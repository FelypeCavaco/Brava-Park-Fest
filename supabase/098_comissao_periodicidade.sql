-- =========================================================
-- COMISSÕES: QUANDO CADA PESSOA É PAGA (semanal, quinzenal ou mensal)
--
-- Cada pessoa que recebe comissão passa a ter a sua data de repasse:
--   semanal   : um dia da semana (padrão: segunda-feira, como era para todos);
--   quinzenal : dois dias do mês (ex.: dia 5 e dia 20);
--   mensal    : um dia do mês (ex.: todo dia 10).
-- Mês que não tem o dia (ex.: 31 em fevereiro) usa o último dia do mês.
-- O repasse paga as festas cadastradas até a véspera da data de pagamento
-- (como já era: segunda paga até o domingo).
--
-- Quem já existe continua semanal, na segunda: nada muda até alguém editar.
-- Não mexe nos repasses já feitos. Depende da 096. Funciona nos dois bancos
-- (Brava e clientes). Roda numa transação.
-- =========================================================

begin;

alter table commission_rules add column if not exists pay_frequency text not null default 'semanal' check (pay_frequency in ('semanal', 'quinzenal', 'mensal'));
alter table commission_rules add column if not exists pay_weekday int not null default 1 check (pay_weekday between 1 and 7);
alter table commission_rules add column if not exists pay_day int not null default 1 check (pay_day between 1 and 31);
alter table commission_rules add column if not exists pay_day2 int not null default 16 check (pay_day2 between 1 and 31);

-- dia D do mês (ou o último dia, se o mês for menor)
create or replace function commission_month_date(p_year int, p_month int, p_day int) returns date
language sql immutable as $$
  select make_date(p_year, p_month, least(p_day, extract(day from (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day'))::int))
$$;

-- última data de pagamento que já chegou (hoje conta)
create or replace function commission_last_pay_date(p_freq text, p_weekday int, p_day int, p_day2 int, p_ref date) returns date
language plpgsql immutable as $$
declare
  v_prev date := (date_trunc('month', p_ref) - interval '1 month')::date;
  v_best date;
begin
  if p_freq = 'semanal' then
    return p_ref - ((extract(isodow from p_ref)::int - p_weekday + 7) % 7);
  end if;
  select max(d) into v_best from (
    select commission_month_date(extract(year from p_ref)::int, extract(month from p_ref)::int, p_day) d
    union all select commission_month_date(extract(year from v_prev)::int, extract(month from v_prev)::int, p_day)
    union all select commission_month_date(extract(year from p_ref)::int, extract(month from p_ref)::int, p_day2) where p_freq = 'quinzenal'
    union all select commission_month_date(extract(year from v_prev)::int, extract(month from v_prev)::int, p_day2) where p_freq = 'quinzenal'
  ) x where d <= p_ref;
  return v_best;
end;
$$;

-- próxima data de pagamento (depois de hoje)
create or replace function commission_next_pay_date(p_freq text, p_weekday int, p_day int, p_day2 int, p_ref date) returns date
language plpgsql immutable as $$
declare
  v_next date := (date_trunc('month', p_ref) + interval '1 month')::date;
  v_ahead int;
  v_best date;
begin
  if p_freq = 'semanal' then
    v_ahead := (p_weekday - extract(isodow from p_ref)::int + 7) % 7;
    if v_ahead = 0 then v_ahead := 7; end if;
    return p_ref + v_ahead;
  end if;
  select min(d) into v_best from (
    select commission_month_date(extract(year from p_ref)::int, extract(month from p_ref)::int, p_day) d
    union all select commission_month_date(extract(year from v_next)::int, extract(month from v_next)::int, p_day)
    union all select commission_month_date(extract(year from p_ref)::int, extract(month from p_ref)::int, p_day2) where p_freq = 'quinzenal'
    union all select commission_month_date(extract(year from v_next)::int, extract(month from v_next)::int, p_day2) where p_freq = 'quinzenal'
  ) x where d > p_ref;
  return v_best;
end;
$$;

-- festas cadastradas até esta data entram no repasse que já pode ser pago
create or replace function commission_cutoff_of(p_rule uuid) returns date
language sql stable security definer set search_path = public as $$
  select commission_last_pay_date(r.pay_frequency, r.pay_weekday, r.pay_day, r.pay_day2, today_brazil()) - 1
  from commission_rules r where r.id = p_rule
$$;

-- Agenda de cada pessoa, para a tela.
create or replace function commission_schedules()
returns table (rule_id uuid, frequency text, weekday int, day int, day2 int, last_pay date, next_pay date, cutoff date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'page:comissoes') then raise exception 'Sem permissão'; end if;
  return query
  select r.id, r.pay_frequency, r.pay_weekday, r.pay_day, r.pay_day2,
         commission_last_pay_date(r.pay_frequency, r.pay_weekday, r.pay_day, r.pay_day2, today_brazil()),
         commission_next_pay_date(r.pay_frequency, r.pay_weekday, r.pay_day, r.pay_day2, today_brazil()),
         commission_last_pay_date(r.pay_frequency, r.pay_weekday, r.pay_day, r.pay_day2, today_brazil()) - 1
  from commission_rules r;
end;
$$;

create or replace function set_commission_schedule(p_rule uuid, p_frequency text, p_weekday int, p_day int, p_day2 int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:comissoes.configurar') then raise exception 'Sem permissão'; end if;
  if not exists (select 1 from commission_rules where id = p_rule) then raise exception 'Pessoa não encontrada.'; end if;
  if p_frequency not in ('semanal', 'quinzenal', 'mensal') then raise exception 'Escolha se o pagamento é semanal, quinzenal ou mensal.'; end if;
  if p_frequency = 'semanal' and (p_weekday is null or p_weekday not between 1 and 7) then raise exception 'Escolha o dia da semana do pagamento.'; end if;
  if p_frequency in ('quinzenal', 'mensal') and (p_day is null or p_day not between 1 and 31) then raise exception 'Escolha o dia do mês do pagamento (de 1 a 31).'; end if;
  if p_frequency = 'quinzenal' and (p_day2 is null or p_day2 not between 1 and 31 or p_day2 = p_day) then raise exception 'Escolha dois dias diferentes do mês para o pagamento quinzenal.'; end if;
  update commission_rules set pay_frequency = p_frequency,
    pay_weekday = coalesce(case when p_frequency = 'semanal' then p_weekday end, pay_weekday),
    pay_day = coalesce(case when p_frequency in ('quinzenal', 'mensal') then p_day end, pay_day),
    pay_day2 = coalesce(case when p_frequency = 'quinzenal' then p_day2 end, pay_day2)
  where id = p_rule;
end;
$$;

-- Histórico: "a pagar" / "semana atual" agora segue a data de cada pessoa.
create or replace function commission_history(p_from date default null, p_to date default null, p_rule uuid default null)
returns table (rule_id uuid, rule_name text, reservation_id uuid, unit_id uuid, cliente text, cadastro date, event_date date, status text,
               cancelada_em date, cadastrada_por text, conta boolean, devido numeric, pago numeric, ultimo_repasse date,
               situacao text, modo text, valor_regra numeric, valor_festa numeric, fora_financeiro boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'page:comissoes') then raise exception 'Sem permissão'; end if;
  return query
  select k.rule_id, k.rule_name, k.reservation_id, k.unit_id, k.cliente, k.cadastro, k.event_date, k.status, k.cancelada_em,
         k.cadastrada_por, k.conta, k.devido, k.pago, k.ultimo_repasse,
         case
           when k.devido > 0 and k.pago = k.devido then 'paga'
           when k.devido > 0 and k.pago = 0 then case when k.cadastro <= commission_cutoff_of(k.rule_id) then 'a_pagar' else 'semana_atual' end
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

-- ---------- Acessos ----------
revoke all on function commission_cutoff_of(uuid) from public, anon, authenticated;
revoke all on function commission_schedules() from public, anon;
grant execute on function commission_schedules() to authenticated;
revoke all on function set_commission_schedule(uuid, text, int, int, int) from public, anon;
grant execute on function set_commission_schedule(uuid, text, int, int, int) to authenticated;
revoke all on function commission_history(date, date, uuid) from public, anon;
grant execute on function commission_history(date, date, uuid) to authenticated;

select fix_definer_owners();

commit;

notify pgrst, 'reload schema';
