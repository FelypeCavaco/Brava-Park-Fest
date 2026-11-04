-- =========================================================
-- REVERTER a migração 082 (vendas no cartão no extrato) — só use se for para desfazer.
-- Volta as regras do extrato como eram na 081. Os movimentos de cartão
-- que estavam esperando conferência voltam para "A classificar".
-- =========================================================
begin;

update bank_statement_lines set status = 'a_classificar' where status = 'cartao';

create or replace function bank_payment_method(p text) returns text
language sql immutable set search_path = public as $$
  select case
    when ' ' || bank_norm(p) || ' ' like '% pix %' then 'pix'
    when bank_norm(p) like '%boleto%' then 'boleto'
    else 'transferencia' end;
$$;

create or replace function bank_classify(p_line uuid, p_skip_dup boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  ln bank_statement_lines%rowtype;
  v_amt numeric;
  v_norm text;
  v_flat text;
  v_id uuid;
  v_id2 uuid;
  v_n int;
  v_res uuid;
  v_label text;
  v_pay uuid;
  rc portal_receipts%rowtype;
  ex expenses%rowtype;
  ru bank_rules%rowtype;
  v_sug jsonb;
begin
  select * into ln from bank_statement_lines where id = p_line for update;
  if not found or ln.status not in ('a_classificar', 'possivel_duplicado') then return; end if;
  v_amt := abs(ln.amount);
  v_norm := ' ' || bank_norm(ln.description) || ' ';
  v_flat := replace(v_norm, ' ', '');

  -- 0) o mesmo movimento já veio em outro extrato (ex.: a mesma semana enviada em OFX e em planilha)
  if not p_skip_dup then
    select b.id into v_id from bank_statement_lines b
    where b.unit_id = ln.unit_id and b.id <> ln.id and b.posted_date = ln.posted_date and b.amount = ln.amount
      and b.import_id is distinct from ln.import_id and b.dup_line_id is null
      and not exists (select 1 from bank_statement_lines c where c.dup_line_id = b.id and c.id <> ln.id)
    order by b.created_at limit 1;
    if v_id is not null then
      update bank_statement_lines set status = 'possivel_duplicado', dup_line_id = v_id,
        how = 'Pode ser um movimento de outro extrato já enviado' where id = ln.id;
      return;
    end if;
  end if;

  if ln.amount > 0 then
    -- 1) possível duplicado: pagamento de festa ou receita já lançados
    if not p_skip_dup then
      select p.id into v_id from payments p join reservations r on r.id = p.reservation_id
      where r.unit_id = ln.unit_id and p.amount = v_amt and p.payment_date between ln.posted_date - 3 and ln.posted_date + 3
        and not exists (select 1 from bank_statement_lines b where b.payment_id = p.id or (b.dup_payment_id = p.id and b.id <> ln.id))
      order by abs(p.payment_date - ln.posted_date), p.created_at limit 1;
      if v_id is null then
        select o.id into v_id2 from other_incomes o
        where o.unit_id = ln.unit_id and o.amount = v_amt and o.received_date between ln.posted_date - 3 and ln.posted_date + 3
          and not exists (select 1 from bank_statement_lines b where b.income_id = o.id or (b.dup_income_id = o.id and b.id <> ln.id))
        order by abs(o.received_date - ln.posted_date) limit 1;
      end if;
      if v_id is not null or v_id2 is not null then
        update bank_statement_lines set status = 'possivel_duplicado', dup_payment_id = v_id, dup_income_id = v_id2,
          how = 'Pode ser um lançamento que já existe' where id = ln.id;
        return;
      end if;
    end if;

    -- 2) comprovante do portal esperando com o mesmo valor (um só)
    select count(*), (array_agg(rc2.id))[1] into v_n, v_id from portal_receipts rc2 join reservations r on r.id = rc2.reservation_id
    where r.unit_id = ln.unit_id and rc2.status = 'em_analise' and rc2.amount = v_amt
      and (rc2.created_at at time zone 'America/Sao_Paulo')::date between ln.posted_date - 5 and ln.posted_date + 2;
    if v_n = 1 then
      select * into rc from portal_receipts where id = v_id for update;
      insert into payments (reservation_id, amount, payment_date, payment_method, notes)
      values (rc.reservation_id, v_amt, ln.posted_date, bank_payment_method(ln.description), 'Comprovante do portal confirmado pelo extrato do banco')
      returning id into v_pay;
      update portal_receipts set status = 'lancado', payment_id = v_pay, decided_by_name = 'Extrato do banco', decided_at = now() where id = rc.id;
      update portal_events set seen_at = now(), seen_by_name = 'Extrato do banco' where ref_id = rc.id and seen_at is null;
      insert into reservation_documents (reservation_id, file_name, storage_path, bucket, receipt_id)
      values (rc.reservation_id, receipt_document_name(v_amt, ln.posted_date, rc.storage_path), rc.storage_path, 'portal-comprovantes', rc.id)
      on conflict do nothing;
      select 'Festa de ' || to_char(r.event_date, 'DD/MM') || coalesce(' · ' || nullif(trim(r.child_name), ''), '') || ' (' || c.name || ')'
        into v_label from reservations r join clients c on c.id = r.client_id where r.id = rc.reservation_id;
      update bank_statement_lines set status = 'lancado', auto = true, created_record = true, payment_id = v_pay, receipt_id = rc.id,
        reservation_id = rc.reservation_id, how = 'Comprovante do portal confirmado · ' || v_label,
        dup_payment_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;
      return;
    end if;

    -- 3) festa pelo nome do cliente ou pelo código do Pix do portal
    with cand as (
      select r.id, r.event_date, c.name as cliente, coalesce(nullif(trim(r.child_name), ''), g.child_name) as crianca,
             festa_total_due(r.id) - coalesce((select sum(amount) from payments p where p.reservation_id = r.id), 0) as saldo,
             split_part(bank_norm(c.name), ' ', 1) as n1,
             regexp_replace(bank_norm(c.name), '^.* ', '') as n2
      from reservations r join clients c on c.id = r.client_id
      left join lateral (select child_name from guest_list_pages where reservation_id = r.id limit 1) g on true
      where r.unit_id = ln.unit_id and r.status <> 'cancelada' and r.event_date >= ln.posted_date - 120
    ), ok as (
      select * from cand
      where saldo > 0.005 and v_amt <= saldo + 0.01
        and ((length(n1) >= 2 and length(n2) >= 2 and n1 <> n2 and v_norm like '% ' || n1 || ' %' and v_norm like '% ' || n2 || ' %')
          or (crianca is not null and length(bank_norm(crianca)) >= 2
              and v_flat like '%' || replace(bank_norm(crianca), ' ', '') || to_char(event_date, 'DDMM') || '%'))
    )
    select count(*), (array_agg(id))[1],
           coalesce(jsonb_agg(jsonb_build_object('reservation_id', id, 'label',
             'Festa de ' || to_char(event_date, 'DD/MM') || coalesce(' · ' || crianca, '') || ' (' || cliente || ') · falta ' || fmt_brl(saldo))
             order by event_date), '[]'::jsonb)
      into v_n, v_res, v_sug from ok;
    if v_n = 1 then
      insert into payments (reservation_id, amount, payment_date, payment_method, notes)
      values (v_res, v_amt, ln.posted_date, bank_payment_method(ln.description), 'Lançado pelo extrato do banco')
      returning id into v_pay;
      update bank_statement_lines set status = 'lancado', auto = true, created_record = true, payment_id = v_pay, reservation_id = v_res,
        how = regexp_replace(v_sug -> 0 ->> 'label', ' · falta .*$', ''), dup_payment_id = null, dup_income_id = null, dup_line_id = null, suggestions = '[]'::jsonb where id = ln.id;
      return;
    end if;
    if v_n = 0 then
      -- sem nome: sugere as festas com esse valor exato em aberto (a pessoa escolhe)
      select coalesce(jsonb_agg(jsonb_build_object('reservation_id', r.id, 'label',
               'Festa de ' || to_char(r.event_date, 'DD/MM') || coalesce(' · ' || nullif(trim(r.child_name), ''), '') || ' (' || c.name || ')' || ' · falta ' || fmt_brl(x.saldo))
               order by r.event_date), '[]'::jsonb)
        into v_sug
      from reservations r join clients c on c.id = r.client_id
      cross join lateral (select festa_total_due(r.id) - coalesce((select sum(amount) from payments p where p.reservation_id = r.id), 0) as saldo) x
      where r.unit_id = ln.unit_id and r.status <> 'cancelada' and r.event_date >= ln.posted_date - 120
        and (abs(x.saldo - v_amt) < 0.01
          or exists (select 1 from reservation_installments i where i.reservation_id = r.id and abs(i.amount - v_amt) < 0.01));
    end if;
  else
    -- 1) possível duplicado: despesa já paga
    if not p_skip_dup then
      select e.id into v_id from expenses e
      where e.unit_id = ln.unit_id and e.status = 'pago' and e.amount = v_amt
        and coalesce(e.paid_date, e.due_date) between ln.posted_date - 3 and ln.posted_date + 3
        and not exists (select 1 from bank_statement_lines b where b.expense_id = e.id or (b.dup_expense_id = e.id and b.id <> ln.id))
      order by abs(coalesce(e.paid_date, e.due_date) - ln.posted_date) limit 1;
      if v_id is not null then
        update bank_statement_lines set status = 'possivel_duplicado', dup_expense_id = v_id,
          how = 'Pode ser um lançamento que já existe' where id = ln.id;
        return;
      end if;
    end if;

    -- 2) uma só conta a pagar em aberto com esse valor
    select count(*), (array_agg(e.id))[1] into v_n, v_id from expenses e
    where e.unit_id = ln.unit_id and e.status in ('a_vencer', 'atrasado') and e.amount = v_amt
      and e.due_date between ln.posted_date - 10 and ln.posted_date + 10
      and not exists (select 1 from bank_statement_lines b where b.expense_id = e.id);
    if v_n = 1 then
      select * into ex from expenses where id = v_id for update;
      update expenses set status = 'pago', paid_date = ln.posted_date, payment_method = coalesce(payment_method, bank_payment_method(ln.description))
      where id = ex.id;
      update bank_statement_lines set status = 'conciliado', auto = true, expense_id = ex.id,
        expense_prev = jsonb_build_object('status', ex.status, 'paid_date', ex.paid_date, 'payment_method', ex.payment_method),
        how = 'Conta a pagar baixada · ' || ex.category || coalesce(' · ' || nullif(coalesce(ex.supplier, ex.description), ''), ''),
        dup_expense_id = null, dup_line_id = null where id = ln.id;
      return;
    end if;
    if v_n > 1 then
      select coalesce(jsonb_agg(jsonb_build_object('expense_id', e.id, 'label',
               e.category || coalesce(' · ' || nullif(coalesce(e.supplier, e.description), ''), '') || ' · vence ' || to_char(e.due_date, 'DD/MM'))
               order by e.due_date), '[]'::jsonb)
        into v_sug from expenses e
      where e.unit_id = ln.unit_id and e.status in ('a_vencer', 'atrasado') and e.amount = v_amt
        and e.due_date between ln.posted_date - 10 and ln.posted_date + 10
        and not exists (select 1 from bank_statement_lines b where b.expense_id = e.id);
    end if;
  end if;

  -- 4) regra aprendida (a mais específica: da unidade antes da geral, texto maior antes)
  select * into ru from bank_rules
  where direction = case when ln.amount > 0 then 'entrada' else 'saida' end
    and (unit_id is null or unit_id = ln.unit_id) and bank_matches(ln.description, match_text)
  order by (unit_id is null), length(match_text) desc limit 1;
  if found then
    if ru.action = 'ignorar' then
      update bank_statement_lines set status = 'ignorado', auto = true, how = 'Ignorado pela regra "' || ru.match_text || '"',
        dup_payment_id = null, dup_expense_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;
      return;
    elsif ru.action = 'despesa' and ln.amount < 0 then
      insert into expenses (unit_id, category, description, supplier, amount, due_date, paid_date, status, payment_method)
      values (ln.unit_id, coalesce(ru.category, 'Outros'), coalesce(nullif(ru.description, ''), left(ln.description, 200)), ru.supplier,
              v_amt, ln.posted_date, ln.posted_date, 'pago', bank_payment_method(ln.description))
      returning id into v_id;
      update bank_statement_lines set status = 'lancado', auto = true, created_record = true, expense_id = v_id,
        how = 'Despesa · ' || coalesce(ru.category, 'Outros') || coalesce(' · ' || ru.supplier, ''), dup_expense_id = null, dup_line_id = null where id = ln.id;
      return;
    elsif ru.action = 'receita' and ln.amount > 0 then
      insert into other_incomes (unit_id, kind, description, amount, received_date, payment_method)
      values (ln.unit_id, 'extrato', coalesce(nullif(ru.description, ''), left(ln.description, 200)), v_amt, ln.posted_date, bank_payment_method(ln.description))
      returning id into v_id;
      update bank_statement_lines set status = 'lancado', auto = true, created_record = true, income_id = v_id,
        how = 'Outra receita · ' || coalesce(nullif(ru.description, ''), ru.match_text), dup_payment_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;
      return;
    end if;
  end if;

  update bank_statement_lines set status = 'a_classificar', how = null, suggestions = coalesce(v_sug, '[]'::jsonb),
    dup_payment_id = null, dup_expense_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;
end;
$$;

create or replace function bank_import(p_unit uuid, p_file_name text, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_imp uuid;
  v_new uuid;
  v_ids uuid[] := '{}';
  x jsonb;
  v_total int := 0;
  v_res jsonb;
  v_acoes jsonb := '{}'::jsonb;
  v_a jsonb;
  ln bank_statement_lines%rowtype;
begin
  if not has_permission(auth.uid(), 'page:financeiro') then raise exception 'Sem permissão para o Financeiro.'; end if;
  if not exists (select 1 from units where id = p_unit) then raise exception 'Unidade não encontrada.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'O arquivo não tem movimentos.'; end if;
  if jsonb_array_length(p_lines) > 5000 then raise exception 'Arquivo grande demais: envie no máximo 5.000 movimentos por vez.'; end if;

  insert into bank_statement_imports (unit_id, file_name, created_by_name)
  values (p_unit, left(p_file_name, 200), current_actor_name()) returning id into v_imp;

  for x in select * from jsonb_array_elements(p_lines) loop
    v_total := v_total + 1;
    if coalesce(x->>'id', '') = '' or (x->>'valor')::numeric = 0 then continue; end if;
    insert into bank_statement_lines (import_id, unit_id, external_id, posted_date, amount, description)
    values (v_imp, p_unit, left(x->>'id', 200), (x->>'data')::date, round((x->>'valor')::numeric, 2), left(coalesce(x->>'descricao', ''), 500))
    on conflict (unit_id, external_id) do nothing
    returning id into v_new;
    if v_new is not null then
      v_ids := v_ids || v_new;
      if jsonb_typeof(x->'acao') = 'object' and coalesce(x->'acao'->>'tipo', 'auto') <> 'auto' then
        v_acoes := v_acoes || jsonb_build_object(v_new::text, x->'acao');
      end if;
      v_new := null;
    end if;
  end loop;

  -- em ordem de data, para os pagamentos caírem na ordem em que entraram
  for v_new in select id from bank_statement_lines where id = any(v_ids) order by posted_date, amount desc loop
    v_a := v_acoes -> (v_new::text);
    if v_a is null then
      perform bank_classify(v_new);
    else
      begin
        perform bank_resolve(v_new, v_a->>'tipo', v_a);
        if v_a->>'tipo' = 'ignorar' then
          update bank_statement_lines set how = 'Não lançado (escolhido na conferência)' where id = v_new;
        end if;
      exception when others then
        select * into ln from bank_statement_lines where id = v_new;
        raise exception 'Movimento de % (% · %): %', to_char(ln.posted_date, 'DD/MM/YYYY'), fmt_brl(ln.amount), left(ln.description, 60), sqlerrm;
      end;
    end if;
  end loop;

  update bank_statement_imports set total_lines = v_total, new_lines = coalesce(array_length(v_ids, 1), 0),
    period_start = (select min((e->>'data')::date) from jsonb_array_elements(p_lines) e),
    period_end = (select max((e->>'data')::date) from jsonb_array_elements(p_lines) e)
  where id = v_imp;

  select jsonb_build_object(
    'import_id', v_imp,
    'total', v_total,
    'novas', coalesce(array_length(v_ids, 1), 0),
    'lancadas', count(*) filter (where status in ('lancado', 'conciliado')),
    'duplicados', count(*) filter (where status = 'possivel_duplicado'),
    'a_classificar', count(*) filter (where status = 'a_classificar'),
    'ignoradas', count(*) filter (where status = 'ignorado'))
    into v_res from bank_statement_lines where id = any(v_ids);
  return v_res;
end;
$$;

create or replace function bank_resolve(p_line uuid, p_action text, p_data jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  ln bank_statement_lines%rowtype;
  v_amt numeric;
  v_id uuid;
  v_label text;
  v_cat text;
  v_match text;
  ex expenses%rowtype;
  v_pay uuid;
  v_lembrar boolean := coalesce((p_data->>'lembrar')::boolean, false);
begin
  if not has_permission(auth.uid(), 'page:financeiro') then raise exception 'Sem permissão para o Financeiro.'; end if;
  select * into ln from bank_statement_lines where id = p_line for update;
  if not found then raise exception 'Movimento não encontrado.'; end if;
  if ln.status not in ('a_classificar', 'possivel_duplicado') then raise exception 'Este movimento já foi resolvido. Desfaça antes de mudar.'; end if;
  v_amt := abs(ln.amount);

  if p_action = 'mesmo' then
    if ln.status <> 'possivel_duplicado' then raise exception 'Este movimento não está marcado como possível duplicado.'; end if;
    if ln.dup_line_id is not null then
      update bank_statement_lines set status = 'ignorado', auto = false, how = 'Repetido: já veio em outro extrato',
        decided_by_name = current_actor_name(), decided_at = now() where id = ln.id;
      return;
    end if;
    update bank_statement_lines set status = 'conciliado', auto = false, payment_id = dup_payment_id, expense_id = dup_expense_id,
      income_id = dup_income_id, created_record = false, how = 'É o mesmo lançamento que já existia',
      reservation_id = (select reservation_id from payments where id = ln.dup_payment_id),
      decided_by_name = current_actor_name(), decided_at = now() where id = ln.id;
    return;
  elsif p_action = 'diferente' then
    if ln.status <> 'possivel_duplicado' then raise exception 'Este movimento não está marcado como possível duplicado.'; end if;
    update bank_statement_lines set status = 'a_classificar', dup_payment_id = null, dup_expense_id = null, dup_income_id = null, dup_line_id = null,
      decided_by_name = current_actor_name(), decided_at = now() where id = ln.id;
    perform bank_classify(ln.id, true);
    return;
  end if;

  if p_action in ('despesa', 'receita', 'ignorar') and v_lembrar then
    v_match := bank_counterpart(ln.description);
    if length(v_match) < 3 then v_match := bank_norm(ln.description); end if;
    v_match := left(v_match, 120);
  end if;

  if p_action = 'festa' then
    if ln.amount < 0 then raise exception 'Saída não pode ser pagamento de festa.'; end if;
    v_id := (p_data->>'reservation_id')::uuid;
    if not exists (select 1 from reservations where id = v_id and unit_id = ln.unit_id) then raise exception 'Escolha uma festa desta unidade.'; end if;
    insert into payments (reservation_id, amount, payment_date, payment_method, notes)
    values (v_id, v_amt, ln.posted_date, bank_payment_method(ln.description), 'Lançado pelo extrato do banco')
    returning id into v_pay;
    select 'Festa de ' || to_char(r.event_date, 'DD/MM') || coalesce(' · ' || nullif(trim(r.child_name), ''), '') || ' (' || c.name || ')'
      into v_label from reservations r join clients c on c.id = r.client_id where r.id = v_id;
    update bank_statement_lines set status = 'lancado', auto = false, created_record = true, payment_id = v_pay, reservation_id = v_id,
      how = v_label, decided_by_name = current_actor_name(), decided_at = now(),
      dup_payment_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;

  elsif p_action = 'conta' then
    if ln.amount > 0 then raise exception 'Entrada não pode pagar conta.'; end if;
    select * into ex from expenses where id = (p_data->>'expense_id')::uuid and unit_id = ln.unit_id for update;
    if not found then raise exception 'Escolha uma conta desta unidade.'; end if;
    if ex.status not in ('a_vencer', 'atrasado') then raise exception 'Esta conta já está paga ou cancelada.'; end if;
    update expenses set status = 'pago', paid_date = ln.posted_date, payment_method = coalesce(payment_method, bank_payment_method(ln.description)) where id = ex.id;
    update bank_statement_lines set status = 'conciliado', auto = false, expense_id = ex.id,
      expense_prev = jsonb_build_object('status', ex.status, 'paid_date', ex.paid_date, 'payment_method', ex.payment_method),
      how = 'Conta a pagar baixada · ' || ex.category || coalesce(' · ' || nullif(coalesce(ex.supplier, ex.description), ''), ''),
      decided_by_name = current_actor_name(), decided_at = now(), dup_expense_id = null, dup_line_id = null where id = ln.id;

  elsif p_action = 'despesa' then
    if ln.amount > 0 then raise exception 'Entrada não pode ser despesa.'; end if;
    v_cat := nullif(trim(p_data->>'category'), '');
    if v_cat is null then raise exception 'Escolha a categoria.'; end if;
    insert into expenses (unit_id, category, description, supplier, amount, due_date, paid_date, status, payment_method)
    values (ln.unit_id, v_cat, coalesce(nullif(trim(p_data->>'description'), ''), left(ln.description, 200)), nullif(trim(p_data->>'supplier'), ''),
            v_amt, ln.posted_date, ln.posted_date, 'pago', bank_payment_method(ln.description))
    returning id into v_id;
    update bank_statement_lines set status = 'lancado', auto = false, created_record = true, expense_id = v_id,
      how = 'Despesa · ' || v_cat || coalesce(' · ' || nullif(trim(p_data->>'supplier'), ''), ''),
      decided_by_name = current_actor_name(), decided_at = now(), dup_expense_id = null, dup_line_id = null where id = ln.id;
    if v_match is not null then
      insert into bank_rules (unit_id, direction, match_text, action, category, supplier, description, created_by_name)
      values (ln.unit_id, 'saida', v_match, 'despesa', v_cat, nullif(trim(p_data->>'supplier'), ''), nullif(trim(p_data->>'description'), ''), current_actor_name())
      on conflict do nothing;
    end if;

  elsif p_action = 'receita' then
    if ln.amount < 0 then raise exception 'Saída não pode ser receita.'; end if;
    insert into other_incomes (unit_id, kind, description, amount, received_date, payment_method)
    values (ln.unit_id, 'extrato', coalesce(nullif(trim(p_data->>'description'), ''), left(ln.description, 200)), v_amt, ln.posted_date, bank_payment_method(ln.description))
    returning id into v_id;
    update bank_statement_lines set status = 'lancado', auto = false, created_record = true, income_id = v_id,
      how = 'Outra receita · ' || coalesce(nullif(trim(p_data->>'description'), ''), left(ln.description, 80)),
      decided_by_name = current_actor_name(), decided_at = now(), dup_payment_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;
    if v_match is not null then
      insert into bank_rules (unit_id, direction, match_text, action, description, created_by_name)
      values (ln.unit_id, 'entrada', v_match, 'receita', nullif(trim(p_data->>'description'), ''), current_actor_name())
      on conflict do nothing;
    end if;

  elsif p_action = 'ignorar' then
    update bank_statement_lines set status = 'ignorado', auto = false, how = 'Ignorado (não entra no financeiro)', suggestions = '[]'::jsonb,
      decided_by_name = current_actor_name(), decided_at = now(), dup_payment_id = null, dup_expense_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;
    if v_match is not null then
      insert into bank_rules (unit_id, direction, match_text, action, created_by_name)
      values (ln.unit_id, case when ln.amount > 0 then 'entrada' else 'saida' end, v_match, 'ignorar', current_actor_name())
      on conflict do nothing;
    end if;
  else
    raise exception 'Ação desconhecida.';
  end if;
end;
$$;

create or replace function bank_undo(p_line uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  ln bank_statement_lines%rowtype;
begin
  if not has_permission(auth.uid(), 'page:financeiro') then raise exception 'Sem permissão para o Financeiro.'; end if;
  select * into ln from bank_statement_lines where id = p_line for update;
  if not found then raise exception 'Movimento não encontrado.'; end if;
  if ln.status not in ('lancado', 'conciliado', 'ignorado') then raise exception 'Não há nada para desfazer.'; end if;

  if ln.receipt_id is not null then
    -- comprovante volta a esperar análise
    delete from reservation_documents where receipt_id = ln.receipt_id;
    update portal_receipts set status = 'em_analise', payment_id = null, decided_by_name = null, decided_at = null where id = ln.receipt_id;
  end if;
  if ln.created_record then
    if ln.payment_id is not null then delete from payments where id = ln.payment_id; end if;
    if ln.expense_id is not null then delete from expenses where id = ln.expense_id; end if;
    if ln.income_id is not null then delete from other_incomes where id = ln.income_id; end if;
  elsif ln.expense_id is not null and ln.expense_prev is not null then
    update expenses set status = ln.expense_prev->>'status', paid_date = (ln.expense_prev->>'paid_date')::date,
      payment_method = ln.expense_prev->>'payment_method' where id = ln.expense_id;
  end if;

  update bank_statement_lines set status = 'a_classificar', auto = false, how = null, reservation_id = null, payment_id = null,
    expense_id = null, income_id = null, receipt_id = null, created_record = false, expense_prev = null,
    dup_payment_id = null, dup_expense_id = null, dup_income_id = null, dup_line_id = null,
    decided_by_name = current_actor_name(), decided_at = now()
  where id = ln.id;
end;
$$;

alter table bank_statement_lines drop constraint if exists bank_statement_lines_status_check;
alter table bank_statement_lines add constraint bank_statement_lines_status_check
  check (status in ('a_classificar', 'possivel_duplicado', 'lancado', 'conciliado', 'ignorado'));
alter table bank_statement_lines drop column if exists linked_payment_ids;
drop function if exists bank_is_card(text);

select fix_definer_owners();

commit;
