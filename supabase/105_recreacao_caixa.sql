-- =========================================================
-- 105 — Recreação, etapa 4: o caixa
-- =========================================================
-- O que muda:
--  1) Caixa por unidade: abre com um fundo de troco, recebe tudo o que a
--     recreação cobra (entrada, saída, estorno) e fecha com conferência.
--  2) Fechamento cego (o atendente conta antes de ver o esperado), com a
--     diferença por forma de pagamento e motivo obrigatório se houver.
--  3) Troca de atendente sem fechar o caixa (com contagem da gaveta).
--  4) Sangria e reforço de dinheiro, sempre com motivo.
--  5) Caixa aberto de outro dia: pergunta se fecha ou mantém (com motivo).
--  6) Ao fechar, o relatório do expediente fica guardado e o que foi
--     recebido entra no Financeiro (uma entrada por forma de pagamento).
--  7) "Só dar entrada com o caixa aberto" (função caixaObrig).
--
-- Nada é apagado: caixa fechado não reabre. Estorno depois do fechamento
-- sai no caixa que estiver aberto.
--
-- Permissões novas (grupo Recreação):
--   page:recreacao_caixa     ver a tela do caixa e o histórico
--   action:recreacao.caixa   abrir, trocar atendente, sangria, fechar
-- Desfazer: 105_REVERTER_recreacao_caixa.sql
-- =========================================================

begin;

-- ---------- 1) Tabelas ----------
create table if not exists rec_caixas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  unit_id uuid not null references units(id),
  dia date not null,
  aberto_em timestamptz not null default now(),
  aberto_por text,
  fundo numeric(10,2) not null default 0 check (fundo >= 0),
  status text not null default 'aberto' check (status in ('aberto', 'fechado')),
  fechado_em timestamptz,
  fechado_por text,
  cego boolean not null default false,
  esperado jsonb,
  contado jsonb,
  diferenca jsonb,
  diferenca_total numeric(10,2),
  obs text,
  manter_motivo text,
  manter_dia date,
  manter_por text,
  relatorio jsonb
);
create unique index if not exists uq_rec_caixas_aberto on rec_caixas (unit_id) where status = 'aberto';
create index if not exists idx_rec_caixas_hist on rec_caixas (company_id, unit_id, aberto_em desc);

create table if not exists rec_turnos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  caixa_id uuid not null references rec_caixas(id) on delete cascade,
  atendente text not null,
  inicio timestamptz not null default now(),
  fim timestamptz,
  contado numeric(10,2),
  esperado numeric(10,2),
  diferenca numeric(10,2)
);
create index if not exists idx_rec_turnos_caixa on rec_turnos (caixa_id);

create table if not exists rec_caixa_movs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  caixa_id uuid not null references rec_caixas(id) on delete cascade,
  turno_id uuid references rec_turnos(id) on delete set null,
  tipo text not null check (tipo in ('sangria', 'suprimento')),
  valor numeric(10,2) not null check (valor > 0),
  motivo text not null,
  em timestamptz not null default now(),
  por text
);
create index if not exists idx_rec_caixa_movs_caixa on rec_caixa_movs (caixa_id);

alter table rec_pagamentos add column if not exists caixa_id uuid references rec_caixas(id) on delete set null;
alter table rec_pagamentos add column if not exists turno_id uuid references rec_turnos(id) on delete set null;
create index if not exists idx_rec_pagamentos_caixa on rec_pagamentos (caixa_id);
alter table other_incomes add column if not exists rec_caixa_id uuid references rec_caixas(id) on delete set null;

do $$
declare t text;
begin
  foreach t in array array['rec_caixas', 'rec_turnos', 'rec_caixa_movs'] loop
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
  end loop;
end $$;
-- Escrita só pelas funções abaixo.

-- ---------- 2) Funções de apoio ----------
create or replace function rec_cfg() returns jsonb
language sql stable security definer set search_path = public as $$
  select rec_funcoes_padrao() || coalesce((select funcoes from rec_config where company_id = current_company_id()), '{}');
$$;
revoke all on function rec_cfg() from public, anon;

-- Dinheiro e formas de um caixa: o que entrou, o que saiu e o que era para ter.
create or replace function rec_caixa_totais(p_caixa uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c rec_caixas%rowtype; formas jsonb := '{}'; r record; v_sang numeric; v_sup numeric; v_din numeric;
begin
  select * into c from rec_caixas where id = p_caixa;
  if not found then return null; end if;
  for r in
    select forma,
           coalesce(sum(valor) filter (where momento = 'entrada'), 0) ent,
           coalesce(sum(valor) filter (where momento = 'saida'), 0) sai,
           coalesce(sum(valor) filter (where momento = 'estorno'), 0) est,
           coalesce(sum(valor), 0) liq
      from rec_pagamentos where caixa_id = p_caixa group by forma
  loop
    formas := formas || jsonb_build_object(r.forma, jsonb_build_object('entradas', r.ent, 'saidas', r.sai, 'estornos', r.est, 'liquido', r.liq));
  end loop;
  select coalesce(sum(valor) filter (where tipo = 'sangria'), 0), coalesce(sum(valor) filter (where tipo = 'suprimento'), 0)
    into v_sang, v_sup from rec_caixa_movs where caixa_id = p_caixa;
  v_din := c.fundo + coalesce((formas->'dinheiro'->>'liquido')::numeric, 0) + v_sup - v_sang;
  return jsonb_build_object('formas', formas, 'fundo', c.fundo, 'sangrias', v_sang, 'suprimentos', v_sup,
    'dinheiro_esperado', v_din,
    'recebido', coalesce((select sum(valor) from rec_pagamentos where caixa_id = p_caixa), 0));
end;
$$;
revoke all on function rec_caixa_totais(uuid) from public, anon;

-- ---------- 3) O caixa precisa estar aberto ----------
create or replace function rec_pagamento_caixa() returns trigger
language plpgsql security definer set search_path = public as $$
declare cx uuid; tn uuid; v_emp uuid := coalesce(new.company_id, current_company_id());
begin
  select id into cx from rec_caixas where company_id = v_emp and unit_id = new.unit_id and status = 'aberto';
  if cx is null then
    if new.momento <> 'estorno' and coalesce((rec_cfg()->>'caixaObrig')::boolean, true) then
      raise exception 'O caixa está fechado. Abra o caixa antes de receber.';
    end if;
    return new;
  end if;
  select id into tn from rec_turnos where caixa_id = cx and fim is null order by inicio desc limit 1;
  new.caixa_id := cx; new.turno_id := tn;
  return new;
end;
$$;
drop trigger if exists trg_zcaixa on rec_pagamentos;
create trigger trg_zcaixa before insert on rec_pagamentos for each row execute function rec_pagamento_caixa();

create or replace function rec_visita_caixa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((rec_cfg()->>'caixaObrig')::boolean, true)
     and not exists (select 1 from rec_caixas where company_id = coalesce(new.company_id, current_company_id()) and unit_id = new.unit_id and status = 'aberto') then
    raise exception 'O caixa está fechado. Abra o caixa para dar entrada.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_zcaixa on rec_visitas;
create trigger trg_zcaixa before insert on rec_visitas for each row execute function rec_visita_caixa();

-- ---------- 4) Situação do caixa ----------
create or replace function rec_caixa_atual(p_unit uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c rec_caixas%rowtype; t rec_turnos%rowtype; tot jsonb; cfg jsonb; v_ver boolean; v_hoje date := today_brazil();
begin
  if not (rec_pode('page:recreacao_caixa') or rec_pode('action:recreacao.operar')) then raise exception 'Sem permissão para ver o caixa.'; end if;
  if not exists (select 1 from units where id = p_unit and company_id = current_company_id()) then raise exception 'Escolha a unidade.'; end if;
  cfg := rec_cfg();
  select * into c from rec_caixas where company_id = current_company_id() and unit_id = p_unit and status = 'aberto';
  if not found then
    return jsonb_build_object('aberto', false, 'obrigatorio', coalesce((cfg->>'caixaObrig')::boolean, true),
      'ultimo', (select jsonb_build_object('id', x.id, 'fechado_em', x.fechado_em, 'fechado_por', x.fechado_por, 'diferenca_total', x.diferenca_total)
                 from rec_caixas x where x.company_id = current_company_id() and x.unit_id = p_unit and x.status = 'fechado' order by x.fechado_em desc limit 1));
  end if;
  select * into t from rec_turnos where caixa_id = c.id and fim is null order by inicio desc limit 1;
  tot := rec_caixa_totais(c.id);
  -- no fechamento cego, só o gerente enxerga o esperado antes de contar
  v_ver := not coalesce((cfg->>'cego')::boolean, true) or rec_pode('action:recreacao.gerente');
  return jsonb_build_object(
    'aberto', true, 'obrigatorio', coalesce((cfg->>'caixaObrig')::boolean, true),
    'caixa', jsonb_build_object('id', c.id, 'dia', c.dia, 'aberto_em', c.aberto_em, 'aberto_por', c.aberto_por, 'fundo', c.fundo),
    'turno', jsonb_build_object('id', t.id, 'atendente', t.atendente, 'inicio', t.inicio),
    'turnos', (select coalesce(jsonb_agg(jsonb_build_object('atendente', x.atendente, 'inicio', x.inicio, 'fim', x.fim) order by x.inicio), '[]') from rec_turnos x where x.caixa_id = c.id),
    'de_outro_dia', c.dia < v_hoje,
    'decidir', c.dia < v_hoje and (c.manter_dia is null or c.manter_dia < v_hoje),
    'manter_motivo', c.manter_motivo,
    'cego', coalesce((cfg->>'cego')::boolean, true), 'ver_esperado', v_ver,
    'recebido', case when v_ver then tot->'recebido' end,
    'formas', case when v_ver then tot->'formas' end, 'fundo', c.fundo, 'sangrias', tot->'sangrias', 'suprimentos', tot->'suprimentos',
    'dinheiro_esperado', case when v_ver then tot->'dinheiro_esperado' end,
    'dentro', (select count(*) from rec_visitas where company_id = current_company_id() and unit_id = p_unit and status = 'dentro'),
    'movs', (select coalesce(jsonb_agg(jsonb_build_object('tipo', m.tipo, 'valor', m.valor, 'motivo', m.motivo, 'em', m.em, 'por', m.por) order by m.em desc), '[]') from rec_caixa_movs m where m.caixa_id = c.id),
    'lembrete', jsonb_build_object('ligado', coalesce((cfg->>'lembrete')::boolean, true), 'hora', cfg->>'horaFecha', 'min', coalesce((cfg->>'lembreteMin')::int, 30)),
    'troca', coalesce((cfg->>'troca')::boolean, true), 'troca_conta', coalesce((cfg->>'trocaConta')::boolean, true));
end;
$$;
revoke all on function rec_caixa_atual(uuid) from public, anon;
grant execute on function rec_caixa_atual(uuid) to authenticated;

-- ---------- 5) Abrir ----------
create or replace function rec_caixa_abrir(p_unit uuid, p_fundo numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_fundo numeric := round(coalesce(p_fundo, 0), 2);
begin
  if not rec_pode('action:recreacao.caixa') then raise exception 'Sem permissão para abrir o caixa.'; end if;
  if not exists (select 1 from units where id = p_unit and company_id = current_company_id()) then raise exception 'Escolha a unidade.'; end if;
  if v_fundo < 0 or v_fundo > 100000 then raise exception 'Valor do fundo de troco inválido.'; end if;
  if exists (select 1 from rec_caixas where company_id = current_company_id() and unit_id = p_unit and status = 'aberto') then
    raise exception 'Já existe um caixa aberto nesta unidade.';
  end if;
  insert into rec_caixas (unit_id, dia, aberto_por, fundo, cego) values (p_unit, today_brazil(), current_actor_name(), v_fundo, coalesce((rec_cfg()->>'cego')::boolean, true))
  returning id into v_id;
  insert into rec_turnos (caixa_id, atendente) values (v_id, current_actor_name());
  return rec_caixa_atual(p_unit);
end;
$$;
revoke all on function rec_caixa_abrir(uuid, numeric) from public, anon;
grant execute on function rec_caixa_abrir(uuid, numeric) to authenticated;

-- ---------- 6) Sangria e reforço ----------
create or replace function rec_caixa_mov(p_caixa uuid, p_tipo text, p_valor numeric, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c rec_caixas%rowtype; t uuid;
begin
  if not rec_pode('action:recreacao.caixa') then raise exception 'Sem permissão para mexer no caixa.'; end if;
  select * into c from rec_caixas where id = p_caixa and company_id = current_company_id() and status = 'aberto';
  if not found then raise exception 'Caixa não encontrado ou já fechado.'; end if;
  if p_tipo not in ('sangria', 'suprimento') then raise exception 'Tipo inválido.'; end if;
  if p_valor is null or p_valor <= 0 or p_valor > 100000 then raise exception 'Informe um valor maior que zero.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escreva o motivo.'; end if;
  select id into t from rec_turnos where caixa_id = c.id and fim is null order by inicio desc limit 1;
  insert into rec_caixa_movs (caixa_id, turno_id, tipo, valor, motivo, por)
  values (c.id, t, p_tipo, round(p_valor, 2), left(trim(p_motivo), 300), current_actor_name());
  return rec_caixa_atual(c.unit_id);
end;
$$;
revoke all on function rec_caixa_mov(uuid, text, numeric, text) from public, anon;
grant execute on function rec_caixa_mov(uuid, text, numeric, text) to authenticated;

-- ---------- 7) Manter aberto (caixa de outro dia) ----------
create or replace function rec_caixa_manter(p_caixa uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c rec_caixas%rowtype;
begin
  if not rec_pode('action:recreacao.caixa') then raise exception 'Sem permissão para mexer no caixa.'; end if;
  select * into c from rec_caixas where id = p_caixa and company_id = current_company_id() and status = 'aberto';
  if not found then raise exception 'Caixa não encontrado ou já fechado.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escreva por que o caixa continua aberto.'; end if;
  update rec_caixas set manter_motivo = left(trim(p_motivo), 300), manter_dia = today_brazil(), manter_por = current_actor_name() where id = c.id;
  return rec_caixa_atual(c.unit_id);
end;
$$;
revoke all on function rec_caixa_manter(uuid, text) from public, anon;
grant execute on function rec_caixa_manter(uuid, text) to authenticated;

-- ---------- 8) Troca de atendente ----------
create or replace function rec_caixa_assumir(p_caixa uuid, p_contado numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c rec_caixas%rowtype; t rec_turnos%rowtype; cfg jsonb := rec_cfg(); tot jsonb; v_esp numeric; v_dif numeric; v_ja numeric; me text := current_actor_name();
begin
  if not rec_pode('action:recreacao.caixa') then raise exception 'Sem permissão para mexer no caixa.'; end if;
  if not coalesce((cfg->>'troca')::boolean, true) then raise exception 'A troca de atendente sem fechar o caixa não está liberada para esta casa.'; end if;
  select * into c from rec_caixas where id = p_caixa and company_id = current_company_id() and status = 'aberto';
  if not found then raise exception 'Caixa não encontrado ou já fechado.'; end if;
  select * into t from rec_turnos where caixa_id = c.id and fim is null order by inicio desc limit 1;
  if t.atendente = me then raise exception 'Você já é o atendente deste caixa.'; end if;
  if coalesce((cfg->>'trocaConta')::boolean, true) then
    if p_contado is null or p_contado < 0 then raise exception 'Conte o dinheiro da gaveta e informe o valor.'; end if;
    tot := rec_caixa_totais(c.id);
    v_esp := (tot->>'dinheiro_esperado')::numeric;
    select coalesce(sum(diferenca), 0) into v_ja from rec_turnos where caixa_id = c.id and fim is not null;
    v_dif := round(p_contado, 2) - v_esp - v_ja;
    update rec_turnos set fim = now(), contado = round(p_contado, 2), esperado = v_esp, diferenca = v_dif where id = t.id;
  else
    update rec_turnos set fim = now() where id = t.id;
  end if;
  insert into rec_turnos (caixa_id, atendente) values (c.id, me);
  return rec_caixa_atual(c.unit_id);
end;
$$;
revoke all on function rec_caixa_assumir(uuid, numeric) from public, anon;
grant execute on function rec_caixa_assumir(uuid, numeric) to authenticated;

-- ---------- 9) Relatório do expediente ----------
create or replace function rec_caixa_relatorio(p_caixa uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c rec_caixas%rowtype; ate timestamptz; tot jsonb;
begin
  if not (rec_pode('page:recreacao_caixa') or rec_pode('action:recreacao.caixa')) then raise exception 'Sem permissão para ver o caixa.'; end if;
  select * into c from rec_caixas where id = p_caixa and company_id = current_company_id();
  if not found then raise exception 'Caixa não encontrado.'; end if;
  if c.status = 'fechado' and c.relatorio is not null then return c.relatorio; end if;
  ate := coalesce(c.fechado_em, now());
  tot := rec_caixa_totais(c.id);
  return jsonb_build_object(
    'caixa', jsonb_build_object('id', c.id, 'unit_id', c.unit_id, 'unidade', (select name from units where id = c.unit_id), 'dia', c.dia,
      'aberto_em', c.aberto_em, 'aberto_por', c.aberto_por, 'fechado_em', c.fechado_em, 'fechado_por', c.fechado_por, 'fundo', c.fundo, 'status', c.status,
      'obs', c.obs, 'manter_motivo', c.manter_motivo),
    'totais', tot,
    'esperado', c.esperado, 'contado', c.contado, 'diferenca', c.diferenca, 'diferenca_total', c.diferenca_total,
    'turnos', (select coalesce(jsonb_agg(jsonb_build_object('atendente', x.atendente, 'inicio', x.inicio, 'fim', x.fim, 'contado', x.contado,
        'esperado', x.esperado, 'diferenca', x.diferenca,
        'recebido', coalesce((select sum(valor) from rec_pagamentos p where p.turno_id = x.id), 0)) order by x.inicio), '[]')
      from rec_turnos x where x.caixa_id = c.id),
    'movs', (select coalesce(jsonb_agg(jsonb_build_object('tipo', m.tipo, 'valor', m.valor, 'motivo', m.motivo, 'em', m.em, 'por', m.por) order by m.em), '[]') from rec_caixa_movs m where m.caixa_id = c.id),
    'resumo', jsonb_build_object(
      'entradas', (select count(*) from rec_visitas v where v.company_id = c.company_id and v.unit_id = c.unit_id and v.entrada_em >= c.aberto_em and v.entrada_em <= ate and v.status <> 'cancelada'),
      'saidas', (select count(*) from rec_visitas v where v.company_id = c.company_id and v.unit_id = c.unit_id and v.saida_em >= c.aberto_em and v.saida_em <= ate),
      'cancelamentos', (select count(*) from rec_visitas v where v.company_id = c.company_id and v.unit_id = c.unit_id and v.cancelada_em >= c.aberto_em and v.cancelada_em <= ate),
      'descontos', (select coalesce(sum(v.desconto), 0) from rec_visitas v where v.company_id = c.company_id and v.unit_id = c.unit_id and v.saida_em >= c.aberto_em and v.saida_em <= ate),
      'itens', (select coalesce(sum(v.itens_total), 0) from rec_visitas v where v.company_id = c.company_id and v.unit_id = c.unit_id and v.saida_em >= c.aberto_em and v.saida_em <= ate),
      'ocorrencias', (select count(*) from rec_ocorrencias o join rec_visitas v on v.id = o.visita_id where o.company_id = c.company_id and v.unit_id = c.unit_id and o.em >= c.aberto_em and o.em <= ate),
      'ainda_dentro', (select count(*) from rec_visitas v where v.company_id = c.company_id and v.unit_id = c.unit_id and v.status = 'dentro')));
end;
$$;
revoke all on function rec_caixa_relatorio(uuid) from public, anon;
grant execute on function rec_caixa_relatorio(uuid) to authenticated;

-- ---------- 10) Fechar ----------
-- p_contado: { forma: valor contado } — precisa trazer o dinheiro e cada forma que teve movimento.
create or replace function rec_caixa_fechar(p_caixa uuid, p_contado jsonb, p_obs text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c rec_caixas%rowtype; t rec_turnos%rowtype; tot jsonb; esp jsonb := '{}'; con jsonb := '{}'; dif jsonb := '{}'; k text; v_e numeric; v_c numeric;
  v_dt numeric := 0; v_has boolean := false; v_rel jsonb; v_din_turno numeric; v_ja numeric; f record; v_fim timestamptz := now();
begin
  if not rec_pode('action:recreacao.caixa') then raise exception 'Sem permissão para fechar o caixa.'; end if;
  select * into c from rec_caixas where id = p_caixa and company_id = current_company_id() and status = 'aberto' for update;
  if not found then raise exception 'Caixa não encontrado ou já fechado.'; end if;
  if jsonb_typeof(coalesce(p_contado, 'null'::jsonb)) <> 'object' then raise exception 'Informe o que foi contado.'; end if;
  tot := rec_caixa_totais(c.id);
  -- esperado por forma: o dinheiro leva fundo, reforços e sangrias
  esp := jsonb_build_object('dinheiro', (tot->>'dinheiro_esperado')::numeric);
  for k in select jsonb_object_keys(tot->'formas') loop
    if k <> 'dinheiro' then esp := esp || jsonb_build_object(k, (tot->'formas'->k->>'liquido')::numeric); end if;
  end loop;
  for k in select jsonb_object_keys(esp) loop
    if not (p_contado ? k) or nullif(p_contado->>k, '') is null then
      raise exception 'Falta informar o valor contado de %.', case k when 'dinheiro' then 'dinheiro' when 'pix' then 'Pix' when 'cartao_debito' then 'cartão de débito' when 'cartao_credito' then 'cartão de crédito' else k end;
    end if;
    v_c := round((p_contado->>k)::numeric, 2);
    if v_c < 0 then raise exception 'O valor contado não pode ser negativo.'; end if;
    v_e := (esp->>k)::numeric;
    con := con || jsonb_build_object(k, v_c);
    dif := dif || jsonb_build_object(k, v_c - v_e);
    v_dt := v_dt + (v_c - v_e);
    if v_c <> v_e then v_has := true; end if;
  end loop;
  if v_has and length(trim(coalesce(p_obs, ''))) < 3 then raise exception 'Há diferença no caixa. Escreva o que aconteceu.'; end if;

  -- encerra o turno de quem está no caixa (a contagem final vale para o dinheiro)
  select * into t from rec_turnos where caixa_id = c.id and fim is null order by inicio desc limit 1;
  select coalesce(sum(diferenca), 0) into v_ja from rec_turnos where caixa_id = c.id and fim is not null;
  v_din_turno := (dif->>'dinheiro')::numeric - v_ja;
  update rec_turnos set fim = v_fim, contado = (con->>'dinheiro')::numeric, esperado = (esp->>'dinheiro')::numeric, diferenca = v_din_turno where id = t.id;

  update rec_caixas set status = 'fechado', fechado_em = v_fim, fechado_por = current_actor_name(),
    esperado = esp, contado = con, diferenca = dif, diferenca_total = v_dt, obs = nullif(left(trim(coalesce(p_obs, '')), 500), '')
  where id = c.id;

  -- o que a recreação recebeu vira entrada no Financeiro (uma por forma de pagamento)
  for f in select key forma, (value->>'liquido')::numeric liq from jsonb_each(tot->'formas') loop
    if f.liq > 0 then
      insert into other_incomes (unit_id, kind, category, description, amount, received_date, payment_method, rec_caixa_id)
      values (c.unit_id, 'recreacao', 'Recreação',
              left('Recreação — caixa de ' || to_char(c.dia, 'DD/MM/YYYY'), 200), f.liq, c.dia, f.forma, c.id);
    end if;
  end loop;

  v_rel := rec_caixa_relatorio(c.id);
  update rec_caixas set relatorio = v_rel where id = c.id;
  return v_rel;
end;
$$;
revoke all on function rec_caixa_fechar(uuid, jsonb, text) from public, anon;
grant execute on function rec_caixa_fechar(uuid, jsonb, text) to authenticated;

-- ---------- 11) Histórico ----------
create or replace function rec_caixa_historico(p_unit uuid, p_limite int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not rec_pode('page:recreacao_caixa') then raise exception 'Sem permissão para ver o histórico do caixa.'; end if;
  return (select coalesce(jsonb_agg(x order by x.aberto_em desc), '[]') from (
    select c.id, c.dia, c.aberto_em, c.aberto_por, c.fechado_em, c.fechado_por, c.status, c.fundo, c.diferenca_total, c.obs,
           coalesce((select sum(valor) from rec_pagamentos p where p.caixa_id = c.id), 0) recebido
      from rec_caixas c where c.company_id = current_company_id() and c.unit_id = p_unit
      order by c.aberto_em desc limit greatest(1, least(coalesce(p_limite, 30), 200))) x);
end;
$$;
revoke all on function rec_caixa_historico(uuid, int) from public, anon;
grant execute on function rec_caixa_historico(uuid, int) to authenticated;

commit;
