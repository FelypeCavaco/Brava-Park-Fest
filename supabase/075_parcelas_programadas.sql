-- =========================================================
-- PARCELAS PROGRAMADAS (cobrança — nível 1)
--
-- Para empresas que cobram em parcelas com data marcada (a Brava continua no
-- modo "livre", como hoje — nada muda para ela).
--
-- 1) Regra de cobrança da empresa (companies): modo (livre / parcelas),
--    sinal %, quantas parcelas, intervalo, 1ª parcela X dias após o sinal,
--    tudo quitado até X dias antes da festa; multa (máx. 2%, CDC), juros ao
--    mês e dias de tolerância no atraso.
-- 2) reservation_installments: o cronograma de cada festa. Nasce sozinho
--    quando a festa é fechada (sai de orçamento) numa empresa em "parcelas";
--    pode ser refeito ou ajustado à mão (a soma precisa bater com o valor).
-- 3) Situação de cada parcela calculada na hora: os pagamentos da festa
--    quitam as parcelas em ordem de vencimento (pagou a mais, abate a
--    próxima; a menos, fica "paga em parte"). Parcela atrasada mostra multa
--    e juros de hoje.
-- 4) Multa e juros recebidos entram como receita própria (other_incomes,
--    tipo 'multa_juros'), sem mudar o valor da festa; dispensa fica anotada
--    na festa com o motivo.
-- 5) Painel (parcelas atrasadas e vencendo), previsão de recebimento por mês
--    e o cronograma no portal do cliente.
--
-- Funciona no banco da Brava (até 074) e no dos clientes.
-- Não altera festas, pagamentos ou valores existentes. Roda numa transação.
-- =========================================================

begin;

-- ---------- 1) Regra de cobrança da empresa ----------
alter table companies add column if not exists billing_mode text not null default 'livre';
alter table companies add column if not exists installment_down_percent numeric(5,2) not null default 30;
alter table companies add column if not exists installment_down_days int not null default 0;
alter table companies add column if not exists installment_count int not null default 3;
alter table companies add column if not exists installment_interval text not null default 'mensal';
alter table companies add column if not exists installment_first_days int not null default 30;
alter table companies add column if not exists installment_deadline_days int not null default 7;
alter table companies add column if not exists late_fees_enabled boolean not null default false;
alter table companies add column if not exists late_fee_percent numeric(5,2) not null default 2;
alter table companies add column if not exists late_interest_percent numeric(5,2) not null default 1;
alter table companies add column if not exists late_grace_days int not null default 0;
alter table companies drop constraint if exists companies_billing_check;
alter table companies add constraint companies_billing_check check (
  billing_mode in ('livre', 'parcelas')
  and installment_down_percent between 0 and 100
  and installment_down_days between 0 and 60
  and installment_count between 0 and 24
  and installment_interval in ('semanal', 'quinzenal', 'mensal')
  and installment_first_days between 0 and 365
  and installment_deadline_days between 0 and 60
  and late_fee_percent between 0 and 2          -- Código de Defesa do Consumidor: multa de mora de no máximo 2%
  and late_interest_percent between 0 and 10
  and late_grace_days between 0 and 60
);

-- ---------- 2) Cronograma de cada festa ----------
create table if not exists reservation_installments (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  seq int not null,
  label text not null,
  due_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (reservation_id, seq)
);
create index if not exists idx_reservation_installments_res on reservation_installments (reservation_id);

-- mesma separação por empresa das outras tabelas (migração 071)
alter table reservation_installments add column if not exists company_id uuid references companies(id);
alter table reservation_installments alter column company_id set default current_company_id();
alter table reservation_installments alter column company_id set not null;
create index if not exists idx_reservation_installments_company on reservation_installments (company_id);
drop trigger if exists trg_set_company_id on reservation_installments;
create trigger trg_set_company_id before insert or update on reservation_installments for each row execute function set_company_id();
alter table reservation_installments enable row level security;
drop policy if exists company_isolation on reservation_installments;
create policy company_isolation on reservation_installments as restrictive for all
  using (company_id = current_company_id() or (auth.uid() is null and current_user = 'app_definer'))
  with check (company_id = current_company_id() or (auth.uid() is null and current_user = 'app_definer'));
drop policy if exists app_definer_all on reservation_installments;
create policy app_definer_all on reservation_installments for all to app_definer using (true) with check (true);
drop policy if exists "read_active" on reservation_installments;
create policy "read_active" on reservation_installments for select using (is_active_user(auth.uid()));
drop policy if exists "write_installments" on reservation_installments;
create policy "write_installments" on reservation_installments for all
  using (has_permission(auth.uid(), 'action:festa.pagamentos'))
  with check (has_permission(auth.uid(), 'action:festa.pagamentos'));
drop trigger if exists trg_audit on reservation_installments;
create trigger trg_audit after insert or update or delete on reservation_installments for each row execute function audit_row_change();
grant all on reservation_installments to app_definer;

-- multa e juros recebidos: receita própria ligada à festa
alter table other_incomes add column if not exists reservation_id uuid references reservations(id) on delete set null;

-- ---------- Valor da festa (o mesmo do portal: pacote + extras + consumo) ----------
create or replace function festa_total_due(p_res uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(r.final_value, 0)
    + coalesce((select sum(price_snapshot * quantity) from reservation_extra_items where reservation_id = p_res), 0)
    + coalesce((select sum(quantity * unit_price) from reservation_consumption where reservation_id = p_res), 0)
  from reservations r where r.id = p_res;
$$;

-- Monta o cronograma pela regra da empresa (só calcula, não grava).
create or replace function build_installment_plan(p_res uuid, p_start date)
returns table (seq int, label text, due_date date, amount numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  co companies%rowtype;
  v_total numeric;
  v_event date;
  v_deadline date;
  v_down numeric;
  v_down_due date;
  v_rest numeric;
  v_dates date[] := '{}';
  v_d date;
  v_n int;
  v_each numeric;
  v_seq int := 0;
  i int;
begin
  select c.* into co from companies c join reservations r on r.company_id = c.id where r.id = p_res;
  select event_date into v_event from reservations where id = p_res;
  v_total := round(festa_total_due(p_res), 2);
  if v_total <= 0 then return; end if;
  v_deadline := greatest(v_event - co.installment_deadline_days, p_start);
  v_down := case when co.installment_count = 0 then v_total else round(v_total * co.installment_down_percent / 100, 2) end;
  v_down_due := least(p_start + co.installment_down_days, v_deadline);
  if v_down > 0 then
    v_seq := 1;
    seq := 1; label := case when co.installment_count = 0 then 'Pagamento único' else 'Sinal' end; due_date := v_down_due; amount := v_down;
    return next;
  end if;
  v_rest := v_total - v_down;
  if v_rest <= 0 then return; end if;
  -- datas das parcelas; as que passariam do prazo final vão para o prazo final (juntas)
  for i in 1..greatest(co.installment_count, 1) loop
    v_d := case co.installment_interval
      when 'semanal' then v_down_due + co.installment_first_days + 7 * (i - 1)
      when 'quinzenal' then v_down_due + co.installment_first_days + 15 * (i - 1)
      else ((v_down_due + co.installment_first_days) + make_interval(months => i - 1))::date
    end;
    v_d := least(v_d, v_deadline);
    if not v_d = any(v_dates) then v_dates := v_dates || v_d; end if;
  end loop;
  v_n := array_length(v_dates, 1);
  v_each := round(v_rest / v_n, 2);
  for i in 1..v_n loop
    v_seq := v_seq + 1;
    seq := v_seq;
    label := v_seq || 'ª parcela';
    due_date := v_dates[i];
    amount := case when i = v_n then v_rest - v_each * (v_n - 1) else v_each end;
    return next;
  end loop;
end;
$$;

-- Gera (ou refaz) o cronograma da festa pela regra da empresa.
create or replace function generate_installments(p_res uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_start date; v_n int;
begin
  if auth.uid() is not null and not has_permission(auth.uid(), 'action:festa.pagamentos') then raise exception 'Sem permissão.'; end if;
  if (select c.billing_mode from companies c join reservations r on r.company_id = c.id where r.id = p_res) <> 'parcelas' then
    raise exception 'A empresa está no modo de pagamento livre (sem parcelas).';
  end if;
  select (created_at at time zone 'America/Sao_Paulo')::date into v_start from reservations where id = p_res;
  delete from reservation_installments where reservation_id = p_res;
  insert into reservation_installments (reservation_id, seq, label, due_date, amount)
  select p_res, b.seq, b.label, b.due_date, b.amount from build_installment_plan(p_res, v_start) b;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Ao fechar a festa (sair de orçamento) numa empresa em "parcelas", o
-- cronograma nasce sozinho.
create or replace function auto_generate_installments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status not in ('orcamento', 'cancelada')
     and (tg_op = 'INSERT' or old.status in ('orcamento', 'cancelada'))
     and not exists (select 1 from reservation_installments where reservation_id = new.id)
     and (select billing_mode from companies where id = new.company_id) = 'parcelas' then
    insert into reservation_installments (reservation_id, seq, label, due_date, amount, company_id)
    select new.id, b.seq, b.label, b.due_date, b.amount, new.company_id
    from build_installment_plan(new.id, (coalesce(new.created_at, now()) at time zone 'America/Sao_Paulo')::date) b;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_auto_generate_installments on reservations;
create trigger trg_auto_generate_installments after insert or update of status on reservations
  for each row execute function auto_generate_installments();

-- Salva um cronograma ajustado à mão. p_items = [{"label","due_date","amount"}]
create or replace function save_installments(p_res uuid, p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_soma numeric; v_seq int := 0; it jsonb;
begin
  if not has_permission(auth.uid(), 'action:festa.pagamentos') then raise exception 'Sem permissão.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Informe pelo menos uma parcela.'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) x where (x ->> 'amount')::numeric <= 0 or nullif(x ->> 'due_date', '') is null) then
    raise exception 'Cada parcela precisa de data e valor maior que zero.';
  end if;
  v_total := round(festa_total_due(p_res), 2);
  select round(sum((x ->> 'amount')::numeric), 2) into v_soma from jsonb_array_elements(p_items) x;
  if v_soma <> v_total then
    raise exception 'A soma das parcelas (%) precisa ser igual ao valor da festa (%).', fmt_brl(v_soma), fmt_brl(v_total);
  end if;
  delete from reservation_installments where reservation_id = p_res;
  for it in select x from jsonb_array_elements(p_items) x order by (x ->> 'due_date')::date loop
    v_seq := v_seq + 1;
    insert into reservation_installments (reservation_id, seq, label, due_date, amount)
    values (p_res, v_seq, coalesce(nullif(trim(it ->> 'label'), ''), v_seq || 'ª parcela'), (it ->> 'due_date')::date, round((it ->> 'amount')::numeric, 2));
  end loop;
end;
$$;

-- ---------- 3) Situação das parcelas ----------
-- Os pagamentos quitam as parcelas em ordem de vencimento.
create or replace function festa_installments(p_res uuid, p_today date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := coalesce(p_today, today_brazil());
  co companies%rowtype;
  v_paid numeric;
  v_rest numeric;
  v_acum numeric := 0;
  v_out jsonb := '[]'::jsonb;
  it record;
  v_pago numeric; v_aberto numeric; v_atraso int; v_multa numeric; v_juros numeric; v_status text; v_data_paga date;
  v_tot_atraso numeric := 0; v_tot_encargos numeric := 0; v_tot_vencer numeric := 0; v_soma numeric := 0;
  v_total numeric := round(festa_total_due(p_res), 2);
begin
  select c.* into co from companies c join reservations r on r.company_id = c.id where r.id = p_res;
  select coalesce(sum(amount), 0) into v_paid from payments where reservation_id = p_res;
  v_rest := v_paid;
  for it in select * from reservation_installments where reservation_id = p_res order by due_date, seq loop
    v_pago := least(it.amount, greatest(v_rest, 0));
    v_rest := v_rest - it.amount;
    v_aberto := it.amount - v_pago;
    v_acum := v_acum + it.amount;
    v_soma := v_soma + it.amount;
    v_atraso := case when v_aberto > 0 and v_today > it.due_date then v_today - it.due_date else 0 end;
    if v_aberto > 0 and co.late_fees_enabled and v_atraso > co.late_grace_days then
      v_multa := round(v_aberto * co.late_fee_percent / 100, 2);
      v_juros := round(v_aberto * co.late_interest_percent / 100 * v_atraso / 30.0, 2);
    else
      v_multa := 0; v_juros := 0;
    end if;
    v_data_paga := null;
    if v_aberto = 0 then
      select x.payment_date into v_data_paga from (
        select payment_date, sum(amount) over (order by payment_date, created_at) s from payments where reservation_id = p_res
      ) x where x.s >= v_acum order by x.payment_date limit 1;
    end if;
    v_status := case
      when v_aberto = 0 then 'paga'
      when v_atraso > 0 then 'atrasada'
      when it.due_date = v_today then 'vence_hoje'
      when v_pago > 0 then 'parcial'
      else 'a_vencer' end;
    if v_status = 'atrasada' then v_tot_atraso := v_tot_atraso + v_aberto; v_tot_encargos := v_tot_encargos + v_multa + v_juros;
    elsif v_aberto > 0 then v_tot_vencer := v_tot_vencer + v_aberto; end if;
    v_out := v_out || jsonb_build_object('seq', it.seq, 'label', it.label, 'vencimento', it.due_date, 'valor', it.amount,
      'pago', v_pago, 'aberto', v_aberto, 'status', v_status, 'dias_atraso', v_atraso, 'multa', v_multa, 'juros', v_juros,
      'total_hoje', v_aberto + v_multa + v_juros, 'paga_em', v_data_paga);
  end loop;
  return jsonb_build_object('parcelas', v_out, 'valor_festa', v_total, 'soma_parcelas', v_soma, 'pago', v_paid,
    'em_atraso', v_tot_atraso, 'encargos', v_tot_encargos, 'a_vencer', v_tot_vencer, 'diferenca', v_total - v_soma);
end;
$$;

-- ---------- 4) Multa e juros: receber ou dispensar ----------
create or replace function register_installment_fees(p_res uuid, p_amount numeric, p_date date, p_method text, p_label text) returns void
language plpgsql security definer set search_path = public as $$
declare v_unit uuid; v_cli text;
begin
  if not has_permission(auth.uid(), 'action:festa.pagamentos') then raise exception 'Sem permissão para registrar pagamentos.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Informe o valor da multa e dos juros.'; end if;
  select r.unit_id, c.name into v_unit, v_cli from reservations r join clients c on c.id = r.client_id where r.id = p_res;
  if v_unit is null then raise exception 'Festa não encontrada.'; end if;
  insert into other_incomes (unit_id, kind, description, amount, received_date, payment_method, reservation_id)
  values (v_unit, 'multa_juros', 'Multa e juros por atraso — ' || coalesce(nullif(trim(p_label), ''), 'parcela') || ' — ' || v_cli,
          round(p_amount, 2), coalesce(p_date, today_brazil()), p_method, p_res);
end;
$$;

create or replace function waive_installment_fees(p_res uuid, p_label text, p_amount numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:festa.pagamentos') then raise exception 'Sem permissão.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Informe o motivo da dispensa.'; end if;
  insert into reservation_notes (reservation_id, body, created_by_name)
  values (p_res, 'Multa e juros dispensados (' || coalesce(nullif(trim(p_label), ''), 'parcela') || ', ' || fmt_brl(coalesce(p_amount, 0)) || '): ' || left(trim(p_reason), 300),
          current_actor_name());
end;
$$;

-- ---------- 5) Painel e previsão ----------
-- Parcelas em aberto até X dias à frente (atrasadas incluídas), de todas as festas.
create or replace function installments_attention(p_days int default 7)
returns table (reservation_id uuid, unit_id uuid, cliente text, telefone text, crianca text, event_date date, token uuid,
               seq int, label text, vencimento date, valor numeric, aberto numeric, status text, dias_atraso int,
               multa numeric, juros numeric, total_hoje numeric)
language plpgsql stable security definer set search_path = public as $$
declare f record; p jsonb;
begin
  if not (has_permission(auth.uid(), 'page:financeiro') or has_permission(auth.uid(), 'page:pagamentos')
          or has_permission(auth.uid(), 'action:festa.pagamentos') or has_permission(auth.uid(), 'page:portal_avisos')) then
    raise exception 'Sem permissão';
  end if;
  for f in
    select r.id, r.unit_id, c.name cli, c.phone, r.child_name, r.event_date, g.token
    from reservations r join clients c on c.id = r.client_id left join guest_list_pages g on g.reservation_id = r.id
    where r.status <> 'cancelada' and exists (select 1 from reservation_installments i where i.reservation_id = r.id)
  loop
    for p in select x from jsonb_array_elements(festa_installments(f.id) -> 'parcelas') x loop
      if (p ->> 'aberto')::numeric > 0 and (p ->> 'vencimento')::date <= today_brazil() + p_days then
        reservation_id := f.id; unit_id := f.unit_id; cliente := f.cli; telefone := f.phone; crianca := f.child_name;
        event_date := f.event_date; token := f.token;
        seq := (p ->> 'seq')::int; label := p ->> 'label'; vencimento := (p ->> 'vencimento')::date;
        valor := (p ->> 'valor')::numeric; aberto := (p ->> 'aberto')::numeric; status := p ->> 'status';
        dias_atraso := (p ->> 'dias_atraso')::int; multa := (p ->> 'multa')::numeric; juros := (p ->> 'juros')::numeric;
        total_hoje := (p ->> 'total_hoje')::numeric;
        return next;
      end if;
    end loop;
  end loop;
end;
$$;

-- Previsão: quanto entra por mês (parcelas em aberto), atrasado e encargos.
create or replace function installments_forecast(p_unit uuid default null, p_months int default 6) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  f record; p jsonb;
  v_hoje date := today_brazil();
  v_atraso numeric := 0; v_encargos numeric := 0;
  v_meses jsonb := '{}'::jsonb; v_chave text;
  v_mes_ini date := date_trunc('month', today_brazil())::date;
begin
  if not (has_permission(auth.uid(), 'page:financeiro') or has_permission(auth.uid(), 'page:pagamentos')) then raise exception 'Sem permissão'; end if;
  for f in select r.id from reservations r
           where r.status <> 'cancelada' and (p_unit is null or r.unit_id = p_unit)
             and exists (select 1 from reservation_installments i where i.reservation_id = r.id) loop
    for p in select x from jsonb_array_elements(festa_installments(f.id) -> 'parcelas') x loop
      if (p ->> 'aberto')::numeric > 0 then
        if p ->> 'status' = 'atrasada' then
          v_atraso := v_atraso + (p ->> 'aberto')::numeric;
          v_encargos := v_encargos + (p ->> 'multa')::numeric + (p ->> 'juros')::numeric;
        else
          v_chave := to_char((p ->> 'vencimento')::date, 'YYYY-MM');
          v_meses := v_meses || jsonb_build_object(v_chave, coalesce((v_meses ->> v_chave)::numeric, 0) + (p ->> 'aberto')::numeric);
        end if;
      end if;
    end loop;
  end loop;
  return jsonb_build_object(
    'atrasado', v_atraso,
    'encargos_hoje', v_encargos,
    'meses', (select coalesce(jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM'), 'valor', coalesce((v_meses ->> to_char(m, 'YYYY-MM'))::numeric, 0)) order by m), '[]'::jsonb)
              from generate_series(v_mes_ini, (v_mes_ini + make_interval(months => greatest(p_months, 1) - 1))::date, interval '1 month') m),
    'encargos_recebidos_mes', (select coalesce(sum(amount), 0) from other_incomes o
                               where o.kind = 'multa_juros' and o.received_date >= v_mes_ini and (p_unit is null or o.unit_id = p_unit)));
end;
$$;

revoke all on function festa_total_due(uuid), build_installment_plan(uuid, date) from public, anon, authenticated;
revoke all on function festa_installments(uuid, date) from public, anon;
grant execute on function festa_installments(uuid, date) to authenticated;
revoke all on function generate_installments(uuid), save_installments(uuid, jsonb), register_installment_fees(uuid, numeric, date, text, text),
  waive_installment_fees(uuid, text, numeric, text), installments_attention(int), installments_forecast(uuid, int) from public, anon;
grant execute on function generate_installments(uuid), save_installments(uuid, jsonb), register_installment_fees(uuid, numeric, date, text, text),
  waive_installment_fees(uuid, text, numeric, text), installments_attention(int), installments_forecast(uuid, int) to authenticated;
revoke all on function auto_generate_installments() from public, anon, authenticated;

-- ---------- Portal do cliente: cronograma ----------
create or replace function portal_get(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  r record;
  v_limit jsonb;
  v_due numeric;
  v_paid numeric;
begin
  if v_res is null then return null; end if;
  select res.*, c.name cliente, u.name unidade, u.full_address, u.pix_key, u.google_review_link, u.extra_hour_price,
         u.guest_min_age, u.menu_deadline_days, u.guest_deadline_days, u.payment_deadline_days, u.playlist_enabled,
         u.parabens_after_min, u.hot_dish_after_parabens_min, u.cake_after_parabens_min, u.portal_rules,
         u.schedule_enabled, u.schedule_items,
         p.name pacote, p.included_items, g.playlist_url
  into r
  from reservations res
  join clients c on c.id = res.client_id
  join units u on u.id = res.unit_id
  left join packages p on p.id = res.package_id
  join guest_list_pages g on g.token = p_token
  where res.id = v_res;

  v_limit := festa_hot_dish_limit(v_res);
  select coalesce(sum(amount), 0) into v_paid from payments where reservation_id = v_res;
  v_due := coalesce(r.final_value, 0)
    + coalesce((select sum(price_snapshot * quantity) from reservation_extra_items where reservation_id = v_res), 0)
    + coalesce((select sum(quantity * unit_price) from reservation_consumption where reservation_id = v_res), 0);

  return jsonb_build_object('cobranca', (select jsonb_build_object('modo', co.billing_mode, 'multa_pct', case when co.late_fees_enabled then co.late_fee_percent else 0 end, 'juros_pct', case when co.late_fees_enabled then co.late_interest_percent else 0 end, 'tolerancia', co.late_grace_days, 'cronograma', festa_installments(v_res)) from companies co where co.id = r.company_id)) || jsonb_build_object(
    'cliente', split_part(r.cliente, ' ', 1),
    'cliente_nome', r.cliente,
    'crianca', r.child_name, 'idade', r.child_age, 'tema', r.theme,
    'data', r.event_date, 'inicio', to_char(r.start_time, 'HH24:MI'), 'fim', to_char(r.end_time, 'HH24:MI'),
    'status', r.status,
    'unidade', r.unidade, 'vila', r.playlist_enabled, 'playlist_habilitada', r.playlist_enabled, 'endereco', r.full_address,
    'pix', r.pix_key, 'google_review_link', r.google_review_link, 'hora_extra', r.extra_hour_price,
    'pacote', r.pacote, 'itens_inclusos', r.included_items,
    'convidados_limite', coalesce(r.guest_count, 0) + coalesce(r.courtesy_guests, 0),
    'pratos_inclusos', (v_limit ->> 'inclusos')::int, 'pratos_adicionais', (v_limit ->> 'adicionais')::int,
    'pratos', case when coalesce(r.hot_dish_flavors, '') = '' then '[]'::jsonb else to_jsonb(array(select trim(x) from unnest(string_to_array(r.hot_dish_flavors, '/')) x where trim(x) <> '')) end,
    'bolo_sabor', r.cake_flavor, 'bolo_massa', r.cake_dough, 'cardapio_confirmado_em', r.menu_confirmed_at, 'cardapio_apos_prazo', coalesce(r.menu_sent_late, false),
    'musica', r.music_choice, 'playlist', r.playlist_url,
    'prazo_cardapio', r.event_date - r.menu_deadline_days, 'prazo_convidados', r.event_date - r.guest_deadline_days, 'prazo_pagamento', r.event_date - r.payment_deadline_days,
    'idade_minima', r.guest_min_age,
    'roteiro', jsonb_build_object('parabens', r.parabens_after_min, 'pratos', r.hot_dish_after_parabens_min, 'bolo', r.cake_after_parabens_min),
    'regras', coalesce(r.portal_rules, '[]'::jsonb),
    'roteiro_ligado', r.schedule_enabled, 'roteiro_itens', coalesce(r.schedule_items, '[]'::jsonb),
    'cardapio', jsonb_build_object('secoes', festa_menu_sections(v_res), 'escolhas', festa_menu_choices(v_res)),
    'empresa', (select jsonb_build_object('nome', co.name, 'logo_url', co.logo_url, 'whatsapp', co.team_whatsapp, 'tema', co.portal_theme) from companies co where co.id = r.company_id),
    'hoje', today_brazil(),
    'festa_terminou', festa_ended(v_res),
    'valor_total', v_due, 'pago', v_paid, 'saldo', greatest(v_due - v_paid, 0),
    'pagamentos', coalesce((select jsonb_agg(jsonb_build_object('data', payment_date, 'valor', amount, 'forma', payment_method, 'obs', notes) order by payment_date, created_at)
                            from payments where reservation_id = v_res), '[]'::jsonb),
    'comprovantes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'valor', amount, 'status', status, 'motivo', reject_reason, 'enviado_em', created_at) order by created_at desc)
                              from portal_receipts where reservation_id = v_res), '[]'::jsonb),
    'contrato', (select jsonb_build_object('gerado_em', generated_at, 'texto', terms_text) from contracts where reservation_id = v_res order by generated_at desc nulls last limit 1),
    'mensagens', coalesce((select jsonb_agg(jsonb_build_object('de_cliente', from_client, 'autor', author_name, 'texto', body, 'em', created_at) order by created_at)
                           from portal_messages where reservation_id = v_res), '[]'::jsonb),
    'historico', coalesce((select jsonb_agg(jsonb_build_object('em', created_at, 'texto', description) order by created_at desc)
                           from (select * from portal_events where reservation_id = v_res order by created_at desc limit 100) e), '[]'::jsonb),
    'avaliou', exists (select 1 from party_reviews pr join review_links rl on rl.token = pr.token where rl.reservation_id = v_res),
    'menu', jsonb_build_object(
      'pratos', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'prato' and active and company_id = r.company_id), '[]'::jsonb),
      'massas', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'bolo_massa' and active and company_id = r.company_id), '[]'::jsonb),
      'sabores', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'bolo_sabor' and active and company_id = r.company_id), '[]'::jsonb)
    )
  );
end;
$$;

grant execute on all functions in schema public to app_definer;
select fix_definer_owners();

commit;

notify pgrst, 'reload schema';
