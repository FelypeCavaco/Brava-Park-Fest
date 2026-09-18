-- =========================================================
-- Itens como suco de laranja/uva são comprados em tamanhos variados
-- (1,5L, 3L, 5L — o que estiver mais em conta no dia), mas o que importa
-- pro estoque é o total em litros, não o tamanho da garrafa. Esta tabela
-- guarda os "tamanhos de compra" possíveis de um item; na hora de comprar,
-- a pessoa escolhe o tamanho + quantas garrafas, e o sistema já converte
-- pra litros e soma no estoque único do item (ex: "Suco de laranja" em L).
-- Genérico: qualquer item pode ganhar variantes assim, não só suco.
-- =========================================================

create table if not exists inventory_purchase_variants (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  label text not null, -- "1,5L", "3L", "5L"
  volume_amount numeric(10, 3) not null, -- quantidade (na unidade de medida do item) que uma garrafa dessa representa
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_purchase_variants_item on inventory_purchase_variants (inventory_item_id);

alter table inventory_purchase_variants enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'inventory_purchase_variants' and policyname = 'authenticated_full_access') then
    create policy "authenticated_full_access" on inventory_purchase_variants
      for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;

-- ---------- Suco de laranja e suco de uva passam a ser controlados em
-- litros (não mais "un"), com 0,2L por convidado (10L numa festa de 50
-- pessoas, conforme informado) — ajuste esse número em Estoque se mudar. ----------
update inventory_items
set unit_of_measure = 'L', quantity_per_guest = 0.2
where name in ('Suco de laranja', 'Suco de uva');

insert into inventory_purchase_variants (inventory_item_id, label, volume_amount)
select i.id, v.label, v.volume_amount
from inventory_items i
cross join (values ('1,5L', 1.5), ('3L', 3), ('5L', 5)) as v(label, volume_amount)
where i.name in ('Suco de laranja', 'Suco de uva')
  and not exists (
    select 1 from inventory_purchase_variants existing
    where existing.inventory_item_id = i.id and existing.label = v.label
  );
