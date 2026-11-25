-- Desfaz a 112. Atenção: apaga os estornos registrados (o dinheiro estornado continua nos pagamentos).
begin;

drop function if exists rec_caixa_relatorio(uuid);
alter function rec_caixa_relatorio_base(uuid) rename to rec_caixa_relatorio;
drop function if exists rec_estornos_do_caixa(uuid);
drop function if exists rec_estornar(uuid, numeric, text, text);
drop function if exists rec_estorno_buscar(uuid, text);
drop table if exists rec_estornos;

-- rec_saida volta ao formato antigo (só desconto em R$)
create or replace function rec_saida(p_visitas uuid[], p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v rec_visitas%rowtype; d jsonb; it jsonb; ri rec_itens%rowtype; v_seg numeric; v_conta jsonb; v_itens numeric; v_desc numeric; v_desc_mot text;
  v_total numeric; v_pagar numeric; v_forma text; v_lib jsonb := null; out jsonb := '[]'; n int := 0; v_cfg jsonb; tot_pagar numeric := 0;
begin
  if not rec_pode('action:recreacao.operar') then raise exception 'Sem permissão para registrar a saída.'; end if;
  if p_visitas is null or array_length(p_visitas, 1) is null then raise exception 'Escolha quem vai sair.'; end if;
  v_cfg := rec_funcoes_padrao() || coalesce((select funcoes from rec_config where company_id = current_company_id()), '{}');
  if p_dados->'liberacao' is not null and jsonb_typeof(p_dados->'liberacao') = 'object' then
    if not rec_pode('action:recreacao.gerente') then raise exception 'Sem o código, só o gerente libera a criança.'; end if;
    if length(trim(coalesce(p_dados->'liberacao'->>'documento', ''))) < 3 or length(trim(coalesce(p_dados->'liberacao'->>'motivo', ''))) < 3 then
      raise exception 'Informe o documento de quem está buscando e o motivo.';
    end if;
    v_lib := jsonb_build_object('documento', left(trim(p_dados->'liberacao'->>'documento'), 60), 'motivo', left(trim(p_dados->'liberacao'->>'motivo'), 200), 'por', current_actor_name());
  end if;
  for v in select * from rec_visitas where id = any(p_visitas) and company_id = current_company_id() order by entrada_em for update loop
    n := n + 1;
    if v.status <> 'dentro' then raise exception 'A saída de uma dessas crianças já foi registrada.'; end if;
    if coalesce((v_cfg->>'codigo')::boolean, true) and v_lib is null and coalesce(p_dados->>'codigo', '') <> v.codigo then
      raise exception 'Código de retirada não confere.';
    end if;
    if coalesce((v_cfg->>'ocorrCiente')::boolean, true) and exists (select 1 from rec_ocorrencias where visita_id = v.id)
       and not coalesce((p_dados->>'ciente')::boolean, false) then
      raise exception 'Conte a ocorrência ao responsável e marque que ele está ciente.';
    end if;
    d := coalesce(p_dados->'visitas'->(v.id::text), '{}');
    v_itens := 0;
    for it in select x from jsonb_array_elements(coalesce(d->'itens', '[]')) x loop
      select * into ri from rec_itens where id = (it->>'item')::uuid and company_id = current_company_id() and ativo;
      if not found then raise exception 'Item do balcão não encontrado.'; end if;
      if coalesce((it->>'quantidade')::numeric, 0) <= 0 then continue; end if;
      insert into rec_visita_itens (visita_id, item_id, nome, quantidade, preco) values (v.id, ri.id, ri.nome, (it->>'quantidade')::numeric, ri.preco);
      v_itens := v_itens + round((it->>'quantidade')::numeric * ri.preco, 2);
    end loop;
    v_desc := coalesce(nullif(d->'desconto'->>'valor', '')::numeric, 0);
    v_desc_mot := nullif(trim(coalesce(d->'desconto'->>'motivo', '')), '');
    if v_desc < 0 then raise exception 'Desconto inválido.'; end if;
    if v_desc > 0 then
      if not rec_pode('action:recreacao.desconto') then raise exception 'Sem permissão para dar desconto.'; end if;
      if v_desc_mot is null or length(v_desc_mot) < 3 then raise exception 'Escreva o motivo do desconto.'; end if;
    end if;
    update rec_pausas set fim = now(), fim_por = current_actor_name() where visita_id = v.id and fim is null;
    v_seg := rec_seg_cobrados(v.id);
    v_conta := rec_calcular(v.plano, v_seg);
    v_total := greatest(0, (v_conta->>'total')::numeric + v_itens - v_desc);
    v_pagar := greatest(0, v_total - v.pago_entrada);
    v_forma := nullif(trim(coalesce(d->>'forma', '')), '');
    if v_pagar > 0 and v_forma is null then raise exception 'Escolha a forma de pagamento.'; end if;
    if v_pagar > 0 then
      insert into rec_pagamentos (unit_id, visita_id, momento, forma, valor, por) values (v.unit_id, v.id, 'saida', v_forma, v_pagar, current_actor_name());
    end if;
    update rec_ocorrencias set ciente_em = now() where visita_id = v.id and ciente_em is null and coalesce((p_dados->>'ciente')::boolean, false);
    update rec_visitas set status = 'saiu', saida_em = now(), saida_por = current_actor_name(), seg_cobrado = v_seg, conta = v_conta,
      itens_total = v_itens, desconto = v_desc, desconto_motivo = v_desc_mot, total = v_total, pago_saida = v_pagar,
      forma_saida = case when v_pagar > 0 then v_forma end, buscou = nullif(left(trim(coalesce(p_dados->>'buscou', '')), 120), ''), liberacao = v_lib
    where id = v.id;
    tot_pagar := tot_pagar + v_pagar;
    out := out || jsonb_build_array(jsonb_build_object('id', v.id, 'total', v_total, 'pago_entrada', v.pago_entrada, 'pagou_agora', v_pagar, 'forma', v_forma, 'seg', v_seg));
  end loop;
  if n <> array_length(p_visitas, 1) then raise exception 'Criança não encontrada.'; end if;
  return jsonb_build_object('saida_em', now(), 'pagar', tot_pagar, 'visitas', out);
end;
$$;

alter table rec_visitas drop column if exists desconto_tipo, drop column if exists desconto_pct, drop column if exists acrescimo,
  drop column if exists acrescimo_tipo, drop column if exists acrescimo_pct, drop column if exists acrescimo_motivo;

commit;
