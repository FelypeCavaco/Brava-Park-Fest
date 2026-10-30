-- =========================================================
-- CONSULTA (só leitura — não altera nada). Rodar ANTES da 071.
-- Confere se o banco permite o que a 071 precisa fazer (criar o papel
-- app_definer e dar a ele o acesso de usuário logado).
-- Copie o resultado (todas as linhas) e mande para o Claude.
-- =========================================================
select 'versao' as item, split_part(version(), ' ', 2) as valor
union all
select 'eu_sou', current_user
union all
select 'pode_criar_papel', (select rolcreaterole::text from pg_roles where rolname = current_user)
union all
select 'sou_superusuario', (select rolsuper::text from pg_roles where rolname = current_user)
union all
select 'ignoro_seguranca', (select rolbypassrls::text from pg_roles where rolname = current_user)
union all
select 'posso_dar_authenticated', (
  select coalesce(bool_or(m.admin_option), false)::text
  from pg_auth_members m join pg_roles r on r.oid = m.roleid join pg_roles u on u.oid = m.member
  where r.rolname = 'authenticated' and u.rolname = current_user)
union all
select 'papel_app_definer_ja_existe', exists (select 1 from pg_roles where rolname = 'app_definer')::text
union all
select 'empresas', (select count(*)::text from companies)
union all
select 'tabelas', (select count(*)::text from pg_tables where schemaname = 'public')
union all
select 'funcoes_por_cima', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef);
