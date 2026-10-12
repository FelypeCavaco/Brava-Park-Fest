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

-- Confirmar na tela de Acertos = marcar as contas como pagas (o resto é automático).
create or replace function confirm_settlements(p_ids uuid[], p_paid_date date, p_payment_method text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r record;
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
  for r in select id, due_date from unit_settlements where id = any(p_ids) loop
    perform create_settlement_payable(r.id, coalesce(r.due_date, p_paid_date));
    update expenses set status = 'pago', paid_date = coalesce(p_paid_date, today_brazil()), payment_method = p_payment_method
    where settlement_id = r.id;
  end loop;
  return null;
end;
$$;

-- Desfazer a confirmação de um acerto: a conta volta a não paga (a entrada some sozinha).
create or replace function undo_settlement(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:acertos.desfazer') then raise exception 'Sem permissão para desfazer a confirmação.'; end if;
  if not exists (select 1 from unit_settlements where id = p_id and status = 'pago') then raise exception 'Este acerto não está pago.'; end if;
  update expenses set status = 'a_vencer', paid_date = null, payment_method = null where settlement_id = p_id;
end;
$$;

-- Cancelar acerto pendente cancela também a conta a pagar dele.
create or replace function cancel_settlement(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:acertos.confirmar') then raise exception 'Sem permissão.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  update unit_settlements set status = 'cancelado', cancel_reason = trim(p_reason), cancelled_by_name = current_actor_name()
  where id = p_id and status = 'pendente';
  if not found then raise exception 'Só é possível cancelar acerto pendente.'; end if;
  perform set_config('app.expense_fn', '1', true);
  update expenses set status = 'cancelado', description = description || ' (cancelado: ' || trim(p_reason) || ')' where settlement_id = p_id;
  perform set_config('app.expense_fn', '', true);
end;
$$;

-- Acertos pendentes que já existiam ganham a conta a pagar agora.
do $$
declare r record;
begin
  for r in select id from unit_settlements where status = 'pendente' and amount > 0 loop
    perform create_settlement_payable(r.id, today_brazil());
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array['transfer_stock(uuid, uuid, numeric, boolean, date)', 'undo_settlement(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
