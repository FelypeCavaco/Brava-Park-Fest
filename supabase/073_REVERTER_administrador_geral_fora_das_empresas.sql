-- =========================================================
-- REVERTER a migração 073 (administrador geral fora das empresas) — só use se for para desfazer.
-- Volta as regras de antes: administrador de cada empresa mexe nas
-- configurações dela, e o administrador geral volta a precisar de cadastro
-- de funcionário numa empresa (o cadastro apagado pela 073 NÃO volta sozinho).
-- =========================================================
begin;

drop function if exists platform_enter_company(uuid);
drop function if exists platform_leave_company();
delete from company_members where user_id in (select user_id from platform_admins);

drop policy if exists "insert_admin" on units;
create policy "insert_admin" on units for insert with check (is_admin_user(auth.uid()));
drop policy if exists "update_admin" on units;
create policy "update_admin" on units for update using (is_admin_user(auth.uid())) with check (is_admin_user(auth.uid()));
drop policy if exists "update_own_admin" on companies;
create policy "update_own_admin" on companies for update
  using (id = current_company_id() and is_admin_user(auth.uid()))
  with check (id = current_company_id() and is_admin_user(auth.uid()));
do $$
begin
  drop policy if exists "marca_insert" on storage.objects;
  create policy "marca_insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'marca' and is_admin_user(auth.uid()) and (storage.foldername(name))[1] = current_company_id()::text);
  drop policy if exists "marca_update" on storage.objects;
  create policy "marca_update" on storage.objects for update to authenticated using (bucket_id = 'marca' and is_admin_user(auth.uid()));
  drop policy if exists "marca_delete" on storage.objects;
  create policy "marca_delete" on storage.objects for delete to authenticated using (bucket_id = 'marca' and is_admin_user(auth.uid()));
end $$;
drop function if exists can_manage_company_setup(uuid);

drop function if exists public_company_brand();
create or replace function is_active_user(check_id uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select coalesce((
    select up.active and coalesce(c.active, true)
    from user_profiles up left join companies c on c.id = up.company_id
    where up.id = check_id
  ), false);
$$;

create or replace function is_admin_user(check_id uuid) returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from user_profiles up
    join roles r on r.id = up.role_id
    where up.id = check_id and r.is_admin and up.active
  );
$$;

create or replace function current_actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(current_setting('app.audit_actor', true), ''), (select name from user_profiles where id = auth.uid()), 'Sistema');
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

create or replace function public_company_brand()
returns table (name text, logo_url text, tagline text, team_whatsapp text, mascot_enabled boolean, portal_theme text, disabled_modules text[], active boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if current_company_id() is null and exists (select 1 from platform_settings) then
    return query select p.name, p.logo_url, p.tagline, null::text, false, 'padrao'::text, '{}'::text[], true from platform_settings p limit 1;
    return;
  end if;
  return query
  select c.name, c.logo_url, c.tagline, c.team_whatsapp, c.mascot_enabled, c.portal_theme, c.disabled_modules, c.active
  from companies c
  where c.id = coalesce(current_company_id(), (select id from companies order by created_at limit 1));
end;
$$;

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
revoke all on function public_company_brand() from public;
grant execute on function public_company_brand() to anon, authenticated;
revoke all on function fix_definer_owners() from public, anon, authenticated;
select fix_definer_owners();

commit;
notify pgrst, 'reload schema';
