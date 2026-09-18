-- =========================================================
-- Brava Park Fest — Adição: Despesas fixas recorrentes
-- Rode este arquivo no SQL Editor do Supabase (não precisa mexer
-- no que já foi criado antes).
-- =========================================================

create table if not exists recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id),
  category text not null,
  description text not null,
  amount numeric(10,2) not null,
  day_of_month int not null default 5, -- dia do mês em que a despesa vence
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_recurring_expenses_unit on recurring_expenses (unit_id);

alter table recurring_expenses enable row level security;

create policy "authenticated_full_access" on recurring_expenses
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Nota: aqui a tabela só guarda o "molde" da despesa fixa. Para ela virar de
-- fato um lançamento em `expenses` todo mês automaticamente, o próximo passo
-- (quando ligarmos os dados reais) é criar uma Supabase Edge Function agendada
-- (pg_cron) que roda todo dia 1º e copia as despesas fixas ativas para a
-- tabela `expenses` do mês corrente.
