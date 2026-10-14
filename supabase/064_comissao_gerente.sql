-- =========================================================
-- COMISSÃO DA GERENTE POR FESTA FECHADA
--
-- Regras combinadas:
--   • Comissão por festa CADASTRADA (data do cadastro, fuso de Brasília).
--   • Valor fixo (hoje R$ 150), editável pela tela. Cada festa usa o valor
--     que valia no dia em que foi cadastrada; o histórico de valores fica
--     guardado.
--   • Repasse toda segunda-feira: paga as festas cadastradas até o domingo
--     anterior que ainda não foram pagas.
--   • Festa com comissão já paga que é cancelada depois: o valor é abatido
--     no próximo repasse. Se a festa voltar (deixar de estar cancelada), a
--     comissão volta a ser devida.
--   • Festa cadastrada e cancelada antes do repasse: não gera comissão.
--   • Só contam festas cadastradas a partir da data de início configurada
--     (para não cobrar de novo o que já foi pago fora do sistema).
--   • Pagar o repasse cria, em cada unidade, uma conta PAGA no Financeiro
--     (categoria "Comissão"), com a lista das festas. Essa conta só muda
--     pela tela Comissões. Unidade cujo total da semana não fica positivo
--     (só abatimentos) não é paga: os itens ficam para o próximo repasse.
--
-- Nada aqui altera festas, pagamentos ou contas já existentes.
-- Roda dentro de uma transação. Para desfazer: 064_REVERTER_comissao_gerente.sql
-- =========================================================

begin;

-- ---------- Tabelas ----------
create table if not exists commission_rates (
  id uuid primary key default gen_random_uuid(),
  amount numeric(10,2) not null check (amount >= 0),
  valid_from date not null,
  created_at timestamptz not null default now()
);

create table if not exists commission_settings (
  id uuid primary key default gen_random_uuid(),
  unica boolean not null default true unique check (unica), -- uma linha só
  start_date date not null,
  beneficiary text not null default 'Gerente'
);

create table if not exists commission_payouts (
  id uuid primary key default gen_random_uuid(),
  until_date date not null,       -- festas cadastradas até esta data
  paid_date date not null,
  payment_method text,
  total numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create table if not exists commission_payout_items (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references commission_payouts(id) on delete cascade,
  reservation_id uuid not null references reservations(id) on delete cascade,
  unit_id uuid not null references units(id),
  kind text not null check (kind in ('comissao', 'abatimento', 'ajuste')),
  amount numeric(10,2) not null
);
create index if not exists idx_commission_items_reservation on commission_payout_items (reservation_id);
create index if not exists idx_commission_items_payout on commission_payout_items (payout_id);

alter table expenses add column if not exists commission_payout_id uuid references commission_payouts(id) on delete set null;

-- Valor inicial e data de início: contam as festas cadastradas a partir de
-- segunda, 19/10/2026 (as anteriores foram lançadas à parte como despesa).
-- Os dois podem ser mudados pela tela.
insert into commission_rates (amount, valid_from)
select 150, date '2000-01-01' where not exists (select 1 from commission_rates);
insert into commission_settings (start_date)
select date '2026-10-19'
where not exists (select 1 from commission_settings);

-- ---------- Acesso: só leitura pela tela; gravação só pelas funções ----------
alter table commission_rates enable row level security;
alter table commission_settings enable row level security;
alter table commission_payouts enable row level security;
alter table commission_payout_items enable row level security;
drop policy if exists "read_comissoes" on commission_rates;
drop policy if exists "read_comissoes" on commission_settings;
drop policy if exists "read_comissoes" on commission_payouts;
drop policy if exists "read_comissoes" on commission_payout_items;
create policy "read_comissoes" on commission_rates for select using (has_permission(auth.uid(), 'page:comissoes'));
create policy "read_comissoes" on commission_settings for select using (has_permission(auth.uid(), 'page:comissoes'));
create policy "read_comissoes" on commission_payouts for select using (has_permission(auth.uid(), 'page:comissoes'));
create policy "read_comissoes" on commission_payout_items for select using (has_permission(auth.uid(), 'page:comissoes'));
grant select on commission_rates, commission_settings, commission_payouts, commission_payout_items to authenticated;

-- Permissões: quem já vê o Financeiro vê, paga e configura comissões.
-- Desfazer um repasse: só Administrador (nenhuma linha criada).
insert into role_permission_items (role_id, permission_key, allowed)
select r.id, k, true
from roles r
cross join unnest(array['page:comissoes', 'action:comissoes.pagar', 'action:comissoes.configurar']) k
where not r.is_admin
  and exists (select 1 from role_permission_items x where x.role_id = r.id and x.permission_key = 'page:financeiro' and x.allowed)
on conflict (role_id, permission_key) do nothing;

-- ---------- Trava da conta de comissão ----------
create or replace function guard_locked_expense() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.expense_fn', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if old.commission_payout_id is not null then
    if tg_op = 'DELETE' then
      raise exception 'Conta de comissão: desfaça o repasse pela tela Comissões.';
    end if;
    if new.amount is distinct from old.amount or new.unit_id is distinct from old.unit_id
       or new.category is distinct from old.category or new.description is distinct from old.description
       or new.status is distinct from old.status or new.commission_payout_id is distinct from old.commission_payout_id then
      raise exception 'Conta de comissão: o valor vem do repasse; para mudar, desfaça o repasse pela tela Comissões.';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.commission_payout_id is not null then
    raise exception 'Só a tela Comissões pode ligar uma conta a um repasse.';
  end if;
  if old.settlement_batch_id is not null then
    raise exception 'Lançamento de acerto entre unidades: altere ou desfaça pela tela Acertos entre unidades.';
  end if;
  if old.is_stock_purchase or (old.category = 'Estorno' and old.reservation_id is not null) or old.settlement_id is not null then
    if tg_op = 'DELETE' then
      raise exception '%', case
        when old.is_stock_purchase then 'Compra de estoque: exclua pela Entrada de compra (tela Estoque).'
        when old.settlement_id is not null then 'Conta de acerto entre unidades: cancele pela tela Acertos entre unidades.'
        else 'Estorno: altere pela festa cancelada.' end;
    end if;
    if new.amount is distinct from old.amount or new.unit_id is distinct from old.unit_id
       or new.category is distinct from old.category or new.description is distinct from old.description
       or new.supplier is distinct from old.supplier or new.is_stock_purchase is distinct from old.is_stock_purchase
       or new.reservation_id is distinct from old.reservation_id or new.settlement_id is distinct from old.settlement_id
       or (old.settlement_id is not null and (new.status = 'cancelado' or old.status = 'cancelado')) then
      raise exception '%', case
        when old.is_stock_purchase then 'Compra de estoque: edite pela Entrada de compra (tela Estoque).'
        when old.settlement_id is not null then 'Conta de acerto entre unidades: o valor vem da transferência; para cancelar, use a tela Acertos entre unidades.'
        else 'Estorno: altere o valor pela festa cancelada.' end;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function guard_commission_expense_insert() returns trigger
language plpgsql as $$
begin
  if new.commission_payout_id is not null and coalesce(current_setting('app.expense_fn', true), '') <> '1' then
    raise exception 'Só a tela Comissões pode criar conta de comissão.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_commission_expense_insert on expenses;
create trigger trg_guard_commission_expense_insert before insert on expenses
  for each row execute function guard_commission_expense_insert();

-- ---------- Cálculo ----------
-- Valor da comissão que valia numa data.
create or replace function commission_rate_at(p_date date) returns numeric
language sql stable security definer set search_path = public as $$
  select amount from commission_rates where valid_from <= p_date order by valid_from desc, created_at desc limit 1
$$;

-- Último domingo já encerrado (o repasse de segunda paga até ele).
create or replace function commission_last_sunday() returns date
language sql stable as $$
  select today_brazil() - extract(isodow from today_brazil())::int
$$;

-- O que falta pagar (ou abater) por festa. Devido = valor da comissão do dia
-- do cadastro se a festa não está cancelada, ou zero se está. Já pago = soma
-- dos repasses. A diferença é o que entra no próximo repasse.
-- p_until: comissões de festas cadastradas até esta data (abatimentos entram
-- sempre, qualquer que seja a data do cadastro).
create or replace function commission_pending(p_until date default null)
returns table (reservation_id uuid, unit_id uuid, cliente text, cadastro date, event_date date, status text,
               cancelada_em date, kind text, amount numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_until date := coalesce(p_until, commission_last_sunday());
begin
  if not has_permission(auth.uid(), 'page:comissoes') then raise exception 'Sem permissão'; end if;
  return query
  with base as (
    select r.id, r.unit_id, coalesce(c.name, '—') cli, (r.created_at at time zone 'America/Sao_Paulo')::date cad,
           r.event_date ev, r.status::text st, (r.cancelled_at at time zone 'America/Sao_Paulo')::date canc,
           case when r.status <> 'cancelada' then coalesce(commission_rate_at((r.created_at at time zone 'America/Sao_Paulo')::date), 0) else 0 end devido,
           coalesce((select sum(i.amount) from commission_payout_items i where i.reservation_id = r.id), 0) pago
    from reservations r left join clients c on c.id = r.client_id
    where (r.created_at at time zone 'America/Sao_Paulo')::date >= (select start_date from commission_settings)
  )
  select b.id, b.unit_id, b.cli, b.cad, b.ev, b.st, b.canc,
         case when b.pago = 0 and b.devido > 0 then 'comissao'
              when b.devido = 0 and b.pago > 0 then 'abatimento'
              else 'ajuste' end,
         b.devido - b.pago
  from base b
  where b.devido - b.pago <> 0
    and (b.devido - b.pago < 0 or b.cad <= v_until)
  order by b.cad, b.cli;
end;
$$;

-- ---------- Pagar o repasse ----------
create or replace function pay_commissions(p_until date, p_paid_date date, p_payment_method text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_payout uuid;
  v_total numeric := 0;
  u record;
  v_benef text := (select beneficiary from commission_settings);
begin
  if not has_permission(auth.uid(), 'action:comissoes.pagar') then raise exception 'Sem permissão'; end if;
  if p_until is null or p_until > today_brazil() then raise exception 'Escolha até que dia o repasse paga (não pode ser no futuro).'; end if;
  if p_paid_date is null then raise exception 'Informe a data do pagamento.'; end if;

  -- Unidades com total positivo no período
  create temp table if not exists tmp_comissao (like commission_payout_items including defaults) on commit drop;
  delete from tmp_comissao;
  insert into tmp_comissao (payout_id, reservation_id, unit_id, kind, amount)
  select '00000000-0000-0000-0000-000000000000'::uuid, p.reservation_id, p.unit_id, p.kind, p.amount
  from commission_pending(p_until) p;
  delete from tmp_comissao t where t.unit_id in (select x.unit_id from tmp_comissao x group by x.unit_id having sum(x.amount) <= 0);
  select coalesce(sum(amount), 0) into v_total from tmp_comissao;
  if v_total <= 0 then raise exception 'Não há comissão a pagar até esta data.'; end if;

  insert into commission_payouts (until_date, paid_date, payment_method, total)
  values (p_until, p_paid_date, p_payment_method, v_total) returning id into v_payout;
  insert into commission_payout_items (payout_id, reservation_id, unit_id, kind, amount)
  select v_payout, reservation_id, unit_id, kind, amount from tmp_comissao;

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
            'Comissão de ' || v_benef || ' — festas cadastradas até ' || to_char(p_until, 'DD/MM/YYYY') || ': '
              || u.n_com || ' festa(s) (' || fmt_brl(u.v_com) || ')'
              || case when u.n_ab > 0 then ', ' || u.n_ab || ' cancelada(s) abatida(s) (−' || fmt_brl(u.v_ab) || ')' else '' end
              || case when u.n_aj > 0 then ', ' || u.n_aj || ' ajuste(s) de valor' else '' end,
            v_benef, u.total, p_paid_date, p_paid_date, 'pago', p_payment_method, v_payout);
  end loop;
  perform set_config('app.expense_fn', '', true);
  return v_payout;
end;
$$;

-- Desfaz um repasse (só Administrador): apaga as contas e o repasse; as
-- festas voltam a ficar pendentes.
create or replace function undo_commission_payout(p_payout uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:comissoes.desfazer') then raise exception 'Sem permissão'; end if;
  perform set_config('app.expense_fn', '1', true);
  delete from expenses where commission_payout_id = p_payout;
  perform set_config('app.expense_fn', '', true);
  delete from commission_payouts where id = p_payout;
end;
$$;

-- ---------- Configuração ----------
create or replace function set_commission_rate(p_amount numeric, p_valid_from date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:comissoes.configurar') then raise exception 'Sem permissão'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Informe um valor válido.'; end if;
  if p_valid_from is null then raise exception 'Informe a partir de quando vale.'; end if;
  insert into commission_rates (amount, valid_from) values (round(p_amount, 2), p_valid_from);
end;
$$;

create or replace function set_commission_settings(p_start date, p_beneficiary text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:comissoes.configurar') then raise exception 'Sem permissão'; end if;
  if p_start is null then raise exception 'Informe a data de início.'; end if;
  update commission_settings set start_date = p_start, beneficiary = coalesce(nullif(trim(p_beneficiary), ''), 'Gerente') where unica;
end;
$$;

-- ---------- Acessos às funções ----------
revoke all on function commission_rate_at(date) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'commission_last_sunday()', 'commission_pending(date)', 'pay_commissions(date, date, text)',
    'undo_commission_payout(uuid)', 'set_commission_rate(numeric, date)', 'set_commission_settings(date, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Histórico de alterações
drop trigger if exists trg_audit on commission_rates;
create trigger trg_audit after insert or update or delete on commission_rates for each row execute function audit_row_change();
drop trigger if exists trg_audit on commission_settings;
create trigger trg_audit after insert or update or delete on commission_settings for each row execute function audit_row_change();
drop trigger if exists trg_audit on commission_payouts;
create trigger trg_audit after insert or update or delete on commission_payouts for each row execute function audit_row_change();

commit;

-- Avisa a API do Supabase para enxergar as tabelas e funções novas na hora.
notify pgrst, 'reload schema';
