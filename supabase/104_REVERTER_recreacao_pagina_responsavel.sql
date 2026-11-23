-- Desfaz a 104 (página do responsável). Os pedidos de tempo e avisos de chegada gravados se perdem.
-- rec_visita_json e rec_estender voltam para a versão da 103.
begin;

drop function if exists rec_publico(uuid);
drop function if exists rec_publico_chegando(uuid);
drop function if exists rec_publico_pedir_tempo(uuid, uuid, int);
drop function if exists rec_pedido_recusar(uuid);
drop function if exists rec_visitas_por_token(uuid);

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
    'agora', now())
  from rec_criancas c, rec_familias f, lateral (select rec_seg_cobrados(v.id) seg) s
  where c.id = v.crianca_id and f.id = v.familia_id;
$$;
revoke all on function rec_visita_json(rec_visitas) from public, anon;

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
  v_total := v_novo + (extract(epoch from (now() - v.entrada_em)) - rec_seg_cobrados(v.id)) / 60;
  v_lim := coalesce((v.plano->>'limite')::numeric, 0);
  if v_lim > 0 and v_total > v_lim then
    if v.plano->>'limiteAcao' = 'bloquear' then raise exception 'Não dá: o plano tem limite de % minutos.', v_lim; end if;
    if v.plano->>'limiteAcao' = 'autorizacao' and not rec_pode('action:recreacao.gerente') then raise exception 'Passa do limite do plano: só o gerente pode estender.'; end if;
  end if;
  v_efeito := (rec_calcular(v.plano, v_novo * 60)->>'total')::numeric - coalesce((v.plano->>'valor')::numeric, 0);
  update rec_visitas set extensao_min = extensao_min + p_minutos where id = v.id;
  insert into rec_extensoes (visita_id, minutos, efeito, por) values (v.id, p_minutos, v_efeito, current_actor_name());
  return jsonb_build_object('minutos', v_novo, 'efeito', v_efeito);
end;
$$;
revoke all on function rec_estender(uuid, int) from public, anon;
grant execute on function rec_estender(uuid, int) to authenticated;

alter table rec_visitas drop column if exists chegando_em;
alter table rec_visitas drop column if exists pedido_min;
alter table rec_visitas drop column if exists pedido_em;

commit;
