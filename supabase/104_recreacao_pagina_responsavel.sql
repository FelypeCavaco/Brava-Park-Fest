-- =========================================================
-- 104 — Recreação, etapa 3b: página do responsável, "Estou chegando",
--       pedido de mais tempo e leitura do QR na saída
-- ---------------------------------------------------------
-- Depende de: 100, 102 e 103.
--
-- O que muda:
--   * rec_visitas ganha chegando_em, pedido_min e pedido_em.
--   * rec_publico(token)               página do responsável (sem login; só o link)
--   * rec_publico_chegando(token)      "Estou chegando" (avisa a recepção)
--   * rec_publico_pedir_tempo(token, visita, minutos)   "Pedir mais tempo"
--   * rec_pedido_recusar(visita)       a recepção recusa o pedido
--   * rec_visitas_por_token(token)     a recepção leu o QR: quem está dentro
--   * rec_visita_json e rec_estender   passam a mostrar/limpar o pedido
--
-- A página pública NÃO mostra CPF, telefone, alergias nem foto. Só o que o
-- responsável já sabe: nome da criança, tempo, valor, código e ocorrências
-- (se a casa deixar). Cada função liga/desliga pelas "Funções da recreação".
-- Desfazer: 104_REVERTER_recreacao_pagina_responsavel.sql
-- =========================================================

begin;

alter table rec_visitas add column if not exists chegando_em timestamptz;
alter table rec_visitas add column if not exists pedido_min int;
alter table rec_visitas add column if not exists pedido_em timestamptz;

-- ---------- 1) Painel: mostra chegada e pedido ----------
create or replace function rec_visita_json(v rec_visitas) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', v.id, 'grupo', v.grupo_id, 'unit_id', v.unit_id, 'pulseira', v.pulseira, 'entrada_em', v.entrada_em, 'entrada_por', v.entrada_por,
    'crianca', jsonb_build_object('id', c.id, 'nome', c.nome, 'nascimento', c.nascimento, 'cuidados', c.cuidados, 'foto_path', c.foto_path),
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

-- Estender o tempo também resolve o pedido do responsável.
create or replace function rec_estender(p_visita uuid, p_minutos int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v rec_visitas%rowtype; v_novo numeric; v_total numeric; v_efeito numeric; v_lim numeric;
begin
  if not rec_pode('action:recreacao.operar') then raise exception 'Sem permissão.'; end if;
  if p_minutos is null or p_minutos <= 0 or p_minutos > 600 then raise exception 'Quanto tempo a mais?'; end if;
  select * into v from rec_visitas where id = p_visita and company_id = current_company_id() and status = 'dentro' for update;
  if not found then raise exception 'Esta criança não está na recreação.'; end if;
  if v.plano->>'cobranca' <> 'entrada' or v.plano->>'incl' is null then raise exception 'Este plano não tem tempo combinado para estender.'; end if;
  v_novo := (v.plano->>'incl')::numeric + v.extensao_min + p_minutos;
  -- tempo combinado contando as pausas que já houve
  v_total := v_novo + (extract(epoch from (now() - v.entrada_em)) - rec_seg_cobrados(v.id)) / 60;
  v_lim := coalesce((v.plano->>'limite')::numeric, 0);
  if v_lim > 0 and v_total > v_lim then
    if v.plano->>'limiteAcao' = 'bloquear' then raise exception 'Não dá: o plano tem limite de % minutos.', v_lim; end if;
    if v.plano->>'limiteAcao' = 'autorizacao' and not rec_pode('action:recreacao.gerente') then raise exception 'Passa do limite do plano: só o gerente pode estender.'; end if;
  end if;
  v_efeito := (rec_calcular(v.plano, v_novo * 60)->>'total')::numeric - coalesce((v.plano->>'valor')::numeric, 0);
  update rec_visitas set extensao_min = extensao_min + p_minutos, pedido_min = null, pedido_em = null where id = v.id;
  insert into rec_extensoes (visita_id, minutos, efeito, por) values (v.id, p_minutos, v_efeito, current_actor_name());
  return jsonb_build_object('minutos', v_novo, 'efeito', v_efeito);
end;
$$;
revoke all on function rec_estender(uuid, int) from public, anon;
grant execute on function rec_estender(uuid, int) to authenticated;

create or replace function rec_pedido_recusar(p_visita uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not rec_pode('action:recreacao.operar') then raise exception 'Sem permissão.'; end if;
  update rec_visitas set pedido_min = null, pedido_em = null
  where id = p_visita and company_id = current_company_id() and status = 'dentro';
end;
$$;
revoke all on function rec_pedido_recusar(uuid) from public, anon;
grant execute on function rec_pedido_recusar(uuid) to authenticated;

-- ---------- 2) Leitura do QR na recepção ----------
-- O QR leva o link da página do responsável. A recepção lê e a tela recebe
-- o código e quem está dentro nesse grupo (ler o QR vale como digitar o código).
create or replace function rec_visitas_por_token(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v rec_visitas%rowtype;
begin
  if not rec_pode('action:recreacao.operar') then raise exception 'Sem permissão.'; end if;
  select * into v from rec_visitas where token = p_token and company_id = current_company_id();
  if not found then return jsonb_build_object('visitas', '[]'::jsonb, 'codigo', null); end if;
  return jsonb_build_object('codigo', v.codigo,
    'visitas', coalesce((select jsonb_agg(id order by entrada_em) from rec_visitas where grupo_id = v.grupo_id and company_id = v.company_id and status = 'dentro'), '[]'::jsonb));
end;
$$;
revoke all on function rec_visitas_por_token(uuid) from public, anon;
grant execute on function rec_visitas_por_token(uuid) to authenticated;

-- ---------- 3) Página do responsável (sem login) ----------
-- Quem tem o link vê o grupo daquela entrada. Se a casa desligou a página, ou
-- a entrada já acabou há mais de 12 horas, só volta o aviso.
create or replace function rec_publico(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v rec_visitas%rowtype; cfg jsonb; co record; fam rec_familias%rowtype; v_un text; fim timestamptz; vis jsonb;
begin
  if p_token is null then return null; end if;
  select * into v from rec_visitas where token = p_token;
  if not found then return null; end if;
  select name, logo_url into co from companies where id = v.company_id;
  cfg := rec_funcoes_padrao() || coalesce((select funcoes from rec_config where company_id = v.company_id), '{}');
  if not coalesce((cfg->>'paginaPais')::boolean, true) then
    return jsonb_build_object('desligada', true, 'casa', jsonb_build_object('nome', co.name, 'logo_url', co.logo_url));
  end if;
  select max(coalesce(saida_em, now())) into fim from rec_visitas where grupo_id = v.grupo_id;
  if not exists (select 1 from rec_visitas where grupo_id = v.grupo_id and status = 'dentro') and fim < now() - interval '12 hours' then
    return jsonb_build_object('encerrada', true, 'casa', jsonb_build_object('nome', co.name, 'logo_url', co.logo_url));
  end if;
  select * into fam from rec_familias where id = v.familia_id;
  select name into v_un from units where id = v.unit_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'nome', c.nome, 'status', x.status, 'entrada_em', x.entrada_em, 'saida_em', x.saida_em,
      'pulseira', x.pulseira,
      'plano', x.plano->>'nome', 'cobranca', x.plano->>'cobranca', 'incl', (x.plano->>'incl')::numeric,
      'extensao_min', x.extensao_min, 'pago_entrada', x.pago_entrada,
      'pausado', exists (select 1 from rec_pausas pz where pz.visita_id = x.id and pz.fim is null),
      'seg_cobrado', case when x.status = 'dentro' then rec_seg_cobrados(x.id) else x.seg_cobrado end,
      'total', case when x.status = 'dentro' then (rec_calcular(x.plano, rec_seg_cobrados(x.id))->>'total')::numeric else x.total end,
      'proxima', case when x.status = 'dentro' then rec_proxima(x.plano, rec_seg_cobrados(x.id)) end,
      'chegando_em', x.chegando_em, 'pedido_min', x.pedido_min,
      'ocorrencias', case when coalesce((cfg->>'ocorrPais')::boolean, true)
        then (select coalesce(jsonb_agg(jsonb_build_object('tipo', o.tipo, 'descricao', o.descricao, 'providencia', o.providencia, 'em', o.em) order by o.em), '[]') from rec_ocorrencias o where o.visita_id = x.id)
        else '[]'::jsonb end
    ) order by x.entrada_em, c.nome), '[]'::jsonb) into vis
  from rec_visitas x join rec_criancas c on c.id = x.crianca_id
  where x.grupo_id = v.grupo_id and x.status <> 'cancelada';

  return jsonb_build_object(
    'agora', now(), 'casa', jsonb_build_object('nome', co.name, 'logo_url', co.logo_url), 'unidade', v_un,
    'responsavel', split_part(fam.responsavel, ' ', 1),
    'codigo', case when coalesce((cfg->>'codigo')::boolean, true) then v.codigo end,
    'qr', coalesce((cfg->>'qr')::boolean, true),
    'funcoes', jsonb_build_object('chegando', coalesce((cfg->>'chegando')::boolean, true), 'pedirTempo', coalesce((cfg->>'pedirTempo')::boolean, true)),
    'visitas', vis);
end;
$$;
revoke all on function rec_publico(uuid) from public;
grant execute on function rec_publico(uuid) to anon, authenticated;

create or replace function rec_publico_chegando(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v rec_visitas%rowtype; cfg jsonb; n int;
begin
  select * into v from rec_visitas where token = p_token;
  if not found then raise exception 'Link não encontrado.'; end if;
  cfg := rec_funcoes_padrao() || coalesce((select funcoes from rec_config where company_id = v.company_id), '{}');
  if not coalesce((cfg->>'paginaPais')::boolean, true) or not coalesce((cfg->>'chegando')::boolean, true) then
    raise exception 'Esta função não está ligada.';
  end if;
  -- repetir o toque em poucos minutos não muda nada (não vira bagunça no painel)
  update rec_visitas set chegando_em = now()
  where grupo_id = v.grupo_id and status = 'dentro' and (chegando_em is null or chegando_em < now() - interval '15 minutes');
  select count(*) into n from rec_visitas where grupo_id = v.grupo_id and status = 'dentro';
  if n = 0 then raise exception 'A saída já foi registrada.'; end if;
  return jsonb_build_object('em', (select max(chegando_em) from rec_visitas where grupo_id = v.grupo_id and status = 'dentro'));
end;
$$;
revoke all on function rec_publico_chegando(uuid) from public;
grant execute on function rec_publico_chegando(uuid) to anon, authenticated;

create or replace function rec_publico_pedir_tempo(p_token uuid, p_visita uuid, p_minutos int) returns void
language plpgsql security definer set search_path = public as $$
declare v rec_visitas%rowtype; g uuid; cfg jsonb;
begin
  select grupo_id into g from rec_visitas where token = p_token;
  if g is null then raise exception 'Link não encontrado.'; end if;
  select * into v from rec_visitas where id = p_visita and grupo_id = g and status = 'dentro';
  if not found then raise exception 'Esta criança já saiu.'; end if;
  cfg := rec_funcoes_padrao() || coalesce((select funcoes from rec_config where company_id = v.company_id), '{}');
  if not coalesce((cfg->>'paginaPais')::boolean, true) or not coalesce((cfg->>'pedirTempo')::boolean, true) then
    raise exception 'Esta função não está ligada.';
  end if;
  if v.plano->>'cobranca' <> 'entrada' or v.plano->>'incl' is null then raise exception 'Este plano não tem tempo combinado para estender.'; end if;
  if p_minutos is null or p_minutos < 5 or p_minutos > 240 then raise exception 'Escolha quanto tempo a mais.'; end if;
  update rec_visitas set pedido_min = p_minutos, pedido_em = now() where id = v.id;
end;
$$;
revoke all on function rec_publico_pedir_tempo(uuid, uuid, int) from public;
grant execute on function rec_publico_pedir_tempo(uuid, uuid, int) to anon, authenticated;

commit;
