-- =========================================================
-- 117 — Vendas no bar: bebidas pagas pelo dono da festa não deixam a festa "não quitada"
-- =========================================================
-- Quando a venda vai "na conta do dono da festa", o valor soma no total da festa e a festa
-- deixa de ficar Quitada até esse valor ser pago. Agora:
--  1) Ao vender na conta, dá para marcar "o dono já pagou agora" e a forma de pagamento:
--     o pagamento entra na festa na hora e ela continua Quitada.
--  2) Uma venda na conta que ficou em aberto pode ser marcada como recebida depois
--     (bar_receber), na forma de pagamento escolhida.
--  3) Cancelar a venda também tira esse pagamento.
-- Nada existente muda: vendas antigas continuam como estão.
-- Desfazer: 117_REVERTER_vendas_bar_pagas.sql
-- =========================================================

begin;

alter table payments add column if not exists bar_venda_id uuid;
alter table bar_vendas add column if not exists payment_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_bar_venda_fkey') then
    alter table payments add constraint payments_bar_venda_fkey foreign key (bar_venda_id) references bar_vendas(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bar_vendas_payment_fkey') then
    alter table bar_vendas add constraint bar_vendas_payment_fkey foreign key (payment_id) references payments(id) on delete set null;
  end if;
end $$;

-- a assinatura nova tem um parâmetro a mais (com padrão)
drop function if exists bar_vender(uuid, text, text, jsonb);
create or replace function bar_vender(p_reservation uuid, p_modo text, p_forma text, p_itens jsonb, p_dono_pagou boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r reservations%rowtype;
  v_id uuid := gen_random_uuid();
  it jsonb;
  inv inventory_items%rowtype;
  v_q numeric; v_p numeric; v_nome text; v_sc uuid; v_cost numeric; v_cons uuid; v_oi uuid;
  v_total numeric := 0; v_custo numeric := 0; v_cliente text; v_pay uuid;
begin
  if not has_permission(auth.uid(), 'action:festa.vendas_bar') then raise exception 'Sem permissão para vender no bar.'; end if;
  if p_modo not in ('pago', 'conta') then raise exception 'Diga quem paga: na hora ou na conta do dono da festa.'; end if;
  if (p_modo = 'pago' or (p_modo = 'conta' and coalesce(p_dono_pagou, false))) and coalesce(trim(p_forma), '') = '' then raise exception 'Escolha a forma de pagamento.'; end if;
  select * into r from reservations where id = p_reservation and company_id = current_company_id();
  if not found then raise exception 'Festa não encontrada.'; end if;
  if r.status = 'cancelada' then raise exception 'Esta festa está cancelada.'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Escolha pelo menos uma bebida.'; end if;
  if jsonb_array_length(p_itens) > 50 then raise exception 'Muitos itens numa venda só.'; end if;

  insert into bar_vendas (id, reservation_id, unit_id, modo, forma, criado_por)
  values (v_id, r.id, r.unit_id, p_modo, case when p_modo = 'pago' or (p_modo = 'conta' and coalesce(p_dono_pagou, false)) then trim(p_forma) end, current_actor_name());

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
  -- na conta do dono, mas ele já pagou agora: o pagamento entra na festa (para ela continuar quitada)
  if p_modo = 'conta' and coalesce(p_dono_pagou, false) and v_total > 0 then
    insert into payments (reservation_id, amount, payment_date, payment_method, notes, bar_venda_id)
    values (r.id, v_total, today_brazil(), trim(p_forma), 'Bebidas do bar', v_id)
    returning id into v_pay;
  end if;
  update bar_vendas set total = v_total, custo = round(v_custo, 2), other_income_id = v_oi, payment_id = v_pay where id = v_id;
  return v_id;
end;
$$;
revoke all on function bar_vender(uuid, text, text, jsonb, boolean) from public, anon;
grant execute on function bar_vender(uuid, text, text, jsonb, boolean) to authenticated;

-- Marca como recebida uma venda que ficou na conta do dono (lança o pagamento na festa).
create or replace function bar_receber(p_venda uuid, p_forma text) returns void
language plpgsql security definer set search_path = public as $$
declare v bar_vendas%rowtype; v_pay uuid;
begin
  if not has_permission(auth.uid(), 'action:festa.vendas_bar') then raise exception 'Sem permissão para vender no bar.'; end if;
  if coalesce(trim(p_forma), '') = '' then raise exception 'Escolha a forma de pagamento.'; end if;
  select * into v from bar_vendas where id = p_venda and company_id = current_company_id() for update;
  if not found then raise exception 'Venda não encontrada.'; end if;
  if v.cancelada_em is not null then raise exception 'Esta venda foi cancelada.'; end if;
  if v.modo <> 'conta' then raise exception 'Esta venda já foi paga na hora.'; end if;
  if v.payment_id is not null then raise exception 'Esta venda já foi marcada como paga.'; end if;
  if coalesce(v.total, 0) <= 0 then raise exception 'Venda sem valor.'; end if;
  insert into payments (reservation_id, amount, payment_date, payment_method, notes, bar_venda_id)
  values (v.reservation_id, v.total, today_brazil(), trim(p_forma), 'Bebidas do bar', v.id)
  returning id into v_pay;
  update bar_vendas set payment_id = v_pay, forma = trim(p_forma) where id = v.id;
end;
$$;
revoke all on function bar_receber(uuid, text) from public, anon;
grant execute on function bar_receber(uuid, text) to authenticated;

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
  if v.payment_id is not null then delete from payments where id = v.payment_id; end if;
  update bar_vendas set cancelada_em = now(), cancelada_por = current_actor_name(), motivo_cancelamento = left(trim(p_motivo), 300), other_income_id = null, payment_id = null
  where id = v.id;
end;
$$;
revoke all on function bar_cancelar(uuid, text) from public, anon;
grant execute on function bar_cancelar(uuid, text) to authenticated;

commit;
