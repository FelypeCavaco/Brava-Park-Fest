-- =========================================================
-- PAINEL DO ADMINISTRADOR GERAL (venda do sistema — Etapa 4)
--
-- 1) platform_admins: quem administra a plataforma (cadastra empresas). Só é
--    preenchida no banco dos clientes; no banco da Brava fica vazia e o
--    painel nem aparece.
-- 2) companies ganha:
--    - active: empresa suspensa (ex.: sem pagamento) — ninguém dela entra;
--    - disabled_modules: funções desligadas para aquela empresa (comissões,
--      agenda, marketing...). Some do menu e das telas dela.
-- 3) platform_settings: nome/logo do produto, mostrados na tela de login do
--    banco compartilhado (sem login não dá para saber de qual empresa é).
-- 4) Funções do painel (só administrador geral): listar empresas com
--    números, editar nome/funções/suspensão, configurar o produto.
--    platform_create_company: cria empresa + dados iniciais + perfil do
--    primeiro administrador — chamada pela função de servidor
--    "platform-admin", que cria o login (precisa da chave de serviço).
-- 5) is_active_user passa a considerar a empresa suspensa.
-- 6) O histórico de alterações registra também o que o administrador geral
--    faz em outra empresa.
--
-- Na Brava nada muda (ela continua ativa e com todas as funções).
-- Roda dentro de uma transação.
-- =========================================================

begin;

-- ---------- 1) Administrador geral ----------
create table if not exists platform_admins (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security; -- sem regras: ninguém lê pela internet
revoke all on platform_admins from anon, authenticated;

create or replace function is_platform_admin(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = p_user);
$$;
revoke all on function is_platform_admin(uuid) from public, anon;
grant execute on function is_platform_admin(uuid) to authenticated;

-- ---------- 2) Empresa: ativa e funções desligadas ----------
alter table companies add column if not exists active boolean not null default true;
alter table companies add column if not exists disabled_modules text[] not null default '{}';

-- Usuário de empresa suspensa deixa de ser "ativo" (todas as permissões caem).
create or replace function is_active_user(check_id uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select coalesce((
    select up.active and coalesce(c.active, true)
    from user_profiles up left join companies c on c.id = up.company_id
    where up.id = check_id
  ), false);
$$;

-- ---------- 3) Produto (tela de login do banco compartilhado) ----------
create table if not exists platform_settings (
  id uuid primary key default gen_random_uuid(),
  unica boolean not null default true unique check (unica),
  name text not null check (length(trim(name)) > 0),
  logo_url text,
  tagline text
);
alter table platform_settings enable row level security;
revoke all on platform_settings from anon, authenticated;

-- Marca: logado = a própria empresa; sem login = o produto (se configurado)
-- ou, num banco de uma empresa só (Brava), a própria empresa.
drop function if exists public_company_brand();
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
revoke all on function public_company_brand() from public;
grant execute on function public_company_brand() to anon, authenticated;

-- ---------- 4) Funções do painel ----------
create or replace function platform_list_companies()
returns table (id uuid, name text, active boolean, created_at timestamptz, disabled_modules text[],
               usuarios int, unidades int, festas int, festas_30d int, ultima_atividade timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query
  select c.id, c.name, c.active, c.created_at, c.disabled_modules,
         (select count(*)::int from user_profiles u where u.company_id = c.id and u.active),
         (select count(*)::int from units un where un.company_id = c.id and un.active),
         (select count(*)::int from reservations r where r.company_id = c.id and r.status <> 'cancelada'),
         (select count(*)::int from reservations r where r.company_id = c.id and r.created_at > now() - interval '30 days'),
         (select max(a.created_at) from audit_log a where a.company_id = c.id)
  from companies c
  order by c.created_at;
end;
$$;

create or replace function platform_update_company(p_company uuid, p_name text, p_active boolean, p_disabled_modules text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Informe o nome da empresa.'; end if;
  update companies set name = trim(p_name), active = coalesce(p_active, active), disabled_modules = coalesce(p_disabled_modules, '{}')
  where id = p_company;
  if not found then raise exception 'Empresa não encontrada.'; end if;
end;
$$;

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

commit;

notify pgrst, 'reload schema';
