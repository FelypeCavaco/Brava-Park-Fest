-- =========================================================
-- Despesa fixa (recorrente) passa a gerar, de verdade, um lançamento em
-- `expenses` todo mês — antes ela era só um "molde" que nunca virava conta
-- de verdade, então não tinha como marcar como paga nem aparecer como
-- pendente/vencida. O dia cadastrado na despesa fixa (day_of_month) vira o
-- vencimento daquele mês.
--
-- A geração roda de forma "preguiçosa": toda vez que o app carrega (Painel
-- ou Financeiro), chama esta função, que só cria o que ainda não existe pro
-- mês atual — não precisa de pg_cron nem Edge Function agendada.
-- =========================================================

alter table expenses add column if not exists recurring_expense_id uuid references recurring_expenses(id) on delete set null;
create index if not exists idx_expenses_recurring on expenses (recurring_expense_id);

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

revoke all on function ensure_recurring_expenses_current_month() from public, anon;
grant execute on function ensure_recurring_expenses_current_month() to authenticated;
