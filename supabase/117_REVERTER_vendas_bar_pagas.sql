-- Desfaz a 117 (os pagamentos já lançados nas festas continuam; só perdem a ligação com a venda).
begin;
drop function if exists bar_receber(uuid, text);
drop function if exists bar_vender(uuid, text, text, jsonb, boolean);
create or replace function bar_vender(p_reservation uuid, p_modo text, p_forma text, p_itens jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r reservations%rowtype;
  v_id uuid := gen_random_uuid();
  it jsonb;
  inv inventory_items%rowtype;
  v_q numeric; v_p numeric; v_nome text; v_sc uuid; v_cost numeric; v_cons uuid; v_oi uuid;
  v_total numeric := 0; v_custo numeric := 0; v_cliente text;
begin
  if not has_permission(auth.uid(), 'action:festa.vendas_bar') then raise exception 'Sem permissão para vender no bar.'; end if;
  if p_modo not in ('pago', 'conta') then raise exception 'Diga quem paga: na hora ou na conta do dono da festa.'; end if;
  if p_modo = 'pago' and coalesce(trim(p_forma), '') = '' then raise exception 'Escolha a forma de pagamento.'; end if;
  select * into r from reservations where id = p_reservation and company_id = current_company_id();
  if not found then raise exception 'Festa não encontrada.'; end if;
  if r.status = 'cancelada' then raise exception 'Esta festa está cancelada.'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Escolha pelo menos uma bebida.'; end if;
  if jsonb_array_length(p_itens) > 50 then raise exception 'Muitos itens numa venda só.'; end if;

  insert into bar_vendas (id, reservation_id, unit_id, modo, forma, criado_por)
  values (v_id, r.id, r.unit_id, p_modo, case when p_modo = 'pago' then trim(p_forma) end, current_actor_name());

  for it in select x from jsonb_array_elements(p_itens) x loop
    v_q := nullif(it->>'quantidade', '')::numeric;
    if v_q is null or v_q <= 0 or v_q > 10000 then raise exception 'Quantidade inválida.'; end if;
    v_sc := null; v_cost := null; v_cons := null;
    if nullif(it->>'item', '') is not null then
      select * into inv from inventory_items where id = (it->>'item')::uuid and unit_id = r.unit_id;
      if not found then raise exception 'Bebida não encontrada no estoque da unidade desta festa.'; end if;
      v_nome := inv.name;
      v_p := coalesce(nullif(it->>'preco', '')::numeric, inv.sale_price);
      if v_p is null then raise exception 'Defina o preço de venda de "%" no Estoque.', inv.name; end if;
      -- baixa do estoque, do mesmo jeito do consumo pós-festa, marcada como bar
      v_sc := gen_random_uuid();
      v_cost := stock_apply_out(inv.id, v_q, 'venda_bar', 'Venda no bar', null, v_sc, null, r.id);
      insert into reservation_stock_consumption (id, reservation_id, inventory_item_id, item_name, quantity, unit_cost, total_cost, no_cost, origem)
      values (v_sc, r.id, inv.id, inv.name, v_q, case when v_cost is not null then v_cost / v_q end, v_cost, v_cost is null, 'bar');
    else
      v_nome := left(trim(coalesce(it->>'nome', '')), 80);
      if v_nome = '' then raise exception 'Escreva o nome do item.'; end if;
      v_p := nullif(it->>'preco', '')::numeric;
      if v_p is null then raise exception 'Informe o preço de "%".', v_nome; end if;
    end if;
    if v_p < 0 or v_p > 100000 then raise exception 'Preço inválido.'; end if;
    if p_modo = 'conta' then
      insert into reservation_consumption (reservation_id, item, quantity, unit_price, inventory_item_id, bar_venda_id)
      values (r.id, v_nome, v_q, round(v_p, 2), inv.id, v_id)
      returning id into v_cons;
    end if;
    insert into bar_venda_itens (venda_id, inventory_item_id, nome, quantidade, preco_unit, custo, stock_consumption_id, consumption_id)
    values (v_id, case when v_sc is not null then inv.id end, v_nome, v_q, round(v_p, 2), round(v_cost, 2), v_sc, v_cons);
    v_total := v_total + round(v_q * round(v_p, 2), 2);
    v_custo := v_custo + coalesce(v_cost, 0);
    inv := null;
  end loop;

  if p_modo = 'pago' and v_total > 0 then
    select c.name into v_cliente from clients c where c.id = r.client_id;
    insert into other_incomes (unit_id, kind, category, description, amount, received_date, payment_method, reservation_id, bar_venda_id)
    values (r.unit_id, 'bar', 'Vendas no bar',
            left('Vendas no bar — festa de ' || coalesce(nullif(trim(r.child_name), ''), v_cliente, 'cliente') || ' (' || to_char(r.event_date, 'DD/MM') || ')', 200),
            v_total, today_brazil(), trim(p_forma), r.id, v_id)
    returning id into v_oi;
  end if;
  update bar_vendas set total = v_total, custo = round(v_custo, 2), other_income_id = v_oi where id = v_id;
  return v_id;
end;
$$;
revoke all on function bar_vender(uuid, text, text, jsonb) from public, anon;
grant execute on function bar_vender(uuid, text, text, jsonb) to authenticated;

create or replace function bar_cancelar(p_venda uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v bar_vendas%rowtype; i record; c reservation_stock_consumption%rowtype;
begin
  if not has_permission(auth.uid(), 'action:festa.vendas_bar') then raise exception 'Sem permissão para vender no bar.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escreva o motivo do cancelamento.'; end if;
  select * into v from bar_vendas where id = p_venda and company_id = current_company_id() for update;
  if not found then raise exception 'Venda não encontrada.'; end if;
  if v.cancelada_em is not null then raise exception 'Esta venda já foi cancelada.'; end if;
  for i in select * from bar_venda_itens where venda_id = v.id loop
    if i.stock_consumption_id is not null then
      select * into c from reservation_stock_consumption where id = i.stock_consumption_id for update;
      if found then
        if c.inventory_item_id is not null then
          perform stock_apply_in(c.inventory_item_id, c.quantity, case when c.no_cost then null else coalesce(c.total_cost, 0) end,
                                 'venda_bar_cancelada', left('Venda no bar cancelada: ' || trim(p_motivo), 200), null, c.id, null, c.reservation_id);
        end if;
        delete from reservation_stock_consumption where id = c.id;
      end if;
    end if;
    if i.consumption_id is not null then delete from reservation_consumption where id = i.consumption_id; end if;
  end loop;
  if v.other_income_id is not null then delete from other_incomes where id = v.other_income_id; end if;
  update bar_vendas set cancelada_em = now(), cancelada_por = current_actor_name(), motivo_cancelamento = left(trim(p_motivo), 300), other_income_id = null
  where id = v.id;
end;
$$;
revoke all on function bar_cancelar(uuid, text) from public, anon;
grant execute on function bar_cancelar(uuid, text) to authenticated;
alter table bar_vendas drop constraint if exists bar_vendas_payment_fkey;
alter table payments drop constraint if exists payments_bar_venda_fkey;
alter table bar_vendas drop column if exists payment_id;
alter table payments drop column if exists bar_venda_id;
commit;
