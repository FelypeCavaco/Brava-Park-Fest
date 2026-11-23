-- =========================================================
-- DESFAZ a 100 (recreação — etapa 1). Nos dois bancos.
-- Apaga a configuração e os planos da recreação e tira as funções
-- "festas" e "recreacao" da lista. Não mexe em nada de festa.
-- =========================================================

begin;

drop function if exists platform_rec_funcoes_salvar(uuid, jsonb);
drop function if exists platform_rec_funcoes(uuid);
drop function if exists rec_item_salvar(uuid, text, numeric, boolean);
drop function if exists rec_planos_ordenar(uuid[]);
drop function if exists rec_plano_ativar(uuid, boolean);
drop function if exists rec_plano_salvar(uuid, jsonb);
drop function if exists rec_regras_salvar(jsonb, text);
drop function if exists rec_config_get();
drop function if exists rec_simular(jsonb, numeric);
drop function if exists rec_pontos(jsonb);
drop function if exists rec_pontos_de(text, numeric, numeric);
drop function if exists rec_validar(jsonb);
drop function if exists rec_validar_faixas(jsonb, text, text[], text[]);
drop function if exists rec_frase(jsonb);
drop function if exists rec_frase_faixas(jsonb);
drop function if exists rec_normalizar(jsonb);
drop function if exists rec_calcular(jsonb, numeric);
drop function if exists rec_nblocos(numeric, numeric, numeric, numeric, numeric);
drop function if exists rec_explica_faixa(jsonb, integer, text, text);
drop function if exists rec_faixa(jsonb, numeric);
drop function if exists rec_rotulo(jsonb, integer);
drop function if exists rec_arred(jsonb, numeric);
drop function if exists rec_relogio(numeric);
drop function if exists rec_fmtmin(numeric);
drop function if exists rec_dur(numeric);
drop function if exists rec_n(numeric);
drop function if exists rec_brl(numeric);
drop function if exists rec_regras_padrao();
drop function if exists rec_funcoes_padrao();
drop function if exists rec_pode_configurar();
drop function if exists rec_ligada();

drop table if exists rec_itens;
drop table if exists rec_planos_versoes;
drop table if exists rec_planos;
drop table if exists rec_config;

update companies set disabled_modules = array_remove(array_remove(disabled_modules, 'recreacao'), 'festas');
alter table companies alter column disabled_modules set default '{}'::text[];

do $$
begin
  if to_regclass('public.platform_plans') is not null then
    execute $f$
      create or replace function platform_all_modules() returns text[]
      language sql immutable set search_path = public as $q$
        select array['agenda', 'comissoes', 'marketing', 'estoque', 'acertos', 'propostas', 'escalas',
                     'reativacao', 'satisfacao', 'lucro', 'fin_avancado', 'relatorio']::text[];
      $q$ $f$;
    update platform_plans set modulos = array_remove(array_remove(modulos, 'festas'), 'recreacao');
    update platform_billing set modulos_extras = array_remove(array_remove(modulos_extras, 'festas'), 'recreacao');
    perform platform_apply_plan(company_id) from platform_billing where plano_id is not null;
  end if;
end $$;

commit;
