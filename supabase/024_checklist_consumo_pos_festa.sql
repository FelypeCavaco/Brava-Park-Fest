-- =========================================================
-- Checklist de consumo pós-festa: itens fixos (bebidas/salgados)
-- + "Outros" com descrição livre. A quantidade lançada é
-- debitada automaticamente do estoque da unidade da festa.
-- =========================================================

-- ---------- Semeia os itens fixos no estoque das duas unidades (se ainda
-- não existirem) — a quantidade real de cada um o usuário ajusta depois na
-- tela Estoque; aqui só garantimos que o item exista para poder debitar. ----------
insert into inventory_items (unit_id, name, category, unit_of_measure, quantity, minimum_quantity)
select u.id, v.nome, 'Buffet e bebidas', 'un', 0, 0
from units u
cross join (values
  ('Coca Normal'), ('Coca Zero'), ('Guaraná'), ('Suco de laranja'),
  ('Suco de uva'), ('Saco de Batata'), ('Água com gás')
) as v(nome)
where not exists (
  select 1 from inventory_items i where i.unit_id = u.id and i.name = v.nome
);

-- ---------- Histórico do que foi lançado em cada festa ----------
create table if not exists reservation_stock_consumption (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  inventory_item_id uuid references inventory_items(id) on delete set null,
  item_name text not null, -- nome no momento do lançamento (mesmo se o item do estoque mudar de nome depois)
  quantity numeric(10,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_reservation_stock_consumption_reservation on reservation_stock_consumption (reservation_id);

alter table reservation_stock_consumption enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'reservation_stock_consumption' and policyname = 'authenticated_full_access') then
    create policy "authenticated_full_access" on reservation_stock_consumption
      for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;

-- ---------- Funções que lançam/desfazem o consumo e já debitam/devolvem o
-- estoque na mesma operação (evita ficar com estoque errado se uma das duas
-- partes falhar). Só a equipe logada pode chamar essas funções. ----------
create or replace function record_stock_consumption(
  p_reservation_id uuid,
  p_inventory_item_id uuid,
  p_item_name text,
  p_quantity numeric
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into reservation_stock_consumption (reservation_id, inventory_item_id, item_name, quantity)
  values (p_reservation_id, p_inventory_item_id, p_item_name, p_quantity)
  returning id into v_id;

  if p_inventory_item_id is not null then
    update inventory_items
    set quantity = greatest(0, quantity - p_quantity), updated_at = now()
    where id = p_inventory_item_id;
  end if;

  return v_id;
end;
$$;

create or replace function undo_stock_consumption(p_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
  v_qty numeric;
begin
  select inventory_item_id, quantity into v_item_id, v_qty from reservation_stock_consumption where id = p_id;

  if v_item_id is not null then
    update inventory_items set quantity = quantity + v_qty, updated_at = now() where id = v_item_id;
  end if;

  delete from reservation_stock_consumption where id = p_id;
end;
$$;

revoke all on function record_stock_consumption(uuid, uuid, text, numeric) from public, anon;
grant execute on function record_stock_consumption(uuid, uuid, text, numeric) to authenticated;

revoke all on function undo_stock_consumption(uuid) from public, anon;
grant execute on function undo_stock_consumption(uuid) to authenticated;
