-- =========================================================
-- SEGURANÇA — Etapa 1 de 2.
--
-- Buraco encontrado: TODA tabela do sistema (inclusive user_profiles) tinha
-- a mesma política solta: "for all using (auth.role() = 'authenticated')".
-- Isso significa que QUALQUER funcionário logado, de qualquer perfil,
-- conseguia escrever direto em user_profiles.role_id — e como a tabela
-- `roles` é de leitura livre para qualquer autenticado (inclusive a coluna
-- is_admin), bastava:
--   1) ler o id do perfil administrador em `roles`
--   2) fazer update no próprio user_profiles trocando role_id pra esse id
-- ...para qualquer funcionário virar administrador sozinho, sem passar
-- pela tela de Usuários nem pelo <Can>/RequireAuth (que só escondem botão,
-- não protegem nada de verdade).
--
-- Esta migration:
--   1) Tira user_profiles da política solta e bloqueia escrita pra quem
--      não é administrador ativo — só a Edge Function create-employee
--      (que usa a service role key, não passa por RLS) e a tela de
--      Usuários (só acessível a administrador) continuam funcionando.
--      (`is_admin_user` já exigia active=true desde a migration 031 — isso
--      não muda aqui, só reaproveitado.)
--   2) Cria `is_active_user`, nova, usada na próxima migration para cortar
--      acesso de qualquer usuário desativado (não só administrador) em
--      todas as tabelas — hoje um funcionário comum desativado continua
--      passando em toda política que só checa "auth.role() = authenticated".
-- =========================================================

create or replace function is_active_user(check_id uuid) returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select active from user_profiles where id = check_id), false);
$$;

revoke all on function is_active_user(uuid) from public, anon;
grant execute on function is_active_user(uuid) to authenticated;

-- Remove a política solta especificamente de user_profiles (ela continua
-- existindo pras outras ~40 tabelas até a próxima migration revisar cada
-- uma; aqui o foco é fechar o caminho de virar administrador sozinho).
drop policy if exists "authenticated_full_access" on user_profiles;

create policy "authenticated_read" on user_profiles
  for select using (auth.role() = 'authenticated');
create policy "administrador_write" on user_profiles
  for insert with check (is_admin_user(auth.uid()));
create policy "administrador_update" on user_profiles
  for update using (is_admin_user(auth.uid())) with check (is_admin_user(auth.uid()));
create policy "administrador_delete" on user_profiles
  for delete using (is_admin_user(auth.uid()));
