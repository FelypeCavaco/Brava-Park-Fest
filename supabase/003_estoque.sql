-- =========================================================
-- Brava Park Fest — Adição: Controle de estoque de insumos
-- Rode este arquivo no SQL Editor do Supabase (não precisa mexer
-- no que já foi criado antes).
-- =========================================================

create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id),
  name text not null,
  category text not null default 'Outros', -- ex: 'Buffet e bebidas', 'Descartáveis', 'Decoração', 'Limpeza', 'Manutenção', 'Outros'
  unit_of_measure text not null default 'un', -- ex: 'un', 'kg', 'litro', 'pacote', 'caixa'
  quantity numeric(10,2) not null default 0,
  minimum_quantity numeric(10,2) not null default 0, -- abaixo disso, entra na lista de compras
  supplier text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_inventory_items_unit on inventory_items (unit_id);

alter table inventory_items enable row level security;

create policy "authenticated_full_access" on inventory_items
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
