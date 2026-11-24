-- =========================================================
-- 107 — Recreação, etapa 5b: foto da criança a cada entrada
-- =========================================================
-- O que muda (só vale para as casas em que o administrador geral ligou
-- "Foto da criança: tirar a cada entrada"):
--  1) Cada visita pode guardar a foto tirada na entrada (rec_visitas.foto_path).
--  2) "Foto obrigatória": a entrada é barrada no servidor se faltar a foto
--     (da entrada ou do cadastro, conforme a opção da casa).
--  3) O painel mostra a foto de hoje no lugar da do cadastro.
--  4) Apagar depois de N dias ("fotoDias"): a tela da recepção apaga do
--     armazenamento as fotos de entrada vencidas e limpa o registro.
--     A foto do cadastro não é apagada por esta rotina.
--  5) A recepção (permissão de operar) pode enviar e apagar fotos de entrada,
--     só na pasta "<empresa>/entrada/".
-- Desfazer: 107_REVERTER_recreacao_foto_entrada.sql
-- =========================================================

begin;

alter table rec_visitas add column if not exists foto_path text;
alter table rec_visitas add column if not exists foto_em timestamptz;
create index if not exists idx_rec_visitas_foto on rec_visitas (company_id, foto_em) where foto_path is not null;

-- ---------- Armazenamento: a recepção envia e apaga fotos de entrada ----------
do $$
begin
  drop policy if exists "rec_fotos_entrada_enviar" on storage.objects;
  create policy "rec_fotos_entrada_enviar" on storage.objects for insert to authenticated
    with check (bucket_id = 'recreacao-fotos' and (storage.foldername(name))[1] = current_company_id()::text and (storage.foldername(name))[2] = 'entrada'
                and (has_permission(auth.uid(), 'action:recreacao.operar') or is_platform_admin(auth.uid())));
  drop policy if exists "rec_fotos_entrada_apagar" on storage.objects;
  create policy "rec_fotos_entrada_apagar" on storage.objects for delete to authenticated
    using (bucket_id = 'recreacao-fotos' and (storage.foldername(name))[1] = current_company_id()::text and (storage.foldername(name))[2] = 'entrada'
           and (has_permission(auth.uid(), 'action:recreacao.operar') or is_platform_admin(auth.uid())));
end $$;

-- ---------- Entrada (igual à da etapa 3a, com a foto) ----------
-- p_criancas: [{ crianca, plano, pulseira, forma, excecao, foto }]
create or replace function rec_entrada(p_unit uuid, p_familia uuid, p_criancas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f rec_familias%rowtype; it jsonb; c rec_criancas%rowtype; pl rec_planos%rowtype; v_cfg jsonb := rec_cfg();
  v_grupo uuid := gen_random_uuid(); v_codigo text; v_snap jsonb; v_pago numeric; v_forma text; v_exc text; v_foto text;
  v_lot int; v_dentro int; v_id uuid; out jsonb := '[]';
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
    v_pago := 0;
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
        if v_pago > 0 and v_forma is null then raise exception 'Escolha a forma de pagamento de %.', c.nome; end if;
      end if;
    end if;
    insert into rec_visitas (unit_id, familia_id, crianca_id, grupo_id, codigo, pulseira, plano_id, plano_versao, plano, entrada_por,
                             pago_entrada, forma_entrada, excecao_motivo, excecao_por, foto_path, foto_em)
    values (p_unit, f.id, c.id, v_grupo, v_codigo, nullif(left(trim(coalesce(it->>'pulseira', '')), 20), ''), pl.id, pl.versao, v_snap, current_actor_name(),
            v_pago, case when v_pago > 0 then v_forma end, v_exc, case when v_exc is not null then current_actor_name() end,
            v_foto, case when v_foto is not null then now() end)
    returning id into v_id;
    if v_pago > 0 then
      insert into rec_pagamentos (unit_id, visita_id, momento, forma, valor, por) values (p_unit, v_id, 'entrada', v_forma, v_pago, current_actor_name());
    end if;
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

-- ---------- Painel: a foto de hoje vale mais que a do cadastro ----------
create or replace function rec_visita_json(v rec_visitas) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', v.id, 'grupo', v.grupo_id, 'unit_id', v.unit_id, 'pulseira', v.pulseira, 'entrada_em', v.entrada_em, 'entrada_por', v.entrada_por,
    'crianca', jsonb_build_object('id', c.id, 'nome', c.nome, 'nascimento', c.nascimento, 'cuidados', c.cuidados, 'foto_path', coalesce(v.foto_path, c.foto_path)),
    'familia', jsonb_build_object('id', f.id, 'responsavel', f.responsavel, 'telefone', f.telefone),
    'plano', jsonb_build_object('nome', v.plano->>'nome', 'cobranca', v.plano->>'cobranca', 'incl', (v.plano->>'incl')::numeric, 'tolIncl', (v.plano->>'tolIncl')::numeric,
      'valor', (v.plano->>'valor')::numeric, 'limite', (v.plano->>'limite')::numeric, 'limiteAcao', v.plano->>'limiteAcao', 'pausa', coalesce((v.plano->>'pausa')::boolean, true)),
    'extensao_min', v.extensao_min, 'pago_entrada', v.pago_entrada, 'forma_entrada', v.forma_entrada, 'excecao', v.excecao_motivo,
    'seg_total', extract(epoch from (now() - v.entrada_em)), 'seg_cobrado', s.seg,
    'pausa', (select jsonb_build_object('inicio', pz.inicio, 'motivo', pz.motivo, 'por', pz.por) from rec_pausas pz where pz.visita_id = v.id and pz.fim is null limit 1),
    'conta', rec_calcular(v.plano, s.seg), 'proxima', rec_proxima(v.plano, s.seg),
    'ocorrencias', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'tipo', o.tipo, 'descricao', o.descricao, 'providencia', o.providencia, 'em', o.em, 'por', o.por) order by o.em), '[]') from rec_ocorrencias o where o.visita_id = v.id),
    'chegando_em', v.chegando_em, 'pedido_min', v.pedido_min, 'pedido_em', v.pedido_em,
    'agora', now())
  from rec_criancas c, rec_familias f, lateral (select rec_seg_cobrados(v.id) seg) s
  where c.id = v.crianca_id and f.id = v.familia_id;
$$;
revoke all on function rec_visita_json(rec_visitas) from public, anon;

-- ---------- Apagar fotos de entrada vencidas ----------
create or replace function rec_fotos_vencidas() returns text[]
language plpgsql stable security definer set search_path = public as $$
declare v_dias int := coalesce((rec_cfg()->>'fotoDias')::int, 30);
begin
  if not rec_pode('action:recreacao.operar') then return '{}'; end if;
  return coalesce((select array_agg(foto_path) from (
    select foto_path from rec_visitas
     where company_id = current_company_id() and foto_path is not null and status <> 'dentro'
       and foto_em < now() - make_interval(days => v_dias)
     order by foto_em limit 100) x), '{}');
end;
$$;
revoke all on function rec_fotos_vencidas() from public, anon;
grant execute on function rec_fotos_vencidas() to authenticated;

create or replace function rec_fotos_limpar(p_paths text[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not rec_pode('action:recreacao.operar') then raise exception 'Sem permissão.'; end if;
  update rec_visitas set foto_path = null
   where company_id = current_company_id() and foto_path = any(p_paths) and status <> 'dentro';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function rec_fotos_limpar(text[]) from public, anon;
grant execute on function rec_fotos_limpar(text[]) to authenticated;

commit;
