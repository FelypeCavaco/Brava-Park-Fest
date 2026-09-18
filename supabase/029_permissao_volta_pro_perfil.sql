-- =========================================================
-- SUPERADA — NÃO RODE ESTE ARQUIVO. Voltou pra perfil fixo demais (só 4
-- valores possíveis) — a 030 corrigiu de novo pra perfil totalmente
-- dinâmico (o dono cria/edita/exclui perfis pela tela). Mantida aqui só de
-- registro histórico.
-- =========================================================
-- Correção: as permissões voltam a ser editadas direto por PERFIL
-- (administrador/financeiro/comercial/operacional) — o perfil já É o
-- "modelo", não precisa de um conceito separado de "modelo de permissão".
-- Continua dando pra ajustar uma pessoa específica por cima do perfil dela
-- (user_permission_overrides), pra quando duas pessoas do mesmo perfil
-- precisarem de acessos diferentes. Desfaz a ideia de "permission_templates"
-- criada na migration 028. Este arquivo funciona independente de quais
-- migrations anteriores (027/028) já tiverem rodado ou não.
-- =========================================================

create table if not exists role_permissions (
  role user_role not null,
  permission_key text not null,
  allowed boolean not null default true,
  primary key (role, permission_key)
);

alter table role_permissions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'role_permissions' and policyname = 'authenticated_read') then
    create policy "authenticated_read" on role_permissions for select using (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'role_permissions' and policyname = 'administrador_write') then
    create policy "administrador_write" on role_permissions for all using (
      exists (select 1 from user_profiles up where up.id = auth.uid() and up.role = 'administrador' and up.active)
    ) with check (
      exists (select 1 from user_profiles up where up.id = auth.uid() and up.role = 'administrador' and up.active)
    );
  end if;
end $$;

-- Ajuste pontual de uma pessoa específica, por cima do que o perfil dela
-- libera — continua existindo, só o "básico" que volta a ser por perfil.
create table if not exists user_permission_overrides (
  user_id uuid not null references user_profiles(id) on delete cascade,
  permission_key text not null,
  allowed boolean not null default true,
  primary key (user_id, permission_key)
);

alter table user_permission_overrides enable row level security;

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

-- ---------- Se a migration 028 chegou a rodar (existe permission_templates),
-- traz os valores dos modelos "(padrão)" de volta pros perfis correspondentes
-- e depois limpa tudo que não é mais usado. ----------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'permission_templates') then
    insert into role_permissions (role, permission_key, allowed)
    select
      (case t.name
        when 'Financeiro (padrão)' then 'financeiro'
        when 'Comercial (padrão)' then 'comercial'
        when 'Operacional (padrão)' then 'operacional'
      end)::user_role,
      pti.permission_key,
      pti.allowed
    from permission_template_items pti
    join permission_templates t on t.id = pti.template_id
    where t.name in ('Financeiro (padrão)', 'Comercial (padrão)', 'Operacional (padrão)')
    on conflict (role, permission_key) do update set allowed = excluded.allowed;

    alter table user_profiles drop column if exists permission_template_id;
    drop table if exists permission_template_items;
    drop table if exists permission_templates;
  end if;
end $$;

-- ---------- Semeia os valores padrão, caso role_permissions ainda esteja
-- vazio (ex: nem a migration 027 nem a 028 rodaram antes desta). Reproduz o
-- que era fixo no código originalmente. ----------
insert into role_permissions (role, permission_key, allowed)
select p.role::user_role, p.permission_key, p.allowed
from (values
  ('financeiro', 'page:painel', true), ('comercial', 'page:painel', true), ('operacional', 'page:painel', true),
  ('financeiro', 'page:lembretes', true), ('comercial', 'page:lembretes', true), ('operacional', 'page:lembretes', true),
  ('financeiro', 'page:reservas', false), ('comercial', 'page:reservas', true), ('operacional', 'page:reservas', true),
  ('financeiro', 'page:visitas', false), ('comercial', 'page:visitas', true), ('operacional', 'page:visitas', true),
  ('financeiro', 'page:festa_detalhe', true), ('comercial', 'page:festa_detalhe', true), ('operacional', 'page:festa_detalhe', true),
  ('financeiro', 'page:clientes', false), ('comercial', 'page:clientes', true), ('operacional', 'page:clientes', false),
  ('financeiro', 'page:reativacao', false), ('comercial', 'page:reativacao', true), ('operacional', 'page:reativacao', false),
  ('financeiro', 'page:satisfacao', false), ('comercial', 'page:satisfacao', true), ('operacional', 'page:satisfacao', false),
  ('financeiro', 'page:pacotes', false), ('comercial', 'page:pacotes', true), ('operacional', 'page:pacotes', false),
  ('financeiro', 'page:contratos', false), ('comercial', 'page:contratos', true), ('operacional', 'page:contratos', false),
  ('financeiro', 'page:propostas', false), ('comercial', 'page:propostas', true), ('operacional', 'page:propostas', false),
  ('financeiro', 'page:marketing', false), ('comercial', 'page:marketing', true), ('operacional', 'page:marketing', false),
  ('financeiro', 'page:funil', false), ('comercial', 'page:funil', true), ('operacional', 'page:funil', false),
  ('financeiro', 'page:pagamentos', true), ('comercial', 'page:pagamentos', false), ('operacional', 'page:pagamentos', false),
  ('financeiro', 'page:financeiro', true), ('comercial', 'page:financeiro', false), ('operacional', 'page:financeiro', false),
  ('financeiro', 'page:resultado_do_mes', true), ('comercial', 'page:resultado_do_mes', false), ('operacional', 'page:resultado_do_mes', false),
  ('financeiro', 'page:lucro_por_festa', true), ('comercial', 'page:lucro_por_festa', false), ('operacional', 'page:lucro_por_festa', false),
  ('financeiro', 'page:relatorios', true), ('comercial', 'page:relatorios', false), ('operacional', 'page:relatorios', false),
  ('financeiro', 'page:estoque', false), ('comercial', 'page:estoque', false), ('operacional', 'page:estoque', true),
  ('financeiro', 'page:fornecedores', false), ('comercial', 'page:fornecedores', false), ('operacional', 'page:fornecedores', true),
  ('financeiro', 'page:escalas', false), ('comercial', 'page:escalas', false), ('operacional', 'page:escalas', true),
  ('financeiro', 'page:relatorio_aniversariantes', false), ('comercial', 'page:relatorio_aniversariantes', false), ('operacional', 'page:relatorio_aniversariantes', true),
  ('financeiro', 'page:usuarios', false), ('comercial', 'page:usuarios', false), ('operacional', 'page:usuarios', false),
  ('financeiro', 'action:reservas.nova_reserva', false), ('comercial', 'action:reservas.nova_reserva', true), ('operacional', 'action:reservas.nova_reserva', true),
  ('financeiro', 'action:reservas.lista_espera', false), ('comercial', 'action:reservas.lista_espera', true), ('operacional', 'action:reservas.lista_espera', true),
  ('financeiro', 'action:festa.trocar_pacote', false), ('comercial', 'action:festa.trocar_pacote', true), ('operacional', 'action:festa.trocar_pacote', false),
  ('financeiro', 'action:festa.editar_dados', false), ('comercial', 'action:festa.editar_dados', true), ('operacional', 'action:festa.editar_dados', true),
  ('financeiro', 'action:festa.documentos', true), ('comercial', 'action:festa.documentos', true), ('operacional', 'action:festa.documentos', true),
  ('financeiro', 'action:festa.lista_convidados', false), ('comercial', 'action:festa.lista_convidados', true), ('operacional', 'action:festa.lista_convidados', true),
  ('financeiro', 'action:festa.pagamentos', true), ('comercial', 'action:festa.pagamentos', false), ('operacional', 'action:festa.pagamentos', false),
  ('financeiro', 'action:festa.itens_extras', false), ('comercial', 'action:festa.itens_extras', true), ('operacional', 'action:festa.itens_extras', true),
  ('financeiro', 'action:festa.consumo_pos_festa', false), ('comercial', 'action:festa.consumo_pos_festa', false), ('operacional', 'action:festa.consumo_pos_festa', true),
  ('financeiro', 'action:festa.checklist', false), ('comercial', 'action:festa.checklist', false), ('operacional', 'action:festa.checklist', true),
  ('financeiro', 'action:festa.equipe', false), ('comercial', 'action:festa.equipe', false), ('operacional', 'action:festa.equipe', true),
  ('financeiro', 'action:financeiro.registrar_despesa', true), ('comercial', 'action:financeiro.registrar_despesa', false), ('operacional', 'action:financeiro.registrar_despesa', false),
  ('financeiro', 'action:financeiro.despesas_fixas', true), ('comercial', 'action:financeiro.despesas_fixas', false), ('operacional', 'action:financeiro.despesas_fixas', false),
  ('financeiro', 'action:financeiro.marcar_pago', true), ('comercial', 'action:financeiro.marcar_pago', false), ('operacional', 'action:financeiro.marcar_pago', false),
  ('financeiro', 'action:financeiro.remover', true), ('comercial', 'action:financeiro.remover', false), ('operacional', 'action:financeiro.remover', false),
  ('financeiro', 'action:pacotes.criar_editar', false), ('comercial', 'action:pacotes.criar_editar', true), ('operacional', 'action:pacotes.criar_editar', false),
  ('financeiro', 'action:pacotes.excluir', false), ('comercial', 'action:pacotes.excluir', true), ('operacional', 'action:pacotes.excluir', false),
  ('financeiro', 'action:clientes.criar_editar', false), ('comercial', 'action:clientes.criar_editar', true), ('operacional', 'action:clientes.criar_editar', false),
  ('financeiro', 'action:clientes.excluir', false), ('comercial', 'action:clientes.excluir', true), ('operacional', 'action:clientes.excluir', false)
) as p(role, permission_key, allowed)
where not exists (
  select 1 from role_permissions existing
  where existing.role = p.role::user_role and existing.permission_key = p.permission_key
);
