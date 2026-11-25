-- =========================================================
-- 114 — Recreação: impressão de entrada e saída e relatórios novos
-- =========================================================
-- O que muda:
--  1) Regras da casa ganham: folha A4 como tipo de impressora, "imprimir o termo de
--     responsabilidade na entrada" (fica com a casa) e "imprimir o comprovante de saída".
--     A via de entrada (com a hora de entrada e o código) sai sempre que há impressora.
--  2) Relatórios novos (rec_relatorio_mais): crianças que mais vieram, famílias mais
--     frequentes, dias da semana, faixas de idade, itens do balcão mais vendidos,
--     ocorrências por tipo e quem não volta há mais de 30 dias.
-- Desfazer: 114_REVERTER_recreacao_impressao_relatorios.sql
-- =========================================================

begin;

create or replace function rec_regras_padrao() returns jsonb language sql immutable as $$
  select '{"lotacao": 40, "aviso": 10, "idMin": 2, "idMax": 12, "comprovante": "perguntar", "impressora": "nao",
           "imprimeTermo": "nao", "imprimeSaida": "sim"}'::jsonb;
$$;

create or replace function rec_regras_salvar(p_regras jsonb, p_termo text) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not rec_pode_configurar() then raise exception 'Sem permissão para configurar a recreação.'; end if;
  r := jsonb_build_object(
    'lotacao', coalesce(nullif(p_regras->>'lotacao', '')::int, 40),
    'aviso', coalesce(nullif(p_regras->>'aviso', '')::int, 10),
    'idMin', coalesce(nullif(p_regras->>'idMin', '')::int, 0),
    'idMax', coalesce(nullif(p_regras->>'idMax', '')::int, 17),
    'comprovante', case when p_regras->>'comprovante' in ('perguntar', 'zap', 'imp', 'ambos') then p_regras->>'comprovante' else 'perguntar' end,
    'impressora', case when p_regras->>'impressora' in ('nao', '58', '80', 'a4') then p_regras->>'impressora' else 'nao' end,
    'imprimeTermo', case when p_regras->>'imprimeTermo' = 'sim' then 'sim' else 'nao' end,
    'imprimeSaida', case when p_regras->>'imprimeSaida' = 'nao' then 'nao' else 'sim' end);
  if (r->>'lotacao')::int < 1 or (r->>'lotacao')::int > 2000 then raise exception 'A lotação precisa ser de 1 a 2000 crianças.'; end if;
  if (r->>'aviso')::int < 1 or (r->>'aviso')::int > 120 then raise exception 'O aviso precisa ser de 1 a 120 minutos antes.'; end if;
  if (r->>'idMin')::int < 0 or (r->>'idMax')::int > 17 or (r->>'idMin')::int > (r->>'idMax')::int then
    raise exception 'Confira as idades: a mínima não pode passar da máxima (até 17 anos).';
  end if;
  if length(trim(coalesce(p_termo, ''))) < 20 then raise exception 'Escreva o termo de responsabilidade (pelo menos uma frase).'; end if;
  insert into rec_config (company_id, regras, termo, atualizado_em, atualizado_por)
  values (current_company_id(), r, trim(p_termo), now(), current_actor_name())
  on conflict (company_id) do update set regras = excluded.regras, termo = excluded.termo, atualizado_em = now(), atualizado_por = excluded.atualizado_por;
end;
$$;
revoke all on function rec_regras_salvar(jsonb, text) from public, anon;
grant execute on function rec_regras_salvar(jsonb, text) to authenticated;

-- ---------- Relatórios novos ----------
create or replace function rec_relatorio_mais(p_ini date, p_fim date, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_emp uuid := current_company_id(); v_ini timestamptz; v_fim timestamptz;
begin
  if not rec_pode('page:recreacao_relatorios') then raise exception 'Sem permissão para ver os relatórios da recreação.'; end if;
  if p_ini is null or p_fim is null or p_fim < p_ini then raise exception 'Escolha um período válido.'; end if;
  if p_fim - p_ini > 366 then raise exception 'Escolha um período de até um ano.'; end if;
  if p_unit is not null and not exists (select 1 from units where id = p_unit and company_id = v_emp) then raise exception 'Unidade não encontrada.'; end if;
  v_ini := (p_ini::timestamp) at time zone 'America/Sao_Paulo';
  v_fim := ((p_fim + 1)::timestamp) at time zone 'America/Sao_Paulo';

  return jsonb_build_object(
    -- crianças que mais tiveram entradas
    'criancas_top', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'visitas', n, 'tempo_min', tmin, 'gasto', gasto) order by n desc, nome), '[]') from (
        select c.nome, count(*) n, coalesce(round(sum(v.seg_cobrado) filter (where v.status = 'saiu') / 60), 0) tmin,
               coalesce(sum(v.total) filter (where v.status = 'saiu'), 0) gasto
          from rec_visitas v join rec_criancas c on c.id = v.crianca_id
         where v.company_id = v_emp and v.entrada_em >= v_ini and v.entrada_em < v_fim and v.status <> 'cancelada' and (p_unit is null or v.unit_id = p_unit)
         group by c.id, c.nome order by n desc, c.nome limit 10) x),
    -- famílias mais frequentes
    'familias_top', (select coalesce(jsonb_agg(jsonb_build_object('responsavel', responsavel, 'visitas', n, 'dias', dias, 'gasto', gasto) order by dias desc, n desc, responsavel), '[]') from (
        select f.responsavel, count(*) n, count(distinct (v.entrada_em at time zone 'America/Sao_Paulo')::date) dias,
               coalesce(sum(v.total) filter (where v.status = 'saiu'), 0) gasto
          from rec_visitas v join rec_familias f on f.id = v.familia_id
         where v.company_id = v_emp and v.entrada_em >= v_ini and v.entrada_em < v_fim and v.status <> 'cancelada' and (p_unit is null or v.unit_id = p_unit)
         group by f.id, f.responsavel order by dias desc, n desc, f.responsavel limit 10) x),
    -- dias da semana (0 = domingo)
    'dias_semana', (select coalesce(jsonb_agg(jsonb_build_object('dow', d.dow, 'visitas', coalesce(a.n, 0), 'dias', coalesce(a.dias, 0),
          'recebido', coalesce(b.v, 0)) order by d.dow), '[]')
        from generate_series(0, 6) d(dow)
        left join (select extract(dow from entrada_em at time zone 'America/Sao_Paulo')::int dow, count(*) n,
                          count(distinct (entrada_em at time zone 'America/Sao_Paulo')::date) dias
                     from rec_visitas where company_id = v_emp and entrada_em >= v_ini and entrada_em < v_fim and status <> 'cancelada' and (p_unit is null or unit_id = p_unit) group by 1) a on a.dow = d.dow
        left join (select extract(dow from em at time zone 'America/Sao_Paulo')::int dow, sum(valor) v from rec_pagamentos
                    where company_id = v_emp and em >= v_ini and em < v_fim and (p_unit is null or unit_id = p_unit) group by 1) b on b.dow = d.dow),
    -- faixas de idade (idade na data da entrada)
    'faixas_idade', (select coalesce(jsonb_agg(jsonb_build_object('faixa', faixa, 'visitas', n, 'criancas', cr) order by ord), '[]') from (
        select case when anos <= 2 then 1 when anos <= 4 then 2 when anos <= 6 then 3 when anos <= 8 then 4 when anos <= 10 then 5 else 6 end ord,
               case when anos <= 2 then 'Até 2 anos' when anos <= 4 then '3 a 4 anos' when anos <= 6 then '5 a 6 anos'
                    when anos <= 8 then '7 a 8 anos' when anos <= 10 then '9 a 10 anos' else '11 anos ou mais' end faixa,
               count(*) n, count(distinct crianca_id) cr
          from (select v.crianca_id, extract(year from age((v.entrada_em at time zone 'America/Sao_Paulo')::date, c.nascimento))::int anos
                  from rec_visitas v join rec_criancas c on c.id = v.crianca_id
                 where v.company_id = v_emp and v.entrada_em >= v_ini and v.entrada_em < v_fim and v.status <> 'cancelada' and (p_unit is null or v.unit_id = p_unit)) t
         group by 1, 2) x),
    -- itens do balcão mais vendidos
    'itens_top', (select coalesce(jsonb_agg(jsonb_build_object('item', nome, 'quantidade', q, 'total', tot) order by q desc, nome), '[]') from (
        select i.nome, sum(i.quantidade) q, sum(round(i.quantidade * i.preco, 2)) tot
          from rec_visita_itens i join rec_visitas v on v.id = i.visita_id
         where v.company_id = v_emp and v.saida_em >= v_ini and v.saida_em < v_fim and v.status = 'saiu' and (p_unit is null or v.unit_id = p_unit)
         group by i.nome order by q desc, i.nome limit 10) x),
    -- ocorrências por tipo
    'ocorrencias_tipo', (select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'quantidade', n) order by n desc, tipo), '[]') from (
        select o.tipo, count(*) n from rec_ocorrencias o join rec_visitas v on v.id = o.visita_id
         where o.company_id = v_emp and o.em >= v_ini and o.em < v_fim and (p_unit is null or v.unit_id = p_unit)
         group by o.tipo) x),
    -- quem não volta há mais de 30 dias (olha todo o histórico, não só o período)
    'sumidos', (select coalesce(jsonb_agg(jsonb_build_object('responsavel', responsavel, 'telefone', telefone, 'ultima', ultima, 'visitas', n,
          'dias_fora', (current_date - (ultima at time zone 'America/Sao_Paulo')::date)) order by ultima desc), '[]') from (
        select f.responsavel, f.telefone, max(v.entrada_em) ultima, count(*) n
          from rec_visitas v join rec_familias f on f.id = v.familia_id
         where v.company_id = v_emp and v.status <> 'cancelada' and f.ativo and (p_unit is null or v.unit_id = p_unit)
         group by f.id, f.responsavel, f.telefone
        having max(v.entrada_em) < now() - interval '30 days' and count(*) >= 2
         order by max(v.entrada_em) desc limit 30) x)
  );
end;
$$;
revoke all on function rec_relatorio_mais(date, date, uuid) from public, anon;
grant execute on function rec_relatorio_mais(date, date, uuid) to authenticated;

commit;
