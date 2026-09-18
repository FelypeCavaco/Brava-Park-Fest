-- =========================================================
-- Brava Park Fest — Adição: Propostas comerciais e pesquisa de satisfação
-- Rode este arquivo no SQL Editor do Supabase (não precisa mexer
-- no que já foi criado antes).
-- =========================================================

create table if not exists proposals (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id),
  client_name text not null, -- TODO: trocar por client_id quando os clientes forem reais
  event_date date,
  package_id uuid references packages(id),
  extra_items jsonb, -- lista simples de itens extras escolhidos, com nome e preço
  total_value numeric(10,2) not null default 0,
  status text not null default 'enviada', -- 'enviada', 'aceita', 'recusada'
  created_at timestamptz not null default now()
);

create index if not exists idx_proposals_unit on proposals (unit_id);

create table if not exists nps_responses (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references reservations(id) on delete set null,
  client_name text not null,
  score int not null check (score >= 0 and score <= 10),
  comment text,
  created_at timestamptz not null default now()
);

alter table proposals enable row level security;
alter table nps_responses enable row level security;

create policy "authenticated_full_access" on proposals
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated_full_access" on nps_responses
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
