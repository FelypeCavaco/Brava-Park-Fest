-- =========================================================
-- Corrige um bug real: as políticas de segurança de "roles" consultavam
-- a própria tabela "roles" pra checar se quem está mexendo é administrador
-- — isso causa "infinite recursion" no Postgres e trava TODA consulta a
-- essa tabela (e às que dependem dela) com erro 500, até uma leitura
-- simples. Corrigido com uma função que roda com privilégio elevado
-- (dono da tabela, que não passa pelas próprias políticas de segurança),
-- em vez de reconsultar a tabela protegida de dentro da política dela.
-- =========================================================

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

revoke all on function is_admin_user(uuid) from public, anon;
grant execute on function is_admin_user(uuid) to authenticated;

drop policy if exists "administrador_write" on roles;
create policy "administrador_write" on roles
  for all using (is_admin_user(auth.uid())) with check (is_admin_user(auth.uid()));

drop policy if exists "administrador_write" on role_permission_items;
create policy "administrador_write" on role_permission_items
  for all using (is_admin_user(auth.uid())) with check (is_admin_user(auth.uid()));

drop policy if exists "self_or_admin_read" on user_permission_overrides;
create policy "self_or_admin_read" on user_permission_overrides
  for select using (user_id = auth.uid() or is_admin_user(auth.uid()));

drop policy if exists "administrador_write" on user_permission_overrides;
create policy "administrador_write" on user_permission_overrides
  for all using (is_admin_user(auth.uid())) with check (is_admin_user(auth.uid()));
