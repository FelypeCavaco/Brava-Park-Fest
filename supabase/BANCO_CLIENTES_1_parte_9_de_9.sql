-- =========================================================
-- BANCO DOS CLIENTES — ESTRUTURA, PARTE 9 DE 9
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
-- LIMPEZA: nenhum dado da Brava (nem de ninguém) fica no banco novo.
-- =========================================================
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('truncate table %I cascade', t);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
