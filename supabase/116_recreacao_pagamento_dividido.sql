-- =========================================================
-- 116 — Recreação: pagamento dividido em mais de uma forma
-- =========================================================
-- Às vezes o responsável paga uma parte em uma forma (ex.: Pix) e o resto em outra
-- (ex.: dinheiro). Na entrada e na saída, cada pagamento pode agora ser dividido.
--  * A soma das partes precisa bater com o valor a pagar (conferido no banco).
--  * Cada parte vira um lançamento no caixa, na sua forma de pagamento.
--  * Cancelar uma entrada devolve cada parte na forma em que foi paga.
-- Desfazer: 116_REVERTER_recreacao_pagamento_dividido.sql
-- =========================================================

begin;

-- Confere e junta as partes: [{forma, valor}] — formas conhecidas, valores positivos, soma = total.
create or replace function rec_pagamentos_validar(p_pags jsonb, p_total numeric) returns jsonb
language plpgsql stable set search_path = public as $$
declare x jsonb; f text; v numeric; soma numeric := 0; juntas jsonb := '{}'; k text; out jsonb := '[]';
begin
  if jsonb_typeof(p_pags) <> 'array' or jsonb_array_length(p_pags) = 0 then raise exception 'Informe como foi pago.'; end if;
  if jsonb_array_length(p_pags) > 6 then raise exception 'Pagamento dividido em formas demais.'; end if;
  for x in select e from jsonb_array_elements(p_pags) e loop
    f := nullif(trim(coalesce(x->>'forma', '')), '');
    v := round(coalesce(nullif(x->>'valor', '')::numeric, 0), 2);
    if f is null or f not in ('pix', 'dinheiro', 'cartao_debito', 'cartao_credito') then raise exception 'Forma de pagamento inválida.'; end if;
    if v <= 0 then raise exception 'Cada parte do pagamento precisa ter valor maior que zero.'; end if;
    juntas := jsonb_set(juntas, array[f], to_jsonb(coalesce((juntas->>f)::numeric, 0) + v));
    soma := soma + v;
  end loop;
  if abs(soma - round(p_total, 2)) > 0.004 then
    raise exception 'A soma dos pagamentos (R$ %) não bate com o valor a pagar (R$ %).', to_char(soma, 'FM999990D00'), to_char(round(p_total, 2), 'FM999990D00');
  end if;
  for k in select jsonb_object_keys(juntas) loop
    out := out || jsonb_build_array(jsonb_build_object('forma', k, 'valor', (juntas->>k)::numeric));
  end loop;
  return out;
end;
$$;
revoke all on function rec_pagamentos_validar(jsonb, numeric) from public, anon;
grant execute on function rec_pagamentos_validar(jsonb, numeric) to authenticated;

-- ---------- Entrada: aceita "pagamentos" em cada criança ----------
-- p_criancas: [{ crianca, plano, pulseira, forma | pagamentos: [{forma, valor}], excecao, foto }]
create or replace function rec_entrada(p_unit uuid, p_familia uuid, p_criancas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f rec_familias%rowtype; it jsonb; c rec_criancas%rowtype; pl rec_planos%rowtype; v_cfg jsonb := rec_cfg();
  v_grupo uuid := gen_random_uuid(); v_codigo text; v_snap jsonb; v_pago numeric; v_forma text; v_exc text; v_foto text;
  v_lot int; v_dentro int; v_id uuid; out jsonb := '[]'; v_pags jsonb; pg jsonb;
begin
  if not rec_pode('action:recreacao.operar') then raise exception 'Sem permissão para dar entrada na recreação.'; end if;
  if not exists (select 1 from units where id = p_unit and company_id = current_company_id()) then raise exception 'Escolha a unidade.'; end if;
  select * into f from rec_familias where id = p_familia and company_id = current_company_id() and ativo;
  if not found then raise exception 'Família não encontrada.'; end if;
  if f.termo_aceito_em is null then raise exception 'O responsável ainda não aceitou o termo. Abra o cadastro e marque o aceite.'; end if;
  if jsonb_typeof(p_criancas) <> 'array' or jsonb_array_length(p_criancas) = 0 then raise exception 'Marque quem vai entrar.'; end if;
  v_lot := coalesce(((select regras from rec_config where company_id = current_company_id())->>'lotacao')::int, 40);
  select count(*) into v_dentro from rec_visitas where company_id = current_company_id() and unit_id = p_unit and status = 'dentro';
  if v_dentro + jsonb_array_length(p_criancas) > v_lot then
    raise exception 'Lotação cheia: % de % crianças dentro.', v_dentro, v_lot;
  end if;
  v_codigo := rec_codigo_novo();
  for it in select x from jsonb_array_elements(p_criancas) x loop
    select * into c from rec_criancas where id = (it->>'crianca')::uuid and familia_id = f.id and ativo;
    if not found then raise exception 'Criança não encontrada nesta família.'; end if;
    if exists (select 1 from rec_visitas where crianca_id = c.id and status = 'dentro') then raise exception '% já está na recreação.', c.nome; end if;
    select * into pl from rec_planos where id = (it->>'plano')::uuid and company_id = current_company_id() and ativo;
    if not found then raise exception 'Escolha o plano de %.', c.nome; end if;
    v_snap := pl.regra || jsonb_build_object('nome', pl.nome);
    v_exc := nullif(trim(coalesce(it->>'excecao', '')), '');
    v_forma := nullif(trim(coalesce(it->>'forma', '')), '');
    v_pago := 0; v_pags := '[]';
    -- foto desta entrada (só quando a casa tira a cada entrada)
    v_foto := null;
    if v_cfg->>'foto' = 'entrada' then
      v_foto := nullif(trim(coalesce(it->>'foto', '')), '');
      if v_foto is not null and (left(v_foto, length(current_company_id()::text) + 9) <> current_company_id()::text || '/entrada/' or v_foto like '%..%') then
        raise exception 'Foto inválida.';
      end if;
    end if;
    if coalesce((v_cfg->>'fotoObrig')::boolean, false) and v_cfg->>'foto' <> 'nao' then
      if v_cfg->>'foto' = 'entrada' and v_foto is null then raise exception 'Tire a foto de %.', split_part(c.nome, ' ', 1); end if;
      if v_cfg->>'foto' = 'cadastro' and c.foto_path is null then raise exception 'Falta a foto de % no cadastro.', split_part(c.nome, ' ', 1); end if;
    end if;
    if v_snap->>'cobranca' = 'entrada' then
      if v_exc is not null then
        if not rec_pode('action:recreacao.gerente') then raise exception 'Cobrar tudo na saída é uma exceção: só o gerente libera.'; end if;
        if length(v_exc) < 3 then raise exception 'Escreva o motivo da exceção.'; end if;
      else
        v_pago := coalesce((v_snap->>'valor')::numeric, 0);
        if v_pago > 0 then
          if jsonb_typeof(it->'pagamentos') = 'array' and jsonb_array_length(it->'pagamentos') > 0 then
            v_pags := rec_pagamentos_validar(it->'pagamentos', v_pago);
          elsif v_forma is null then
            raise exception 'Escolha a forma de pagamento de %.', c.nome;
          else
            v_pags := rec_pagamentos_validar(jsonb_build_array(jsonb_build_object('forma', v_forma, 'valor', v_pago)), v_pago);
          end if;
          v_forma := (select p->>'forma' from jsonb_array_elements(v_pags) p order by (p->>'valor')::numeric desc limit 1);
        end if;
      end if;
    end if;
    insert into rec_visitas (unit_id, familia_id, crianca_id, grupo_id, codigo, pulseira, plano_id, plano_versao, plano, entrada_por,
                             pago_entrada, forma_entrada, excecao_motivo, excecao_por, foto_path, foto_em)
    values (p_unit, f.id, c.id, v_grupo, v_codigo, nullif(left(trim(coalesce(it->>'pulseira', '')), 20), ''), pl.id, pl.versao, v_snap, current_actor_name(),
            v_pago, case when v_pago > 0 then v_forma end, v_exc, case when v_exc is not null then current_actor_name() end,
            v_foto, case when v_foto is not null then now() end)
    returning id into v_id;
    for pg in select p from jsonb_array_elements(v_pags) p loop
      insert into rec_pagamentos (unit_id, visita_id, momento, forma, valor, por) values (p_unit, v_id, 'entrada', pg->>'forma', (pg->>'valor')::numeric, current_actor_name());
    end loop;
    out := out || jsonb_build_array(jsonb_build_object('id', v_id, 'nome', c.nome, 'pulseira', nullif(trim(coalesce(it->>'pulseira', '')), ''),
      'plano', pl.nome, 'pago', v_pago, 'cuidados', c.cuidados, 'nascimento', c.nascimento,
      'ate', case when v_snap->>'cobranca' = 'entrada' and v_snap->>'incl' is not null then now() + ((v_snap->>'incl')::numeric * interval '1 minute') end));
  end loop;
  return jsonb_build_object('grupo', v_grupo, 'codigo', v_codigo, 'token', (select token from rec_visitas where grupo_id = v_grupo limit 1),
    'entrada_em', now(), 'responsavel', f.responsavel, 'telefone', f.telefone, 'visitas', out);
end;
$$;
revoke all on function rec_entrada(uuid, uuid, jsonb) from public, anon;
grant execute on function rec_entrada(uuid, uuid, jsonb) to authenticated;

-- ---------- Saída: aceita "pagamentos" em cada criança ----------
-- visitas: { "<id>": { forma | pagamentos: [{forma, valor}], itens, desconto, acrescimo } }
create or replace function rec_saida(p_visitas uuid[], p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v rec_visitas%rowtype; d jsonb; it jsonb; ri rec_itens%rowtype; v_seg numeric; v_conta jsonb; v_itens numeric; v_base numeric;
  v_desc numeric; v_desc_mot text; v_desc_tipo text; v_desc_in numeric; v_desc_pct numeric;
  v_acr numeric; v_acr_mot text; v_acr_tipo text; v_acr_in numeric; v_acr_pct numeric;
  v_total numeric; v_pagar numeric; v_forma text; v_pags jsonb; pg jsonb; v_lib jsonb := null; out jsonb := '[]'; n int := 0; v_cfg jsonb; tot_pagar numeric := 0;
begin
  if not rec_pode('action:recreacao.operar') then raise exception 'Sem permissão para registrar a saída.'; end if;
  if p_visitas is null or array_length(p_visitas, 1) is null then raise exception 'Escolha quem vai sair.'; end if;
  v_cfg := rec_funcoes_padrao() || coalesce((select funcoes from rec_config where company_id = current_company_id()), '{}');

  -- liberação sem código: só o gerente, com documento e motivo
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
    -- itens do balcão (preço da tabela da casa)
    v_itens := 0;
    for it in select x from jsonb_array_elements(coalesce(d->'itens', '[]')) x loop
      select * into ri from rec_itens where id = (it->>'item')::uuid and company_id = current_company_id() and ativo;
      if not found then raise exception 'Item do balcão não encontrado.'; end if;
      if coalesce((it->>'quantidade')::numeric, 0) <= 0 then continue; end if;
      insert into rec_visita_itens (visita_id, item_id, nome, quantidade, preco) values (v.id, ri.id, ri.nome, (it->>'quantidade')::numeric, ri.preco);
      v_itens := v_itens + round((it->>'quantidade')::numeric * ri.preco, 2);
    end loop;
    update rec_pausas set fim = now(), fim_por = current_actor_name() where visita_id = v.id and fim is null;
    v_seg := rec_seg_cobrados(v.id);
    v_conta := rec_calcular(v.plano, v_seg);
    v_base := (v_conta->>'total')::numeric + v_itens;

    -- desconto: em R$ ou %, com motivo e permissão
    v_desc_in := coalesce(nullif(d->'desconto'->>'valor', '')::numeric, 0);
    v_desc_tipo := case when d->'desconto'->>'tipo' = 'pct' then 'pct' else 'valor' end;
    v_desc_mot := nullif(trim(coalesce(d->'desconto'->>'motivo', '')), '');
    v_desc := 0; v_desc_pct := null;
    if v_desc_in < 0 then raise exception 'Desconto inválido.'; end if;
    if v_desc_in > 0 then
      if not rec_pode('action:recreacao.desconto') then raise exception 'Sem permissão para dar desconto.'; end if;
      if v_desc_mot is null or length(v_desc_mot) < 3 then raise exception 'Escreva o motivo do desconto.'; end if;
      if v_desc_tipo = 'pct' then
        if v_desc_in > 100 then raise exception 'O desconto em porcentagem não pode passar de 100%%.'; end if;
        v_desc_pct := round(v_desc_in, 2);
        v_desc := round(v_base * v_desc_in / 100, 2);
      else
        v_desc := round(v_desc_in, 2);
      end if;
      v_desc := least(v_desc, v_base);
    else
      v_desc_tipo := null;
    end if;

    -- acréscimo: em R$ ou %, com motivo e permissão
    v_acr_in := coalesce(nullif(d->'acrescimo'->>'valor', '')::numeric, 0);
    v_acr_tipo := case when d->'acrescimo'->>'tipo' = 'pct' then 'pct' else 'valor' end;
    v_acr_mot := nullif(trim(coalesce(d->'acrescimo'->>'motivo', '')), '');
    v_acr := 0; v_acr_pct := null;
    if v_acr_in < 0 then raise exception 'Acréscimo inválido.'; end if;
    if v_acr_in > 0 then
      if not rec_pode('action:recreacao.desconto') then raise exception 'Sem permissão para dar acréscimo.'; end if;
      if v_acr_mot is null or length(v_acr_mot) < 3 then raise exception 'Escreva o motivo do acréscimo.'; end if;
      if v_acr_tipo = 'pct' then
        if v_acr_in > 1000 then raise exception 'Acréscimo em porcentagem alto demais.'; end if;
        v_acr_pct := round(v_acr_in, 2);
        v_acr := round(v_base * v_acr_in / 100, 2);
      else
        v_acr := round(v_acr_in, 2);
      end if;
      if v_acr > 100000 then raise exception 'Acréscimo alto demais.'; end if;
    else
      v_acr_tipo := null;
    end if;

    v_total := greatest(0, v_base - v_desc + v_acr);
    v_pagar := greatest(0, v_total - v.pago_entrada);
    v_forma := nullif(trim(coalesce(d->>'forma', '')), '');
    v_pags := '[]';
    if v_pagar > 0 then
      if jsonb_typeof(d->'pagamentos') = 'array' and jsonb_array_length(d->'pagamentos') > 0 then
        v_pags := rec_pagamentos_validar(d->'pagamentos', v_pagar);
      elsif v_forma is null then
        raise exception 'Escolha a forma de pagamento.';
      else
        v_pags := rec_pagamentos_validar(jsonb_build_array(jsonb_build_object('forma', v_forma, 'valor', v_pagar)), v_pagar);
      end if;
      v_forma := (select p->>'forma' from jsonb_array_elements(v_pags) p order by (p->>'valor')::numeric desc limit 1);
      for pg in select p from jsonb_array_elements(v_pags) p loop
        insert into rec_pagamentos (unit_id, visita_id, momento, forma, valor, por) values (v.unit_id, v.id, 'saida', pg->>'forma', (pg->>'valor')::numeric, current_actor_name());
      end loop;
    end if;
    update rec_ocorrencias set ciente_em = now() where visita_id = v.id and ciente_em is null and coalesce((p_dados->>'ciente')::boolean, false);
    update rec_visitas set status = 'saiu', saida_em = now(), saida_por = current_actor_name(), seg_cobrado = v_seg, conta = v_conta,
      itens_total = v_itens, desconto = v_desc, desconto_motivo = v_desc_mot, desconto_tipo = v_desc_tipo, desconto_pct = v_desc_pct,
      acrescimo = v_acr, acrescimo_motivo = v_acr_mot, acrescimo_tipo = v_acr_tipo, acrescimo_pct = v_acr_pct,
      total = v_total, pago_saida = v_pagar,
      forma_saida = case when v_pagar > 0 then v_forma end, buscou = nullif(left(trim(coalesce(p_dados->>'buscou', '')), 120), ''), liberacao = v_lib
    where id = v.id;
    tot_pagar := tot_pagar + v_pagar;
    out := out || jsonb_build_array(jsonb_build_object('id', v.id, 'total', v_total, 'pago_entrada', v.pago_entrada, 'pagou_agora', v_pagar, 'forma', v_forma, 'pagamentos', v_pags, 'seg', v_seg));
  end loop;
  if n <> array_length(p_visitas, 1) then raise exception 'Criança não encontrada.'; end if;
  return jsonb_build_object('saida_em', now(), 'pagar', tot_pagar, 'visitas', out);
end;
$$;
revoke all on function rec_saida(uuid[], jsonb) from public, anon;
grant execute on function rec_saida(uuid[], jsonb) to authenticated;

-- ---------- Cancelar: devolve cada parte na forma em que foi paga ----------
create or replace function rec_cancelar(p_visita uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v rec_visitas%rowtype;
begin
  if not rec_pode('action:recreacao.cancelar') then raise exception 'Sem permissão para cancelar.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escreva o motivo do cancelamento.'; end if;
  select * into v from rec_visitas where id = p_visita and company_id = current_company_id() and status = 'dentro' for update;
  if not found then raise exception 'Esta criança não está na recreação.'; end if;
  update rec_pausas set fim = now(), fim_por = current_actor_name() where visita_id = v.id and fim is null;
  update rec_visitas set status = 'cancelada', cancelada_em = now(), cancelada_por = current_actor_name(), cancel_motivo = left(trim(p_motivo), 300), saida_em = now()
  where id = v.id;
  if v.pago_entrada > 0 then
    insert into rec_pagamentos (unit_id, visita_id, momento, forma, valor, por)
    select v.unit_id, v.id, 'estorno', p.forma, -sum(p.valor), current_actor_name()
      from rec_pagamentos p where p.visita_id = v.id and p.momento = 'entrada' group by p.forma having sum(p.valor) > 0;
  end if;
end;
$$;

commit;
