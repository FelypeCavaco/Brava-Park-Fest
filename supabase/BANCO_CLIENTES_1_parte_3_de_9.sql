-- =========================================================
-- BANCO DOS CLIENTES — ESTRUTURA, PARTE 3 DE 9
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

-- Os planos reais (Festa Completa / Somente o Espaço em São Vicente; Classic
-- / Gourmet / Prime em cada faixa de convidados na Vila Operária), preços por
-- dia da semana e itens extras do catálogo (fotógrafo, número em LED, etc.)
-- ficam no arquivo de migração 018_planos_e_precos.sql — não duplicado aqui
-- por serem ~25 pacotes com texto longo. Rode as migrações em ordem (002 a
-- 018) para reproduzir o estado atual em uma instalação nova.

-- Itens fixos do checklist de consumo pós-festa, semeados nas duas unidades
-- (quantidade real fica a cargo do usuário ajustar depois em Estoque).
insert into inventory_items (unit_id, name, category, unit_of_measure, quantity, minimum_quantity)
select u.id, v.nome, 'Buffet e bebidas', 'un', 0, 0
from units u
cross join (values
  ('Coca Normal'), ('Coca Zero'), ('Guaraná'), ('Suco de laranja'),
  ('Suco de uva'), ('Saco de Batata'), ('Água com gás')
) as v(nome)
where not exists (
  select 1 from inventory_items i where i.unit_id = u.id and i.name = v.nome
);

-- Suco de laranja e uva são controlados em litros (comprados em garrafas de
-- tamanho variado — ver inventory_purchase_variants), com 0,2L por
-- convidado (10L numa festa de 50 pessoas).
update inventory_items set unit_of_measure = 'L', quantity_per_guest = 0.2 where name in ('Suco de laranja', 'Suco de uva');

insert into inventory_purchase_variants (inventory_item_id, label, volume_amount)
select i.id, v.label, v.volume_amount
from inventory_items i
cross join (values ('1,5L', 1.5), ('3L', 3), ('5L', 5)) as v(label, volume_amount)
where i.name in ('Suco de laranja', 'Suco de uva')
  and not exists (
    select 1 from inventory_purchase_variants existing
    where existing.inventory_item_id = i.id and existing.label = v.label
  );

-- Velas numéricas (0-9, azul e rosa) — 20 itens por unidade, agrupados
-- visualmente numa gradinha compacta na tela de Estoque.
insert into inventory_items (unit_id, name, category, unit_of_measure, quantity, minimum_quantity)
select u.id, 'Vela ' || d.digito || ' ' || c.cor, 'Decoração', 'un', 0, 1
from units u
cross join generate_series(0, 9) as d(digito)
cross join (values ('Azul'), ('Rosa')) as c(cor)
where not exists (
  select 1 from inventory_items i where i.unit_id = u.id and i.name = 'Vela ' || d.digito || ' ' || c.cor
);

-- Mensagem padrão (editável pela tela) de confirmação com fornecedores.
insert into message_templates (key, body)
values (
  'confirmar_fornecedores',
  'Olá Pessoal, tudo certo?

Passando para lembrar que a entrega de hoje do BOLO, DOCINHOS, SALGADINHOS E PRATOS QUENTE está programada para as {{horario_entrega}}

TEMA: {{tema}}

{{aniversariante_idade}}

OBS: {{observacao}}'
)
on conflict (key) do nothing;

-- ---------- Tabela 2027 de São Vicente (provisória) ----------
-- Os planos anteriores de São Vicente valem para festas até 31/12/2026;
-- os novos, de 01/01/2027 em diante. "Somente o Espaço" não entra em 2027.
update packages
set valid_until = '2026-12-31'
where unit_id = (select id from units where name = 'São Vicente')
  and valid_from is null
  and valid_until is null;

insert into packages (name, description, base_price, weekday_price, weekend_price, unit_id, guest_limit, duration_hours, included_items, valid_from)
select v.nome, 'Plano de São Vicente — tabela 2027 (provisória)', v.semana, v.semana, v.fds, u.id, v.limite, 4, v.itens, '2027-01-01'
from units u
cross join (values
  ('Festa Completa 40 pessoas (2027)', 4600.00, 4800.00, 40,
    'Buffet completo: salgados fritos e assados sortidos, até 3 (três) opções de pratos assados, docinhos sortidos, bolo, refrigerante, suco e água. Decoração inclusa. Brinquedos: área da cama elástica, circuito radical, tobogã, piscina de bolinhas, basquete eletrônico, fliperama (mais de 10 mil jogos), ambiente game (PlayStation) e presença do Urso Theo. Ambiente climatizado e monitorado, som ambiente, Wi-Fi e convite virtual (padrão Brava Park Fest). Equipe: recepcionista, garçom, copeira, recreadores treinados e equipe de cozinha.'),
  ('Festa Completa 50 pessoas (2027)', 5200.00, 5500.00, 50,
    'Buffet completo: salgados fritos e assados sortidos, até 4 (quatro) opções de pratos assados, docinhos sortidos, bolo, refrigerante, suco e água. Decoração inclusa. Brinquedos: área da cama elástica, circuito radical, tobogã, piscina de bolinhas, basquete eletrônico, fliperama (mais de 10 mil jogos), ambiente game (PlayStation) e presença do Urso Theo. Ambiente climatizado e monitorado, som ambiente, Wi-Fi e convite virtual (padrão Brava Park Fest). Equipe: recepcionista, garçom, copeira, recreadores treinados e equipe de cozinha.'),
  ('Festa Completa 60 pessoas (2027)', 5700.00, 6150.00, 60,
    'Buffet completo: salgados fritos e assados sortidos, até 4 (quatro) opções de pratos assados, docinhos sortidos, bolo, refrigerante, suco e água. Decoração inclusa. Brinquedos: área da cama elástica, circuito radical, tobogã, piscina de bolinhas, basquete eletrônico, fliperama (mais de 10 mil jogos), ambiente game (PlayStation) e presença do Urso Theo. Ambiente climatizado e monitorado, som ambiente, Wi-Fi e convite virtual (padrão Brava Park Fest). Equipe: recepcionista, garçom, copeira, recreadores treinados e equipe de cozinha.')
) as v(nome, semana, fds, limite, itens)
where u.name = 'São Vicente'
  and not exists (select 1 from packages p where p.unit_id = u.id and p.name = v.nome);

-- ---------- Status automático da festa + histórico completo (quem fez o quê) ----------
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

-- =========================================================
-- CUSTO NO ESTOQUE, ACERTO ENTRE UNIDADES E ESTORNO DE CANCELAMENTO
--
-- 1) Estoque passa a ter valor (custo médio ponderado). Cada item guarda a
--    quantidade E o valor total em estoque; o custo médio é sempre
--    valor ÷ quantidade (nunca arredondado a cada operação). Toda mudança
--    de quantidade/valor passa por funções do banco e fica registrada em
--    inventory_movements (compra, consumo, ajuste, transferência...).
--    Mudar quantidade/valor direto na tabela fica bloqueado.
-- 2) "Entrada de compra" (tela Estoque): lança a compra uma vez só e o
--    sistema cria a conta a pagar vinculada. Editar/excluir refaz o estoque
--    pela diferença, na mesma conta.
-- 3) Consumo pós-festa grava o custo da linha (congelado). Só informativo
--    (Lucro por festa) — não mexe no caixa nem no Resultado do mês.
-- 4) Transferência entre unidades é atômica e cria um "acerto" pendente.
--    Confirmar o acerto gera, juntos e uma única vez, a saída na unidade que
--    recebeu os produtos e a entrada (novo tipo "outras entradas") na que
--    mandou. Esses lançamentos só mudam pelo acerto.
-- 5) Cancelamento com valor devolvido cria a saída "Estorno" (uma por festa).
-- 6) Médias de consumo por convidado, calculadas na hora a partir dos dados.
--
-- Pode rodar mais de uma vez sem duplicar nada.
-- =========================================================

-- ---------- Permissões novas ----------
-- Estorno: perfis Financeiro e Comercial (Administrador sempre pode).
insert into role_permission_items (role_id, permission_key, allowed)
select r.id, 'action:festa.estorno', true
from roles r
where not r.is_admin and (r.name ilike '%financeiro%' or r.name ilike '%comercial%')
on conflict (role_id, permission_key) do nothing;

-- Ver/confirmar acertos e definir custo inicial: perfis que já veem o Financeiro.
-- Desfazer confirmação de acerto: só Administrador (nenhuma linha criada).
insert into role_permission_items (role_id, permission_key, allowed)
select r.id, k, true
from roles r
cross join unnest(array['page:acertos', 'action:acertos.confirmar', 'action:estoque.custo_inicial']) k
where not r.is_admin
  and exists (select 1 from role_permission_items x where x.role_id = r.id and x.permission_key = 'page:financeiro' and x.allowed)
on conflict (role_id, permission_key) do nothing;

-- ---------- Formatação para descrições automáticas ----------
create or replace function fmt_brl(p numeric) returns text
language sql immutable as $$
  select 'R$ ' || replace(replace(replace(to_char(round(coalesce(p, 0), 2), 'FM999,999,999,990.00'), ',', '#'), '.', ','), '#', '.');
$$;

create or replace function fmt_qtd(p numeric) returns text
language sql immutable as $$
  select replace(rtrim(rtrim(to_char(coalesce(p, 0), 'FM999999990.000'), '0'), '.'), '.', ',');
$$;

-- ---------- 1) Estoque com valor ----------
alter table inventory_items add column if not exists total_value numeric(18,6) not null default 0;

alter table inventory_items add column if not exists has_cost boolean not null default false;

alter table inventory_items add column if not exists last_unit_cost numeric(18,6);

alter table inventory_items add column if not exists consumption_type text;

update inventory_items
set consumption_type = case when quantity_per_guest is not null then 'por_convidado' else 'por_festa' end
where consumption_type is null;

alter table inventory_items alter column consumption_type set default 'por_convidado';

alter table inventory_items alter column consumption_type set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_items_consumption_type_check') then
    alter table inventory_items add constraint inventory_items_consumption_type_check check (consumption_type in ('por_convidado', 'por_festa'));
  end if;
end $$;

create table if not exists inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  unit_id uuid not null references units(id),
  kind text not null, -- compra, compra_ajuste, compra_excluida, consumo, consumo_ajuste, consumo_desfeito, ajuste_entrada, ajuste_saida, custo_inicial, transferencia_saida, transferencia_entrada, cadastro
  quantity numeric(14,3) not null,       -- + entrou / − saiu
  value numeric(18,6) not null default 0, -- + entrou / − saiu (R$)
  reason text,
  expense_id uuid,
  consumption_id uuid,
  settlement_id uuid,
  reservation_id uuid,
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_movements_item on inventory_movements (inventory_item_id, created_at desc);

alter table inventory_movements enable row level security;

drop policy if exists "read_inventory_movements" on inventory_movements;

create policy "read_inventory_movements" on inventory_movements for select
  using (has_permission(auth.uid(), 'page:estoque') or has_permission(auth.uid(), 'page:financeiro') or has_permission(auth.uid(), 'page:festa_detalhe'));

create or replace function current_actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(current_setting('app.audit_actor', true), ''), (select name from user_profiles where id = auth.uid()), 'Sistema');
$$;

-- Quantidade/valor do estoque só mudam pelas funções abaixo.
create or replace function guard_inventory_stock() returns trigger
language plpgsql as $$
begin
  if (new.quantity is distinct from old.quantity or new.total_value is distinct from old.total_value or new.has_cost is distinct from old.has_cost)
     and coalesce(current_setting('app.stock_fn', true), '') <> '1' then
    raise exception 'A quantidade e o valor do estoque só mudam por Entrada de compra, ajuste, consumo ou transferência.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_inventory_stock on inventory_items;

create trigger trg_guard_inventory_stock before update on inventory_items
  for each row execute function guard_inventory_stock();

-- Item cadastrado já com quantidade fica registrado no histórico.
create or replace function log_inventory_item_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.quantity <> 0 or new.total_value <> 0 then
    insert into inventory_movements (inventory_item_id, unit_id, kind, quantity, value, reason, created_by_name)
    values (new.id, new.unit_id, 'cadastro', new.quantity, new.total_value, 'Item cadastrado', current_actor_name());
  end if;
  return null;
end;
$$;

drop trigger if exists trg_log_inventory_item_created on inventory_items;

create trigger trg_log_inventory_item_created after insert on inventory_items
  for each row execute function log_inventory_item_created();

-- Custo unitário atual do item (médio; sem quantidade, o último conhecido).
create or replace function stock_unit_cost(p_item uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when quantity > 0 then total_value / quantity else last_unit_cost end
  from inventory_items where id = p_item;
$$;

-- ENTRADA. p_value nulo = entra pelo custo médio atual (ajuste, devolução).
-- Devolve o valor que entrou no estoque.
create or replace function stock_apply_in(
  p_item uuid, p_qty numeric, p_value numeric, p_kind text, p_reason text default null,
  p_expense uuid default null, p_consumption uuid default null, p_settlement uuid default null, p_reservation uuid default null
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  it inventory_items%rowtype;
  v_value numeric;
  v_unit numeric;
begin
  select * into it from inventory_items where id = p_item for update;
  if not found then return 0; end if;
  perform set_config('app.stock_fn', '1', true);

  if p_value is null then
    v_unit := case when it.quantity > 0 then it.total_value / it.quantity else it.last_unit_cost end;
    v_value := case when it.has_cost then round(p_qty * coalesce(v_unit, 0), 6) else 0 end;
  else
    v_value := p_value;
    -- Primeira compra com valor de um item que tinha quantidade sem custo:
    -- o que já existia passa a valer o custo desta compra.
    if not it.has_cost and p_value > 0 and it.quantity > 0 and p_qty > 0 then
      update inventory_items set total_value = it.quantity * (p_value / p_qty) where id = p_item;
      insert into inventory_movements (inventory_item_id, unit_id, kind, quantity, value, reason, expense_id, created_by_name)
      values (p_item, it.unit_id, 'custo_inicial', 0, it.quantity * (p_value / p_qty),
              'Custo assumido para o estoque que estava sem custo, pelo valor desta compra', p_expense, 'Sistema');
      it.total_value := it.quantity * (p_value / p_qty);
    end if;
  end if;

  update inventory_items set
    quantity = quantity + p_qty,
    total_value = it.total_value + v_value,
    has_cost = it.has_cost or (p_value is not null and p_value > 0),
    last_unit_cost = case when p_value is not null and p_value > 0 and p_qty > 0 then p_value / p_qty else last_unit_cost end,
    updated_at = now()
  where id = p_item;

  insert into inventory_movements (inventory_item_id, unit_id, kind, quantity, value, reason, expense_id, consumption_id, settlement_id, reservation_id, created_by_name)
  values (p_item, it.unit_id, p_kind, p_qty, v_value, p_reason, p_expense, p_consumption, p_settlement, p_reservation, current_actor_name());

  perform set_config('app.stock_fn', '', true);
  return v_value;
end;
$$;

-- SAÍDA pelo custo médio. Devolve o custo atribuído à saída (nulo se o item
-- está sem custo). Saída maior que o estoque: o estoque vai a zero (nunca
-- negativo) e o excedente é custeado pelo custo médio do momento.
create or replace function stock_apply_out(
  p_item uuid, p_qty numeric, p_kind text, p_reason text default null,
  p_expense uuid default null, p_consumption uuid default null, p_settlement uuid default null, p_reservation uuid default null
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  it inventory_items%rowtype;
  v_unit numeric;
  v_from_stock numeric;
  v_cost numeric;
begin
  select * into it from inventory_items where id = p_item for update;
  if not found then return null; end if;
  perform set_config('app.stock_fn', '1', true);

  v_unit := case when it.quantity > 0 then it.total_value / it.quantity else it.last_unit_cost end;
  if p_qty >= it.quantity then
    v_from_stock := it.total_value;  -- leva todo o valor: sem sobra de centavos
    v_cost := it.total_value + round(greatest(p_qty - greatest(it.quantity, 0), 0) * coalesce(v_unit, 0), 6);
    update inventory_items set quantity = 0, total_value = 0, updated_at = now() where id = p_item;
  else
    v_from_stock := round(p_qty * it.total_value / it.quantity, 6);
    v_cost := v_from_stock;
    update inventory_items set quantity = quantity - p_qty, total_value = total_value - v_from_stock, updated_at = now() where id = p_item;
  end if;

  insert into inventory_movements (inventory_item_id, unit_id, kind, quantity, value, reason, expense_id, consumption_id, settlement_id, reservation_id, created_by_name)
  values (p_item, it.unit_id, p_kind, -least(p_qty, greatest(it.quantity, 0)), -v_from_stock, p_reason, p_expense, p_consumption, p_settlement, p_reservation, current_actor_name());

  perform set_config('app.stock_fn', '', true);
  return case when it.has_cost then v_cost else null end;
end;
$$;

-- Ajuste "cru" por diferença (edição/exclusão de compra). Se deixaria o
-- estoque negativo, exige justificativa; com ela, zera quantidade e valor.
create or replace function stock_apply_delta(
  p_item uuid, p_dqty numeric, p_dvalue numeric, p_kind text, p_reason text, p_justification text, p_expense uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  it inventory_items%rowtype;
  v_q numeric;
  v_v numeric;
begin
  select * into it from inventory_items where id = p_item for update;
  if not found then return; end if;
  v_q := it.quantity + p_dqty;
  v_v := it.total_value + p_dvalue;
  if v_q < 0 then
    if coalesce(trim(p_justification), '') = '' then
      raise exception 'ESTOQUE_NEGATIVO: % — parte dessa compra já foi consumida. Informe uma justificativa para continuar.', it.name;
    end if;
    v_q := 0;
  end if;
  if v_q = 0 or v_v < 0 then v_v := case when v_q = 0 then 0 else greatest(v_v, 0) end; end if;

  perform set_config('app.stock_fn', '1', true);
  update inventory_items set
    quantity = v_q, total_value = v_v,
    has_cost = has_cost or p_dvalue > 0,
    updated_at = now()
  where id = p_item;
  insert into inventory_movements (inventory_item_id, unit_id, kind, quantity, value, reason, expense_id, created_by_name)
  values (p_item, it.unit_id, p_kind, v_q - it.quantity, v_v - it.total_value,
          concat_ws(' · ', p_reason, nullif(trim(p_justification), '')), p_expense, current_actor_name());
  perform set_config('app.stock_fn', '', true);
end;
$$;

revoke all on function stock_apply_in(uuid, numeric, numeric, text, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;

revoke all on function stock_apply_out(uuid, numeric, text, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;

revoke all on function stock_apply_delta(uuid, numeric, numeric, text, text, text, uuid) from public, anon, authenticated;

revoke all on function stock_unit_cost(uuid) from public, anon;

grant execute on function stock_unit_cost(uuid) to authenticated;

revoke all on function current_actor_name() from public, anon;

grant execute on function current_actor_name() to authenticated;

-- Ajuste manual (+/− e campo de quantidade da tela Estoque). Não cria despesa.
create or replace function adjust_stock(p_item uuid, p_new_quantity numeric, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_q numeric;
begin
  if not has_permission(auth.uid(), 'page:estoque') then raise exception 'Sem permissão'; end if;
  if p_new_quantity < 0 then raise exception 'A quantidade não pode ser negativa.'; end if;
  select quantity into v_q from inventory_items where id = p_item;
  if v_q is null then raise exception 'Item não encontrado.'; end if;
  if p_new_quantity > v_q then
    perform stock_apply_in(p_item, p_new_quantity - v_q, null, 'ajuste_entrada', coalesce(nullif(trim(p_reason), ''), 'Ajuste manual'));
  elsif p_new_quantity < v_q then
    if coalesce(trim(p_reason), '') = '' then raise exception 'Informe o motivo para diminuir o estoque.'; end if;
    perform stock_apply_out(p_item, v_q - p_new_quantity, 'ajuste_saida', p_reason);
  end if;
end;
$$;

-- Custo inicial de um item que está "sem custo". Não cria lançamento financeiro.
create or replace function set_initial_stock_cost(p_item uuid, p_unit_cost numeric) returns void
language plpgsql security definer set search_path = public as $$
declare
  it inventory_items%rowtype;
begin
  if not has_permission(auth.uid(), 'action:estoque.custo_inicial') then raise exception 'Sem permissão'; end if;
  if p_unit_cost is null or p_unit_cost < 0 then raise exception 'Informe um custo unitário válido.'; end if;
  select * into it from inventory_items where id = p_item for update;
  if not found then raise exception 'Item não encontrado.'; end if;
  if it.has_cost then raise exception 'Este item já tem custo.'; end if;
  perform set_config('app.stock_fn', '1', true);
  update inventory_items set total_value = quantity * p_unit_cost, has_cost = true, last_unit_cost = p_unit_cost, updated_at = now() where id = p_item;
  insert into inventory_movements (inventory_item_id, unit_id, kind, quantity, value, reason, created_by_name)
  values (p_item, it.unit_id, 'custo_inicial', 0, it.quantity * p_unit_cost, 'Custo inicial definido: ' || fmt_brl(p_unit_cost) || ' por ' || it.unit_of_measure, current_actor_name());
  perform set_config('app.stock_fn', '', true);
end;
$$;

-- ---------- 2) Entrada de compra ----------
alter table expenses add column if not exists is_stock_purchase boolean not null default false;

alter table expenses add column if not exists other_items_value numeric(14,2) not null default 0;

alter table expenses add column if not exists purchase_date date;

alter table expenses add column if not exists reservation_id uuid references reservations(id) on delete set null;

alter table expenses add column if not exists settlement_batch_id uuid;

create unique index if not exists uq_expenses_settlement_batch on expenses (settlement_batch_id) where settlement_batch_id is not null;

create unique index if not exists uq_expenses_estorno_ativo on expenses (reservation_id) where category = 'Estorno' and status <> 'cancelado' and reservation_id is not null;

alter table expense_items add column if not exists line_value numeric(14,2);

alter table expense_items add column if not exists unit_cost numeric(18,6);

alter table expense_items add column if not exists stock_value numeric(18,6);

-- valor que de fato entrou no estoque

-- Lançamentos "travados" (compra de estoque, acerto, estorno) só mudam pelas funções.
create or replace function guard_locked_expense() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.expense_fn', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if old.settlement_batch_id is not null then
    raise exception 'Lançamento de acerto entre unidades: altere ou desfaça pela tela Acertos entre unidades.';
  end if;
  if old.is_stock_purchase or (old.category = 'Estorno' and old.reservation_id is not null) then
    if tg_op = 'DELETE' then
      raise exception '%', case when old.is_stock_purchase then 'Compra de estoque: exclua pela Entrada de compra (tela Estoque).' else 'Estorno: altere pela festa cancelada.' end;
    end if;
    if new.amount is distinct from old.amount or new.unit_id is distinct from old.unit_id
       or new.category is distinct from old.category or new.description is distinct from old.description
       or new.supplier is distinct from old.supplier or new.is_stock_purchase is distinct from old.is_stock_purchase
       or new.reservation_id is distinct from old.reservation_id then
      raise exception '%', case when old.is_stock_purchase then 'Compra de estoque: edite pela Entrada de compra (tela Estoque).' else 'Estorno: altere o valor pela festa cancelada.' end;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_guard_locked_expense on expenses;

create trigger trg_guard_locked_expense before update or delete on expenses
  for each row execute function guard_locked_expense();

commit;
