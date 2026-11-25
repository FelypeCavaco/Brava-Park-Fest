-- =========================================================
-- 115 — Recreação: reenviar o link e o código para o responsável
-- =========================================================
-- Se a recepção fechou a mensagem sem querer (ou o responsável perdeu o código e o QR),
-- dá para buscar os dados da criança que ainda está dentro e mandar de novo.
-- Cada vez que o código é consultado, fica registrado quem consultou e quando.
--  + ficha da família clicável nos relatórios (rec_familia_ficha)
-- Desfazer: 115_REVERTER_recreacao_reenviar_link.sql
-- =========================================================

begin;

create table if not exists rec_reenvios (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  visita_id uuid not null references rec_visitas(id) on delete cascade,
  em timestamptz not null default now(),
  por text
);
create index if not exists idx_rec_reenvios_visita on rec_reenvios (visita_id);

do $$
declare t text := 'rec_reenvios';
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

-- Dados para reenviar: só de quem está dentro agora.
create or replace function rec_reenviar_dados(p_visita uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v rec_visitas%rowtype; f rec_familias%rowtype;
begin
  if not rec_pode('action:recreacao.operar') then raise exception 'Sem permissão.'; end if;
  select * into v from rec_visitas where id = p_visita and company_id = current_company_id();
  if not found then raise exception 'Criança não encontrada.'; end if;
  if v.status <> 'dentro' then raise exception 'Essa criança já saiu.'; end if;
  select * into f from rec_familias where id = v.familia_id;
  insert into rec_reenvios (visita_id, por) values (v.id, current_actor_name());
  return jsonb_build_object(
    'codigo', v.codigo, 'token', v.token, 'entrada_em', v.entrada_em,
    'responsavel', f.responsavel, 'telefone', f.telefone,
    'criancas', (select coalesce(jsonb_agg(c.nome order by x.entrada_em), '[]') from rec_visitas x join rec_criancas c on c.id = x.crianca_id
                  where x.grupo_id = v.grupo_id and x.status = 'dentro' and x.company_id = current_company_id()));
end;
$$;
revoke all on function rec_reenviar_dados(uuid) from public, anon;
grant execute on function rec_reenviar_dados(uuid) to authenticated;

-- ---------- Relatórios novos: agora com o identificador da família (para clicar) ----------
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
    'criancas_top', (select coalesce(jsonb_agg(jsonb_build_object('familia_id', familia_id, 'nome', nome, 'visitas', n, 'tempo_min', tmin, 'gasto', gasto) order by n desc, nome), '[]') from (
        select c.nome, c.familia_id, count(*) n, coalesce(round(sum(v.seg_cobrado) filter (where v.status = 'saiu') / 60), 0) tmin,
               coalesce(sum(v.total) filter (where v.status = 'saiu'), 0) gasto
          from rec_visitas v join rec_criancas c on c.id = v.crianca_id
         where v.company_id = v_emp and v.entrada_em >= v_ini and v.entrada_em < v_fim and v.status <> 'cancelada' and (p_unit is null or v.unit_id = p_unit)
         group by c.id, c.nome, c.familia_id order by n desc, c.nome limit 10) x),
    -- famílias mais frequentes
    'familias_top', (select coalesce(jsonb_agg(jsonb_build_object('familia_id', familia_id, 'responsavel', responsavel, 'visitas', n, 'dias', dias, 'gasto', gasto) order by dias desc, n desc, responsavel), '[]') from (
        select f.responsavel, f.id familia_id, count(*) n, count(distinct (v.entrada_em at time zone 'America/Sao_Paulo')::date) dias,
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
    'sumidos', (select coalesce(jsonb_agg(jsonb_build_object('familia_id', familia_id, 'responsavel', responsavel, 'telefone', telefone, 'ultima', ultima, 'visitas', n,
          'dias_fora', (current_date - (ultima at time zone 'America/Sao_Paulo')::date)) order by ultima desc), '[]') from (
        select f.responsavel, f.telefone, f.id familia_id, max(v.entrada_em) ultima, count(*) n
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

-- ---------- Relatório clicável: a ficha completa da família ----------
create or replace function rec_familia_ficha(p_familia uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := current_company_id(); fam jsonb;
begin
  if not (rec_pode('page:recreacao_relatorios') or rec_pode('page:recreacao_familias')) then raise exception 'Sem permissão para ver a ficha da família.'; end if;
  fam := rec_familia_json(p_familia);
  if fam is null then raise exception 'Família não encontrada.'; end if;
  return jsonb_build_object(
    'familia', fam,
    'resumo', (select jsonb_build_object(
        'visitas', count(*) filter (where status <> 'cancelada'),
        'dias', count(distinct (entrada_em at time zone 'America/Sao_Paulo')::date) filter (where status <> 'cancelada'),
        'gasto', coalesce(sum(total) filter (where status = 'saiu'), 0),
        'tempo_medio_min', coalesce(round((avg(seg_cobrado) filter (where status = 'saiu'))::numeric / 60), 0),
        'primeira', min(entrada_em) filter (where status <> 'cancelada'),
        'ultima', max(entrada_em) filter (where status <> 'cancelada'),
        'dentro_agora', count(*) filter (where status = 'dentro'),
        'cancelamentos', count(*) filter (where status = 'cancelada'))
      from rec_visitas where company_id = v_emp and familia_id = p_familia),
    'ocorrencias', (select count(*) from rec_ocorrencias o join rec_visitas x on x.id = o.visita_id where x.company_id = v_emp and x.familia_id = p_familia),
    'visitas', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'crianca', c.nome, 'entrada_em', v.entrada_em, 'saida_em', v.saida_em,
          'status', v.status, 'plano', v.plano->>'nome', 'seg_cobrado', v.seg_cobrado, 'total', v.total, 'itens', v.itens_total,
          'desconto', v.desconto, 'acrescimo', v.acrescimo, 'unidade', u.name) order by v.entrada_em desc), '[]')
        from (select * from rec_visitas where company_id = v_emp and familia_id = p_familia order by entrada_em desc limit 40) v
        join rec_criancas c on c.id = v.crianca_id left join units u on u.id = v.unit_id));
end;
$$;
revoke all on function rec_familia_ficha(uuid) from public, anon;
grant execute on function rec_familia_ficha(uuid) to authenticated;

commit;
