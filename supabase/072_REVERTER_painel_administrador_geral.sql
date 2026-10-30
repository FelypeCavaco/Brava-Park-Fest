-- =========================================================
-- REVERTER a migração 072 (painel do administrador geral) — só use se for para desfazer.
-- Apaga a lista de administradores gerais, o nome do produto e as colunas
-- "empresa suspensa" e "funções desligadas" (todas voltam a ficar ligadas).
-- =========================================================
begin;

drop function if exists platform_create_company(text, uuid, text, text);
drop function if exists platform_save_settings(text, text, text);
drop function if exists platform_get_settings();
drop function if exists platform_update_company(uuid, text, boolean, text[]);
drop function if exists platform_list_companies();
drop function if exists is_platform_admin(uuid);
drop function if exists public_company_brand();

create or replace function is_active_user(check_id uuid) returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select active from user_profiles where id = check_id), false);
$$;

create or replace function public_company_brand()
returns table (name text, logo_url text, tagline text, team_whatsapp text, mascot_enabled boolean, portal_theme text)
language sql stable security definer set search_path = public as $$
  select c.name, c.logo_url, c.tagline, c.team_whatsapp, c.mascot_enabled, c.portal_theme
  from companies c
  where c.id = coalesce(current_company_id(), (select id from companies order by created_at limit 1));
$$;
revoke all on function public_company_brand() from public;
grant execute on function public_company_brand() to anon, authenticated;

drop table if exists platform_settings;
drop table if exists platform_admins;
alter table companies drop column if exists disabled_modules;
alter table companies drop column if exists active;

create or replace function fix_definer_owners() returns int
language plpgsql set search_path = public as $$
declare f record; n int := 0;
begin
  -- O Postgres só deixa um papel ser dono de função se ele puder "criar" na
  -- área (schema) da função: dá essa permissão só durante a troca.
  execute 'grant create on schema public to app_definer';
  for f in
    select p.oid::regprocedure sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prosecdef and pg_get_userbyid(p.proowner) <> 'app_definer'
      and p.proname not in ('is_active_user', 'is_admin_user', 'has_permission', 'portal_token_valid',
                            'current_company_id', 'current_actor_name', 'set_company_id', 'sync_company_member')
  loop
    execute format('alter function %s owner to app_definer', f.sig);
    n := n + 1;
  end loop;
  execute 'revoke create on schema public from app_definer';
  return n;
end;
$$;
revoke all on function fix_definer_owners() from public, anon, authenticated;
select fix_definer_owners();

commit;
notify pgrst, 'reload schema';
