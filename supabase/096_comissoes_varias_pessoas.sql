-- =========================================================
-- COMISSÕES: VÁRIAS PESSOAS, VALOR FIXO OU PORCENTAGEM, CANCELAR E "JÁ PAGA"
--
-- Até aqui havia UMA pessoa recebendo comissão, com um valor fixo por festa.
-- Agora:
--   1) Cada pessoa que recebe é uma "regra" (commission_rules): nome, de quem
--      são as festas que geram comissão (as que ela cadastrou, ou todas) e a
--      data de início. O valor tem histórico (commission_rule_versions): fixo
--      por festa (ex.: R$ 150) ou porcentagem do valor da festa (ex.: 5%).
--      Cada festa usa o valor que valia no dia em que foi cadastrada
--      (igual a antes). Porcentagem = % do valor firmado da festa
--      (final_value, já com desconto; sem extras nem consumo). Se o valor da
--      festa mudar depois de a comissão ser paga, a diferença entra como
--      "ajuste" no próximo repasse (mesma regra de antes).
--   2) O repasse passa a ser POR PESSOA (commission_payouts.rule_id).
--   3) "Já paga, sem lançar no Financeiro": o repasse pode ser registrado sem
--      criar conta no Financeiro (commission_payouts.finance_launched = false),
--      para o que já foi lançado por fora. Pode valer para o repasse inteiro
--      ou só para festas escolhidas.
--   4) Cancelar uma comissão (commission_cancellations): a festa deixa de gerar
--      comissão para aquela pessoa. Se já tinha sido paga, o valor é abatido
--      no próximo repasse (mesma regra de festa cancelada). Dá para restaurar.
--
-- O que já existe é preservado: a configuração e os valores atuais viram a
-- primeira pessoa; os repasses já feitos ficam ligados a ela. As tabelas
-- antigas (commission_settings, commission_rates) continuam no banco, sem uso.
-- Nada aqui altera festas, pagamentos ou contas já lançadas.
-- Roda dentro de uma transação. Para desfazer: 096_REVERTER_comissoes_varias_pessoas.sql
-- =========================================================

begin;

-- ---------- 1) Tabelas ----------
create table if not exists commission_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id),
  name text not null,
  user_id uuid references user_profiles(id) on delete set null,
  scope text not null default 'cadastradas' check (scope in ('cadastradas', 'todas')),
  start_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists commission_rule_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id),
  rule_id uuid not null references commission_rules(id) on delete cascade,
  mode text not null check (mode in ('fixo', 'percentual')),
  value numeric(10,2) not null check (value >= 0),
  valid_from date not null,
  created_at timestamptz not null default now(),
  check (mode = 'fixo' or value <= 100)
);
create index if not exists idx_commission_versions_rule on commission_rule_versions (rule_id, valid_from);

create table if not exists commission_cancellations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id),
  rule_id uuid not null references commission_rules(id) on delete cascade,
  reservation_id uuid not null references reservations(id) on delete cascade,
  reason text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (rule_id, reservation_id)
);

alter table commission_payouts add column if not exists rule_id uuid references commission_rules(id);
alter table commission_payouts add column if not exists finance_launched boolean not null default true;
alter table commission_payouts add column if not exists note text;
alter table commission_payout_items add column if not exists rule_id uuid references commission_rules(id);
create index if not exists idx_commission_items_rule on commission_payout_items (rule_id);
create index if not exists idx_commission_payouts_rule on commission_payouts (rule_id);

-- ---------- 2) O que já existe vira a primeira pessoa ----------
do $$
begin
  if not exists (select 1 from commission_rules) then
    insert into commission_rules (company_id, name, user_id, scope, start_date)
    select cs.company_id, cs.beneficiary, cs.beneficiary_user_id,
           case when cs.beneficiary_user_id is null then 'todas' else 'cadastradas' end, cs.start_date
    from commission_settings cs;

    insert into commission_rule_versions (company_id, rule_id, mode, value, valid_from, created_at)
    select r.company_id, ru.id, 'fixo', r.amount, r.valid_from, r.created_at
    from commission_rates r join commission_rules ru on ru.company_id = r.company_id;

    -- liga os repasses antigos à primeira pessoa (sem disparar histórico nem travas)
    alter table commission_payouts disable trigger user;
    alter table commission_payout_items disable trigger user;
    update commission_payouts p set rule_id = (select ru.id from commission_rules ru where ru.company_id = p.company_id order by ru.created_at limit 1)
    where p.rule_id is null;
    update commission_payout_items i set rule_id = (select ru.id from commission_rules ru where ru.company_id = i.company_id order by ru.created_at limit 1)
    where i.rule_id is null;
    alter table commission_payouts enable trigger user;
    alter table commission_payout_items enable trigger user;
  end if;
end $$;

-- ---------- 3) Empresa, isolamento, acesso e histórico das tabelas novas ----------
do $$
declare t text;
begin
  foreach t in array array['commission_rules', 'commission_rule_versions', 'commission_cancellations'] loop
    execute format('create index if not exists %I on %I (company_id)', 'idx_' || t || '_company', t);
    execute format('drop trigger if exists trg_set_company_id on %I', t);
    execute format('create trigger trg_set_company_id before insert or update on %I for each row execute function set_company_id()', t);
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists company_isolation on %I', t);
    execute format('create policy company_isolation on %I as restrictive for all
      using (company_id = current_company_id() or (auth.uid() is null and current_user = %L))
      with check (company_id = current_company_id() or (auth.uid() is null and current_user = %L))', t, 'app_definer', 'app_definer');
    execute format('drop policy if exists app_definer_all on %I', t);
    execute format('create policy app_definer_all on %I for all to app_definer using (true) with check (true)', t);
    execute format('drop policy if exists "read_comissoes" on %I', t);
    execute format('create policy "read_comissoes" on %I for select using (has_permission(auth.uid(), %L))', t, 'page:comissoes');
    execute format('grant select on %I to authenticated', t);
    execute format('grant all on %I to app_definer', t);
    execute format('drop trigger if exists trg_audit on %I', t);
    execute format('create trigger trg_audit after insert or update or delete on %I for each row execute function audit_row_change()', t);
  end loop;
end $$;

-- ---------- 4) Cálculo (uma linha por festa e por pessoa) ----------
-- Devido = comissão da festa pelo valor que valia no dia do cadastro, se a
-- festa conta para essa pessoa, não está cancelada e a comissão não foi
-- cancelada à mão; senão zero. Pago = soma dos repasses. A diferença é o que
-- entra no próximo repasse (positivo = pagar, negativo = abater).
create or replace function commission_calc(p_rule uuid default null)
returns table (rule_id uuid, rule_name text, modo text, valor_regra numeric, reservation_id uuid, unit_id uuid, cliente text,
               cadastro date, event_date date, status text, cancelada_em date, cadastrada_por text, conta boolean,
               cancelada_manual boolean, valor_festa numeric, devido numeric, pago numeric, ultimo_repasse date, fora_financeiro boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'page:comissoes') then raise exception 'Sem permissão'; end if;
  return query
  with base as (
    select ru.id rid, ru.name rname, ver.mode vmode, ver.value vvalue, r.id resid, r.unit_id uid, coalesce(c.name, '—') cli,
           (r.created_at at time zone 'America/Sao_Paulo')::date cad, r.event_date ev, r.status::text st,
           (r.cancelled_at at time zone 'America/Sao_Paulo')::date canc, coalesce(up.name, '—') quem,
           (ru.scope = 'todas' or (ru.user_id is not null and r.registered_by = ru.user_id)) conta,
           exists (select 1 from commission_cancellations x where x.rule_id = ru.id and x.reservation_id = r.id) manual,
           coalesce(r.final_value, 0) fv
    from commission_rules ru
    join reservations r on r.company_id = ru.company_id and (r.created_at at time zone 'America/Sao_Paulo')::date >= ru.start_date
    left join clients c on c.id = r.client_id
    left join user_profiles up on up.id = r.registered_by
    left join lateral (
      select v.mode, v.value from commission_rule_versions v
      where v.rule_id = ru.id and v.valid_from <= (r.created_at at time zone 'America/Sao_Paulo')::date
      order by v.valid_from desc, v.created_at desc limit 1
    ) ver on true
    where p_rule is null or ru.id = p_rule
  )
  select b.rid, b.rname, b.vmode, b.vvalue, b.resid, b.uid, b.cli, b.cad, b.ev, b.st, b.canc, b.quem, b.conta, b.manual, b.fv,
         case when b.st <> 'cancelada' and b.conta and not b.manual
              then coalesce(case b.vmode when 'percentual' then round(b.fv * b.vvalue / 100, 2) else b.vvalue end, 0)
              else 0 end,
         coalesce((select sum(i.amount) from commission_payout_items i where i.reservation_id = b.resid and i.rule_id = b.rid), 0),
         (select max(p.paid_date) from commission_payout_items i join commission_payouts p on p.id = i.payout_id
           where i.reservation_id = b.resid and i.rule_id = b.rid),
         exists (select 1 from commission_payout_items i join commission_payouts p on p.id = i.payout_id
                 where i.reservation_id = b.resid and i.rule_id = b.rid and not p.finance_launched)
  from base b;
end;
$$;

-- O que falta pagar (ou abater). p_until: comissões de festas cadastradas até
-- esta data (abatimentos entram sempre).
drop function if exists commission_pending(date);
create or replace function commission_pending(p_until date default null, p_rule uuid default null)
returns table (rule_id uuid, rule_name text, reservation_id uuid, unit_id uuid, cliente text, cadastro date, event_date date,
               status text, cancelada_em date, kind text, amount numeric, modo text, valor_regra numeric, valor_festa numeric,
               cancelada_manual boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_until date := coalesce(p_until, commission_last_sunday());
begin
  if not has_permission(auth.uid(), 'page:comissoes') then raise exception 'Sem permissão'; end if;
  return query
  select k.rule_id, k.rule_name, k.reservation_id, k.unit_id, k.cliente, k.cadastro, k.event_date, k.status, k.cancelada_em,
         case when k.pago = 0 and k.devido > 0 then 'comissao'
              when k.devido = 0 and k.pago > 0 then 'abatimento'
              else 'ajuste' end,
         k.devido - k.pago, k.modo, k.valor_regra, k.valor_festa, k.cancelada_manual
  from commission_calc(p_rule) k
  where k.devido - k.pago <> 0 and (k.devido - k.pago < 0 or k.cadastro <= v_until)
  order by k.rule_name, k.cadastro, k.cliente;
end;
$$;

-- Histórico por festa e por pessoa, com a situação da comissão.
drop function if exists commission_history(date, date);
create or replace function commission_history(p_from date default null, p_to date default null, p_rule uuid default null)
returns table (rule_id uuid, rule_name text, reservation_id uuid, unit_id uuid, cliente text, cadastro date, event_date date, status text,
               cancelada_em date, cadastrada_por text, conta boolean, devido numeric, pago numeric, ultimo_repasse date,
               situacao text, modo text, valor_regra numeric, valor_festa numeric, fora_financeiro boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_last date := commission_last_sunday();
begin
  if not has_permission(auth.uid(), 'page:comissoes') then raise exception 'Sem permissão'; end if;
  return query
  select k.rule_id, k.rule_name, k.reservation_id, k.unit_id, k.cliente, k.cadastro, k.event_date, k.status, k.cancelada_em,
         k.cadastrada_por, k.conta, k.devido, k.pago, k.ultimo_repasse,
         case
           when k.devido > 0 and k.pago = k.devido then 'paga'
           when k.devido > 0 and k.pago = 0 then case when k.cadastro <= v_last then 'a_pagar' else 'semana_atual' end
           when k.devido > 0 then 'ajuste_pendente'
           when k.devido = 0 and k.pago > 0 then 'abater'
           when k.devido = 0 and k.pago = 0 and exists (select 1 from commission_payout_items i where i.reservation_id = k.reservation_id and i.rule_id = k.rule_id) then 'abatida'
           when k.cancelada_manual then 'cancelada_manual'
           when not k.conta then 'outra_pessoa'
           else 'cancelada_antes'
         end,
         k.modo, k.valor_regra, k.valor_festa, k.fora_financeiro
  from commission_calc(p_rule) k
  where (p_from is null or k.cadastro >= p_from) and (p_to is null or k.cadastro <= p_to)
  order by k.cadastro desc, k.cliente, k.rule_name;
end;
$$;

-- ---------- 5) Pagar o repasse de uma pessoa ----------
-- p_launch = true: cria as contas pagas no Financeiro (uma por unidade).
-- p_launch = false: só marca como paga (já foi lançado por fora).
-- p_reservations: paga só estas festas (senão, tudo o que está pendente até p_until).
drop function if exists pay_commissions(date, date, text);
create or replace function pay_commissions(p_rule uuid, p_until date, p_paid_date date, p_payment_method text,
                                           p_launch boolean default true, p_reservations uuid[] default null, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_payout uuid;
  v_total numeric := 0;
  u record;
  v_rule commission_rules%rowtype;
  v_sel boolean := p_reservations is not null;
begin
  if not has_permission(auth.uid(), 'action:comissoes.pagar') then raise exception 'Sem permissão'; end if;
  select * into v_rule from commission_rules where id = p_rule;
  if not found then raise exception 'Pessoa não encontrada.'; end if;
  if p_until is null or p_until > today_brazil() then raise exception 'Escolha até que dia o repasse paga (não pode ser no futuro).'; end if;
  if p_paid_date is null then raise exception 'Informe a data do pagamento.'; end if;
  if p_paid_date > today_brazil() then raise exception 'A data do pagamento não pode ser no futuro.'; end if;
  if v_sel and coalesce(array_length(p_reservations, 1), 0) = 0 then raise exception 'Escolha pelo menos uma festa.'; end if;

  create temp table if not exists tmp_comissao (reservation_id uuid, unit_id uuid, kind text, amount numeric) on commit drop;
  delete from tmp_comissao;
  insert into tmp_comissao (reservation_id, unit_id, kind, amount)
  select p.reservation_id, p.unit_id, p.kind, p.amount
  from commission_pending(p_until, p_rule) p
  where not v_sel or p.reservation_id = any(p_reservations);
  -- lançando no Financeiro: unidade cujo total não fica positivo (só abatimentos) não é paga agora
  if p_launch then
    delete from tmp_comissao t where t.unit_id in (select x.unit_id from tmp_comissao x group by x.unit_id having sum(x.amount) <= 0);
  end if;
  select coalesce(sum(amount), 0) into v_total from tmp_comissao;
  if v_total <= 0 then raise exception 'Não há comissão a pagar neste período.'; end if;

  insert into commission_payouts (rule_id, until_date, paid_date, payment_method, total, finance_launched, note)
  values (p_rule, p_until, p_paid_date, p_payment_method, v_total, coalesce(p_launch, true),
          coalesce(nullif(trim(p_note), ''), case when p_launch is false then 'Já lançado no Financeiro por fora; marcado como pago aqui.' end))
  returning id into v_payout;
  insert into commission_payout_items (payout_id, rule_id, reservation_id, unit_id, kind, amount)
  select v_payout, p_rule, reservation_id, unit_id, kind, amount from tmp_comissao;

  if p_launch is not false then
    perform set_config('app.expense_fn', '1', true);
    for u in
      select t.unit_id, sum(t.amount) total,
             count(*) filter (where t.kind = 'comissao') n_com, coalesce(sum(t.amount) filter (where t.kind = 'comissao'), 0) v_com,
             count(*) filter (where t.kind = 'abatimento') n_ab, coalesce(-sum(t.amount) filter (where t.kind = 'abatimento'), 0) v_ab,
             count(*) filter (where t.kind = 'ajuste') n_aj
      from tmp_comissao t group by t.unit_id
    loop
      insert into expenses (unit_id, category, description, supplier, amount, due_date, paid_date, status, payment_method, commission_payout_id)
      values (u.unit_id, 'Comissão',
              'Comissão de ' || v_rule.name || ' — '
                || case when v_sel then 'festas escolhidas' else 'festas cadastradas até ' || to_char(p_until, 'DD/MM/YYYY') end
                || ': ' || u.n_com || ' festa(s) (' || fmt_brl(u.v_com) || ')'
                || case when u.n_ab > 0 then ', ' || u.n_ab || ' cancelada(s) abatida(s) (−' || fmt_brl(u.v_ab) || ')' else '' end
                || case when u.n_aj > 0 then ', ' || u.n_aj || ' ajuste(s) de valor' else '' end,
              v_rule.name, u.total, p_paid_date, p_paid_date, 'pago', p_payment_method, v_payout);
    end loop;
    perform set_config('app.expense_fn', '', true);
  end if;
  return v_payout;
end;
$$;

-- ---------- 6) Cancelar / restaurar uma comissão ----------
create or replace function cancel_commission(p_rule uuid, p_reservation uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:comissoes.pagar') then raise exception 'Sem permissão'; end if;
  if not exists (select 1 from commission_rules where id = p_rule) then raise exception 'Pessoa não encontrada.'; end if;
  if not exists (select 1 from reservations where id = p_reservation) then raise exception 'Festa não encontrada.'; end if;
  insert into commission_cancellations (rule_id, reservation_id, reason, created_by)
  values (p_rule, p_reservation, nullif(trim(p_reason), ''), current_actor_name())
  on conflict (rule_id, reservation_id) do nothing;
end;
$$;

create or replace function restore_commission(p_rule uuid, p_reservation uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:comissoes.pagar') then raise exception 'Sem permissão'; end if;
  delete from commission_cancellations where rule_id = p_rule and reservation_id = p_reservation;
end;
$$;

-- ---------- 7) Pessoas e valores ----------
create or replace function create_commission_rule(p_name text, p_user uuid, p_scope text, p_start date, p_mode text, p_value numeric)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not has_permission(auth.uid(), 'action:comissoes.configurar') then raise exception 'Sem permissão'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'Informe o nome de quem recebe.'; end if;
  if p_scope not in ('cadastradas', 'todas') then raise exception 'Escolha de quais festas vem a comissão.'; end if;
  if p_scope = 'cadastradas' and p_user is null then raise exception 'Escolha quem cadastra as festas dessa pessoa (ou use "todas as festas").'; end if;
  if p_start is null then raise exception 'Informe a data de início.'; end if;
  if p_mode not in ('fixo', 'percentual') then raise exception 'Escolha valor fixo ou porcentagem.'; end if;
  if p_value is null or p_value < 0 or (p_mode = 'percentual' and p_value > 100) then raise exception 'Informe um valor válido.'; end if;
  insert into commission_rules (name, user_id, scope, start_date)
  values (trim(p_name), case when p_scope = 'cadastradas' then p_user end, p_scope, p_start) returning id into v_id;
  insert into commission_rule_versions (rule_id, mode, value, valid_from) values (v_id, p_mode, round(p_value, 2), date '2000-01-01');
  return v_id;
end;
$$;

create or replace function update_commission_rule(p_id uuid, p_name text, p_user uuid, p_scope text, p_start date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:comissoes.configurar') then raise exception 'Sem permissão'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'Informe o nome de quem recebe.'; end if;
  if p_scope not in ('cadastradas', 'todas') then raise exception 'Escolha de quais festas vem a comissão.'; end if;
  if p_scope = 'cadastradas' and p_user is null then raise exception 'Escolha quem cadastra as festas dessa pessoa (ou use "todas as festas").'; end if;
  if p_start is null then raise exception 'Informe a data de início.'; end if;
  update commission_rules set name = trim(p_name), user_id = case when p_scope = 'cadastradas' then p_user end, scope = p_scope, start_date = p_start
  where id = p_id;
  if not found then raise exception 'Pessoa não encontrada.'; end if;
end;
$$;

-- Novo valor (fixo ou %) valendo para festas cadastradas a partir de uma data.
create or replace function set_commission_value(p_rule uuid, p_mode text, p_value numeric, p_valid_from date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:comissoes.configurar') then raise exception 'Sem permissão'; end if;
  if not exists (select 1 from commission_rules where id = p_rule) then raise exception 'Pessoa não encontrada.'; end if;
  if p_mode not in ('fixo', 'percentual') then raise exception 'Escolha valor fixo ou porcentagem.'; end if;
  if p_value is null or p_value < 0 or (p_mode = 'percentual' and p_value > 100) then raise exception 'Informe um valor válido.'; end if;
  if p_valid_from is null then raise exception 'Informe a partir de quando vale.'; end if;
  insert into commission_rule_versions (rule_id, mode, value, valid_from) values (p_rule, p_mode, round(p_value, 2), p_valid_from);
end;
$$;

-- Só apaga a pessoa se nunca teve repasse nem comissão cancelada.
create or replace function delete_commission_rule(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:comissoes.configurar') then raise exception 'Sem permissão'; end if;
  if exists (select 1 from commission_payouts where rule_id = p_id) or exists (select 1 from commission_cancellations where rule_id = p_id) then
    raise exception 'Essa pessoa já tem repasse ou comissão cancelada. Para parar de pagar, mude o valor para R$ 0 a partir de uma data.';
  end if;
  delete from commission_rules where id = p_id;
end;
$$;

-- ---------- 8) Acesso às funções ----------
revoke all on function commission_calc(uuid) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'commission_pending(date, uuid)', 'commission_history(date, date, uuid)',
    'pay_commissions(uuid, date, date, text, boolean, uuid[], text)',
    'cancel_commission(uuid, uuid, text)', 'restore_commission(uuid, uuid)',
    'create_commission_rule(text, uuid, text, date, text, numeric)', 'update_commission_rule(uuid, text, uuid, text, date)',
    'set_commission_value(uuid, text, numeric, date)', 'delete_commission_rule(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

select fix_definer_owners();

commit;

notify pgrst, 'reload schema';
