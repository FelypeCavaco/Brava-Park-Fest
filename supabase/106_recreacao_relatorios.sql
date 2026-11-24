-- =========================================================
-- 106 — Recreação, etapa 5a: relatórios
-- =========================================================
-- Uma função só, que lê o que já existe (visitas, pagamentos, caixas) e
-- devolve o movimento de um período: quantas crianças, quanto entrou,
-- por dia, por horário, por plano, por forma de pagamento, tempo médio,
-- cancelamentos, descontos, ocorrências e as diferenças de caixa.
-- Não grava nada.
--
-- Permissão nova (grupo Recreação):
--   page:recreacao_relatorios   ver os relatórios da recreação
-- Desfazer: 106_REVERTER_recreacao_relatorios.sql
-- =========================================================

begin;

create or replace function rec_relatorio(p_ini date, p_fim date, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_emp uuid := current_company_id(); v_ini timestamptz; v_fim timestamptz; r jsonb;
begin
  if not rec_pode('page:recreacao_relatorios') then raise exception 'Sem permissão para ver os relatórios da recreação.'; end if;
  if p_ini is null or p_fim is null or p_fim < p_ini then raise exception 'Escolha um período válido.'; end if;
  if p_fim - p_ini > 366 then raise exception 'Escolha um período de até um ano.'; end if;
  if p_unit is not null and not exists (select 1 from units where id = p_unit and company_id = v_emp) then raise exception 'Unidade não encontrada.'; end if;
  v_ini := (p_ini::timestamp) at time zone 'America/Sao_Paulo';
  v_fim := ((p_fim + 1)::timestamp) at time zone 'America/Sao_Paulo';

  select jsonb_build_object(
    'periodo', jsonb_build_object('ini', p_ini, 'fim', p_fim),
    'resumo', (select jsonb_build_object(
        'visitas', count(*) filter (where status <> 'cancelada'),
        'criancas', count(distinct crianca_id) filter (where status <> 'cancelada'),
        'familias', count(distinct familia_id) filter (where status <> 'cancelada'),
        'cancelamentos', count(*) filter (where status = 'cancelada'),
        'descontos', coalesce(sum(desconto) filter (where status = 'saiu'), 0),
        'itens', coalesce(sum(itens_total) filter (where status = 'saiu'), 0),
        'tempo_medio_min', coalesce(round((avg(seg_cobrado) filter (where status = 'saiu'))::numeric / 60), 0),
        'ainda_dentro', count(*) filter (where status = 'dentro'),
        'ocorrencias', (select count(*) from rec_ocorrencias o join rec_visitas x on x.id = o.visita_id
                         where o.company_id = v_emp and o.em >= v_ini and o.em < v_fim and (p_unit is null or x.unit_id = p_unit)))
      from rec_visitas v where v.company_id = v_emp and v.entrada_em >= v_ini and v.entrada_em < v_fim and (p_unit is null or v.unit_id = p_unit)),
    'recebido', (select coalesce(sum(valor), 0) from rec_pagamentos p
                  where p.company_id = v_emp and p.em >= v_ini and p.em < v_fim and (p_unit is null or p.unit_id = p_unit)),
    'por_forma', (select coalesce(jsonb_agg(jsonb_build_object('forma', forma, 'valor', valor) order by valor desc), '[]') from (
        select forma, sum(valor) valor from rec_pagamentos p
         where p.company_id = v_emp and p.em >= v_ini and p.em < v_fim and (p_unit is null or p.unit_id = p_unit) group by forma having sum(valor) <> 0) x),
    'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dia', d.dia, 'visitas', coalesce(a.n, 0), 'recebido', coalesce(b.v, 0)) order by d.dia), '[]')
        from generate_series(p_ini, p_fim, interval '1 day') g(dia0)
        cross join lateral (select g.dia0::date dia) d
        left join (select (entrada_em at time zone 'America/Sao_Paulo')::date dia, count(*) n from rec_visitas
                    where company_id = v_emp and entrada_em >= v_ini and entrada_em < v_fim and status <> 'cancelada' and (p_unit is null or unit_id = p_unit) group by 1) a on a.dia = d.dia
        left join (select (em at time zone 'America/Sao_Paulo')::date dia, sum(valor) v from rec_pagamentos
                    where company_id = v_emp and em >= v_ini and em < v_fim and (p_unit is null or unit_id = p_unit) group by 1) b on b.dia = d.dia),
    'por_hora', (select coalesce(jsonb_agg(jsonb_build_object('hora', h.hora, 'visitas', coalesce(a.n, 0)) order by h.hora), '[]')
        from generate_series(0, 23) h(hora)
        left join (select extract(hour from entrada_em at time zone 'America/Sao_Paulo')::int hora, count(*) n from rec_visitas
                    where company_id = v_emp and entrada_em >= v_ini and entrada_em < v_fim and status <> 'cancelada' and (p_unit is null or unit_id = p_unit) group by 1) a on a.hora = h.hora),
    'por_plano', (select coalesce(jsonb_agg(jsonb_build_object('plano', nome, 'visitas', n, 'total', tot, 'tempo_medio_min', tm) order by n desc), '[]') from (
        select coalesce(plano->>'nome', 'Plano') nome, count(*) n,
               coalesce(sum(total) filter (where status = 'saiu'), 0) tot,
               coalesce(round((avg(seg_cobrado) filter (where status = 'saiu'))::numeric / 60), 0) tm
          from rec_visitas where company_id = v_emp and entrada_em >= v_ini and entrada_em < v_fim and status <> 'cancelada' and (p_unit is null or unit_id = p_unit)
         group by 1) x),
    'por_atendente', (select coalesce(jsonb_agg(jsonb_build_object('atendente', por, 'recebido', valor, 'lancamentos', n) order by valor desc), '[]') from (
        select coalesce(por, '—') por, sum(valor) valor, count(*) n from rec_pagamentos p
         where p.company_id = v_emp and p.em >= v_ini and p.em < v_fim and (p_unit is null or p.unit_id = p_unit) group by 1) x),
    'caixas', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'dia', c.dia, 'aberto_por', c.aberto_por, 'fechado_por', c.fechado_por,
                 'status', c.status, 'diferenca_total', c.diferenca_total, 'obs', c.obs) order by c.dia desc, c.aberto_em desc), '[]')
        from rec_caixas c where c.company_id = v_emp and c.dia between p_ini and p_fim and (p_unit is null or c.unit_id = p_unit)),
    'cancelamentos', (select coalesce(jsonb_agg(jsonb_build_object('em', v.cancelada_em, 'crianca', cr.nome, 'por', v.cancelada_por, 'motivo', v.cancel_motivo) order by v.cancelada_em desc), '[]')
        from (select * from rec_visitas where company_id = v_emp and status = 'cancelada' and cancelada_em >= v_ini and cancelada_em < v_fim and (p_unit is null or unit_id = p_unit) limit 50) v
        join rec_criancas cr on cr.id = v.crianca_id),
    'descontos_lista', (select coalesce(jsonb_agg(jsonb_build_object('em', v.saida_em, 'crianca', cr.nome, 'valor', v.desconto, 'motivo', v.desconto_motivo, 'por', v.saida_por) order by v.saida_em desc), '[]')
        from (select * from rec_visitas where company_id = v_emp and status = 'saiu' and desconto > 0 and saida_em >= v_ini and saida_em < v_fim and (p_unit is null or unit_id = p_unit) order by saida_em desc limit 50) v
        join rec_criancas cr on cr.id = v.crianca_id)
  ) into r;
  return r;
end;
$$;
revoke all on function rec_relatorio(date, date, uuid) from public, anon;
grant execute on function rec_relatorio(date, date, uuid) to authenticated;

commit;
