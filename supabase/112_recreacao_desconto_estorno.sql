-- =========================================================
-- 112 — Recreação: desconto e acréscimo em R$ ou %, e estorno no caixa
-- =========================================================
-- O que muda:
--  1) Na saída, o desconto pode ser em valor (R$) ou em porcentagem (%).
--  2) Na saída, passa a existir o acréscimo, também em R$ ou %, com motivo
--     obrigatório (igual ao desconto). Quem pode dar desconto pode dar acréscimo.
--     A porcentagem é calculada sobre a conta (tempo + itens do balcão).
--  3) Estorno, total ou parcial, de uma criança que já saiu: só quem tem a
--     permissão nova, com motivo sempre obrigatório. O valor devolvido sai do
--     caixa que estiver aberto na hora.
--  4) Os estornos aparecem no relatório do fechamento do caixa (criança, valor,
--     forma, motivo e quem fez), e os acréscimos entram no resumo.
--
-- Permissão nova (grupo Recreação):
--   action:recreacao.estornar   estornar dinheiro de uma criança que já saiu
-- Desfazer: 112_REVERTER_recreacao_desconto_estorno.sql
-- =========================================================

begin;

-- ---------- 1) Colunas novas nas visitas ----------
alter table rec_visitas add column if not exists desconto_tipo text check (desconto_tipo in ('valor', 'pct'));
alter table rec_visitas add column if not exists desconto_pct numeric(6,2);
alter table rec_visitas add column if not exists acrescimo numeric(10,2) not null default 0;
alter table rec_visitas add column if not exists acrescimo_tipo text check (acrescimo_tipo in ('valor', 'pct'));
alter table rec_visitas add column if not exists acrescimo_pct numeric(6,2);
alter table rec_visitas add column if not exists acrescimo_motivo text;

-- ---------- 2) Estornos ----------
create table if not exists rec_estornos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  unit_id uuid not null references units(id),
  visita_id uuid not null references rec_visitas(id),
  caixa_id uuid references rec_caixas(id) on delete set null,
  pagamento_id uuid references rec_pagamentos(id) on delete set null,
  valor numeric(10,2) not null check (valor > 0),
  forma text not null,
  motivo text not null check (length(trim(motivo)) >= 3),
  em timestamptz not null default now(),
  por text
);
create index if not exists idx_rec_estornos_caixa on rec_estornos (caixa_id);
create index if not exists idx_rec_estornos_visita on rec_estornos (visita_id);

do $$
declare t text := 'rec_estornos';
begin
  execute format('create index if not exists %I on %I (company_id)', 'idx_' || t || '_company', t);
  execute format('drop trigger if exists trg_set_company_id on %I', t);
  execute format('create trigger trg_set_company_id before insert or update on %I for each row execute function set_company_id()', t);
  execute format('alter table %I enable row level security', t);
  execute format('drop policy if exists company_isolation on %I', t);
  execute format('create policy company_isolation on %I as restrictive for all
    using (company_id = current_company_id() or (auth.uid() is null and current_user = %L))
    with check (company_id = current_company_id() or (auth.uid() is null and current_user = %L))', t, 'app_definer', 'app_definer');
  execute format('drop policy if exists app_definer_all on %I', t);
  execute format('create policy app_definer_all on %I for all to app_definer using (true) with check (true)', t);
  execute format('drop policy if exists "read_recreacao_caixa" on %I', t);
  execute format('create policy "read_recreacao_caixa" on %I for select using (has_permission(auth.uid(), %L) or is_platform_admin(auth.uid()))', t, 'page:recreacao_caixa');
  execute format('revoke all on %I from anon', t);
  execute format('grant select on %I to authenticated', t);
  execute format('grant all on %I to app_definer', t);
  execute format('drop trigger if exists trg_audit on %I', t);
  execute format('create trigger trg_audit after insert or update or delete on %I for each row execute function audit_row_change()', t);
end $$;

-- ---------- 3) Saída com desconto e acréscimo em R$ ou % ----------
-- p_dados: { codigo, liberacao, buscou, ciente,
--   visitas: { "<id>": { forma, itens: [{ item, quantidade }],
--     desconto:  { tipo: 'valor' | 'pct', valor, motivo },
--     acrescimo: { tipo: 'valor' | 'pct', valor, motivo } } } }
create or replace function rec_saida(p_visitas uuid[], p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v rec_visitas%rowtype; d jsonb; it jsonb; ri rec_itens%rowtype; v_seg numeric; v_conta jsonb; v_itens numeric; v_base numeric;
  v_desc numeric; v_desc_mot text; v_desc_tipo text; v_desc_in numeric; v_desc_pct numeric;
  v_acr numeric; v_acr_mot text; v_acr_tipo text; v_acr_in numeric; v_acr_pct numeric;
  v_total numeric; v_pagar numeric; v_forma text; v_lib jsonb := null; out jsonb := '[]'; n int := 0; v_cfg jsonb; tot_pagar numeric := 0;
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
    if v_pagar > 0 and v_forma is null then raise exception 'Escolha a forma de pagamento.'; end if;
    if v_pagar > 0 then
      insert into rec_pagamentos (unit_id, visita_id, momento, forma, valor, por) values (v.unit_id, v.id, 'saida', v_forma, v_pagar, current_actor_name());
    end if;
    update rec_ocorrencias set ciente_em = now() where visita_id = v.id and ciente_em is null and coalesce((p_dados->>'ciente')::boolean, false);
    update rec_visitas set status = 'saiu', saida_em = now(), saida_por = current_actor_name(), seg_cobrado = v_seg, conta = v_conta,
      itens_total = v_itens, desconto = v_desc, desconto_motivo = v_desc_mot, desconto_tipo = v_desc_tipo, desconto_pct = v_desc_pct,
      acrescimo = v_acr, acrescimo_motivo = v_acr_mot, acrescimo_tipo = v_acr_tipo, acrescimo_pct = v_acr_pct,
      total = v_total, pago_saida = v_pagar,
      forma_saida = case when v_pagar > 0 then v_forma end, buscou = nullif(left(trim(coalesce(p_dados->>'buscou', '')), 120), ''), liberacao = v_lib
    where id = v.id;
    tot_pagar := tot_pagar + v_pagar;
    out := out || jsonb_build_array(jsonb_build_object('id', v.id, 'total', v_total, 'pago_entrada', v.pago_entrada, 'pagou_agora', v_pagar, 'forma', v_forma, 'seg', v_seg));
  end loop;
  if n <> array_length(p_visitas, 1) then raise exception 'Criança não encontrada.'; end if;
  return jsonb_build_object('saida_em', now(), 'pagar', tot_pagar, 'visitas', out);
end;
$$;

-- ---------- 4) Estorno ----------
-- Procurar crianças que já saíram (últimos 60 dias) e ainda têm dinheiro a devolver.
create or replace function rec_estorno_buscar(p_unit uuid, p_busca text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not rec_pode('action:recreacao.estornar') then raise exception 'Sem permissão para estornar.'; end if;
  return coalesce((select jsonb_agg(x order by x.saida_em desc) from (
    select v.id, c.nome, f.responsavel, v.saida_em, v.total,
           coalesce((select sum(p.valor) from rec_pagamentos p where p.visita_id = v.id), 0) as pago,
           coalesce((select sum(e.valor) from rec_estornos e where e.visita_id = v.id), 0) as estornado,
           (select coalesce(jsonb_object_agg(g.forma, g.liq), '{}') from (
              select p.forma, sum(p.valor) liq from rec_pagamentos p where p.visita_id = v.id group by p.forma having sum(p.valor) > 0) g) as formas
      from rec_visitas v
      join rec_criancas c on c.id = v.crianca_id
      join rec_familias f on f.id = v.familia_id
     where v.company_id = current_company_id() and v.unit_id = p_unit and v.status = 'saiu'
       and v.saida_em > now() - interval '60 days'
       and (nullif(trim(coalesce(p_busca, '')), '') is null
            or c.nome ilike '%' || trim(p_busca) || '%' or f.responsavel ilike '%' || trim(p_busca) || '%')
       and coalesce((select sum(p.valor) from rec_pagamentos p where p.visita_id = v.id), 0) > 0
     order by v.saida_em desc limit 15) x), '[]');
end;
$$;
revoke all on function rec_estorno_buscar(uuid, text) from public, anon;
grant execute on function rec_estorno_buscar(uuid, text) to authenticated;

-- Estornar (total ou parcial) o dinheiro de uma criança que já saiu.
create or replace function rec_estornar(p_visita uuid, p_valor numeric, p_forma text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v rec_visitas%rowtype; v_valor numeric := round(coalesce(p_valor, 0), 2); v_liq numeric; v_pag uuid; v_cx uuid; v_forma text := nullif(trim(coalesce(p_forma, '')), '');
begin
  if not rec_pode('action:recreacao.estornar') then raise exception 'Sem permissão para estornar.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escreva o motivo do estorno.'; end if;
  if v_valor <= 0 then raise exception 'Informe um valor maior que zero.'; end if;
  if v_forma is null then raise exception 'Escolha a forma de pagamento que será devolvida.'; end if;
  select * into v from rec_visitas where id = p_visita and company_id = current_company_id() for update;
  if not found then raise exception 'Criança não encontrada.'; end if;
  if v.status <> 'saiu' then raise exception 'Só dá para estornar de quem já saiu. Para uma entrada cancelada, o estorno já é feito no cancelamento.'; end if;
  if not exists (select 1 from rec_caixas where company_id = current_company_id() and unit_id = v.unit_id and status = 'aberto') then
    raise exception 'O caixa está fechado. Abra o caixa: o dinheiro devolvido sai dele.';
  end if;
  select coalesce(sum(valor), 0) into v_liq from rec_pagamentos where visita_id = v.id and forma = v_forma;
  if v_valor > v_liq then
    raise exception 'O valor passa do que foi pago em % (restam R$ %).', v_forma, to_char(greatest(v_liq, 0), 'FM999990D00');
  end if;
  insert into rec_pagamentos (unit_id, visita_id, momento, forma, valor, por)
  values (v.unit_id, v.id, 'estorno', v_forma, -v_valor, current_actor_name()) returning id, caixa_id into v_pag, v_cx;
  insert into rec_estornos (unit_id, visita_id, caixa_id, pagamento_id, valor, forma, motivo, por)
  values (v.unit_id, v.id, v_cx, v_pag, v_valor, v_forma, left(trim(p_motivo), 300), current_actor_name());
  return jsonb_build_object('valor', v_valor, 'forma', v_forma, 'caixa_id', v_cx);
end;
$$;
revoke all on function rec_estornar(uuid, numeric, text, text) from public, anon;
grant execute on function rec_estornar(uuid, numeric, text, text) to authenticated;

-- Estornos de um caixa (para a tela do caixa e para o relatório).
create or replace function rec_estornos_do_caixa(p_caixa uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'crianca', c.nome, 'responsavel', f.responsavel, 'valor', e.valor, 'forma', e.forma,
    'motivo', e.motivo, 'em', e.em, 'por', e.por) order by e.em), '[]')
  from rec_estornos e
  join rec_visitas v on v.id = e.visita_id
  join rec_criancas c on c.id = v.crianca_id
  join rec_familias f on f.id = v.familia_id
  where e.caixa_id = p_caixa and e.company_id = current_company_id();
$$;
revoke all on function rec_estornos_do_caixa(uuid) from public, anon;
grant execute on function rec_estornos_do_caixa(uuid) to authenticated;

-- ---------- 5) Relatório do expediente: estornos e acréscimos ----------
-- A função de 105 vira "base"; a nova chama a base e junta o que faltava.
-- (O fechamento chama rec_caixa_relatorio pelo nome, então o relatório guardado já sai completo.)
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'rec_caixa_relatorio_base') then
    alter function rec_caixa_relatorio(uuid) rename to rec_caixa_relatorio_base;
  end if;
end $$;

create or replace function rec_caixa_relatorio(p_caixa uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; c rec_caixas%rowtype; ate timestamptz; est jsonb;
begin
  r := rec_caixa_relatorio_base(p_caixa);
  select * into c from rec_caixas where id = p_caixa and company_id = current_company_id();
  ate := coalesce(c.fechado_em, now());
  est := rec_estornos_do_caixa(p_caixa);
  return jsonb_set(jsonb_set(jsonb_set(r, '{estornos}', est), '{resumo,estornos}', to_jsonb((select coalesce(sum((x->>'valor')::numeric), 0) from jsonb_array_elements(est) x))),
    '{resumo,acrescimos}', to_jsonb((select coalesce(sum(v.acrescimo), 0) from rec_visitas v
      where v.company_id = c.company_id and v.unit_id = c.unit_id and v.saida_em >= c.aberto_em and v.saida_em <= ate)));
end;
$$;
revoke all on function rec_caixa_relatorio(uuid) from public, anon;
grant execute on function rec_caixa_relatorio(uuid) to authenticated;
revoke all on function rec_caixa_relatorio_base(uuid) from public, anon;

commit;
