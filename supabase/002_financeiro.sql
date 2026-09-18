-- =========================================================
-- Brava Park Fest — Adição: Despesas e custos por festa
-- Rode este arquivo no SQL Editor do Supabase (não precisa mexer
-- no que já foi criado antes com o schema.sql original).
-- =========================================================

-- ---------- Despesas (contas a pagar / fluxo de caixa) ----------
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id),
  category text not null, -- ex: 'Aluguel', 'Folha de pagamento', 'Fornecedores', 'Manutenção', 'Marketing', 'Impostos', 'Outros'
  description text,
  amount numeric(10,2) not null,
  expense_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_expenses_unit_date on expenses (unit_id, expense_date);

-- ---------- Custos de uma festa específica (para calcular lucro real por festa) ----------
create table if not exists reservation_costs (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  description text not null, -- ex: 'Buffet', 'Decoração', 'Equipe extra', 'DJ'
  amount numeric(10,2) not null
);

create index if not exists idx_reservation_costs_reservation on reservation_costs (reservation_id);

alter table expenses enable row level security;
alter table reservation_costs enable row level security;

create policy "authenticated_full_access" on expenses
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated_full_access" on reservation_costs
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
