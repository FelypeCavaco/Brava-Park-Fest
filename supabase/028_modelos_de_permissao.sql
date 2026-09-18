-- =========================================================
-- SUPERADA — NÃO RODE ESTE ARQUIVO. Foi uma tentativa intermediária
-- (perfis fixos + "modelos" separados) que a 030 corrigiu e substituiu de
-- vez (perfis viram totalmente dinâmicos, sem conceito de "modelo" à
-- parte). Mantida aqui só de registro histórico.
-- =========================================================
-- Modelos de permissão (templates), editáveis e reutilizáveis, com
-- possibilidade de ajuste individual por pessoa. Antes, as permissões
-- ficavam só presas ao perfil (financeiro/comercial/operacional) — todo
-- mundo do mesmo perfil via exatamente as mesmas coisas. Agora dá pra criar
-- modelos (ex: "Operacional recepção", "Operacional cozinha"), aplicar um
-- modelo em cada pessoa na hora do cadastro (ou depois), e ainda fazer um
-- ajuste pontual só para uma pessoa específica sem precisar criar um modelo
-- novo pra isso.
-- =========================================================

create table if not exists permission_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists permission_template_items (
  template_id uuid not null references permission_templates(id) on delete cascade,
  permission_key text not null,
  allowed boolean not null default true,
  primary key (template_id, permission_key)
);

-- Ajuste específico de uma pessoa, por cima do que o modelo dela diz —
-- usado quando duas pessoas usam o mesmo modelo mas uma precisa de uma
-- exceção pontual (ex: Letícia não pode mexer numa página específica que o
-- resto do time operacional pode).
create table if not exists user_permission_overrides (
  user_id uuid not null references user_profiles(id) on delete cascade,
  permission_key text not null,
  allowed boolean not null default true,
  primary key (user_id, permission_key)
);

alter table user_profiles add column if not exists permission_template_id uuid references permission_templates(id) on delete set null;

alter table permission_templates enable row level security;
alter table permission_template_items enable row level security;
alter table user_permission_overrides enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'permission_templates' and policyname = 'authenticated_read') then
    create policy "authenticated_read" on permission_templates for select using (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'permission_templates' and policyname = 'administrador_write') then
    create policy "administrador_write" on permission_templates for all using (
      exists (select 1 from user_profiles up where up.id = auth.uid() and up.role = 'administrador' and up.active)
    ) with check (
      exists (select 1 from user_profiles up where up.id = auth.uid() and up.role = 'administrador' and up.active)
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'permission_template_items' and policyname = 'authenticated_read') then
    create policy "authenticated_read" on permission_template_items for select using (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'permission_template_items' and policyname = 'administrador_write') then
    create policy "administrador_write" on permission_template_items for all using (
      exists (select 1 from user_profiles up where up.id = auth.uid() and up.role = 'administrador' and up.active)
    ) with check (
      exists (select 1 from user_profiles up where up.id = auth.uid() and up.role = 'administrador' and up.active)
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'user_permission_overrides' and policyname = 'self_or_admin_read') then
    create policy "self_or_admin_read" on user_permission_overrides for select using (
      user_id = auth.uid()
      or exists (select 1 from user_profiles up where up.id = auth.uid() and up.role = 'administrador' and up.active)
    );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'user_permission_overrides' and policyname = 'administrador_write') then
    create policy "administrador_write" on user_permission_overrides for all using (
      exists (select 1 from user_profiles up where up.id = auth.uid() and up.role = 'administrador' and up.active)
    ) with check (
      exists (select 1 from user_profiles up where up.id = auth.uid() and up.role = 'administrador' and up.active)
    );
  end if;
end $$;

-- ---------- Migra o que já existia em role_permissions (por perfil) para
-- modelos nomeados, e liga cada pessoa já cadastrada ao modelo do perfil
-- dela — ninguém perde nem ganha acesso na hora que isso roda. ----------
-- Bloco protegido: só migra/apaga role_permissions se ela ainda existir,
-- pra este arquivo poder ser rodado mais de uma vez sem dar erro.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'role_permissions') then
    insert into permission_templates (name)
    select v.name from (values ('Financeiro (padrão)'), ('Comercial (padrão)'), ('Operacional (padrão)')) as v(name)
    where not exists (select 1 from permission_templates t where t.name = v.name);

    insert into permission_template_items (template_id, permission_key, allowed)
    select t.id, rp.permission_key, rp.allowed
    from role_permissions rp
    join permission_templates t on t.name = case rp.role::text
      when 'financeiro' then 'Financeiro (padrão)'
      when 'comercial' then 'Comercial (padrão)'
      when 'operacional' then 'Operacional (padrão)'
    end
    where rp.role::text in ('financeiro', 'comercial', 'operacional')
    on conflict (template_id, permission_key) do nothing;

    update user_profiles up
    set permission_template_id = t.id
    from permission_templates t
    where up.permission_template_id is null
      and up.role::text = case t.name
        when 'Financeiro (padrão)' then 'financeiro'
        when 'Comercial (padrão)' then 'comercial'
        when 'Operacional (padrão)' then 'operacional'
      end;

    drop table role_permissions;
  end if;
end $$;
