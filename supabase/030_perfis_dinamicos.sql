-- =========================================================
-- Correção final: perfis de acesso viram totalmente dinâmicos — o dono
-- cria, edita e apaga perfis pela tela (ex: "Recepção"), além dos que já
-- vêm prontos (Administrador, Financeiro, Comercial, Operacional). Cada
-- perfil tem seu próprio conjunto de permissões, editável. Continua dando
-- pra ajustar só uma pessoa específica por cima do perfil dela
-- (user_permission_overrides), sem mudar qual é o perfil mostrado pra ela.
--
-- Esta migration SUBSTITUI de vez as tentativas anteriores (027/028/029,
-- marcadas como superadas) — rode só esta. Funciona independente de quais
-- delas você já tiver rodado ou não.
-- =========================================================

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_admin boolean not null default false, -- perfil com acesso total, nunca passa por checagem de permissão
  created_at timestamptz not null default now()
);

create table if not exists role_permission_items (
  role_id uuid not null references roles(id) on delete cascade,
  permission_key text not null,
  allowed boolean not null default true,
  primary key (role_id, permission_key)
);

-- Ajuste específico de uma pessoa, por cima do que o perfil dela diz — pra
-- quando duas pessoas do mesmo perfil precisarem de acessos diferentes,
-- sem mudar o perfil que aparece pra nenhuma das duas.
create table if not exists user_permission_overrides (
  user_id uuid not null references user_profiles(id) on delete cascade,
  permission_key text not null,
  allowed boolean not null default true,
  primary key (user_id, permission_key)
);

-- Precisa existir ANTES das policies abaixo, porque elas fazem join com
-- essa coluna pra checar se quem está mexendo é administrador.
alter table user_profiles add column if not exists role_id uuid references roles(id);

alter table roles enable row level security;
alter table role_permission_items enable row level security;
alter table user_permission_overrides enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'roles' and policyname = 'authenticated_read') then
    create policy "authenticated_read" on roles for select using (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'roles' and policyname = 'administrador_write') then
    create policy "administrador_write" on roles for all using (
      exists (
        select 1 from user_profiles up join roles r on r.id = up.role_id
        where up.id = auth.uid() and r.is_admin and up.active
      )
    ) with check (
      exists (
        select 1 from user_profiles up join roles r on r.id = up.role_id
        where up.id = auth.uid() and r.is_admin and up.active
      )
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'role_permission_items' and policyname = 'authenticated_read') then
    create policy "authenticated_read" on role_permission_items for select using (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'role_permission_items' and policyname = 'administrador_write') then
    create policy "administrador_write" on role_permission_items for all using (
      exists (
        select 1 from user_profiles up join roles r on r.id = up.role_id
        where up.id = auth.uid() and r.is_admin and up.active
      )
    ) with check (
      exists (
        select 1 from user_profiles up join roles r on r.id = up.role_id
        where up.id = auth.uid() and r.is_admin and up.active
      )
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'user_permission_overrides' and policyname = 'self_or_admin_read') then
    create policy "self_or_admin_read" on user_permission_overrides for select using (
      user_id = auth.uid()
      or exists (
        select 1 from user_profiles up join roles r on r.id = up.role_id
        where up.id = auth.uid() and r.is_admin and up.active
      )
    );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'user_permission_overrides' and policyname = 'administrador_write') then
    create policy "administrador_write" on user_permission_overrides for all using (
      exists (
        select 1 from user_profiles up join roles r on r.id = up.role_id
        where up.id = auth.uid() and r.is_admin and up.active
      )
    ) with check (
      exists (
        select 1 from user_profiles up join roles r on r.id = up.role_id
        where up.id = auth.uid() and r.is_admin and up.active
      )
    );
  end if;
end $$;

-- ---------- Perfis básicos + permissões padrão (só entra se ainda não
-- existir um perfil com esse nome) ----------
insert into roles (name, is_admin)
select v.name, v.is_admin from (values
  ('Administrador', true),
  ('Financeiro', false),
  ('Comercial', false),
  ('Operacional', false)
) as v(name, is_admin)
where not exists (select 1 from roles r where r.name = v.name);

insert into role_permission_items (role_id, permission_key, allowed)
select r.id, p.permission_key, p.allowed
from (values
  ('Financeiro', 'page:painel', true), ('Comercial', 'page:painel', true), ('Operacional', 'page:painel', true),
  ('Financeiro', 'page:lembretes', true), ('Comercial', 'page:lembretes', true), ('Operacional', 'page:lembretes', true),
  ('Financeiro', 'page:reservas', false), ('Comercial', 'page:reservas', true), ('Operacional', 'page:reservas', true),
  ('Financeiro', 'page:visitas', false), ('Comercial', 'page:visitas', true), ('Operacional', 'page:visitas', true),
  ('Financeiro', 'page:festa_detalhe', true), ('Comercial', 'page:festa_detalhe', true), ('Operacional', 'page:festa_detalhe', true),
  ('Financeiro', 'page:clientes', false), ('Comercial', 'page:clientes', true), ('Operacional', 'page:clientes', false),
  ('Financeiro', 'page:reativacao', false), ('Comercial', 'page:reativacao', true), ('Operacional', 'page:reativacao', false),
  ('Financeiro', 'page:satisfacao', false), ('Comercial', 'page:satisfacao', true), ('Operacional', 'page:satisfacao', false),
  ('Financeiro', 'page:pacotes', false), ('Comercial', 'page:pacotes', true), ('Operacional', 'page:pacotes', false),
  ('Financeiro', 'page:contratos', false), ('Comercial', 'page:contratos', true), ('Operacional', 'page:contratos', false),
  ('Financeiro', 'page:propostas', false), ('Comercial', 'page:propostas', true), ('Operacional', 'page:propostas', false),
  ('Financeiro', 'page:marketing', false), ('Comercial', 'page:marketing', true), ('Operacional', 'page:marketing', false),
  ('Financeiro', 'page:funil', false), ('Comercial', 'page:funil', true), ('Operacional', 'page:funil', false),
  ('Financeiro', 'page:pagamentos', true), ('Comercial', 'page:pagamentos', false), ('Operacional', 'page:pagamentos', false),
  ('Financeiro', 'page:financeiro', true), ('Comercial', 'page:financeiro', false), ('Operacional', 'page:financeiro', false),
  ('Financeiro', 'page:resultado_do_mes', true), ('Comercial', 'page:resultado_do_mes', false), ('Operacional', 'page:resultado_do_mes', false),
  ('Financeiro', 'page:lucro_por_festa', true), ('Comercial', 'page:lucro_por_festa', false), ('Operacional', 'page:lucro_por_festa', false),
  ('Financeiro', 'page:relatorios', true), ('Comercial', 'page:relatorios', false), ('Operacional', 'page:relatorios', false),
  ('Financeiro', 'page:estoque', false), ('Comercial', 'page:estoque', false), ('Operacional', 'page:estoque', true),
  ('Financeiro', 'page:fornecedores', false), ('Comercial', 'page:fornecedores', false), ('Operacional', 'page:fornecedores', true),
  ('Financeiro', 'page:escalas', false), ('Comercial', 'page:escalas', false), ('Operacional', 'page:escalas', true),
  ('Financeiro', 'page:relatorio_aniversariantes', false), ('Comercial', 'page:relatorio_aniversariantes', false), ('Operacional', 'page:relatorio_aniversariantes', true),
  ('Financeiro', 'page:usuarios', false), ('Comercial', 'page:usuarios', false), ('Operacional', 'page:usuarios', false),
  ('Financeiro', 'action:reservas.nova_reserva', false), ('Comercial', 'action:reservas.nova_reserva', true), ('Operacional', 'action:reservas.nova_reserva', true),
  ('Financeiro', 'action:reservas.lista_espera', false), ('Comercial', 'action:reservas.lista_espera', true), ('Operacional', 'action:reservas.lista_espera', true),
  ('Financeiro', 'action:festa.trocar_pacote', false), ('Comercial', 'action:festa.trocar_pacote', true), ('Operacional', 'action:festa.trocar_pacote', false),
  ('Financeiro', 'action:festa.editar_dados', false), ('Comercial', 'action:festa.editar_dados', true), ('Operacional', 'action:festa.editar_dados', true),
  ('Financeiro', 'action:festa.documentos', true), ('Comercial', 'action:festa.documentos', true), ('Operacional', 'action:festa.documentos', true),
  ('Financeiro', 'action:festa.lista_convidados', false), ('Comercial', 'action:festa.lista_convidados', true), ('Operacional', 'action:festa.lista_convidados', true),
  ('Financeiro', 'action:festa.pagamentos', true), ('Comercial', 'action:festa.pagamentos', false), ('Operacional', 'action:festa.pagamentos', false),
  ('Financeiro', 'action:festa.itens_extras', false), ('Comercial', 'action:festa.itens_extras', true), ('Operacional', 'action:festa.itens_extras', true),
  ('Financeiro', 'action:festa.consumo_pos_festa', false), ('Comercial', 'action:festa.consumo_pos_festa', false), ('Operacional', 'action:festa.consumo_pos_festa', true),
  ('Financeiro', 'action:festa.checklist', false), ('Comercial', 'action:festa.checklist', false), ('Operacional', 'action:festa.checklist', true),
  ('Financeiro', 'action:festa.equipe', false), ('Comercial', 'action:festa.equipe', false), ('Operacional', 'action:festa.equipe', true),
  ('Financeiro', 'action:financeiro.registrar_despesa', true), ('Comercial', 'action:financeiro.registrar_despesa', false), ('Operacional', 'action:financeiro.registrar_despesa', false),
  ('Financeiro', 'action:financeiro.despesas_fixas', true), ('Comercial', 'action:financeiro.despesas_fixas', false), ('Operacional', 'action:financeiro.despesas_fixas', false),
  ('Financeiro', 'action:financeiro.marcar_pago', true), ('Comercial', 'action:financeiro.marcar_pago', false), ('Operacional', 'action:financeiro.marcar_pago', false),
  ('Financeiro', 'action:financeiro.remover', true), ('Comercial', 'action:financeiro.remover', false), ('Operacional', 'action:financeiro.remover', false),
  ('Financeiro', 'action:pacotes.criar_editar', false), ('Comercial', 'action:pacotes.criar_editar', true), ('Operacional', 'action:pacotes.criar_editar', false),
  ('Financeiro', 'action:pacotes.excluir', false), ('Comercial', 'action:pacotes.excluir', true), ('Operacional', 'action:pacotes.excluir', false),
  ('Financeiro', 'action:clientes.criar_editar', false), ('Comercial', 'action:clientes.criar_editar', true), ('Operacional', 'action:clientes.criar_editar', false),
  ('Financeiro', 'action:clientes.excluir', false), ('Comercial', 'action:clientes.excluir', true), ('Operacional', 'action:clientes.excluir', false)
) as p(role_name, permission_key, allowed)
join roles r on r.name = p.role_name
where not exists (
  select 1 from role_permission_items existing
  where existing.role_id = r.id and existing.permission_key = p.permission_key
);

-- ---------- Liga cada pessoa já cadastrada ao novo perfil correspondente,
-- a partir do valor antigo (fixo) que ela tinha ----------
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'role') then
    update user_profiles up
    set role_id = r.id
    from roles r
    where up.role_id is null
      and r.name = (case up.role::text
        when 'administrador' then 'Administrador'
        when 'financeiro' then 'Financeiro'
        when 'comercial' then 'Comercial'
        when 'operacional' then 'Operacional'
      end);
  end if;
end $$;

-- ---------- Limpa o que ficou de tentativas anteriores (027/028/029), se
-- alguma delas chegou a rodar ----------
drop table if exists permission_template_items;
drop table if exists permission_templates;
drop table if exists role_permissions;
alter table user_profiles drop column if exists permission_template_id;

-- ---------- A coluna fixa antiga de perfil não é mais usada — role_id manda
-- agora. Precisa ser a última coisa, depois que todo mundo já foi migrado. ----------
alter table user_profiles drop column if exists role;
drop type if exists user_role;
