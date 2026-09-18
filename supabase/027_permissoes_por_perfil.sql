-- =========================================================
-- SUPERADA — NÃO RODE ESTE ARQUIVO. Foi substituída pela 030, que já
-- cobre tudo isso (e mais) de um jeito que funciona mesmo se este arquivo
-- nunca tiver sido rodado. Mantida aqui só de registro histórico.
-- =========================================================
-- Permissões editáveis por perfil: em vez de fixo no código, cada
-- página e cada ação/botão sensível vira uma "chave de permissão"
-- (permission_key) que o administrador liga/desliga por perfil na
-- tela de Usuários e permissões. Administrador sempre tem acesso
-- total (não passa por esta tabela, fica garantido no código).
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
    create policy "authenticated_read" on role_permissions
      for select using (auth.role() = 'authenticated');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'role_permissions' and policyname = 'administrador_write') then
    create policy "administrador_write" on role_permissions
      for all using (
        exists (select 1 from user_profiles up where up.id = auth.uid() and up.role = 'administrador' and up.active)
      ) with check (
        exists (select 1 from user_profiles up where up.id = auth.uid() and up.role = 'administrador' and up.active)
      );
  end if;
end $$;

-- ---------- Seed: reproduz exatamente as regras que já existiam fixas no
-- código (src/lib/permissions.ts), pra ninguém perder nem ganhar acesso na
-- hora que essa tabela passa a valer. Depois disso o administrador edita
-- livremente pela tela. ----------
insert into role_permissions (role, permission_key, allowed)
select p.role::user_role, p.permission_key, p.allowed
from (values
  -- páginas abertas pra todo mundo hoje
  ('financeiro', 'page:painel', true), ('comercial', 'page:painel', true), ('operacional', 'page:painel', true),
  ('financeiro', 'page:lembretes', true), ('comercial', 'page:lembretes', true), ('operacional', 'page:lembretes', true),
  -- grupo Reservas
  ('financeiro', 'page:reservas', false), ('comercial', 'page:reservas', true), ('operacional', 'page:reservas', true),
  ('financeiro', 'page:visitas', false), ('comercial', 'page:visitas', true), ('operacional', 'page:visitas', true),
  ('financeiro', 'page:festa_detalhe', true), ('comercial', 'page:festa_detalhe', true), ('operacional', 'page:festa_detalhe', true),
  -- grupo Clientes
  ('financeiro', 'page:clientes', false), ('comercial', 'page:clientes', true), ('operacional', 'page:clientes', false),
  ('financeiro', 'page:reativacao', false), ('comercial', 'page:reativacao', true), ('operacional', 'page:reativacao', false),
  ('financeiro', 'page:satisfacao', false), ('comercial', 'page:satisfacao', true), ('operacional', 'page:satisfacao', false),
  -- grupo Comercial
  ('financeiro', 'page:pacotes', false), ('comercial', 'page:pacotes', true), ('operacional', 'page:pacotes', false),
  ('financeiro', 'page:contratos', false), ('comercial', 'page:contratos', true), ('operacional', 'page:contratos', false),
  ('financeiro', 'page:propostas', false), ('comercial', 'page:propostas', true), ('operacional', 'page:propostas', false),
  ('financeiro', 'page:marketing', false), ('comercial', 'page:marketing', true), ('operacional', 'page:marketing', false),
  ('financeiro', 'page:funil', false), ('comercial', 'page:funil', true), ('operacional', 'page:funil', false),
  -- grupo Financeiro
  ('financeiro', 'page:pagamentos', true), ('comercial', 'page:pagamentos', false), ('operacional', 'page:pagamentos', false),
  ('financeiro', 'page:financeiro', true), ('comercial', 'page:financeiro', false), ('operacional', 'page:financeiro', false),
  ('financeiro', 'page:resultado_do_mes', true), ('comercial', 'page:resultado_do_mes', false), ('operacional', 'page:resultado_do_mes', false),
  ('financeiro', 'page:lucro_por_festa', true), ('comercial', 'page:lucro_por_festa', false), ('operacional', 'page:lucro_por_festa', false),
  ('financeiro', 'page:relatorios', true), ('comercial', 'page:relatorios', false), ('operacional', 'page:relatorios', false),
  -- grupo Operação
  ('financeiro', 'page:estoque', false), ('comercial', 'page:estoque', false), ('operacional', 'page:estoque', true),
  ('financeiro', 'page:fornecedores', false), ('comercial', 'page:fornecedores', false), ('operacional', 'page:fornecedores', true),
  ('financeiro', 'page:escalas', false), ('comercial', 'page:escalas', false), ('operacional', 'page:escalas', true),
  ('financeiro', 'page:relatorio_aniversariantes', false), ('comercial', 'page:relatorio_aniversariantes', false), ('operacional', 'page:relatorio_aniversariantes', true),
  -- Configurações: ninguém além do administrador
  ('financeiro', 'page:usuarios', false), ('comercial', 'page:usuarios', false), ('operacional', 'page:usuarios', false),

  -- ações/botões: por padrão liberadas pra quem já vê a página (o
  -- administrador ajusta depois pra restringir o que quiser)
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
