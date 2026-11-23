-- =========================================================
-- DESFAZ a 103 (recreação — entrada, painel e saída). Nos dois bancos.
-- APAGA as visitas, pausas, ocorrências e os pagamentos da recreação.
-- Volta a função de juntar cadastros como era na 102.
-- =========================================================

begin;

drop function if exists rec_saida(uuid[], jsonb);
drop function if exists rec_saida_previa(uuid[]);
drop function if exists rec_visitas_por_codigo(text);
drop function if exists rec_cancelar(uuid, text);
drop function if exists rec_ocorrencia(uuid, text, text, text);
drop function if exists rec_estender(uuid, int);
drop function if exists rec_retomar(uuid);
drop function if exists rec_pausar(uuid, text);
drop function if exists rec_painel(uuid);
drop function if exists rec_visita_json(rec_visitas);
drop function if exists rec_entrada(uuid, uuid, jsonb);
drop function if exists rec_codigo_novo();
drop function if exists rec_proxima(jsonb, numeric);
drop function if exists rec_seg_cobrados(uuid, timestamptz);

drop table if exists rec_pagamentos;
drop table if exists rec_visita_itens;
drop table if exists rec_ocorrencias;
drop table if exists rec_extensoes;
drop table if exists rec_pausas;
drop table if exists rec_visitas;

create or replace function rec_familias_juntar(p_ficar uuid, p_sair uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a rec_familias%rowtype; b rec_familias%rowtype;
begin
  if not rec_pode('action:recreacao.familias_juntar') then raise exception 'Sem permissão para juntar cadastros.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escreva o motivo.'; end if;
  if p_ficar = p_sair then raise exception 'Escolha dois cadastros diferentes.'; end if;
  select * into a from rec_familias where id = p_ficar and company_id = current_company_id() and ativo for update;
  select * into b from rec_familias where id = p_sair and company_id = current_company_id() and ativo for update;
  if a.id is null or b.id is null then raise exception 'Cadastro não encontrado.'; end if;
  update rec_criancas set familia_id = a.id, atualizado_em = now(), atualizado_por = current_actor_name() where familia_id = b.id;
  update rec_autorizados set familia_id = a.id where familia_id = b.id;
  update rec_familias set ativo = false, mesclada_para = a.id, mesclada_em = now(), mesclada_motivo = left(trim(p_motivo), 300),
    atualizado_em = now(), atualizado_por = current_actor_name()
  where id = b.id;
  update rec_familias set
    cpf = coalesce(cpf, b.cpf), email = coalesce(email, b.email),
    termo_aceito_em = coalesce(termo_aceito_em, b.termo_aceito_em), termo_texto = coalesce(termo_texto, b.termo_texto),
    termo_registrado_por = coalesce(termo_registrado_por, b.termo_registrado_por),
    imagem_autorizada = imagem_autorizada or b.imagem_autorizada,
    observacoes = nullif(concat_ws(E'\n', observacoes, b.observacoes), ''),
    atualizado_em = now(), atualizado_por = current_actor_name()
  where id = a.id;
end;
$$;

commit;
