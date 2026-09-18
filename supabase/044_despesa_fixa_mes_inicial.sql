-- =========================================================
-- Ao cadastrar uma despesa fixa, dá pra escolher se ela já entra como
-- pendente NESTE mês ou só a partir do mês que vem (ex: cadastrou no fim do
-- mês um aluguel que só começa a valer depois). `first_charge_month` guarda
-- o primeiro mês (sempre dia 1) em que ela deve gerar lançamento — nulo
-- significa "sem restrição", ou seja, já vale desde já.
-- =========================================================

alter table recurring_expenses add column if not exists first_charge_month date;

create or replace function ensure_recurring_expenses_current_month() returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_month_start date := date_trunc('month', current_date)::date;
  v_days_in_month int := extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'))::int;
  v_due_date date;
begin
  for r in select * from recurring_expenses where active loop
    -- ainda não chegou o mês combinado pra essa despesa começar a valer.
    if r.first_charge_month is not null and v_month_start < r.first_charge_month then
      continue;
    end if;

    -- já existe lançamento dessa despesa fixa pra este mês? não duplica.
    if exists (
      select 1 from expenses
      where recurring_expense_id = r.id
        and due_date >= v_month_start
        and due_date < (v_month_start + interval '1 month')
    ) then
      continue;
    end if;

    v_due_date := (v_month_start + (least(r.day_of_month, v_days_in_month) - 1) * interval '1 day')::date;

    insert into expenses (unit_id, category, description, amount, due_date, status, recurring_expense_id)
    values (r.unit_id, r.category, r.description, r.amount, v_due_date, 'a_vencer', r.id);
  end loop;
end;
$$;
