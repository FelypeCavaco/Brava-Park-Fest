-- =========================================================
-- FINANCEIRO — três correções:
--
-- 1) CONTA VENCIDA VIRA "ATRASADO" SOZINHA
--    Antes, uma conta a pagar que passava do vencimento continuava "A vencer"
--    até alguém trocar à mão, então o cartão "Atrasado" do Financeiro ficava
--    zerado. Agora:
--      • ao salvar (criar/editar) uma conta não paga, o status é acertado
--        pela data: vencimento antes de hoje → Atrasado; hoje ou depois →
--        A vencer;
--      • toda vez que o Painel ou o Financeiro abrem, as contas que venceram
--        desde a última vez passam para Atrasado (mesma rotina que já gera as
--        despesas fixas do mês).
--    "Hoje" é a data de Brasília, não a do servidor (UTC).
--
-- 2) CONTA QUE PAGA CUSTOS JÁ LANÇADOS NAS FESTAS
--    Nova marcação na conta a pagar: "esta conta paga custos que já estão
--    lançados nas festas" (ex: nota mensal do fornecedor de docinhos, que já
--    entra sozinho como despesa fixa de cada festa). Conta marcada continua
--    na lista para controlar vencimento e pagamento, mas NÃO entra em nenhum
--    total (saldo, resultado do mês, fluxo de caixa, a pagar/atrasado) — o
--    valor dela já está contado pelos custos das festas. Isso acaba com a
--    contagem em dobro.
--
-- 3) HISTÓRICO: ações automáticas aparecem como automáticas
--    As mudanças feitas sozinhas pelo sistema (status da festa recalculado,
--    conta virando atrasada) eram gravadas no histórico com o nome de quem
--    estava usando o sistema naquela hora. Agora aparecem como
--    "Sistema (automático)".
--
-- + SEGURANÇA: fecha três funções internas que podiam ser chamadas sem
--   login (não expunham dados de cliente, mas não precisam ficar abertas).
-- =========================================================

-- ---------- 2) marcação na conta a pagar ----------
alter table expenses add column if not exists covers_festa_costs boolean not null default false;

-- ---------- 3) quem aparece no histórico ----------
-- Funções automáticas setam app.audit_actor durante a própria alteração;
-- o gatilho do histórico usa esse nome no lugar do usuário logado.
create or replace function audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_actor text := nullif(current_setting('app.audit_actor', true), '');
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

  if v_actor is not null then
    v_uid := null;
    v_name := v_actor;
  elsif v_uid is not null then
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

-- Status automático da festa (mesma regra da 055), agora registrado como
-- "Sistema (automático)" no histórico.
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
    perform set_config('app.audit_actor', 'Sistema (status automático)', true);
    update reservations set status = v_new where id = p_reservation_id;
    perform set_config('app.audit_actor', '', true);
  end if;
end;
$$;

-- ---------- 1) atrasado automático ----------
create or replace function today_brazil() returns date
language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- Ao salvar uma conta não paga, acerta A vencer / Atrasado pela data.
create or replace function normalize_expense_status() returns trigger
language plpgsql as $$
begin
  if new.status in ('a_vencer', 'atrasado') then
    new.status := case when new.due_date < today_brazil() then 'atrasado' else 'a_vencer' end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_expense_status on expenses;
create trigger trg_normalize_expense_status before insert or update of status, due_date on expenses
  for each row execute function normalize_expense_status();

-- Gera as despesas fixas do mês (igual antes, agora pela data de Brasília)
-- e passa para Atrasado o que venceu.
create or replace function ensure_recurring_expenses_current_month() returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_today date := today_brazil();
  v_month_start date := date_trunc('month', today_brazil())::date;
  v_days_in_month int := extract(day from (date_trunc('month', today_brazil()) + interval '1 month - 1 day'))::int;
  v_due_date date;
begin
  for r in select * from recurring_expenses where active loop
    if r.first_charge_month is not null and v_month_start < r.first_charge_month then
      continue;
    end if;

    if exists (
      select 1 from expenses
      where recurring_expense_id = r.id
        and due_date >= v_month_start
        and due_date < (v_month_start + interval '1 month')
    ) then
      continue;
    end if;

    v_due_date := (v_month_start + (least(r.day_of_month, v_days_in_month) - 1) * interval '1 day')::date;

    insert into expenses (unit_id, category, description, amount, due_date, status, recurring_expense_id)
    values (r.unit_id, r.category, r.description, r.amount, v_due_date, 'a_vencer', r.id);
  end loop;

  if exists (select 1 from expenses where status = 'a_vencer' and due_date < v_today) then
    perform set_config('app.audit_actor', 'Sistema (conta venceu)', true);
    update expenses set status = 'atrasado' where status = 'a_vencer' and due_date < v_today;
    perform set_config('app.audit_actor', '', true);
  end if;
end;
$$;
revoke all on function ensure_recurring_expenses_current_month() from public, anon;
grant execute on function ensure_recurring_expenses_current_month() to authenticated;

-- Acerta agora as contas que já estão vencidas.
do $$
begin
  perform set_config('app.audit_actor', 'Sistema (conta venceu)', true);
  update expenses set status = 'atrasado' where status = 'a_vencer' and due_date < today_brazil();
  perform set_config('app.audit_actor', '', true);
end $$;

-- ---------- Segurança: funções internas sem acesso externo ----------
revoke all on function recompute_reservation_status(uuid) from public, anon, authenticated;
revoke all on function festa_fixed_cost_amount(uuid, uuid) from public, anon, authenticated;
revoke all on function audit_trim(jsonb) from public, anon, authenticated;
revoke all on function today_brazil() from public, anon;
grant execute on function today_brazil() to authenticated;
