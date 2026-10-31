-- =========================================================
-- BANCO DOS CLIENTES — ESTRUTURA, PARTE 9 DE 10
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

create or replace function platform_get_settings() returns table (name text, logo_url text, tagline text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query select p.name, p.logo_url, p.tagline from platform_settings p limit 1;
end;
$$;

create or replace function platform_save_settings(p_name text, p_logo_url text, p_tagline text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Informe o nome do produto.'; end if;
  insert into platform_settings (name, logo_url, tagline) values (trim(p_name), nullif(trim(p_logo_url), ''), nullif(trim(p_tagline), ''))
  on conflict (unica) do update set name = excluded.name, logo_url = excluded.logo_url, tagline = excluded.tagline;
end;
$$;

-- Cria a empresa com os dados iniciais e o perfil do primeiro administrador.
-- Chamada só pela função de servidor "platform-admin" (chave de serviço),
-- depois de ela criar o login (p_admin_user) no Supabase Auth.
create or replace function platform_create_company(p_name text, p_admin_user uuid, p_admin_name text, p_admin_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_role uuid;
begin
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Informe o nome da empresa.'; end if;
  if p_admin_user is null or p_admin_name is null or length(trim(p_admin_name)) = 0 then raise exception 'Informe o administrador da empresa.'; end if;
  if exists (select 1 from user_profiles where id = p_admin_user) then raise exception 'Este login já pertence a uma empresa.'; end if;

  insert into companies (name, portal_theme, mascot_enabled) values (trim(p_name), 'padrao', false) returning id into v_company;

  -- dados iniciais
  insert into roles (name, is_admin, company_id) values ('Administrador', true, v_company) returning id into v_role;
  insert into payment_method_fees (company_id, payment_method, fee_percent)
  select v_company, m, 0 from unnest(array['pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'boleto', 'transferencia', 'outro']) m;
  insert into commission_settings (company_id, start_date, beneficiary) values (v_company, today_brazil(), 'Gerente');

  insert into user_profiles (id, name, email, role_id, active, company_id)
  values (p_admin_user, trim(p_admin_name), nullif(trim(p_admin_email), ''), v_role, true, v_company);
  return v_company;
end;
$$;

revoke all on function platform_list_companies() from public, anon;

revoke all on function platform_update_company(uuid, text, boolean, text[]) from public, anon;

revoke all on function platform_get_settings() from public, anon;

revoke all on function platform_save_settings(text, text, text) from public, anon;

grant execute on function platform_list_companies(), platform_update_company(uuid, text, boolean, text[]),
  platform_get_settings(), platform_save_settings(text, text, text) to authenticated;

revoke all on function platform_create_company(text, uuid, text, text) from public, anon, authenticated;

grant execute on function platform_create_company(text, uuid, text, text) to service_role;

-- As funções do painel precisam enxergar todas as empresas: ficam com o dono
-- atual (não passam para app_definer).
create or replace function fix_definer_owners() returns int
language plpgsql set search_path = public as $$
declare f record; n int := 0;
begin
  execute 'grant create on schema public to app_definer';
  for f in
    select p.oid::regprocedure sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prosecdef and pg_get_userbyid(p.proowner) <> 'app_definer'
      and p.proname not in ('is_active_user', 'is_admin_user', 'has_permission', 'portal_token_valid',
                            'current_company_id', 'current_actor_name', 'set_company_id', 'sync_company_member',
                            'is_platform_admin', 'public_company_brand', 'audit_row_change')
      and p.proname not like 'platform\_%'
  loop
    execute format('alter function %s owner to app_definer', f.sig);
    n := n + 1;
  end loop;
  execute 'revoke create on schema public from app_definer';
  return n;
end;
$$;

revoke all on function fix_definer_owners() from public, anon, authenticated;

-- public_company_brand foi recriada acima (dono atual): precisa ver o produto sem login.
-- O histórico de alterações só ESCREVE (na empresa do próprio registro); volta
-- para o dono atual para registrar também o que o administrador geral faz em
-- outra empresa (ex.: suspender), o que o bloqueio entre empresas recusaria.
do $$ begin execute format('alter function audit_row_change() owner to %I', current_user); end $$;

select fix_definer_owners();

-- =========================================================
-- ADMINISTRADOR GERAL FORA DAS EMPRESAS (venda do sistema)
--
-- 1) O administrador geral não é mais funcionário de nenhuma empresa: não
--    aparece em "Usuários e permissões" de ninguém, e nenhum administrador
--    de casa de festas consegue ativar, desativar ou mudar o acesso dele.
--    Ao entrar, ele fica no painel da plataforma; para mexer numa casa de
--    festas, "abre" a empresa (platform_enter_company) e age como
--    administrador dela; "volta" com platform_leave_company.
-- 2) Configurações da empresa e das unidades: num banco com administrador
--    geral (o dos clientes), só ele altera; num banco sem (a Brava), o
--    administrador da empresa continua alterando como hoje.
-- 3) O histórico mostra "Administrador geral" no que ele fizer.
--
-- Na Brava nada muda (não há administrador geral).
-- Roda dentro de uma transação.
-- =========================================================


-- ---------- 1) Administrador geral age como administrador da empresa aberta ----------
create or replace function is_active_user(check_id uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select is_platform_admin(check_id) or coalesce((
    select up.active and coalesce(c.active, true)
    from user_profiles up left join companies c on c.id = up.company_id
    where up.id = check_id
  ), false);
$$;

create or replace function is_admin_user(check_id uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select is_platform_admin(check_id) or exists (
    select 1 from user_profiles up
    join roles r on r.id = up.role_id
    where up.id = check_id and r.is_admin and up.active
  );
$$;

create or replace function current_actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(current_setting('app.audit_actor', true), ''),
                  (select name from user_profiles where id = auth.uid()),
                  case when is_platform_admin(auth.uid()) then 'Administrador geral' end,
                  'Sistema');
$$;

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

  insert into audit_log (company_id, user_id, user_name, action, entity, entity_id, details)
  values (
    coalesce(
      case when tg_table_name = 'companies' then (v_row ->> 'id')::uuid else (v_row ->> 'company_id')::uuid end,
      current_company_id()
    ),
    v_uid,
    coalesce(v_name, case when v_uid is null then 'Link público ou sistema' else case when is_platform_admin(v_uid) then 'Administrador geral' else 'Usuário sem perfil' end end),
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

-- Abre / fecha uma casa de festas para o administrador geral.
create or replace function platform_enter_company(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if not exists (select 1 from companies where id = p_company) then raise exception 'Empresa não encontrada.'; end if;
  insert into company_members (user_id, company_id) values (auth.uid(), p_company)
  on conflict (user_id) do update set company_id = excluded.company_id;
end;
$$;

create or replace function platform_leave_company() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  delete from company_members where user_id = auth.uid();
end;
$$;

revoke all on function platform_enter_company(uuid), platform_leave_company() from public, anon;

grant execute on function platform_enter_company(uuid), platform_leave_company() to authenticated;

-- Empresa pode ser criada sem administrador (ex.: a de demonstração, que o
-- administrador geral abre pelo painel).
create or replace function platform_create_company(p_name text, p_admin_user uuid, p_admin_name text, p_admin_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_role uuid;
begin
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Informe o nome da empresa.'; end if;
  if p_admin_user is not null then
    if p_admin_name is null or length(trim(p_admin_name)) = 0 then raise exception 'Informe o administrador da empresa.'; end if;
    if exists (select 1 from user_profiles where id = p_admin_user) then raise exception 'Este login já pertence a uma empresa.'; end if;
    if is_platform_admin(p_admin_user) then raise exception 'O administrador geral não pode ser funcionário de uma empresa.'; end if;
  end if;

  insert into companies (name, portal_theme, mascot_enabled) values (trim(p_name), 'padrao', false) returning id into v_company;
  insert into roles (name, is_admin, company_id) values ('Administrador', true, v_company) returning id into v_role;
  insert into payment_method_fees (company_id, payment_method, fee_percent)
  select v_company, m, 0 from unnest(array['pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'boleto', 'transferencia', 'outro']) m;
  insert into commission_settings (company_id, start_date, beneficiary) values (v_company, today_brazil(), 'Gerente');

  if p_admin_user is not null then
    insert into user_profiles (id, name, email, role_id, active, company_id)
    values (p_admin_user, trim(p_admin_name), nullif(trim(p_admin_email), ''), v_role, true, v_company);
  end if;
  return v_company;
end;
$$;

-- Quem já é administrador geral sai do cadastro de funcionários (e da
-- empresa aberta): passa a entrar pelo painel.
delete from company_members where user_id in (select user_id from platform_admins);

delete from user_profiles where id in (select user_id from platform_admins);

-- ---------- 2) Configurações da empresa e das unidades ----------
create or replace function can_manage_company_setup(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from platform_admins) then is_platform_admin(p_user) else is_admin_user(p_user) end;
$$;

revoke all on function can_manage_company_setup(uuid) from public, anon;

grant execute on function can_manage_company_setup(uuid) to authenticated, app_definer;

drop policy if exists "insert_admin" on units;

create policy "insert_admin" on units for insert with check (can_manage_company_setup(auth.uid()));

drop policy if exists "update_admin" on units;

create policy "update_admin" on units for update using (can_manage_company_setup(auth.uid())) with check (can_manage_company_setup(auth.uid()));

drop policy if exists "update_own_admin" on companies;

create policy "update_own_admin" on companies for update
  using (id = current_company_id() and can_manage_company_setup(auth.uid()))
  with check (id = current_company_id() and can_manage_company_setup(auth.uid()));

do $$
begin
  drop policy if exists "marca_insert" on storage.objects;
  create policy "marca_insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'marca' and can_manage_company_setup(auth.uid()) and (storage.foldername(name))[1] = current_company_id()::text);
  drop policy if exists "marca_update" on storage.objects;
  create policy "marca_update" on storage.objects for update to authenticated using (bucket_id = 'marca' and can_manage_company_setup(auth.uid()));
  drop policy if exists "marca_delete" on storage.objects;
  create policy "marca_delete" on storage.objects for delete to authenticated using (bucket_id = 'marca' and can_manage_company_setup(auth.uid()));
end $$;

-- Marca também diz qual empresa está aberta e se o banco tem administrador geral.
drop function if exists public_company_brand();

create or replace function public_company_brand()
returns table (name text, logo_url text, tagline text, team_whatsapp text, mascot_enabled boolean, portal_theme text,
               disabled_modules text[], active boolean, company_id uuid, platform_managed boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_plat boolean := exists (select 1 from platform_admins);
begin
  if current_company_id() is null and exists (select 1 from platform_settings) then
    return query select p.name, p.logo_url, p.tagline, null::text, false, 'padrao'::text, '{}'::text[], true, null::uuid, v_plat
    from platform_settings p limit 1;
    return;
  end if;
  return query
  select c.name, c.logo_url, c.tagline, c.team_whatsapp, c.mascot_enabled, c.portal_theme, c.disabled_modules, c.active, c.id, v_plat
  from companies c
  where c.id = coalesce(current_company_id(), (select id from companies order by created_at limit 1));
end;
$$;

revoke all on function public_company_brand() from public;

grant execute on function public_company_brand() to anon, authenticated;

-- ---------- Donos das funções ----------
create or replace function fix_definer_owners() returns int
language plpgsql set search_path = public as $$
declare f record; n int := 0;
begin
  execute 'grant create on schema public to app_definer';
  for f in
    select p.oid::regprocedure sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prosecdef and pg_get_userbyid(p.proowner) <> 'app_definer'
      and p.proname not in ('is_active_user', 'is_admin_user', 'has_permission', 'portal_token_valid',
                            'current_company_id', 'current_actor_name', 'set_company_id', 'sync_company_member',
                            'is_platform_admin', 'public_company_brand', 'audit_row_change', 'can_manage_company_setup')
      and p.proname not like 'platform\_%'
  loop
    execute format('alter function %s owner to app_definer', f.sig);
    n := n + 1;
  end loop;
  execute 'revoke create on schema public from app_definer';
  return n;
end;
$$;

revoke all on function fix_definer_owners() from public, anon, authenticated;

do $$ begin execute format('alter function audit_row_change() owner to %I', current_user); end $$;

select fix_definer_owners();

-- =========================================================
-- COMPROVANTES ACEITOS VÃO PARA OS DOCUMENTOS DA FESTA
--
-- Quando a equipe aceita ("Lançar pagamento") um comprovante enviado pelo
-- cliente no portal, o arquivo passa a aparecer também em Central da festa →
-- Documentos, junto do contrato, com o nome "Comprovante - R$ valor - data".
-- O arquivo não é copiado: o documento aponta para o próprio comprovante
-- (reservation_documents.bucket = 'portal-comprovantes'). Tirar da lista de
-- documentos não apaga o comprovante nem o pagamento.
-- Os comprovantes já aceitos antes desta migração também entram na lista
-- (sem gerar avisos no histórico).
--
-- Vale para o banco da Brava (072) e o dos clientes (073).
-- Não altera pagamentos, festas ou valores. Roda dentro de uma transação.
-- =========================================================


alter table reservation_documents add column if not exists bucket text not null default 'festa-documentos';

alter table reservation_documents drop constraint if exists reservation_documents_bucket_check;

alter table reservation_documents add constraint reservation_documents_bucket_check check (bucket in ('festa-documentos', 'portal-comprovantes'));

alter table reservation_documents add column if not exists receipt_id uuid references portal_receipts(id) on delete cascade;

create unique index if not exists reservation_documents_receipt_key on reservation_documents (receipt_id) where receipt_id is not null;

-- Nome do documento: "Comprovante - R$ 1.500,00 - 30/10/2026.pdf"
create or replace function receipt_document_name(p_amount numeric, p_date date, p_path text) returns text
language sql immutable set search_path = public as $$
  select 'Comprovante - ' || fmt_brl(p_amount) || ' - ' || to_char(p_date, 'DD/MM/YYYY')
         || coalesce('.' || lower(substring(p_path from '\.([A-Za-z0-9]{2,5})$')), '');
$$;

create or replace function launch_portal_receipt(p_receipt uuid, p_amount numeric, p_date date, p_method text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  rc portal_receipts%rowtype;
  v_payment uuid;
begin
  if not has_permission(auth.uid(), 'action:festa.pagamentos') then raise exception 'Sem permissão para registrar pagamentos.'; end if;
  select * into rc from portal_receipts where id = p_receipt for update;
  if not found then raise exception 'Comprovante não encontrado.'; end if;
  if rc.status <> 'em_analise' then raise exception 'Este comprovante já foi analisado.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Informe o valor.'; end if;
  insert into payments (reservation_id, amount, payment_date, payment_method, notes)
  values (rc.reservation_id, round(p_amount, 2), coalesce(p_date, today_brazil()), p_method, 'Comprovante enviado pelo portal do cliente')
  returning id into v_payment;
  update portal_receipts set status = 'lancado', payment_id = v_payment, decided_by_name = current_actor_name(), decided_at = now() where id = p_receipt;
  update portal_events set seen_at = now(), seen_by_name = current_actor_name() where ref_id = p_receipt and seen_at is null;
  -- comprovante aceito entra nos documentos da festa (junto do contrato)
  insert into reservation_documents (reservation_id, file_name, storage_path, bucket, receipt_id)
  values (rc.reservation_id, receipt_document_name(round(p_amount, 2), coalesce(p_date, today_brazil()), rc.storage_path), rc.storage_path, 'portal-comprovantes', rc.id)
  on conflict do nothing;
  return v_payment;
end;
$$;

-- Comprovantes aceitos antes desta migração (sem disparar o histórico).
alter table reservation_documents disable trigger user;

insert into reservation_documents (reservation_id, file_name, storage_path, bucket, receipt_id, uploaded_at, company_id)
select r.reservation_id,
       receipt_document_name(coalesce(p.amount, r.amount), coalesce(p.payment_date, (r.decided_at at time zone 'America/Sao_Paulo')::date, (r.created_at at time zone 'America/Sao_Paulo')::date), r.storage_path),
       r.storage_path, 'portal-comprovantes', r.id, coalesce(r.decided_at, r.created_at), r.company_id
from portal_receipts r
left join payments p on p.id = r.payment_id
where r.status = 'lancado'
  and not exists (select 1 from reservation_documents d where d.receipt_id = r.id);

alter table reservation_documents enable trigger user;

-- Quem vê a festa consegue abrir o comprovante pela lista de documentos.
do $$
begin
  drop policy if exists "portal_comprovantes_read" on storage.objects;
  create policy "portal_comprovantes_read" on storage.objects for select to authenticated
    using (bucket_id = 'portal-comprovantes'
      and (
        -- quem confere comprovantes (avisos do portal / pagamentos)
        ((has_permission(auth.uid(), 'page:portal_avisos') or has_permission(auth.uid(), 'action:festa.pagamentos'))
          and exists (select 1 from portal_receipts pr where pr.storage_path = name))
        -- ou quem vê o comprovante aceito nos documentos da festa
        or exists (select 1 from reservation_documents d where d.bucket = 'portal-comprovantes' and d.storage_path = name)
      ));
end $$;

select fix_definer_owners();

-- =========================================================
-- PARCELAS PROGRAMADAS (cobrança — nível 1)
--
-- Para empresas que cobram em parcelas com data marcada (a Brava continua no
-- modo "livre", como hoje — nada muda para ela).
--
-- 1) Regra de cobrança da empresa (companies): modo (livre / parcelas),
--    sinal %, quantas parcelas, intervalo, 1ª parcela X dias após o sinal,
--    tudo quitado até X dias antes da festa; multa (máx. 2%, CDC), juros ao
--    mês e dias de tolerância no atraso.
-- 2) reservation_installments: o cronograma de cada festa. Nasce sozinho
--    quando a festa é fechada (sai de orçamento) numa empresa em "parcelas";
--    pode ser refeito ou ajustado à mão (a soma precisa bater com o valor).
-- 3) Situação de cada parcela calculada na hora: os pagamentos da festa
--    quitam as parcelas em ordem de vencimento (pagou a mais, abate a
--    próxima; a menos, fica "paga em parte"). Parcela atrasada mostra multa
--    e juros de hoje.
-- 4) Multa e juros recebidos entram como receita própria (other_incomes,
--    tipo 'multa_juros'), sem mudar o valor da festa; dispensa fica anotada
--    na festa com o motivo.
-- 5) Painel (parcelas atrasadas e vencendo), previsão de recebimento por mês
--    e o cronograma no portal do cliente.
--
-- Funciona no banco da Brava (até 074) e no dos clientes.
-- Não altera festas, pagamentos ou valores existentes. Roda numa transação.
-- =========================================================


-- ---------- 1) Regra de cobrança da empresa ----------
alter table companies add column if not exists billing_mode text not null default 'livre';

alter table companies add column if not exists installment_down_percent numeric(5,2) not null default 30;

alter table companies add column if not exists installment_down_days int not null default 0;

alter table companies add column if not exists installment_count int not null default 3;

alter table companies add column if not exists installment_interval text not null default 'mensal';

alter table companies add column if not exists installment_first_days int not null default 30;

alter table companies add column if not exists installment_deadline_days int not null default 7;

alter table companies add column if not exists late_fees_enabled boolean not null default false;

alter table companies add column if not exists late_fee_percent numeric(5,2) not null default 2;

alter table companies add column if not exists late_interest_percent numeric(5,2) not null default 1;

alter table companies add column if not exists late_grace_days int not null default 0;

alter table companies drop constraint if exists companies_billing_check;

alter table companies add constraint companies_billing_check check (
  billing_mode in ('livre', 'parcelas')
  and installment_down_percent between 0 and 100
  and installment_down_days between 0 and 60
  and installment_count between 0 and 24
  and installment_interval in ('semanal', 'quinzenal', 'mensal')
  and installment_first_days between 0 and 365
  and installment_deadline_days between 0 and 60
  and late_fee_percent between 0 and 2          -- Código de Defesa do Consumidor: multa de mora de no máximo 2%
  and late_interest_percent between 0 and 10
  and late_grace_days between 0 and 60
);

-- ---------- 2) Cronograma de cada festa ----------
create table if not exists reservation_installments (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  seq int not null,
  label text not null,
  due_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (reservation_id, seq)
);

create index if not exists idx_reservation_installments_res on reservation_installments (reservation_id);

-- mesma separação por empresa das outras tabelas (migração 071)
alter table reservation_installments add column if not exists company_id uuid references companies(id);

alter table reservation_installments alter column company_id set default current_company_id();

alter table reservation_installments alter column company_id set not null;

create index if not exists idx_reservation_installments_company on reservation_installments (company_id);

drop trigger if exists trg_set_company_id on reservation_installments;

create trigger trg_set_company_id before insert or update on reservation_installments for each row execute function set_company_id();

alter table reservation_installments enable row level security;

drop policy if exists company_isolation on reservation_installments;

create policy company_isolation on reservation_installments as restrictive for all
  using (company_id = current_company_id() or (auth.uid() is null and current_user = 'app_definer'))
  with check (company_id = current_company_id() or (auth.uid() is null and current_user = 'app_definer'));

drop policy if exists app_definer_all on reservation_installments;

create policy app_definer_all on reservation_installments for all to app_definer using (true) with check (true);

drop policy if exists "read_active" on reservation_installments;

create policy "read_active" on reservation_installments for select using (is_active_user(auth.uid()));

drop policy if exists "write_installments" on reservation_installments;

create policy "write_installments" on reservation_installments for all
  using (has_permission(auth.uid(), 'action:festa.pagamentos'))
  with check (has_permission(auth.uid(), 'action:festa.pagamentos'));

drop trigger if exists trg_audit on reservation_installments;

create trigger trg_audit after insert or update or delete on reservation_installments for each row execute function audit_row_change();

grant all on reservation_installments to app_definer;

-- multa e juros recebidos: receita própria ligada à festa
alter table other_incomes add column if not exists reservation_id uuid references reservations(id) on delete set null;

-- ---------- Valor da festa (o mesmo do portal: pacote + extras + consumo) ----------
create or replace function festa_total_due(p_res uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(r.final_value, 0)
    + coalesce((select sum(price_snapshot * quantity) from reservation_extra_items where reservation_id = p_res), 0)
    + coalesce((select sum(quantity * unit_price) from reservation_consumption where reservation_id = p_res), 0)
  from reservations r where r.id = p_res;
$$;

-- Monta o cronograma pela regra da empresa (só calcula, não grava).
create or replace function build_installment_plan(p_res uuid, p_start date)
returns table (seq int, label text, due_date date, amount numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  co companies%rowtype;
  v_total numeric;
  v_event date;
  v_deadline date;
  v_down numeric;
  v_down_due date;
  v_rest numeric;
  v_dates date[] := '{}';
  v_d date;
  v_n int;
  v_each numeric;
  v_seq int := 0;
  i int;
begin
  select c.* into co from companies c join reservations r on r.company_id = c.id where r.id = p_res;
  select event_date into v_event from reservations where id = p_res;
  v_total := round(festa_total_due(p_res), 2);
  if v_total <= 0 then return; end if;
  v_deadline := greatest(v_event - co.installment_deadline_days, p_start);
  v_down := case when co.installment_count = 0 then v_total else round(v_total * co.installment_down_percent / 100, 2) end;
  v_down_due := least(p_start + co.installment_down_days, v_deadline);
  if v_down > 0 then
    v_seq := 1;
    seq := 1; label := case when co.installment_count = 0 then 'Pagamento único' else 'Sinal' end; due_date := v_down_due; amount := v_down;
    return next;
  end if;
  v_rest := v_total - v_down;
  if v_rest <= 0 then return; end if;
  -- datas das parcelas; as que passariam do prazo final vão para o prazo final (juntas)
  for i in 1..greatest(co.installment_count, 1) loop
    v_d := case co.installment_interval
      when 'semanal' then v_down_due + co.installment_first_days + 7 * (i - 1)
      when 'quinzenal' then v_down_due + co.installment_first_days + 15 * (i - 1)
      else ((v_down_due + co.installment_first_days) + make_interval(months => i - 1))::date
    end;
    v_d := least(v_d, v_deadline);
    if not v_d = any(v_dates) then v_dates := v_dates || v_d; end if;
  end loop;
  v_n := array_length(v_dates, 1);
  v_each := round(v_rest / v_n, 2);
  for i in 1..v_n loop
    v_seq := v_seq + 1;
    seq := v_seq;
    label := v_seq || 'ª parcela';
    due_date := v_dates[i];
    amount := case when i = v_n then v_rest - v_each * (v_n - 1) else v_each end;
    return next;
  end loop;
end;
$$;

-- Gera (ou refaz) o cronograma da festa pela regra da empresa.
create or replace function generate_installments(p_res uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_start date; v_n int;
begin
  if auth.uid() is not null and not has_permission(auth.uid(), 'action:festa.pagamentos') then raise exception 'Sem permissão.'; end if;
  if (select c.billing_mode from companies c join reservations r on r.company_id = c.id where r.id = p_res) <> 'parcelas' then
    raise exception 'A empresa está no modo de pagamento livre (sem parcelas).';
  end if;
  select (created_at at time zone 'America/Sao_Paulo')::date into v_start from reservations where id = p_res;
  delete from reservation_installments where reservation_id = p_res;
  insert into reservation_installments (reservation_id, seq, label, due_date, amount)
  select p_res, b.seq, b.label, b.due_date, b.amount from build_installment_plan(p_res, v_start) b;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Ao fechar a festa (sair de orçamento) numa empresa em "parcelas", o
-- cronograma nasce sozinho.
create or replace function auto_generate_installments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status not in ('orcamento', 'cancelada')
     and (tg_op = 'INSERT' or old.status in ('orcamento', 'cancelada'))
     and not exists (select 1 from reservation_installments where reservation_id = new.id)
     and (select billing_mode from companies where id = new.company_id) = 'parcelas' then
    insert into reservation_installments (reservation_id, seq, label, due_date, amount, company_id)
    select new.id, b.seq, b.label, b.due_date, b.amount, new.company_id
    from build_installment_plan(new.id, (coalesce(new.created_at, now()) at time zone 'America/Sao_Paulo')::date) b;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_auto_generate_installments on reservations;

create trigger trg_auto_generate_installments after insert or update of status on reservations
  for each row execute function auto_generate_installments();

-- Salva um cronograma ajustado à mão. p_items = [{"label","due_date","amount"}]
create or replace function save_installments(p_res uuid, p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_soma numeric; v_seq int := 0; it jsonb;
begin
  if not has_permission(auth.uid(), 'action:festa.pagamentos') then raise exception 'Sem permissão.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Informe pelo menos uma parcela.'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) x where (x ->> 'amount')::numeric <= 0 or nullif(x ->> 'due_date', '') is null) then
    raise exception 'Cada parcela precisa de data e valor maior que zero.';
  end if;
  v_total := round(festa_total_due(p_res), 2);
  select round(sum((x ->> 'amount')::numeric), 2) into v_soma from jsonb_array_elements(p_items) x;
  if v_soma <> v_total then
    raise exception 'A soma das parcelas (%) precisa ser igual ao valor da festa (%).', fmt_brl(v_soma), fmt_brl(v_total);
  end if;
  delete from reservation_installments where reservation_id = p_res;
  for it in select x from jsonb_array_elements(p_items) x order by (x ->> 'due_date')::date loop
    v_seq := v_seq + 1;
    insert into reservation_installments (reservation_id, seq, label, due_date, amount)
    values (p_res, v_seq, coalesce(nullif(trim(it ->> 'label'), ''), v_seq || 'ª parcela'), (it ->> 'due_date')::date, round((it ->> 'amount')::numeric, 2));
  end loop;
end;
$$;

-- ---------- 3) Situação das parcelas ----------
-- Os pagamentos quitam as parcelas em ordem de vencimento.
create or replace function festa_installments(p_res uuid, p_today date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := coalesce(p_today, today_brazil());
  co companies%rowtype;
  v_paid numeric;
  v_rest numeric;
  v_acum numeric := 0;
  v_out jsonb := '[]'::jsonb;
  it record;
  v_pago numeric; v_aberto numeric; v_atraso int; v_multa numeric; v_juros numeric; v_status text; v_data_paga date;
  v_tot_atraso numeric := 0; v_tot_encargos numeric := 0; v_tot_vencer numeric := 0; v_soma numeric := 0;
  v_total numeric := round(festa_total_due(p_res), 2);
begin
  select c.* into co from companies c join reservations r on r.company_id = c.id where r.id = p_res;
  select coalesce(sum(amount), 0) into v_paid from payments where reservation_id = p_res;
  v_rest := v_paid;
  for it in select * from reservation_installments where reservation_id = p_res order by due_date, seq loop
    v_pago := least(it.amount, greatest(v_rest, 0));
    v_rest := v_rest - it.amount;
    v_aberto := it.amount - v_pago;
    v_acum := v_acum + it.amount;
    v_soma := v_soma + it.amount;
    v_atraso := case when v_aberto > 0 and v_today > it.due_date then v_today - it.due_date else 0 end;
    if v_aberto > 0 and co.late_fees_enabled and v_atraso > co.late_grace_days then
      v_multa := round(v_aberto * co.late_fee_percent / 100, 2);
      v_juros := round(v_aberto * co.late_interest_percent / 100 * v_atraso / 30.0, 2);
    else
      v_multa := 0; v_juros := 0;
    end if;
    v_data_paga := null;
    if v_aberto = 0 then
      select x.payment_date into v_data_paga from (
        select payment_date, sum(amount) over (order by payment_date, created_at) s from payments where reservation_id = p_res
      ) x where x.s >= v_acum order by x.payment_date limit 1;
    end if;
    v_status := case
      when v_aberto = 0 then 'paga'
      when v_atraso > 0 then 'atrasada'
      when it.due_date = v_today then 'vence_hoje'
      when v_pago > 0 then 'parcial'
      else 'a_vencer' end;
    if v_status = 'atrasada' then v_tot_atraso := v_tot_atraso + v_aberto; v_tot_encargos := v_tot_encargos + v_multa + v_juros;
    elsif v_aberto > 0 then v_tot_vencer := v_tot_vencer + v_aberto; end if;
    v_out := v_out || jsonb_build_object('seq', it.seq, 'label', it.label, 'vencimento', it.due_date, 'valor', it.amount,
      'pago', v_pago, 'aberto', v_aberto, 'status', v_status, 'dias_atraso', v_atraso, 'multa', v_multa, 'juros', v_juros,
      'total_hoje', v_aberto + v_multa + v_juros, 'paga_em', v_data_paga);
  end loop;
  return jsonb_build_object('parcelas', v_out, 'valor_festa', v_total, 'soma_parcelas', v_soma, 'pago', v_paid,
    'em_atraso', v_tot_atraso, 'encargos', v_tot_encargos, 'a_vencer', v_tot_vencer, 'diferenca', v_total - v_soma);
end;
$$;

-- ---------- 4) Multa e juros: receber ou dispensar ----------
create or replace function register_installment_fees(p_res uuid, p_amount numeric, p_date date, p_method text, p_label text) returns void
language plpgsql security definer set search_path = public as $$
declare v_unit uuid; v_cli text;
begin
  if not has_permission(auth.uid(), 'action:festa.pagamentos') then raise exception 'Sem permissão para registrar pagamentos.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Informe o valor da multa e dos juros.'; end if;
  select r.unit_id, c.name into v_unit, v_cli from reservations r join clients c on c.id = r.client_id where r.id = p_res;
  if v_unit is null then raise exception 'Festa não encontrada.'; end if;
  insert into other_incomes (unit_id, kind, description, amount, received_date, payment_method, reservation_id)
  values (v_unit, 'multa_juros', 'Multa e juros por atraso — ' || coalesce(nullif(trim(p_label), ''), 'parcela') || ' — ' || v_cli,
          round(p_amount, 2), coalesce(p_date, today_brazil()), p_method, p_res);
end;
$$;

create or replace function waive_installment_fees(p_res uuid, p_label text, p_amount numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:festa.pagamentos') then raise exception 'Sem permissão.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Informe o motivo da dispensa.'; end if;
  insert into reservation_notes (reservation_id, body, created_by_name)
  values (p_res, 'Multa e juros dispensados (' || coalesce(nullif(trim(p_label), ''), 'parcela') || ', ' || fmt_brl(coalesce(p_amount, 0)) || '): ' || left(trim(p_reason), 300),
          current_actor_name());
end;
$$;

-- ---------- 5) Painel e previsão ----------
-- Parcelas em aberto até X dias à frente (atrasadas incluídas), de todas as festas.
create or replace function installments_attention(p_days int default 7)
returns table (reservation_id uuid, unit_id uuid, cliente text, telefone text, crianca text, event_date date, token uuid,
               seq int, label text, vencimento date, valor numeric, aberto numeric, status text, dias_atraso int,
               multa numeric, juros numeric, total_hoje numeric)
language plpgsql stable security definer set search_path = public as $$
declare f record; p jsonb;
begin
  if not (has_permission(auth.uid(), 'page:financeiro') or has_permission(auth.uid(), 'page:pagamentos')
          or has_permission(auth.uid(), 'action:festa.pagamentos') or has_permission(auth.uid(), 'page:portal_avisos')) then
    raise exception 'Sem permissão';
  end if;
  for f in
    select r.id, r.unit_id, c.name cli, c.phone, r.child_name, r.event_date, g.token
    from reservations r join clients c on c.id = r.client_id left join guest_list_pages g on g.reservation_id = r.id
    where r.status <> 'cancelada' and exists (select 1 from reservation_installments i where i.reservation_id = r.id)
  loop
    for p in select x from jsonb_array_elements(festa_installments(f.id) -> 'parcelas') x loop
      if (p ->> 'aberto')::numeric > 0 and (p ->> 'vencimento')::date <= today_brazil() + p_days then
        reservation_id := f.id; unit_id := f.unit_id; cliente := f.cli; telefone := f.phone; crianca := f.child_name;
        event_date := f.event_date; token := f.token;
        seq := (p ->> 'seq')::int; label := p ->> 'label'; vencimento := (p ->> 'vencimento')::date;
        valor := (p ->> 'valor')::numeric; aberto := (p ->> 'aberto')::numeric; status := p ->> 'status';
        dias_atraso := (p ->> 'dias_atraso')::int; multa := (p ->> 'multa')::numeric; juros := (p ->> 'juros')::numeric;
        total_hoje := (p ->> 'total_hoje')::numeric;
        return next;
      end if;
    end loop;
  end loop;
end;
$$;

-- Previsão: quanto entra por mês (parcelas em aberto), atrasado e encargos.
create or replace function installments_forecast(p_unit uuid default null, p_months int default 6) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  f record; p jsonb;
  v_hoje date := today_brazil();
  v_atraso numeric := 0; v_encargos numeric := 0;
  v_meses jsonb := '{}'::jsonb; v_chave text;
  v_mes_ini date := date_trunc('month', today_brazil())::date;
begin
  if not (has_permission(auth.uid(), 'page:financeiro') or has_permission(auth.uid(), 'page:pagamentos')) then raise exception 'Sem permissão'; end if;
  for f in select r.id from reservations r
           where r.status <> 'cancelada' and (p_unit is null or r.unit_id = p_unit)
             and exists (select 1 from reservation_installments i where i.reservation_id = r.id) loop
    for p in select x from jsonb_array_elements(festa_installments(f.id) -> 'parcelas') x loop
      if (p ->> 'aberto')::numeric > 0 then
        if p ->> 'status' = 'atrasada' then
          v_atraso := v_atraso + (p ->> 'aberto')::numeric;
          v_encargos := v_encargos + (p ->> 'multa')::numeric + (p ->> 'juros')::numeric;
        else
          v_chave := to_char((p ->> 'vencimento')::date, 'YYYY-MM');
          v_meses := v_meses || jsonb_build_object(v_chave, coalesce((v_meses ->> v_chave)::numeric, 0) + (p ->> 'aberto')::numeric);
        end if;
      end if;
    end loop;
  end loop;
  return jsonb_build_object(
    'atrasado', v_atraso,
    'encargos_hoje', v_encargos,
    'meses', (select coalesce(jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM'), 'valor', coalesce((v_meses ->> to_char(m, 'YYYY-MM'))::numeric, 0)) order by m), '[]'::jsonb)
              from generate_series(v_mes_ini, (v_mes_ini + make_interval(months => greatest(p_months, 1) - 1))::date, interval '1 month') m),
    'encargos_recebidos_mes', (select coalesce(sum(amount), 0) from other_incomes o
                               where o.kind = 'multa_juros' and o.received_date >= v_mes_ini and (p_unit is null or o.unit_id = p_unit)));
end;
$$;

revoke all on function festa_total_due(uuid), build_installment_plan(uuid, date) from public, anon, authenticated;

revoke all on function festa_installments(uuid, date) from public, anon;

grant execute on function festa_installments(uuid, date) to authenticated;

revoke all on function generate_installments(uuid), save_installments(uuid, jsonb), register_installment_fees(uuid, numeric, date, text, text),
  waive_installment_fees(uuid, text, numeric, text), installments_attention(int), installments_forecast(uuid, int) from public, anon;

grant execute on function generate_installments(uuid), save_installments(uuid, jsonb), register_installment_fees(uuid, numeric, date, text, text),
  waive_installment_fees(uuid, text, numeric, text), installments_attention(int), installments_forecast(uuid, int) to authenticated;

revoke all on function auto_generate_installments() from public, anon, authenticated;

commit;
