-- =========================================================
-- BANCO DOS CLIENTES — ESTRUTURA, PARTE 4 DE 9
-- Rode as partes EM ORDEM (1, 2, 3...), cada uma numa query nova do SQL
-- Editor do projeto NOVO. Se aparecer a pergunta sobre "Row Level Security",
-- escolha rodar SEM o Supabase acrescentar nada (a segurança já está aqui).
-- Cada parte roda inteira ou nada.
-- =========================================================

begin;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'units') then
    raise exception 'Rode antes a parte 1 (e as seguintes, em ordem).';
  end if;
end $$;

-- Cria (p_expense_id nulo) ou edita uma compra de estoque.
-- p_items: [{"inventory_item_id": "...", "item_name": "...", "quantity": 12, "value": 96}] (value pode ser nulo)
create or replace function save_stock_purchase(
  p_expense_id uuid, p_unit_id uuid, p_supplier text, p_purchase_date date, p_category text,
  p_paid boolean, p_payment_method text, p_paid_date date, p_due_date date,
  p_other_value numeric, p_items jsonb, p_justification text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_expense_id;
  v_total numeric := coalesce(p_other_value, 0);
  v_desc text;
  v_line jsonb;
  v_item inventory_items%rowtype;
  v_qty numeric;
  v_val numeric;
  v_unit_cost numeric;
  v_sv numeric;
  v_old expenses%rowtype;
  r record;
begin
  if not has_permission(auth.uid(), 'page:estoque') then raise exception 'Sem permissão'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'A compra precisa ter ao menos um item.'; end if;
  if coalesce(p_other_value, 0) < 0 then raise exception 'Valor de outros itens inválido.'; end if;

  -- validação + total + descrição
  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_line ->> 'quantity')::numeric;
    v_val := nullif(v_line ->> 'value', '')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade deve ser maior que zero.'; end if;
    if v_val is not null and v_val <= 0 then raise exception 'Valor da linha deve ser maior que zero (ou deixe em branco).'; end if;
    select * into v_item from inventory_items where id = (v_line ->> 'inventory_item_id')::uuid;
    if not found or v_item.unit_id <> p_unit_id then raise exception 'Item de estoque inválido para esta unidade.'; end if;
    v_total := v_total + coalesce(v_val, 0);
  end loop;
  if v_total <= 0 then raise exception 'Informe o valor de ao menos um item.'; end if;

  select 'Compra de estoque' || coalesce(' — ' || nullif(trim(p_supplier), ''), '') || ': ' ||
         string_agg(fmt_qtd((l ->> 'quantity')::numeric) || ' ' || i.unit_of_measure || ' ' || i.name ||
                    coalesce(' (' || fmt_brl(nullif(l ->> 'value', '')::numeric) || ')', ' (sem valor)'), ', ') ||
         case when coalesce(p_other_value, 0) > 0 then '; outros itens ' || fmt_brl(p_other_value) else '' end || '.'
  into v_desc
  from jsonb_array_elements(p_items) l
  join inventory_items i on i.id = (l ->> 'inventory_item_id')::uuid;

  perform set_config('app.expense_fn', '1', true);

  if v_id is null then
    insert into expenses (unit_id, category, description, supplier, amount, due_date, paid_date, status, payment_method,
                          is_stock_purchase, other_items_value, purchase_date)
    values (p_unit_id, coalesce(nullif(trim(p_category), ''), 'Fornecedores'), v_desc, nullif(trim(p_supplier), ''), v_total,
            case when p_paid then coalesce(p_paid_date, today_brazil()) else coalesce(p_due_date, today_brazil()) end,
            case when p_paid then coalesce(p_paid_date, today_brazil()) end,
            case when p_paid then 'pago' else 'a_vencer' end,
            case when p_paid then p_payment_method end,
            true, coalesce(p_other_value, 0), coalesce(p_purchase_date, today_brazil()))
    returning id into v_id;

    for v_line in select * from jsonb_array_elements(p_items) loop
      v_qty := (v_line ->> 'quantity')::numeric;
      v_val := nullif(v_line ->> 'value', '')::numeric;
      select * into v_item from inventory_items where id = (v_line ->> 'inventory_item_id')::uuid;
      v_sv := stock_apply_in(v_item.id, v_qty, v_val, 'compra', 'Entrada de compra', v_id);
      insert into expense_items (expense_id, inventory_item_id, item_name, quantity, line_value, unit_cost, stock_value)
      values (v_id, v_item.id, coalesce(v_line ->> 'item_name', v_item.name), v_qty, v_val, case when v_val is not null then v_val / v_qty end, v_sv);
    end loop;
  else
    select * into v_old from expenses where id = v_id for update;
    if not found or not v_old.is_stock_purchase then raise exception 'Compra não encontrada.'; end if;
    if v_old.unit_id <> p_unit_id then raise exception 'Não é possível trocar a unidade de uma compra já lançada.'; end if;

    -- novas linhas: valor que entra no estoque (sem valor = custo médio atual)
    create temp table if not exists tmp_new_lines (item uuid, name text, qty numeric, val numeric, sv numeric) on commit drop;
    delete from tmp_new_lines;
    for v_line in select * from jsonb_array_elements(p_items) loop
      v_qty := (v_line ->> 'quantity')::numeric;
      v_val := nullif(v_line ->> 'value', '')::numeric;
      select * into v_item from inventory_items where id = (v_line ->> 'inventory_item_id')::uuid;
      v_unit_cost := case when v_item.quantity > 0 then v_item.total_value / v_item.quantity else v_item.last_unit_cost end;
      insert into tmp_new_lines values (v_item.id, coalesce(v_line ->> 'item_name', v_item.name), v_qty, v_val,
        coalesce(v_val, case when v_item.has_cost then v_qty * coalesce(v_unit_cost, 0) else 0 end));
    end loop;

    -- diferença por item, em quantidade e em valor
    for r in
      with o as (select inventory_item_id item, sum(quantity) q, sum(coalesce(stock_value, line_value, 0)) v from expense_items where expense_id = v_id and inventory_item_id is not null group by 1),
           n as (select item, sum(qty) q, sum(sv) v from tmp_new_lines group by 1)
      select coalesce(o.item, n.item) item, coalesce(n.q, 0) - coalesce(o.q, 0) dq, coalesce(n.v, 0) - coalesce(o.v, 0) dv
      from o full join n on n.item = o.item
    loop
      if r.dq <> 0 or r.dv <> 0 then
        perform stock_apply_delta(r.item, r.dq, r.dv, 'compra_ajuste', 'Compra editada', p_justification, v_id);
      end if;
    end loop;

    delete from expense_items where expense_id = v_id;
    insert into expense_items (expense_id, inventory_item_id, item_name, quantity, line_value, unit_cost, stock_value)
    select v_id, item, name, qty, val, case when val is not null then val / qty end, sv from tmp_new_lines;

    update expenses set
      category = coalesce(nullif(trim(p_category), ''), 'Fornecedores'),
      description = v_desc, supplier = nullif(trim(p_supplier), ''), amount = v_total,
      due_date = case when p_paid then coalesce(p_paid_date, today_brazil()) else coalesce(p_due_date, due_date) end,
      paid_date = case when p_paid then coalesce(p_paid_date, today_brazil()) end,
      status = case when p_paid then 'pago' else 'a_vencer' end,
      payment_method = case when p_paid then p_payment_method end,
      other_items_value = coalesce(p_other_value, 0),
      purchase_date = coalesce(p_purchase_date, purchase_date)
    where id = v_id;
  end if;

  perform set_config('app.expense_fn', '', true);
  return v_id;
end;
$$;

create or replace function delete_stock_purchase(p_expense_id uuid, p_justification text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_old expenses%rowtype;
  r record;
begin
  if not (has_permission(auth.uid(), 'page:estoque') or has_permission(auth.uid(), 'action:financeiro.remover')) then raise exception 'Sem permissão'; end if;
  select * into v_old from expenses where id = p_expense_id for update;
  if not found then return; end if;
  if not v_old.is_stock_purchase then raise exception 'Esta conta não é uma compra de estoque.'; end if;
  for r in select inventory_item_id item, sum(quantity) q, sum(coalesce(stock_value, line_value, 0)) v
           from expense_items where expense_id = p_expense_id and inventory_item_id is not null group by 1 loop
    perform stock_apply_delta(r.item, -r.q, -r.v, 'compra_excluida', 'Compra excluída', p_justification, p_expense_id);
  end loop;
  perform set_config('app.expense_fn', '1', true);
  delete from expenses where id = p_expense_id;
  perform set_config('app.expense_fn', '', true);
end;
$$;

-- Compras antigas (lançadas pelo Financeiro) continuam funcionando.
create or replace function record_stock_purchase(p_expense_id uuid, p_inventory_item_id uuid, p_item_name text, p_quantity numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_sv numeric := 0;
begin
  if p_inventory_item_id is not null then
    v_sv := stock_apply_in(p_inventory_item_id, p_quantity, null, 'compra', 'Compra lançada pelo Financeiro (sem valor por item)', p_expense_id);
  end if;
  insert into expense_items (expense_id, inventory_item_id, item_name, quantity, stock_value)
  values (p_expense_id, p_inventory_item_id, p_item_name, p_quantity, v_sv)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function undo_stock_purchase(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_line expense_items%rowtype;
begin
  select * into v_line from expense_items where id = p_id;
  if not found then return; end if;
  if v_line.inventory_item_id is not null then
    perform stock_apply_delta(v_line.inventory_item_id, -v_line.quantity, -coalesce(v_line.stock_value, v_line.line_value, 0),
                              'compra_excluida', 'Compra excluída', 'Conta excluída no Financeiro', v_line.expense_id);
  end if;
  delete from expense_items where id = p_id;
end;
$$;

-- ---------- 3) Consumo pós-festa com custo ----------
alter table reservation_stock_consumption add column if not exists unit_cost numeric(18,6);

alter table reservation_stock_consumption add column if not exists total_cost numeric(18,6);

alter table reservation_stock_consumption add column if not exists no_cost boolean not null default false;

create or replace function record_stock_consumption(p_reservation_id uuid, p_inventory_item_id uuid, p_item_name text, p_quantity numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := gen_random_uuid();
  v_cost numeric;
begin
  if not has_permission(auth.uid(), 'action:festa.consumo_pos_festa') then raise exception 'Sem permissão'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantidade deve ser maior que zero.'; end if;
  if p_inventory_item_id is not null then
    v_cost := stock_apply_out(p_inventory_item_id, p_quantity, 'consumo', 'Consumo pós-festa', null, v_id, null, p_reservation_id);
  end if;
  insert into reservation_stock_consumption (id, reservation_id, inventory_item_id, item_name, quantity, unit_cost, total_cost, no_cost)
  values (v_id, p_reservation_id, p_inventory_item_id, p_item_name, p_quantity,
          case when v_cost is not null then v_cost / p_quantity end, v_cost,
          p_inventory_item_id is not null and v_cost is null);
  return v_id;
end;
$$;

create or replace function update_stock_consumption(p_id uuid, p_new_quantity numeric, p_new_item_name text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  c reservation_stock_consumption%rowtype;
  v_delta numeric;
  v_extra numeric;
  v_back numeric;
  v_total numeric;
begin
  if not has_permission(auth.uid(), 'action:festa.consumo_pos_festa') then raise exception 'Sem permissão'; end if;
  if p_new_quantity is null or p_new_quantity <= 0 then raise exception 'Quantidade deve ser maior que zero.'; end if;
  select * into c from reservation_stock_consumption where id = p_id for update;
  if not found then return; end if;
  v_delta := p_new_quantity - c.quantity;
  v_total := c.total_cost;
  if c.inventory_item_id is not null and v_delta > 0 then
    v_extra := stock_apply_out(c.inventory_item_id, v_delta, 'consumo_ajuste', 'Consumo pós-festa editado', null, p_id, null, c.reservation_id);
    if v_total is not null or v_extra is not null then v_total := coalesce(v_total, 0) + coalesce(v_extra, 0); end if;
  elsif c.inventory_item_id is not null and v_delta < 0 then
    -- redução volta pelo custo congelado da linha
    v_back := case when c.total_cost is not null then (-v_delta) * c.total_cost / c.quantity end;
    perform stock_apply_in(c.inventory_item_id, -v_delta, case when c.no_cost then null else coalesce(v_back, 0) end,
                           'consumo_ajuste', 'Consumo pós-festa editado', null, p_id, null, c.reservation_id);
    if v_total is not null then v_total := v_total - v_back; end if;
  end if;
  update reservation_stock_consumption set
    quantity = p_new_quantity,
    item_name = coalesce(p_new_item_name, item_name),
    total_cost = v_total,
    unit_cost = case when v_total is not null then v_total / p_new_quantity end
  where id = p_id;
end;
$$;

create or replace function undo_stock_consumption(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c reservation_stock_consumption%rowtype;
begin
  if not has_permission(auth.uid(), 'action:festa.consumo_pos_festa') then raise exception 'Sem permissão'; end if;
  select * into c from reservation_stock_consumption where id = p_id for update;
  if not found then return; end if;
  if c.inventory_item_id is not null then
    perform stock_apply_in(c.inventory_item_id, c.quantity, case when c.no_cost then null else coalesce(c.total_cost, 0) end,
                           'consumo_desfeito', 'Consumo pós-festa desfeito', null, p_id, null, c.reservation_id);
  end if;
  delete from reservation_stock_consumption where id = p_id;
end;
$$;

-- ---------- 4) Transferência e acertos entre unidades ----------
create table if not exists unit_settlements (
  id uuid primary key default gen_random_uuid(),
  numero bigserial unique,
  from_unit_id uuid not null references units(id), -- quem mandou (a receber)
  to_unit_id uuid not null references units(id),   -- quem recebeu (a pagar)
  from_item_id uuid references inventory_items(id) on delete set null,
  to_item_id uuid references inventory_items(id) on delete set null,
  item_name text not null,
  quantity numeric(14,3) not null,
  unit_of_measure text,
  unit_cost numeric(18,6),
  amount numeric(14,2) not null default 0,
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'cancelado', 'sem_valor')),
  transfer_date date not null default today_brazil(),
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  batch_id uuid,
  paid_date date,
  payment_method text,
  confirmed_by_name text,
  confirmed_at timestamptz,
  cancel_reason text,
  cancelled_by_name text
);

create index if not exists idx_unit_settlements_status on unit_settlements (status);

create table if not exists other_incomes (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id),
  kind text not null default 'acerto_unidades',
  description text not null,
  amount numeric(14,2) not null,
  received_date date not null,
  payment_method text,
  settlement_batch_id uuid unique,
  created_at timestamptz not null default now()
);

alter table unit_settlements enable row level security;

alter table other_incomes enable row level security;

drop policy if exists "read_unit_settlements" on unit_settlements;

create policy "read_unit_settlements" on unit_settlements for select
  using (has_permission(auth.uid(), 'page:acertos') or has_permission(auth.uid(), 'page:estoque') or has_permission(auth.uid(), 'page:financeiro'));

drop policy if exists "read_active" on other_incomes;

create policy "read_active" on other_incomes for select using (is_active_user(auth.uid()));

-- sem políticas de escrita: só as funções abaixo gravam nessas tabelas.

create or replace function transfer_stock(p_item uuid, p_dest_unit uuid, p_quantity numeric, p_allow_zero boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it inventory_items%rowtype;
  v_dest uuid;
  v_dest_has_cost boolean;
  v_cost numeric;
  v_sid uuid := gen_random_uuid();
  v_amount numeric;
  v_num bigint;
begin
  if not has_permission(auth.uid(), 'page:estoque') then raise exception 'Sem permissão'; end if;
  select * into it from inventory_items where id = p_item for update;
  if not found then raise exception 'Item não encontrado.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Informe uma quantidade válida.'; end if;
  if p_quantity > it.quantity then raise exception 'Essa quantidade é maior do que o disponível.'; end if;
  if p_dest_unit = it.unit_id then raise exception 'Escolha outra unidade de destino.'; end if;
  if not it.has_cost and not p_allow_zero then
    raise exception 'SEM_CUSTO: % está sem custo. O acerto entre as unidades ficaria com valor zero.', it.name;
  end if;

  select id, has_cost into v_dest, v_dest_has_cost from inventory_items where unit_id = p_dest_unit and name = it.name limit 1 for update;
  if v_dest is null then
    insert into inventory_items (unit_id, name, category, unit_of_measure, quantity, minimum_quantity, quantity_per_guest, supplier, consumption_type)
    values (p_dest_unit, it.name, it.category, it.unit_of_measure, 0, it.minimum_quantity, it.quantity_per_guest, it.supplier, it.consumption_type)
    returning id into v_dest;
    v_dest_has_cost := false;
  end if;

  v_cost := coalesce(stock_apply_out(p_item, p_quantity, 'transferencia_saida', 'Transferência entre unidades', null, null, v_sid), 0);
  perform stock_apply_in(v_dest, p_quantity,
                         case when it.has_cost then v_cost when v_dest_has_cost then 0 else null end,
                         'transferencia_entrada', 'Transferência entre unidades', null, null, v_sid);

  v_amount := round(v_cost, 2);
  insert into unit_settlements (id, from_unit_id, to_unit_id, from_item_id, to_item_id, item_name, quantity, unit_of_measure,
                                unit_cost, amount, status, created_by_name)
  values (v_sid, it.unit_id, p_dest_unit, p_item, v_dest, it.name, p_quantity, it.unit_of_measure,
          case when it.has_cost then v_cost / p_quantity end, v_amount,
          case when v_amount > 0 then 'pendente' else 'sem_valor' end, current_actor_name())
  returning numero into v_num;

  return jsonb_build_object('settlement_id', v_sid, 'numero', v_num, 'amount', v_amount, 'status', case when v_amount > 0 then 'pendente' else 'sem_valor' end,
                            'from_unit', (select name from units where id = it.unit_id), 'to_unit', (select name from units where id = p_dest_unit),
                            'item', it.name, 'quantity', p_quantity, 'unit_of_measure', it.unit_of_measure, 'dest_item_id', v_dest);
end;
$$;

create or replace function confirm_settlements(p_ids uuid[], p_paid_date date, p_payment_method text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_batch uuid := gen_random_uuid();
  v_from uuid;
  v_to uuid;
  v_total numeric;
  v_count int;
  v_itens text;
  v_numeros text;
  v_datas text;
begin
  if not has_permission(auth.uid(), 'action:acertos.confirmar') then raise exception 'Sem permissão para confirmar acertos.'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then raise exception 'Selecione ao menos um acerto.'; end if;

  perform 1 from unit_settlements where id = any(p_ids) for update;
  if (select count(*) from unit_settlements where id = any(p_ids)) <> array_length(p_ids, 1) then raise exception 'Acerto não encontrado.'; end if;
  if exists (select 1 from unit_settlements where id = any(p_ids) and status <> 'pendente') then
    raise exception 'Só é possível confirmar acertos pendentes (algum já foi confirmado ou cancelado).';
  end if;
  if (select count(distinct (from_unit_id, to_unit_id)) from unit_settlements where id = any(p_ids)) > 1 then
    raise exception 'No lote, todos os acertos precisam ter a mesma origem e o mesmo destino.';
  end if;

  select min(from_unit_id::text)::uuid, min(to_unit_id::text)::uuid, sum(amount),
         string_agg(fmt_qtd(quantity) || ' ' || coalesce(unit_of_measure, 'un') || ' de ' || item_name, ', ' order by numero),
         string_agg(numero::text, ', ' order by numero),
         string_agg(distinct to_char(transfer_date, 'DD/MM'), ', ')
  into v_from, v_to, v_total, v_itens, v_numeros, v_datas
  from unit_settlements where id = any(p_ids);

  perform set_config('app.expense_fn', '1', true);
  insert into expenses (unit_id, category, description, amount, due_date, paid_date, status, payment_method, settlement_batch_id)
  values (v_to, 'Transferência entre unidades',
          'Compra de estoque da unidade ' || (select name from units where id = v_from) || ': ' || v_itens ||
          ' (transferência de ' || v_datas || '). Acerto nº ' || v_numeros || '.',
          v_total, coalesce(p_paid_date, today_brazil()), coalesce(p_paid_date, today_brazil()), 'pago', p_payment_method, v_batch);
  perform set_config('app.expense_fn', '', true);

  insert into other_incomes (unit_id, kind, description, amount, received_date, payment_method, settlement_batch_id)
  values (v_from, 'acerto_unidades',
          'Recebimento da unidade ' || (select name from units where id = v_to) || ' por produtos transferidos: ' || v_itens || '. Acerto nº ' || v_numeros || '.',
          v_total, coalesce(p_paid_date, today_brazil()), p_payment_method, v_batch);

  update unit_settlements set status = 'pago', batch_id = v_batch, paid_date = coalesce(p_paid_date, today_brazil()),
         payment_method = p_payment_method, confirmed_by_name = current_actor_name(), confirmed_at = now()
  where id = any(p_ids);
  return v_batch;
end;
$$;

create or replace function undo_settlement_batch(p_batch_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:acertos.desfazer') then raise exception 'Sem permissão para desfazer a confirmação.'; end if;
  if not exists (select 1 from unit_settlements where batch_id = p_batch_id and status = 'pago') then raise exception 'Confirmação não encontrada.'; end if;
  perform set_config('app.expense_fn', '1', true);
  delete from expenses where settlement_batch_id = p_batch_id;
  perform set_config('app.expense_fn', '', true);
  delete from other_incomes where settlement_batch_id = p_batch_id;
  update unit_settlements set status = 'pendente', batch_id = null, paid_date = null, payment_method = null,
         confirmed_by_name = null, confirmed_at = null
  where batch_id = p_batch_id;
end;
$$;

create or replace function cancel_settlement(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:acertos.confirmar') then raise exception 'Sem permissão.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  update unit_settlements set status = 'cancelado', cancel_reason = trim(p_reason), cancelled_by_name = current_actor_name()
  where id = p_id and status = 'pendente';
  if not found then raise exception 'Só é possível cancelar acerto pendente.'; end if;
end;
$$;

-- ---------- 5) Estorno no cancelamento ----------
-- Cria/atualiza/remove a saída "Estorno" da festa (no máximo uma ativa).
create or replace function sync_cancellation_refund(
  p_reservation_id uuid, p_refund_paid boolean, p_payment_method text, p_paid_date date, p_due_date date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_paid numeric;
  v_desc text;
  v_id uuid;
begin
  select res.id, res.unit_id, res.event_date, res.status, res.cancellation_reason, res.cancellation_fee_percent, res.refund_amount, c.name cliente
  into r from reservations res join clients c on c.id = res.client_id where res.id = p_reservation_id;
  if not found then return null; end if;
  select id into v_id from expenses where reservation_id = p_reservation_id and category = 'Estorno' and status <> 'cancelado' limit 1;

  perform set_config('app.expense_fn', '1', true);
  if r.status <> 'cancelada' or coalesce(r.refund_amount, 0) <= 0 then
    if v_id is not null then delete from expenses where id = v_id; end if;
    perform set_config('app.expense_fn', '', true);
    return null;
  end if;

  select coalesce(sum(amount), 0) into v_paid from payments where reservation_id = p_reservation_id;
  v_desc := 'Estorno — cancelamento da festa de ' || r.cliente || ' de ' || to_char(r.event_date, 'DD/MM') ||
            '. Motivo: ' || coalesce(nullif(trim(r.cancellation_reason), ''), 'não informado') ||
            '. Multa retida: ' || fmt_qtd(coalesce(r.cancellation_fee_percent, 0)) || '%' ||
            '. Valor pago pelo cliente: ' || fmt_brl(v_paid) || '. Valor devolvido: ' || fmt_brl(r.refund_amount) || '.';

  if v_id is null then
    insert into expenses (unit_id, category, description, supplier, amount, due_date, paid_date, status, payment_method, reservation_id)
    values (r.unit_id, 'Estorno', v_desc, r.cliente, r.refund_amount,
            case when p_refund_paid then coalesce(p_paid_date, today_brazil()) else coalesce(p_due_date, today_brazil()) end,
            case when p_refund_paid then coalesce(p_paid_date, today_brazil()) end,
            case when p_refund_paid then 'pago' else 'a_vencer' end,
            case when p_refund_paid then p_payment_method end, p_reservation_id)
    returning id into v_id;
  else
    update expenses set
      description = v_desc, amount = r.refund_amount, supplier = r.cliente,
      due_date = case when p_refund_paid then coalesce(p_paid_date, today_brazil()) else coalesce(p_due_date, due_date) end,
      paid_date = case when p_refund_paid then coalesce(p_paid_date, today_brazil()) end,
      status = case when p_refund_paid then 'pago' else 'a_vencer' end,
      payment_method = case when p_refund_paid then p_payment_method end
    where id = v_id;
  end if;
  perform set_config('app.expense_fn', '', true);
  return v_id;
end;
$$;

revoke all on function sync_cancellation_refund(uuid, boolean, text, date, date) from public, anon, authenticated;

create or replace function cancel_reservation(
  p_id uuid, p_reason text, p_fee_percent numeric, p_refund numeric,
  p_refund_paid boolean, p_payment_method text, p_paid_date date, p_due_date date
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:festa.editar_dados') then raise exception 'Sem permissão para cancelar a festa.'; end if;
  if coalesce(p_refund, 0) > 0 and not has_permission(auth.uid(), 'action:festa.estorno') then
    raise exception 'Sem permissão para registrar estorno de cancelamento.';
  end if;
  if coalesce(p_refund, 0) < 0 then raise exception 'Valor devolvido inválido.'; end if;
  update reservations set status = 'cancelada', cancellation_reason = nullif(trim(p_reason), ''),
         cancellation_fee_percent = p_fee_percent, refund_amount = p_refund, cancelled_at = now()
  where id = p_id;
  if not found then raise exception 'Festa não encontrada.'; end if;
  perform sync_cancellation_refund(p_id, p_refund_paid, p_payment_method, p_paid_date, p_due_date);
end;
$$;

create or replace function save_cancellation_refund(
  p_id uuid, p_refund numeric, p_refund_paid boolean, p_payment_method text, p_paid_date date, p_due_date date
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:festa.estorno') then raise exception 'Sem permissão para registrar estorno.'; end if;
  if coalesce(p_refund, 0) < 0 then raise exception 'Valor devolvido inválido.'; end if;
  update reservations set refund_amount = p_refund where id = p_id and status = 'cancelada';
  if not found then raise exception 'A festa precisa estar cancelada.'; end if;
  perform sync_cancellation_refund(p_id, p_refund_paid, p_payment_method, p_paid_date, p_due_date);
end;
$$;

-- Festa que deixa de estar cancelada: o estorno vinculado é cancelado.
create or replace function cancel_refund_on_uncancel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'cancelada' and new.status <> 'cancelada' then
    perform set_config('app.expense_fn', '1', true);
    perform set_config('app.audit_actor', 'Sistema (festa reativada)', true);
    update expenses set status = 'cancelado', description = description || ' (cancelado: a festa foi reativada)'
    where reservation_id = new.id and category = 'Estorno' and status <> 'cancelado';
    perform set_config('app.audit_actor', '', true);
    perform set_config('app.expense_fn', '', true);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_cancel_refund_on_uncancel on reservations;

create trigger trg_cancel_refund_on_uncancel after update of status on reservations
  for each row execute function cancel_refund_on_uncancel();

-- ---------- 6) Consumo por convidado ----------
alter table reservations add column if not exists consumption_finalized boolean not null default false;

alter table reservations add column if not exists exclude_from_averages boolean not null default false;

alter table reservations add column if not exists exclude_reason text;

create or replace function set_consumption_status(p_id uuid, p_finalized boolean, p_exclude boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:festa.consumo_pos_festa') then raise exception 'Sem permissão'; end if;
  if p_exclude and coalesce(trim(p_reason), '') = '' then raise exception 'Informe o motivo para excluir das médias.'; end if;
  update reservations set consumption_finalized = p_finalized, exclude_from_averages = p_exclude,
         exclude_reason = case when p_exclude then trim(p_reason) end
  where id = p_id;
end;
$$;

-- Médias reais de consumo por item, calculadas na hora (nunca ficam defasadas).
-- Festas: realizadas, não canceladas, consumo finalizado, não excluídas, com
-- convidados (contratados + cortesias). Janela: últimas p_limit por unidade.
-- Item "por convidado": festa sem consumo do item conta como zero.
-- Média ponderada = soma das quantidades ÷ soma dos convidados.
create or replace function consumption_averages(p_unit uuid default null, p_limit int default 10)
returns table (
  inventory_item_id uuid, unit_id uuid, item_name text, unit_of_measure text, consumption_type text,
  festas int, total_qty numeric, total_guests numeric, avg_per_guest numeric, min_per_guest numeric, max_per_guest numeric,
  avg_per_festa numeric, total_cost numeric, avg_cost_per_guest numeric, avg_cost_per_festa numeric,
  configured_per_guest numeric, current_unit_cost numeric, current_quantity numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission(auth.uid(), 'page:estoque') or has_permission(auth.uid(), 'page:lucro_por_festa')) then raise exception 'Sem permissão'; end if;
  return query
  with fest as (
    select r.id, r.unit_id, (coalesce(r.guest_count, 0) + coalesce(r.courtesy_guests, 0))::numeric g,
           row_number() over (partition by r.unit_id order by r.event_date desc) rn
    from reservations r
    where r.status <> 'cancelada' and r.consumption_finalized and not r.exclude_from_averages
      and r.event_date < today_brazil() and (coalesce(r.guest_count, 0) + coalesce(r.courtesy_guests, 0)) > 0
      and (p_unit is null or r.unit_id = p_unit)
  ), sel as (select * from fest where rn <= greatest(p_limit, 1)),
  per as (
    select i.id item_id, s.id res_id, s.g, coalesce(sum(c.quantity), 0) q, sum(c.total_cost) cost
    from inventory_items i
    join sel s on s.unit_id = i.unit_id
    left join reservation_stock_consumption c on c.reservation_id = s.id and c.inventory_item_id = i.id
    where p_unit is null or i.unit_id = p_unit
    group by i.id, s.id, s.g
  ), amostra as (
    select p.*, i.consumption_type t from per p join inventory_items i on i.id = p.item_id
    where i.consumption_type = 'por_convidado' or p.q > 0
  )
  select i.id, i.unit_id, i.name, i.unit_of_measure, i.consumption_type,
         count(a.res_id)::int, sum(a.q), sum(a.g),
         sum(a.q) / nullif(sum(a.g), 0), min(a.q / a.g), max(a.q / a.g),
         sum(a.q) / nullif(count(a.res_id), 0),
         sum(a.cost), sum(a.cost) / nullif(sum(a.g), 0), sum(a.cost) / nullif(count(a.res_id), 0),
         i.quantity_per_guest,
         case when i.quantity > 0 then i.total_value / i.quantity else i.last_unit_cost end,
         i.quantity
  from amostra a join inventory_items i on i.id = a.item_id
  group by i.id
  having sum(a.q) > 0;
end;
$$;

-- ---------- Acessos às funções ----------
do $$
declare f text;
begin
  foreach f in array array[
    'adjust_stock(uuid, numeric, text)', 'set_initial_stock_cost(uuid, numeric)',
    'save_stock_purchase(uuid, uuid, text, date, text, boolean, text, date, date, numeric, jsonb, text)',
    'delete_stock_purchase(uuid, text)', 'record_stock_purchase(uuid, uuid, text, numeric)', 'undo_stock_purchase(uuid)',
    'record_stock_consumption(uuid, uuid, text, numeric)', 'update_stock_consumption(uuid, numeric, text)', 'undo_stock_consumption(uuid)',
    'transfer_stock(uuid, uuid, numeric, boolean)', 'confirm_settlements(uuid[], date, text)', 'undo_settlement_batch(uuid)',
    'cancel_settlement(uuid, text)', 'cancel_reservation(uuid, text, numeric, numeric, boolean, text, date, date)',
    'save_cancellation_refund(uuid, numeric, boolean, text, date, date)', 'set_consumption_status(uuid, boolean, boolean, text)',
    'consumption_averages(uuid, int)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

revoke all on function fmt_brl(numeric) from anon;

revoke all on function fmt_qtd(numeric) from anon;

-- Histórico de quem fez o quê também nos acertos e entradas avulsas.
drop trigger if exists trg_audit on unit_settlements;

create trigger trg_audit after insert or update or delete on unit_settlements for each row execute function audit_row_change();

drop trigger if exists trg_audit on other_incomes;

create trigger trg_audit after insert or update or delete on other_incomes for each row execute function audit_row_change();

-- =========================================================
-- ACERTO ENTRE UNIDADES VIRA CONTA A PAGAR NA HORA
--
-- Antes (057): a transferência criava só um acerto "pendente", e o dinheiro
-- aparecia no Financeiro apenas quando alguém confirmava o acerto.
-- Agora: ao transferir, a unidade que RECEBEU os produtos já ganha uma conta
-- a pagar (A vencer → Atrasado → Pago, como qualquer conta), categoria
-- "Transferência entre unidades". Quando essa conta é marcada como paga
-- (no Financeiro ou na tela de Acertos), o sistema, sozinho e uma única vez:
--   • marca o acerto como Pago;
--   • lança a entrada na unidade que MANDOU os produtos (recuperação de
--     custo de estoque — não é faturamento).
-- Voltar a conta para não paga desfaz a entrada e o acerto volta a Pendente.
-- Cancelar o acerto cancela a conta. Valor, unidade e descrição da conta não
-- podem ser editados (só pelo acerto).
-- =========================================================

alter table expenses add column if not exists settlement_id uuid references unit_settlements(id) on delete set null;

create unique index if not exists uq_expenses_settlement on expenses (settlement_id) where settlement_id is not null;

alter table other_incomes add column if not exists settlement_id uuid references unit_settlements(id) on delete set null;

create unique index if not exists uq_other_incomes_settlement on other_incomes (settlement_id) where settlement_id is not null;

alter table unit_settlements add column if not exists due_date date;

-- Trava: conta de acerto só muda situação/pagamento; o resto, só pelo acerto.
create or replace function guard_locked_expense() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.expense_fn', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if old.settlement_batch_id is not null then
    raise exception 'Lançamento de acerto entre unidades: altere ou desfaça pela tela Acertos entre unidades.';
  end if;
  if old.is_stock_purchase or (old.category = 'Estorno' and old.reservation_id is not null) or old.settlement_id is not null then
    if tg_op = 'DELETE' then
      raise exception '%', case
        when old.is_stock_purchase then 'Compra de estoque: exclua pela Entrada de compra (tela Estoque).'
        when old.settlement_id is not null then 'Conta de acerto entre unidades: cancele pela tela Acertos entre unidades.'
        else 'Estorno: altere pela festa cancelada.' end;
    end if;
    if new.amount is distinct from old.amount or new.unit_id is distinct from old.unit_id
       or new.category is distinct from old.category or new.description is distinct from old.description
       or new.supplier is distinct from old.supplier or new.is_stock_purchase is distinct from old.is_stock_purchase
       or new.reservation_id is distinct from old.reservation_id or new.settlement_id is distinct from old.settlement_id
       or (old.settlement_id is not null and (new.status = 'cancelado' or old.status = 'cancelado')) then
      raise exception '%', case
        when old.is_stock_purchase then 'Compra de estoque: edite pela Entrada de compra (tela Estoque).'
        when old.settlement_id is not null then 'Conta de acerto entre unidades: o valor vem da transferência; para cancelar, use a tela Acertos entre unidades.'
        else 'Estorno: altere o valor pela festa cancelada.' end;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Cria a conta a pagar de um acerto pendente (unidade que recebeu os produtos).
create or replace function create_settlement_payable(p_settlement uuid, p_due_date date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s unit_settlements%rowtype;
  v_id uuid;
begin
  select * into s from unit_settlements where id = p_settlement;
  if not found or s.status <> 'pendente' or s.amount <= 0 then return null; end if;
  select id into v_id from expenses where settlement_id = p_settlement;
  if v_id is not null then return v_id; end if;
  perform set_config('app.expense_fn', '1', true);
  insert into expenses (unit_id, category, description, supplier, amount, due_date, status, settlement_id)
  values (s.to_unit_id, 'Transferência entre unidades',
          'Compra de estoque da unidade ' || (select name from units where id = s.from_unit_id) || ': ' ||
          fmt_qtd(s.quantity) || ' ' || coalesce(s.unit_of_measure, 'un') || ' de ' || s.item_name ||
          ' (transferência de ' || to_char(s.transfer_date, 'DD/MM') || '). Acerto nº ' || s.numero || '.',
          (select name from units where id = s.from_unit_id),
          s.amount, coalesce(p_due_date, today_brazil()), 'a_vencer', p_settlement)
  returning id into v_id;
  perform set_config('app.expense_fn', '', true);
  update unit_settlements set due_date = coalesce(p_due_date, today_brazil()) where id = p_settlement;
  return v_id;
end;
$$;

revoke all on function create_settlement_payable(uuid, date) from public, anon, authenticated;

-- Conta do acerto paga / despaga → acerto e entrada da outra unidade acompanham.
create or replace function sync_settlement_from_expense() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s unit_settlements%rowtype;
begin
  if new.settlement_id is null then return null; end if;
  select * into s from unit_settlements where id = new.settlement_id for update;
  if not found then return null; end if;

  if new.status = 'pago' then
    insert into other_incomes (unit_id, kind, description, amount, received_date, payment_method, settlement_id)
    values (s.from_unit_id, 'acerto_unidades',
            'Recebimento da unidade ' || (select name from units where id = s.to_unit_id) || ' por produtos transferidos: ' ||
            fmt_qtd(s.quantity) || ' ' || coalesce(s.unit_of_measure, 'un') || ' de ' || s.item_name || '. Acerto nº ' || s.numero || '.',
            new.amount, coalesce(new.paid_date, today_brazil()), new.payment_method, s.id)
    on conflict (settlement_id) where settlement_id is not null
    do update set received_date = excluded.received_date, payment_method = excluded.payment_method, amount = excluded.amount;
    update unit_settlements set status = 'pago', paid_date = coalesce(new.paid_date, today_brazil()), payment_method = new.payment_method,
           confirmed_by_name = coalesce(confirmed_by_name, current_actor_name()), confirmed_at = coalesce(confirmed_at, now())
    where id = s.id;
  elsif old.status = 'pago' then
    delete from other_incomes where settlement_id = s.id;
    update unit_settlements set status = 'pendente', paid_date = null, payment_method = null, confirmed_by_name = null, confirmed_at = null
    where id = s.id and status = 'pago';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sync_settlement_from_expense on expenses;

create trigger trg_sync_settlement_from_expense after update of status, paid_date, payment_method on expenses
  for each row execute function sync_settlement_from_expense();

-- Transferência: igual à 057, e já cria a conta a pagar na unidade que recebe.
create or replace function transfer_stock(p_item uuid, p_dest_unit uuid, p_quantity numeric, p_allow_zero boolean default false, p_due_date date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it inventory_items%rowtype;
  v_dest uuid;
  v_dest_has_cost boolean;
  v_cost numeric;
  v_sid uuid := gen_random_uuid();
  v_amount numeric;
  v_num bigint;
begin
  if not has_permission(auth.uid(), 'page:estoque') then raise exception 'Sem permissão'; end if;
  select * into it from inventory_items where id = p_item for update;
  if not found then raise exception 'Item não encontrado.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Informe uma quantidade válida.'; end if;
  if p_quantity > it.quantity then raise exception 'Essa quantidade é maior do que o disponível.'; end if;
  if p_dest_unit = it.unit_id then raise exception 'Escolha outra unidade de destino.'; end if;
  if not it.has_cost and not p_allow_zero then
    raise exception 'SEM_CUSTO: % está sem custo. O acerto entre as unidades ficaria com valor zero.', it.name;
  end if;

  select id, has_cost into v_dest, v_dest_has_cost from inventory_items where unit_id = p_dest_unit and name = it.name limit 1 for update;
  if v_dest is null then
    insert into inventory_items (unit_id, name, category, unit_of_measure, quantity, minimum_quantity, quantity_per_guest, supplier, consumption_type)
    values (p_dest_unit, it.name, it.category, it.unit_of_measure, 0, it.minimum_quantity, it.quantity_per_guest, it.supplier, it.consumption_type)
    returning id into v_dest;
    v_dest_has_cost := false;
  end if;

  v_cost := coalesce(stock_apply_out(p_item, p_quantity, 'transferencia_saida', 'Transferência entre unidades', null, null, v_sid), 0);
  perform stock_apply_in(v_dest, p_quantity,
                         case when it.has_cost then v_cost when v_dest_has_cost then 0 else null end,
                         'transferencia_entrada', 'Transferência entre unidades', null, null, v_sid);

  v_amount := round(v_cost, 2);
  insert into unit_settlements (id, from_unit_id, to_unit_id, from_item_id, to_item_id, item_name, quantity, unit_of_measure,
                                unit_cost, amount, status, created_by_name)
  values (v_sid, it.unit_id, p_dest_unit, p_item, v_dest, it.name, p_quantity, it.unit_of_measure,
          case when it.has_cost then v_cost / p_quantity end, v_amount,
          case when v_amount > 0 then 'pendente' else 'sem_valor' end, current_actor_name())
  returning numero into v_num;

  if v_amount > 0 then
    perform create_settlement_payable(v_sid, coalesce(p_due_date, today_brazil()));
  end if;

  return jsonb_build_object('settlement_id', v_sid, 'numero', v_num, 'amount', v_amount, 'status', case when v_amount > 0 then 'pendente' else 'sem_valor' end,
                            'from_unit', (select name from units where id = it.unit_id), 'to_unit', (select name from units where id = p_dest_unit),
                            'item', it.name, 'quantity', p_quantity, 'unit_of_measure', it.unit_of_measure, 'dest_item_id', v_dest,
                            'due_date', coalesce(p_due_date, today_brazil()));
end;
$$;

drop function if exists transfer_stock(uuid, uuid, numeric, boolean);

commit;
