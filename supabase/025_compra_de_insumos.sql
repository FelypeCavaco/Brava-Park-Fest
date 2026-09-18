-- =========================================================
-- Ao registrar uma conta a pagar que é compra de insumo,
-- especifica quais itens e a quantidade — e isso soma
-- automaticamente no estoque da unidade daquela despesa.
-- Espelha o checklist de consumo pós-festa, só que somando em
-- vez de descontar.
-- =========================================================

create table if not exists expense_items (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses(id) on delete cascade,
  inventory_item_id uuid references inventory_items(id) on delete set null,
  item_name text not null,
  quantity numeric(10,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_expense_items_expense on expense_items (expense_id);

alter table expense_items enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'expense_items' and policyname = 'authenticated_full_access') then
    create policy "authenticated_full_access" on expense_items
      for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;

create or replace function record_stock_purchase(
  p_expense_id uuid,
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
  insert into expense_items (expense_id, inventory_item_id, item_name, quantity)
  values (p_expense_id, p_inventory_item_id, p_item_name, p_quantity)
  returning id into v_id;

  if p_inventory_item_id is not null then
    update inventory_items
    set quantity = quantity + p_quantity, updated_at = now()
    where id = p_inventory_item_id;
  end if;

  return v_id;
end;
$$;

create or replace function undo_stock_purchase(p_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
  v_qty numeric;
begin
  select inventory_item_id, quantity into v_item_id, v_qty from expense_items where id = p_id;

  if v_item_id is not null then
    update inventory_items set quantity = greatest(0, quantity - v_qty), updated_at = now() where id = v_item_id;
  end if;

  delete from expense_items where id = p_id;
end;
$$;

revoke all on function record_stock_purchase(uuid, uuid, text, numeric) from public, anon;
grant execute on function record_stock_purchase(uuid, uuid, text, numeric) to authenticated;

revoke all on function undo_stock_purchase(uuid) from public, anon;
grant execute on function undo_stock_purchase(uuid) to authenticated;
