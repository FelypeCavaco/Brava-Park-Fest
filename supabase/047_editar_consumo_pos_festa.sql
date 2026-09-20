-- =========================================================
-- Permite editar (não só desfazer) um lançamento de consumo pós-festa já
-- salvo — corrige o estoque pela diferença entre a quantidade antiga e a
-- nova, em vez de simplesmente sobrescrever (que deixaria o estoque errado).
-- =========================================================

create or replace function update_stock_consumption(
  p_id uuid,
  p_new_quantity numeric,
  p_new_item_name text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
  v_old_quantity numeric;
begin
  select inventory_item_id, quantity into v_item_id, v_old_quantity
  from reservation_stock_consumption where id = p_id;

  update reservation_stock_consumption
  set quantity = p_new_quantity,
      item_name = coalesce(p_new_item_name, item_name)
  where id = p_id;

  if v_item_id is not null then
    update inventory_items
    set quantity = greatest(0, quantity - (p_new_quantity - v_old_quantity)), updated_at = now()
    where id = v_item_id;
  end if;
end;
$$;

revoke all on function update_stock_consumption(uuid, numeric, text) from public, anon;
grant execute on function update_stock_consumption(uuid, numeric, text) to authenticated;
