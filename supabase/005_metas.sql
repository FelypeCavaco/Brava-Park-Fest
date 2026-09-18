-- =========================================================
-- Brava Park Fest — Adição: Metas de faturamento por unidade
-- Rode este arquivo no SQL Editor do Supabase (não precisa mexer
-- no que já foi criado antes).
-- =========================================================

create table if not exists unit_goals (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id),
  month date not null, -- salvar sempre como primeiro dia do mês (ex: 2026-09-01)
  goal_amount numeric(10,2) not null default 0,
  unique (unit_id, month)
);

alter table unit_goals enable row level security;

create policy "authenticated_full_access" on unit_goals
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
