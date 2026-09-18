-- =========================================================
-- Brava Park Fest — Adição: Fornecedores e avaliação pós-evento
-- Rode este arquivo no SQL Editor do Supabase.
-- =========================================================

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  service_type text not null, -- 'Buffet externo', 'DJ', 'Fotógrafo', 'Decorador', 'Outro'
  contact text,
  default_price numeric(10,2),
  rating numeric(2,1), -- média calculada, opcional manter aqui como cache
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists supplier_bookings (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id) on delete cascade,
  reservation_id uuid references reservations(id) on delete set null,
  amount numeric(10,2) not null,
  evaluation_note text,
  evaluation_rating int check (evaluation_rating between 1 and 5),
  created_at timestamptz not null default now()
);

create index if not exists idx_supplier_bookings_supplier on supplier_bookings (supplier_id);

alter table suppliers enable row level security;
alter table supplier_bookings enable row level security;

create policy "authenticated_full_access" on suppliers
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated_full_access" on supplier_bookings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
