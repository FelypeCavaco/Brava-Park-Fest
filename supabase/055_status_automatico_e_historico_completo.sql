-- =========================================================
-- 1) STATUS DA FESTA AUTOMÁTICO PELO PAGAMENTO
--    • Pagou menos que o total (contrato + extras + consumo) → Confirmada
--    • Pagou tudo → Quitada
--    • Orçamento sem nenhum pagamento continua Orçamento; ao receber o
--      primeiro pagamento vira Confirmada (ou Quitada, se já pagou tudo).
--    • Cancelada nunca muda sozinha.
--    "Sinal pago" deixa de ser usado: as festas que estavam assim passam a
--    Confirmada ou Quitada conforme o que já foi pago.
--    Recalcula sozinho quando entra/muda/sai pagamento, extra ou consumo, e
--    quando o valor da festa muda.
--
-- 2) HISTÓRICO COMPLETO DE QUEM FEZ O QUÊ
--    Toda criação, alteração e exclusão nas tabelas principais grava no
--    audit_log: quem fez (usuário logado), o quê, e o valor de antes e
--    depois de cada campo alterado. Feito no próprio banco, então vale para
--    qualquer tela do sistema, sem depender de cada botão lembrar de
--    registrar. Ações feitas pelo link público (lista de convidados,
--    avaliação) ou por rotinas do próprio banco aparecem como "Link público
--    ou sistema".
-- =========================================================

-- ---------- 1) Status automático ----------

create or replace function recompute_reservation_status(p_reservation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status reservation_status;
  v_final numeric;
  v_paid numeric;
  v_due numeric;
  v_new reservation_status;
begin
  select status, final_value into v_status, v_final from reservations where id = p_reservation_id;
  if v_status is null or v_status = 'cancelada' then
    return;
  end if;

  select coalesce(sum(amount), 0) into v_paid from payments where reservation_id = p_reservation_id;
  v_due := coalesce(v_final, 0)
    + coalesce((select sum(price_snapshot * quantity) from reservation_extra_items where reservation_id = p_reservation_id), 0)
    + coalesce((select sum(quantity * unit_price) from reservation_consumption where reservation_id = p_reservation_id), 0);

  if v_status = 'orcamento' and v_paid <= 0.005 then
    v_new := 'orcamento';
  elsif v_due > 0 and v_paid >= v_due - 0.005 then
    v_new := 'quitada';
  else
    v_new := 'confirmada';
  end if;

  if v_new is distinct from v_status then
    update reservations set status = v_new where id = p_reservation_id;
  end if;
end;
$$;

create or replace function trg_recompute_status_from_child() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform recompute_reservation_status(new.reservation_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and (tg_op = 'DELETE' or old.reservation_id is distinct from new.reservation_id) then
    perform recompute_reservation_status(old.reservation_id);
  end if;
  return null;
end;
$$;

create or replace function trg_recompute_status_from_reservation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform recompute_reservation_status(new.id);
  return null;
end;
$$;

drop trigger if exists trg_status_payments on payments;
create trigger trg_status_payments after insert or update or delete on payments
  for each row execute function trg_recompute_status_from_child();

drop trigger if exists trg_status_extras on reservation_extra_items;
create trigger trg_status_extras after insert or update or delete on reservation_extra_items
  for each row execute function trg_recompute_status_from_child();

drop trigger if exists trg_status_consumption on reservation_consumption;
create trigger trg_status_consumption after insert or update or delete on reservation_consumption
  for each row execute function trg_recompute_status_from_child();

drop trigger if exists trg_status_reservation_value on reservations;
create trigger trg_status_reservation_value after insert or update of final_value, total_value on reservations
  for each row execute function trg_recompute_status_from_reservation();

-- Acerta todas as festas que já existem (inclui as que estavam "Sinal pago").
do $$
declare r record;
begin
  for r in select id from reservations where status <> 'cancelada' loop
    perform recompute_reservation_status(r.id);
  end loop;
end $$;

-- ---------- 2) Histórico completo ----------

-- Encurta textos longos (ex: texto inteiro do contrato) pra não pesar o histórico.
create or replace function audit_trim(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(
    key,
    case when jsonb_typeof(value) = 'string' and length(value #>> '{}') > 300
         then to_jsonb(left(value #>> '{}', 300) || '…')
         else value end
  ), '{}'::jsonb)
  from jsonb_each(p);
$$;

create or replace function audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_action text;
  v_row jsonb;
  v_old jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_reservation text;
begin
  if tg_op = 'INSERT' then
    v_action := 'criou';
    v_row := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action := 'alterou';
    v_row := to_jsonb(new);
    v_old := to_jsonb(old);
    for v_key in select jsonb_object_keys(v_row) loop
      if v_key not in ('updated_at', 'created_at') and (v_row -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('de', v_old -> v_key, 'para', v_row -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;
    end if;
  else
    v_action := 'excluiu';
    v_row := to_jsonb(old);
  end if;

  if v_uid is not null then
    select name into v_name from user_profiles where id = v_uid;
  end if;

  v_reservation := case
    when tg_table_name = 'reservations' then v_row ->> 'id'
    else v_row ->> 'reservation_id'
  end;

  insert into audit_log (user_id, user_name, action, entity, entity_id, details)
  values (
    v_uid,
    coalesce(v_name, case when v_uid is null then 'Link público ou sistema' else 'Usuário sem perfil' end),
    v_action,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    jsonb_strip_nulls(jsonb_build_object(
      'reservation_id', v_reservation,
      'changes', case when tg_op = 'UPDATE' then audit_trim(v_changes) end,
      'row', case when tg_op <> 'UPDATE' then audit_trim(v_row) end
    ))
  );
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'reservations', 'payments', 'reservation_costs', 'reservation_extra_items', 'reservation_consumption',
    'reservation_stock_consumption', 'reservation_birthday_kids', 'reservation_notes', 'reservation_documents',
    'checklist_items', 'staff_assignments', 'staff_members', 'guest_list_entries', 'contracts',
    'clients', 'expenses', 'recurring_expenses', 'packages', 'extra_items', 'inventory_items',
    'festa_fixed_costs', 'suppliers', 'visits', 'proposals', 'waitlist', 'unit_goals', 'marketing_spend'
  ] loop
    execute format('drop trigger if exists trg_audit on %I', t);
    execute format('create trigger trg_audit after insert or update or delete on %I for each row execute function audit_row_change()', t);
  end loop;
end $$;

create index if not exists idx_audit_log_reservation on audit_log ((details ->> 'reservation_id'));
create index if not exists idx_audit_log_created on audit_log (created_at desc);
