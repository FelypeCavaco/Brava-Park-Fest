-- =========================================================
-- Brava Park Fest — Adição: Consumo avulso da festa (ex: chopp/bebida
-- cobrada por consumo, fechada no final do evento)
-- Rode este arquivo no SQL Editor do Supabase (não precisa mexer
-- no que já foi criado antes).
-- =========================================================

create table if not exists reservation_consumption (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  item text not null, -- ex: 'Chopp (litro)', 'Cerveja lata'
  quantity numeric(10,2) not null default 1,
  unit_price numeric(10,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_reservation_consumption_reservation on reservation_consumption (reservation_id);

alter table reservation_consumption enable row level security;

create policy "authenticated_full_access" on reservation_consumption
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
