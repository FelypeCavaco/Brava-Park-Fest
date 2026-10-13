-- =========================================================
-- EDITAR O CUSTO DE QUALQUER ITEM DO ESTOQUE
--
-- Antes só dava para definir o custo de item "sem custo". Agora dá para
-- corrigir o custo (R$ por litro, por pacote, por unidade...) de qualquer
-- item: o valor em estoque passa a ser quantidade × novo custo. Não cria
-- lançamento no Financeiro e não muda consumos já lançados nas festas (o
-- custo deles fica congelado). Fica registrado no histórico do item.
-- =========================================================

drop function if exists set_initial_stock_cost(uuid, numeric);

create or replace function set_initial_stock_cost(p_item uuid, p_unit_cost numeric, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  it inventory_items%rowtype;
  v_old_unit numeric;
begin
  if not has_permission(auth.uid(), 'action:estoque.custo_inicial') then raise exception 'Sem permissão'; end if;
  if p_unit_cost is null or p_unit_cost < 0 then raise exception 'Informe um custo unitário válido.'; end if;
  select * into it from inventory_items where id = p_item for update;
  if not found then raise exception 'Item não encontrado.'; end if;
  v_old_unit := case when it.quantity > 0 then it.total_value / it.quantity else it.last_unit_cost end;

  perform set_config('app.stock_fn', '1', true);
  update inventory_items set total_value = round(quantity * p_unit_cost, 6), has_cost = true, last_unit_cost = p_unit_cost, updated_at = now() where id = p_item;
  insert into inventory_movements (inventory_item_id, unit_id, kind, quantity, value, reason, created_by_name)
  values (p_item, it.unit_id, 'custo_inicial', 0, round(it.quantity * p_unit_cost, 6) - it.total_value,
          case when it.has_cost
               then 'Custo corrigido: de ' || fmt_brl(v_old_unit) || ' para ' || fmt_brl(p_unit_cost) || ' por ' || it.unit_of_measure
               else 'Custo inicial definido: ' || fmt_brl(p_unit_cost) || ' por ' || it.unit_of_measure end
          || coalesce(' · ' || nullif(trim(p_reason), ''), ''),
          current_actor_name());
  perform set_config('app.stock_fn', '', true);
end;
$$;
revoke all on function set_initial_stock_cost(uuid, numeric, text) from public, anon;
grant execute on function set_initial_stock_cost(uuid, numeric, text) to authenticated;
