-- =========================================================
-- RECREAÇÃO — ETAPA 3a: entrada, painel ao vivo e saída
--
-- Funciona nos dois bancos (Brava e clientes). Precisa da 100 e da 102.
-- Roda numa transação. Não mexe em nenhum dado existente.
--
-- 1) Visita = uma criança na recreação. Guarda a CÓPIA do plano da hora da
--    entrada (mudar o preço depois não muda quem já entrou), o horário do
--    servidor, a pulseira e o código de retirada (4 números, igual para os
--    irmãos que entram juntos).
-- 2) Cada criança tem o próprio plano e o próprio pagamento. Plano pago na
--    entrada é cobrado na entrada (exceção só com o gerente, com motivo).
-- 3) Pausa (com motivo), estender o tempo (respeita o limite do plano),
--    ocorrência com a criança e cancelamento (com motivo e estorno).
-- 4) Saída: código de retirada (ou liberação do gerente com documento e
--    motivo), conta feita aqui no banco pelo horário do servidor, itens do
--    balcão, desconto com motivo, forma de pagamento por criança. A saída é
--    registrada uma vez só: duas telas ao mesmo tempo não cobram duas vezes.
-- 5) Todo dinheiro recebido fica em rec_pagamentos (o caixa da etapa 4 lê daí).
--
-- Permissões novas (grupo Recreação):
--   page:recreacao             ver o painel ao vivo
--   action:recreacao.operar    dar entrada, saída, pausar, estender, ocorrência
--   action:recreacao.desconto  dar desconto na saída
--   action:recreacao.cancelar  cancelar uma visita (com estorno)
--   action:recreacao.gerente   liberar sem código, exceção na cobrança, passar do limite
-- Desfazer: 103_REVERTER_recreacao_visitas.sql
-- =========================================================

begin;

-- ---------- 1) Tabelas ----------
create table if not exists rec_visitas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  unit_id uuid not null references units(id),
  familia_id uuid not null references rec_familias(id),
  crianca_id uuid not null references rec_criancas(id),
  grupo_id uuid not null,
  token uuid not null default gen_random_uuid(),
  codigo text not null check (codigo ~ '^[0-9]{4}$'),
  pulseira text,
  plano_id uuid references rec_planos(id) on delete set null,
  plano_versao int,
  plano jsonb not null,
  entrada_em timestamptz not null default now(),
  entrada_por text,
  status text not null default 'dentro' check (status in ('dentro', 'saiu', 'cancelada')),
  extensao_min int not null default 0,
  pago_entrada numeric(10,2) not null default 0,
  forma_entrada text,
  excecao_motivo text,
  excecao_por text,
  saida_em timestamptz,
  saida_por text,
  seg_cobrado numeric,
  conta jsonb,
  itens_total numeric(10,2) not null default 0,
  desconto numeric(10,2) not null default 0,
  desconto_motivo text,
  total numeric(10,2),
  pago_saida numeric(10,2) not null default 0,
  forma_saida text,
  buscou text,
  liberacao jsonb,
  cancelada_em timestamptz,
  cancelada_por text,
  cancel_motivo text
);
create index if not exists idx_rec_visitas_dentro on rec_visitas (company_id, unit_id) where status = 'dentro';
create index if not exists idx_rec_visitas_grupo on rec_visitas (grupo_id);
create index if not exists idx_rec_visitas_familia on rec_visitas (familia_id);
create index if not exists idx_rec_visitas_data on rec_visitas (company_id, entrada_em desc);
create unique index if not exists uq_rec_visitas_token on rec_visitas (token);
-- a mesma criança não entra duas vezes
create unique index if not exists uq_rec_visitas_crianca_dentro on rec_visitas (crianca_id) where status = 'dentro';

create table if not exists rec_pausas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  visita_id uuid not null references rec_visitas(id) on delete cascade,
  inicio timestamptz not null default now(),
  fim timestamptz,
  motivo text not null,
  por text,
  fim_por text
);
create index if not exists idx_rec_pausas_visita on rec_pausas (visita_id);

create table if not exists rec_extensoes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  visita_id uuid not null references rec_visitas(id) on delete cascade,
  minutos int not null check (minutos > 0),
  efeito numeric(10,2),
  em timestamptz not null default now(),
  por text
);
create index if not exists idx_rec_extensoes_visita on rec_extensoes (visita_id);

create table if not exists rec_ocorrencias (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  visita_id uuid not null references rec_visitas(id) on delete cascade,
  tipo text not null,
  descricao text not null,
  providencia text,
  em timestamptz not null default now(),
  por text,
  ciente_em timestamptz
);
create index if not exists idx_rec_ocorrencias_visita on rec_ocorrencias (visita_id);

create table if not exists rec_visita_itens (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  visita_id uuid not null references rec_visitas(id) on delete cascade,
  item_id uuid references rec_itens(id) on delete set null,
  nome text not null,
  quantidade numeric(10,2) not null check (quantidade > 0),
  preco numeric(10,2) not null check (preco >= 0)
);
create index if not exists idx_rec_visita_itens_visita on rec_visita_itens (visita_id);

-- Todo dinheiro da recreação (entrada, saída e estornos). O caixa lê daqui.
create table if not exists rec_pagamentos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  unit_id uuid not null references units(id),
  visita_id uuid references rec_visitas(id) on delete set null,
  momento text not null check (momento in ('entrada', 'saida', 'estorno')),
  forma text not null,
  valor numeric(10,2) not null,
  em timestamptz not null default now(),
  por text
);
create index if not exists idx_rec_pagamentos_unit on rec_pagamentos (company_id, unit_id, em desc);

do $$
declare t text;
begin
  foreach t in array array['rec_visitas', 'rec_pausas', 'rec_extensoes', 'rec_ocorrencias', 'rec_visita_itens', 'rec_pagamentos'] loop
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
    execute format('drop policy if exists "read_recreacao" on %I', t);
    execute format('create policy "read_recreacao" on %I for select using (has_permission(auth.uid(), %L) or is_platform_admin(auth.uid()))', t, 'page:recreacao');
    execute format('revoke all on %I from anon', t);
    execute format('grant select on %I to authenticated', t);
    execute format('grant all on %I to app_definer', t);
    execute format('drop trigger if exists trg_audit on %I', t);
    execute format('create trigger trg_audit after insert or update or delete on %I for each row execute function audit_row_change()', t);
  end loop;
end $$;
-- Escrita só pelas funções abaixo.

-- ---------- 2) Tempo e próxima mudança de valor ----------
-- Segundos cobrados (sem as pausas), sempre pelo relógio do servidor.
create or replace function rec_seg_cobrados(p_visita uuid, p_ate timestamptz default now()) returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(0, extract(epoch from (coalesce(v.saida_em, p_ate) - v.entrada_em))
    - coalesce((select sum(extract(epoch from (coalesce(pz.fim, v.saida_em, p_ate) - pz.inicio))) from rec_pausas pz where pz.visita_id = v.id), 0))
  from rec_visitas v where v.id = p_visita;
$$;
revoke all on function rec_seg_cobrados(uuid, timestamptz) from public, anon;

-- Quando o valor muda de novo (para o painel avisar). null = não muda mais.
create or replace function rec_proxima(p jsonb, s numeric) returns jsonb language plpgsql immutable as $$
declare
  cand numeric[] := '{}'; c numeric; atual numeric := (rec_calcular(p, s)->>'total')::numeric; v numeric;
  ex jsonb := coalesce(p->'exc', '{}'); ini numeric; b numeric; tp numeric; tc numeric; k int;
begin
  select coalesce(array_agg((x->>'s')::numeric + 1), '{}') into cand from jsonb_array_elements(rec_pontos(p)) x;
  -- blocos que somam: as próximas viradas (até 8 horas)
  if p->>'cobranca' = 'entrada' and p->>'incl' is not null and coalesce(p->>'depois', 'excedente') = 'excedente' and ex->>'modelo' = 'blocos' then
    ini := (p->>'incl')::numeric; b := coalesce((ex->>'B')::numeric, 0); tp := coalesce((p->>'tolIncl')::numeric, 0); tc := coalesce((ex->>'tolCada')::numeric, 0);
  elsif coalesce(p->>'cobranca', 'saida') = 'saida' and p->>'modelo' = 'blocos' then
    ini := (p->>'M0')::numeric; b := coalesce((p->>'B')::numeric, 0); tp := coalesce((p->>'tol')::numeric, 0); tc := coalesce((p->>'tolCada')::numeric, 0);
  end if;
  if b > 0 then
    cand := cand || ((ini + tp) * 60 + 1);
    for k in 1 .. least(480, ceil((s / 60 + 480) / b)::int) loop
      c := (ini + k * b + tc) * 60 + 1;
      if c > s then cand := cand || c; end if;
      exit when c > s + 8 * 3600;
    end loop;
  end if;
  -- com arredondamento por minuto a virada pode cair até 1 minuto depois: testa as duas
  for c in select distinct x from (select unnest(cand) x union all select unnest(cand) + 60) y where x > s order by x limit 80 loop
    v := (rec_calcular(p, c)->>'total')::numeric;
    if v <> atual then return jsonb_build_object('em', c, 'total', v); end if;
  end loop;
  return null;
end;
$$;

create or replace function rec_codigo_novo() returns text
language plpgsql volatile security definer set search_path = public as $$
declare c text;
begin
  for i in 1 .. 50 loop
    c := lpad(floor(random() * 10000)::int::text, 4, '0');
    if not exists (select 1 from rec_visitas where company_id = current_company_id() and status = 'dentro' and codigo = c) then return c; end if;
  end loop;
  raise exception 'Não consegui gerar o código de retirada. Tente de novo.';
end;
$$;
revoke all on function rec_codigo_novo() from public, anon;

-- ---------- 3) Entrada ----------
-- p_criancas: [{ crianca, plano, pulseira, forma, excecao }]
--   forma: obrigatória quando o plano é pago na entrada (pix, dinheiro, cartao_debito, cartao_credito)
--   excecao: motivo para cobrar tudo na saída (só o gerente)
create or replace function rec_entrada(p_unit uuid, p_familia uuid, p_criancas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f rec_familias%rowtype; it jsonb; c rec_criancas%rowtype; pl rec_planos%rowtype;
  v_grupo uuid := gen_random_uuid(); v_codigo text; v_snap jsonb; v_pago numeric; v_forma text; v_exc text;
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
                             pago_entrada, forma_entrada, excecao_motivo, excecao_por)
    values (p_unit, f.id, c.id, v_grupo, v_codigo, nullif(left(trim(coalesce(it->>'pulseira', '')), 20), ''), pl.id, pl.versao, v_snap, current_actor_name(),
            v_pago, case when v_pago > 0 then v_forma end, v_exc, case when v_exc is not null then current_actor_name() end)
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

-- ---------- 4) Painel ao vivo ----------
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

create or replace function rec_painel(p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not rec_pode('page:recreacao') then raise exception 'Sem permissão para ver a recreação.'; end if;
  return coalesce((select jsonb_agg(rec_visita_json(v) order by v.entrada_em) from rec_visitas v
    where v.company_id = current_company_id() and v.status = 'dentro' and (p_unit is null or v.unit_id = p_unit)), '[]');
end;
$$;
revoke all on function rec_painel(uuid) from public, anon;
grant execute on function rec_painel(uuid) to authenticated;

-- ---------- 5) Pausar, retomar, estender, ocorrência ----------
create or replace function rec_pausar(p_visita uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v rec_visitas%rowtype;
begin
  if not rec_pode('action:recreacao.operar') then raise exception 'Sem permissão.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escreva o motivo da pausa.'; end if;
  select * into v from rec_visitas where id = p_visita and company_id = current_company_id() and status = 'dentro' for update;
  if not found then raise exception 'Esta criança não está na recreação.'; end if;
  if not coalesce((v.plano->>'pausa')::boolean, true) then raise exception 'O plano desta criança não permite pausa.'; end if;
  if exists (select 1 from rec_pausas where visita_id = v.id and fim is null) then raise exception 'O tempo já está pausado.'; end if;
  insert into rec_pausas (visita_id, motivo, por) values (v.id, left(trim(p_motivo), 200), current_actor_name());
end;
$$;
create or replace function rec_retomar(p_visita uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not rec_pode('action:recreacao.operar') then raise exception 'Sem permissão.'; end if;
  update rec_pausas set fim = now(), fim_por = current_actor_name()
  where visita_id = p_visita and fim is null and company_id = current_company_id();
  if not found then raise exception 'O tempo não está pausado.'; end if;
end;
$$;

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
  update rec_visitas set extensao_min = extensao_min + p_minutos where id = v.id;
  insert into rec_extensoes (visita_id, minutos, efeito, por) values (v.id, p_minutos, v_efeito, current_actor_name());
  return jsonb_build_object('minutos', v_novo, 'efeito', v_efeito);
end;
$$;

create or replace function rec_ocorrencia(p_visita uuid, p_tipo text, p_descricao text, p_providencia text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not rec_pode('action:recreacao.operar') then raise exception 'Sem permissão.'; end if;
  if not coalesce(((select funcoes from rec_config where company_id = current_company_id())->>'ocorr')::boolean, true) then raise exception 'Ocorrências estão desligadas nesta casa.'; end if;
  if length(trim(coalesce(p_descricao, ''))) < 3 then raise exception 'Descreva o que aconteceu.'; end if;
  if not exists (select 1 from rec_visitas where id = p_visita and company_id = current_company_id() and status = 'dentro') then raise exception 'Esta criança não está na recreação.'; end if;
  insert into rec_ocorrencias (visita_id, tipo, descricao, providencia, por)
  values (p_visita, left(trim(coalesce(p_tipo, 'Outro')), 60), left(trim(p_descricao), 500), nullif(left(trim(coalesce(p_providencia, '')), 300), ''), current_actor_name())
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------- 6) Cancelar (entrada errada) ----------
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
    insert into rec_pagamentos (unit_id, visita_id, momento, forma, valor, por) values (v.unit_id, v.id, 'estorno', coalesce(v.forma_entrada, 'dinheiro'), -v.pago_entrada, current_actor_name());
  end if;
end;
$$;

-- ---------- 7) Saída ----------
-- Prévia da conta (feita aqui, pelo relógio do servidor), para a tela mostrar.
create or replace function rec_saida_previa(p_visitas uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not rec_pode('page:recreacao') then raise exception 'Sem permissão.'; end if;
  return coalesce((select jsonb_agg(rec_visita_json(v) order by v.entrada_em) from rec_visitas v
    where v.id = any(p_visitas) and v.company_id = current_company_id() and v.status = 'dentro'), '[]');
end;
$$;

-- Saída pelo código: quais crianças estão dentro com esse código (a tela não
-- recebe os códigos de ninguém; só pergunta por um).
create or replace function rec_visitas_por_codigo(p_codigo text) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
begin
  if not rec_pode('action:recreacao.operar') then raise exception 'Sem permissão.'; end if;
  if coalesce(p_codigo, '') !~ '^[0-9]{4}$' then return '{}'; end if;
  return coalesce((select array_agg(id order by entrada_em) from rec_visitas
    where company_id = current_company_id() and status = 'dentro' and codigo = p_codigo), '{}');
end;
$$;

-- p_dados: { codigo, liberacao: { documento, motivo } | null, buscou, ciente,
--            visitas: { "<id>": { forma, itens: [{ item, quantidade }], desconto: { valor, motivo } } } }
create or replace function rec_saida(p_visitas uuid[], p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v rec_visitas%rowtype; d jsonb; it jsonb; ri rec_itens%rowtype; v_seg numeric; v_conta jsonb; v_itens numeric; v_desc numeric; v_desc_mot text;
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
    -- desconto: com motivo e permissão
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

-- ---------- 8) Juntar cadastros: as visitas vão junto ----------
create or replace function rec_familias_juntar(p_ficar uuid, p_sair uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a rec_familias%rowtype; b rec_familias%rowtype;
begin
  if not rec_pode('action:recreacao.familias_juntar') then raise exception 'Sem permissão para juntar cadastros.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escreva o motivo.'; end if;
  if p_ficar = p_sair then raise exception 'Escolha dois cadastros diferentes.'; end if;
  select * into a from rec_familias where id = p_ficar and company_id = current_company_id() and ativo for update;
  select * into b from rec_familias where id = p_sair and company_id = current_company_id() and ativo for update;
  if a.id is null or b.id is null then raise exception 'Cadastro não encontrado.'; end if;
  update rec_criancas set familia_id = a.id, atualizado_em = now(), atualizado_por = current_actor_name() where familia_id = b.id;
  update rec_autorizados set familia_id = a.id where familia_id = b.id;
  update rec_visitas set familia_id = a.id where familia_id = b.id;
  update rec_familias set ativo = false, mesclada_para = a.id, mesclada_em = now(), mesclada_motivo = left(trim(p_motivo), 300),
    atualizado_em = now(), atualizado_por = current_actor_name()
  where id = b.id;
  update rec_familias set
    cpf = coalesce(cpf, b.cpf), email = coalesce(email, b.email),
    termo_aceito_em = coalesce(termo_aceito_em, b.termo_aceito_em), termo_texto = coalesce(termo_texto, b.termo_texto),
    termo_registrado_por = coalesce(termo_registrado_por, b.termo_registrado_por),
    imagem_autorizada = imagem_autorizada or b.imagem_autorizada,
    observacoes = nullif(concat_ws(E'\n', observacoes, b.observacoes), ''),
    atualizado_em = now(), atualizado_por = current_actor_name()
  where id = a.id;
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array['rec_pausar(uuid,text)', 'rec_retomar(uuid)', 'rec_estender(uuid,integer)', 'rec_ocorrencia(uuid,text,text,text)',
    'rec_cancelar(uuid,text)', 'rec_saida_previa(uuid[])', 'rec_visitas_por_codigo(text)', 'rec_saida(uuid[],jsonb)', 'rec_familias_juntar(uuid,uuid,text)', 'rec_proxima(jsonb,numeric)'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

commit;
