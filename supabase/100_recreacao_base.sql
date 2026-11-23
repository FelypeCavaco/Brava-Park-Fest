-- =========================================================
-- RECREAÇÃO — ETAPA 1: liga/desliga e configuração
--
-- Funciona nos dois bancos (Brava e clientes). Roda numa transação.
--
-- 1) "Gestão de festas" e "Recreação" viram funções que o administrador geral
--    liga ou desliga por casa (como Comissões, Estoque etc.).
--    - Todas as casas que já existem continuam com a gestão de festas ligada.
--    - A recreação começa DESLIGADA em todas (inclusive na Brava) e em toda
--      casa nova. Só aparece quando o administrador geral liga.
--    - Planos do Festou que já existem ganham "Gestão de festas".
-- 2) Configuração da recreação de cada casa:
--    - funções (código de retirada, QR, foto, ocorrências...): SÓ o
--      administrador geral muda, pelo painel da plataforma;
--    - regras da casa, planos de cobrança, itens do balcão e termo: a casa muda.
-- 3) Motor de cobrança (faixas, blocos, tolerância, excedente, teto,
--    arredondamento). O cálculo é feito aqui no banco, nunca no navegador.
--    Cada plano guarda as versões: a visita (etapa 3) vai guardar a cópia do
--    plano da hora da entrada, então mudar o preço não muda quem já entrou.
--
-- Não apaga nem altera nenhum dado de festa.
-- Desfazer: 100_REVERTER_recreacao_base.sql
-- =========================================================

begin;

-- ---------- 1) Funções "festas" e "recreacao" ----------
update companies set disabled_modules = array_append(disabled_modules, 'recreacao')
where not ('recreacao' = any(disabled_modules));
alter table companies alter column disabled_modules set default array['recreacao']::text[];

do $$
begin
  -- Só no banco dos clientes (onde existem os planos do Festou)
  if to_regclass('public.platform_plans') is not null then
    execute $f$
      create or replace function platform_all_modules() returns text[]
      language sql immutable set search_path = public as $q$
        select array['festas', 'recreacao', 'agenda', 'comissoes', 'marketing', 'estoque', 'acertos', 'propostas', 'escalas',
                     'reativacao', 'satisfacao', 'lucro', 'fin_avancado', 'relatorio']::text[];
      $q$ $f$;
    update platform_plans set modulos = array_prepend('festas', modulos) where not ('festas' = any(modulos));
    -- reaplica os planos: festas continua ligada, recreação continua desligada
    perform platform_apply_plan(company_id) from platform_billing where plano_id is not null;
  end if;
end $$;

-- A recreação está ligada para a empresa de quem chama?
create or replace function rec_ligada() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not ('recreacao' = any(c.disabled_modules)) from companies c where c.id = current_company_id()), false);
$$;
revoke all on function rec_ligada() from public, anon;
grant execute on function rec_ligada() to authenticated;

-- Pode configurar a recreação (planos, regras, itens)?
create or replace function rec_pode_configurar() returns boolean
language sql stable security definer set search_path = public as $$
  select rec_ligada() and (has_permission(auth.uid(), 'page:recreacao_config') or is_platform_admin(auth.uid()));
$$;
revoke all on function rec_pode_configurar() from public, anon;
grant execute on function rec_pode_configurar() to authenticated;

-- ---------- 2) Tabelas ----------
-- Funções (só o administrador geral muda) e regras da casa. Uma linha por casa.
create table if not exists rec_config (
  company_id uuid primary key default current_company_id() references companies(id) on delete cascade,
  funcoes jsonb not null default '{}'::jsonb,
  regras jsonb not null default '{}'::jsonb,
  termo text,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

-- Planos de cobrança da recreação (não confundir com os planos do Festou).
create table if not exists rec_planos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 60),
  descricao text,
  ativo boolean not null default true,
  ordem int not null default 0,
  regra jsonb not null,
  versao int not null default 1,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
create index if not exists idx_rec_planos_ordem on rec_planos (company_id, ativo, ordem);

-- Cada versão salva de um plano (histórico; a visita aponta para a versão).
create table if not exists rec_planos_versoes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  plano_id uuid not null references rec_planos(id) on delete cascade,
  versao int not null,
  regra jsonb not null,
  criado_em timestamptz not null default now(),
  criado_por text,
  unique (plano_id, versao)
);

-- Itens vendidos no balcão (meia antiderrapante, água...).
create table if not exists rec_itens (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 60),
  preco numeric(10,2) not null check (preco >= 0),
  ativo boolean not null default true,
  ordem int not null default 0,
  criado_em timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['rec_config', 'rec_planos', 'rec_planos_versoes', 'rec_itens'] loop
    if t <> 'rec_config' then
      execute format('create index if not exists %I on %I (company_id)', 'idx_' || t || '_company', t);
    end if;
    execute format('drop trigger if exists trg_set_company_id on %I', t);
    execute format('create trigger trg_set_company_id before insert or update on %I for each row execute function set_company_id()', t);
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists company_isolation on %I', t);
    execute format('create policy company_isolation on %I as restrictive for all
      using (company_id = current_company_id() or (auth.uid() is null and current_user = %L))
      with check (company_id = current_company_id() or (auth.uid() is null and current_user = %L))', t, 'app_definer', 'app_definer');
    execute format('drop policy if exists app_definer_all on %I', t);
    execute format('create policy app_definer_all on %I for all to app_definer using (true) with check (true)', t);
    -- Leitura: quem usa a recreação (as telas da etapa 3) ou configura.
    execute format('drop policy if exists "read_recreacao" on %I', t);
    execute format('create policy "read_recreacao" on %I for select using (has_permission(auth.uid(), %L) or has_permission(auth.uid(), %L) or is_platform_admin(auth.uid()))',
                   t, 'page:recreacao', 'page:recreacao_config');
    execute format('revoke all on %I from anon', t);
    execute format('grant select on %I to authenticated', t);
    execute format('grant all on %I to app_definer', t);
    execute format('drop trigger if exists trg_audit on %I', t);
    execute format('create trigger trg_audit after insert or update or delete on %I for each row execute function audit_row_change()', t);
  end loop;
end $$;
-- Escrita só pelas funções abaixo.

-- ---------- 3) Padrões ----------
create or replace function rec_funcoes_padrao() returns jsonb language sql immutable as $$
  select '{"codigo": true, "qr": true, "foto": "cadastro", "fotoObrig": false, "fotoDias": 30,
           "paginaPais": true, "pedirTempo": true, "chegando": true, "ocorrPais": true,
           "ocorr": true, "ocorrCiente": true,
           "caixaObrig": true, "cego": true, "lembrete": true, "horaFecha": "22:00", "lembreteMin": 30,
           "troca": true, "trocaConta": true, "offline": false}'::jsonb;
$$;
create or replace function rec_regras_padrao() returns jsonb language sql immutable as $$
  select '{"lotacao": 40, "aviso": 10, "idMin": 2, "idMax": 12, "comprovante": "perguntar", "impressora": "nao"}'::jsonb;
$$;

-- ---------- 4) Textos (valores e tempos em português) ----------
create or replace function rec_brl(v numeric) returns text language sql immutable as $$
  select (case when round(v, 2) < 0 then '-' else '' end) || 'R$ '
    || regexp_replace(floor(abs(round(v, 2)))::bigint::text, '(\d)(?=(\d{3})+$)', '\1.', 'g')
    || ',' || lpad(((abs(round(v, 2)) * 100)::bigint % 100)::text, 2, '0');
$$;
-- número sem zeros sobrando (60 -> "60", 7.5 -> "7,5")
create or replace function rec_n(v numeric) returns text language sql immutable as $$
  select replace(trim_scale(v)::text, '.', ',');
$$;
create or replace function rec_dur(min numeric) returns text language plpgsql immutable as $$
declare m int := greatest(0, round(coalesce(min, 0))); h int := m / 60; r int := m % 60;
begin
  if h = 0 then return r || ' min'; end if;
  if r = 0 then return h || 'h'; end if;
  return h || 'h' || lpad(r::text, 2, '0');
end;
$$;
create or replace function rec_fmtmin(m numeric) returns text language sql immutable as $$
  select case when m is null then 'sem limite' when m = 60 then '1 hora'
              when m > 60 and m % 60 = 0 then (m / 60)::int || ' horas' else rec_dur(m) end;
$$;
create or replace function rec_relogio(s numeric) returns text language plpgsql immutable as $$
declare t int := greatest(0, floor(coalesce(s, 0)));
begin
  return (t / 3600) || ':' || lpad(((t % 3600) / 60)::text, 2, '0') || ':' || lpad((t % 60)::text, 2, '0');
end;
$$;

-- ---------- 5) Motor de cobrança ----------
-- Uma regra única de virada: o limite é "até e inclusive" o segundo exato.
-- Arredondamento: 'seg' (exato), 'min_ini' (minuto começado), 'min_comp' (só minutos completos).
create or replace function rec_arred(p jsonb, s numeric) returns numeric language sql immutable as $$
  select case coalesce(p->>'arred', 'min_ini')
    when 'seg' then floor(s) when 'min_comp' then floor(s / 60) * 60 else ceil(floor(s) / 60) * 60 end;
$$;

-- Rótulo da faixa: "até 30 min", "acima de 30 até 60 min", "acima de 60 min".
create or replace function rec_rotulo(fx jsonb, i int) returns text language plpgsql immutable as $$
declare f jsonb := fx->i; prev text := case when i > 0 then rec_n((fx->(i-1)->>'ate')::numeric) else '0' end;
begin
  if f->>'ate' is null then return case when i > 0 then 'acima de ' || prev || ' min' else 'qualquer tempo' end; end if;
  return case when i > 0 then 'acima de ' || prev || ' até ' || rec_n((f->>'ate')::numeric) || ' min'
              else 'até ' || rec_n((f->>'ate')::numeric) || ' min' end;
end;
$$;

-- Qual faixa vale para s segundos? como: dentro | tol | trava | semlimite
create or replace function rec_faixa(fx jsonb, s numeric, out i int, out como text) language plpgsql immutable as $$
declare n int := coalesce(jsonb_array_length(fx), 0); f jsonb; fim numeric;
begin
  for k in 0 .. n - 1 loop
    f := fx->k;
    if f->>'ate' is null then i := k; como := 'semlimite'; return; end if;
    fim := (f->>'ate')::numeric * 60;
    if s <= fim then i := k; como := 'dentro'; return; end if;
    if coalesce(f->>'depois', 'avanca') = 'trava' then i := k; como := 'trava'; return; end if;
    if s <= fim + coalesce((f->>'tol')::numeric, 0) * 60 then i := k; como := 'tol'; return; end if;
  end loop;
  i := greatest(n - 1, 0); como := 'trava';
end;
$$;

create or replace function rec_explica_faixa(fx jsonb, i int, como text, quem text) returns text language plpgsql immutable as $$
declare
  f jsonb := fx->i; ant jsonb := case when i > 0 then fx->(i-1) end;
  antes text := '';
begin
  if ant is not null then
    antes := 'Passou de ' || rec_n((ant->>'ate')::numeric + coalesce((ant->>'tol')::numeric, 0)) || ' min (fim da faixa anterior'
             || case when coalesce((ant->>'tol')::numeric, 0) > 0 then ' + tolerância' else '' end || '), então avançou. ';
  end if;
  if como = 'tol' then
    return antes || 'Passou de ' || rec_n((f->>'ate')::numeric) || ' min, mas está na tolerância de ' || rec_n((f->>'tol')::numeric) || ' min: continua na faixa ' || rec_rotulo(fx, i) || '.';
  elsif como = 'trava' then
    return antes || 'Passou de ' || rec_n((f->>'ate')::numeric) || ' min e esta faixa trava o preço: não cobra mais.';
  elsif como = 'semlimite' then
    return antes || 'Última faixa, sem limite: ' || rec_rotulo(fx, i) || '.';
  end if;
  return antes || quem || ' dentro da faixa ' || rec_rotulo(fx, i) || '.';
end;
$$;

-- Blocos: a primeira virada usa a tolerância do plano; as próximas, a de cada
-- bloco. Os blocos contam desde o fim do tempo inicial (não desde a tolerância).
create or replace function rec_nblocos(s numeric, ini numeric, tol_prim numeric, b numeric, tol_cada numeric) returns int
language plpgsql immutable as $$
declare n int; lim numeric;
begin
  if coalesce(b, 0) <= 0 then return 0; end if;
  if s <= (ini + coalesce(tol_prim, 0)) * 60 then return 0; end if;
  n := 1; lim := (ini + b) * 60;
  while s > lim + coalesce(tol_cada, 0) * 60 and n < 100000 loop
    n := n + 1; lim := lim + b * 60;
  end loop;
  return n;
end;
$$;

-- Conta do plano p para p_seg segundos cobrados (já sem as pausas).
-- Devolve { s (tempo considerado), linhas: [{d, v}], expl: [texto], total }.
create or replace function rec_calcular(p jsonb, p_seg numeric) returns jsonb language plpgsql immutable as $$
declare
  sb numeric := greatest(0, floor(coalesce(p_seg, 0)));
  s numeric := rec_arred(p, greatest(0, floor(coalesce(p_seg, 0))));
  l jsonb := '[]'; e jsonb := '[]';
  nome text := coalesce(nullif(trim(p->>'nome'), ''), 'Plano');
  incl numeric := (p->>'incl')::numeric;
  tol_i numeric := coalesce((p->>'tolIncl')::numeric, 0);
  valor numeric := coalesce((p->>'valor')::numeric, 0);
  ex jsonb := coalesce(p->'exc', '{}');
  fx jsonb; r record; n int; v numeric; sub numeric; exc_seg numeric; teto numeric;
begin
  if coalesce(p->>'arred', 'min_ini') <> 'seg' and s <> sb then
    e := e || to_jsonb('Tempo cobrado ' || rec_relogio(sb) || ' conta como ' || rec_relogio(s)
      || case when p->>'arred' = 'min_comp' then ' (conta só minutos completos).' else ' (arredonda para o minuto começado).' end);
  end if;

  if coalesce(p->>'cobranca', 'saida') = 'entrada' then
    l := l || jsonb_build_array(jsonb_build_object('d', nome || ' (pago na entrada)', 'v', valor));
    if incl is null then
      e := e || to_jsonb('Plano sem limite de tempo: nada a mais.'::text);
    elsif s <= incl * 60 then
      e := e || to_jsonb('Dentro do tempo incluído (' || rec_fmtmin(incl) || ').');
    elsif s <= (incl + tol_i) * 60 then
      e := e || to_jsonb('Passou de ' || rec_fmtmin(incl) || ', mas está na tolerância de ' || rec_n(tol_i) || ' min: nada a mais.');
    elsif coalesce(p->>'depois', 'excedente') = 'trava' then
      e := e || to_jsonb('Passou do tempo incluído, mas este plano não cobra a mais.'::text);
    else
      exc_seg := s - incl * 60;
      e := e || to_jsonb('Passou da tolerância (' || rec_n(incl + tol_i) || ' min). O excedente conta desde ' || rec_fmtmin(incl) || ': ' || rec_relogio(exc_seg) || '.');
      if coalesce(ex->>'modelo', 'faixas') = 'faixas' then
        fx := coalesce(ex->'faixas', '[]');
        select * into r from rec_faixa(fx, exc_seg);
        e := e || to_jsonb(rec_explica_faixa(fx, r.i, r.como, 'Excedente') || ' O valor da faixa substitui o anterior.');
        l := l || jsonb_build_array(jsonb_build_object('d', 'Excedente (' || rec_rotulo(fx, r.i) || ')', 'v', coalesce((fx->r.i->>'valor')::numeric, 0)));
      else
        n := rec_nblocos(s, incl, tol_i, (ex->>'B')::numeric, (ex->>'tolCada')::numeric);
        v := n * coalesce((ex->>'Vb')::numeric, 0);
        e := e || to_jsonb(n || ' bloco' || case when n > 1 then 's' else '' end || ' de ' || rec_n((ex->>'B')::numeric) || ' min a ' || rec_brl(coalesce((ex->>'Vb')::numeric, 0)) || '.');
        l := l || jsonb_build_array(jsonb_build_object('d', 'Excedente: ' || n || ' × ' || rec_n((ex->>'B')::numeric) || ' min', 'v', v));
        teto := coalesce((ex->>'teto')::numeric, 0);
        if teto > 0 and v > teto then
          l := l || jsonb_build_array(jsonb_build_object('d', 'Limitado ao teto do excedente', 'v', teto - v));
          e := e || to_jsonb('Excedente limitado a ' || rec_brl(teto) || '.');
        end if;
      end if;
    end if;
  elsif coalesce(p->>'modelo', 'faixas') = 'faixas' then
    fx := coalesce(p->'faixas', '[]');
    select * into r from rec_faixa(fx, s);
    l := l || jsonb_build_array(jsonb_build_object('d', 'Faixa ' || rec_rotulo(fx, r.i), 'v', coalesce((fx->r.i->>'valor')::numeric, 0)));
    e := e || to_jsonb(rec_explica_faixa(fx, r.i, r.como, 'Ficou') || ' O valor da faixa é o total.');
  else
    l := l || jsonb_build_array(jsonb_build_object('d', 'Primeiros ' || rec_n((p->>'M0')::numeric) || ' min', 'v', coalesce((p->>'V0')::numeric, 0)));
    n := rec_nblocos(s, (p->>'M0')::numeric, (p->>'tol')::numeric, (p->>'B')::numeric, (p->>'tolCada')::numeric);
    if n > 0 then
      l := l || jsonb_build_array(jsonb_build_object('d', n || ' × ' || rec_n((p->>'B')::numeric) || ' min a mais', 'v', n * coalesce((p->>'Vb')::numeric, 0)));
      e := e || to_jsonb('Passou de ' || rec_n((p->>'M0')::numeric + coalesce((p->>'tol')::numeric, 0)) || ' min: ' || n || ' bloco' || case when n > 1 then 's' else '' end
        || ' de ' || rec_n((p->>'B')::numeric) || ' min, contados desde ' || rec_n((p->>'M0')::numeric) || ' min.');
    elsif s <= (p->>'M0')::numeric * 60 then
      e := e || to_jsonb('Dentro dos primeiros ' || rec_n((p->>'M0')::numeric) || ' min.');
    else
      e := e || to_jsonb('Na tolerância de ' || rec_n(coalesce((p->>'tol')::numeric, 0)) || ' min: nada a mais.');
    end if;
    select coalesce(sum((x->>'v')::numeric), 0) into sub from jsonb_array_elements(l) x;
    teto := coalesce((p->>'teto')::numeric, 0);
    if teto > 0 and sub > teto then
      l := l || jsonb_build_array(jsonb_build_object('d', 'Limitado ao teto', 'v', teto - sub));
      e := e || to_jsonb('Chegou ao teto de ' || rec_brl(teto) || ': não passa disso.');
    end if;
  end if;
  return jsonb_build_object('s', s, 'linhas', l, 'expl', e,
    'total', (select coalesce(sum((x->>'v')::numeric), 0) from jsonb_array_elements(l) x));
end;
$$;

-- Deixa a regra num formato único (só os campos conhecidos, números de verdade).
create or replace function rec_normalizar(p jsonb) returns jsonb language plpgsql immutable as $$
declare
  num_ text[] := array['valor', 'tolIncl', 'V0', 'M0', 'tol', 'Vb', 'B', 'tolCada', 'teto', 'limite'];
  k text; r jsonb;
  fx_norm text := $q$
    select coalesce(jsonb_agg(jsonb_build_object(
      'ate', case when f->>'ate' is null or f->>'ate' = '' then null else round((f->>'ate')::numeric, 2) end,
      'valor', round(coalesce(nullif(f->>'valor', '')::numeric, 0), 2),
      'tol', round(coalesce(nullif(f->>'tol', '')::numeric, 0), 2),
      'depois', case when f->>'depois' = 'trava' then 'trava' else 'avanca' end) order by ord), '[]'::jsonb)
    from jsonb_array_elements(coalesce($1, '[]'::jsonb)) with ordinality as t(f, ord) $q$;
  fx jsonb; efx jsonb;
begin
  r := jsonb_build_object(
    'nome', left(trim(coalesce(p->>'nome', '')), 60),
    'cobranca', case when p->>'cobranca' = 'entrada' then 'entrada' else 'saida' end,
    'modelo', case when p->>'modelo' = 'blocos' then 'blocos' else 'faixas' end,
    'arred', case when p->>'arred' in ('seg', 'min_comp') then p->>'arred' else 'min_ini' end,
    'pausa', coalesce((p->>'pausa')::boolean, true),
    'limiteAcao', case when p->>'limiteAcao' in ('bloquear', 'autorizacao') then p->>'limiteAcao' else 'alertar' end,
    'depois', case when p->>'depois' = 'trava' then 'trava' else 'excedente' end,
    'incl', case when p->>'incl' is null or p->>'incl' = '' then null else round((p->>'incl')::numeric, 2) end);
  foreach k in array num_ loop
    r := r || jsonb_build_object(k, round(coalesce(nullif(p->>k, '')::numeric, 0), 2));
  end loop;
  execute fx_norm into fx using p->'faixas';
  execute fx_norm into efx using p->'exc'->'faixas';
  r := r || jsonb_build_object('faixas', fx, 'exc', jsonb_build_object(
    'modelo', case when p->'exc'->>'modelo' = 'blocos' then 'blocos' else 'faixas' end,
    'faixas', efx,
    'B', round(coalesce(nullif(p->'exc'->>'B', '')::numeric, 15), 2),
    'Vb', round(coalesce(nullif(p->'exc'->>'Vb', '')::numeric, 0), 2),
    'tolCada', round(coalesce(nullif(p->'exc'->>'tolCada', '')::numeric, 0), 2),
    'teto', round(coalesce(nullif(p->'exc'->>'teto', '')::numeric, 0), 2)));
  return r;
end;
$$;

-- Frase do plano, como a equipe vê.
create or replace function rec_frase_faixas(fx jsonb) returns text language sql immutable as $$
  select string_agg(rec_rotulo(fx, (ord - 1)::int) || ': ' || rec_brl(coalesce((f->>'valor')::numeric, 0))
    || case when f->>'ate' is not null and coalesce((f->>'tol')::numeric, 0) > 0 then ' (tolerância ' || rec_n((f->>'tol')::numeric) || ' min)' else '' end
    || case when f->>'ate' is not null and f->>'depois' = 'trava' then ' e trava aí' else '' end, '; ' order by ord)
  from jsonb_array_elements(coalesce(fx, '[]')) with ordinality as t(f, ord);
$$;

create or replace function rec_frase(p jsonb) returns text language plpgsql immutable as $$
declare t text; ex jsonb := coalesce(p->'exc', '{}'); incl numeric := (p->>'incl')::numeric;
begin
  if p->>'cobranca' = 'entrada' then
    t := 'Paga ' || rec_brl(coalesce((p->>'valor')::numeric, 0)) || ' na entrada';
    if incl is null then
      t := t || ' e fica sem limite de tempo.';
    else
      t := t || ' por ' || rec_fmtmin(incl) || case when coalesce((p->>'tolIncl')::numeric, 0) > 0 then ', com ' || rec_n((p->>'tolIncl')::numeric) || ' min de tolerância' else '' end || '. Depois disso, ';
      if p->>'depois' = 'trava' then t := t || 'não cobra mais nada.';
      elsif coalesce(ex->>'modelo', 'faixas') = 'faixas' then
        t := t || 'cobra o excedente por faixas, contado desde ' || rec_fmtmin(incl) || ' (o valor substitui o anterior): ' || coalesce(rec_frase_faixas(ex->'faixas'), '') || '.';
      else
        t := t || 'soma ' || rec_brl(coalesce((ex->>'Vb')::numeric, 0)) || ' a cada ' || rec_n((ex->>'B')::numeric) || ' min a mais'
          || case when coalesce((ex->>'tolCada')::numeric, 0) > 0 then ' (tolerância de ' || rec_n((ex->>'tolCada')::numeric) || ' min em cada bloco)' else '' end
          || case when coalesce((ex->>'teto')::numeric, 0) > 0 then ', no máximo ' || rec_brl((ex->>'teto')::numeric) || ' a mais' else '' end || '.';
      end if;
    end if;
  elsif coalesce(p->>'modelo', 'faixas') = 'faixas' then
    t := 'Cobra na saída, pelo tempo total (o valor da faixa é o total): ' || coalesce(rec_frase_faixas(p->'faixas'), '') || '.';
  else
    t := 'Cobra na saída: ' || rec_brl(coalesce((p->>'V0')::numeric, 0)) || ' os primeiros ' || rec_n((p->>'M0')::numeric) || ' min'
      || case when coalesce((p->>'tol')::numeric, 0) > 0 then ' (tolerância ' || rec_n((p->>'tol')::numeric) || ' min)' else '' end
      || '; depois soma ' || rec_brl(coalesce((p->>'Vb')::numeric, 0)) || ' a cada ' || rec_n((p->>'B')::numeric) || ' min'
      || case when coalesce((p->>'tolCada')::numeric, 0) > 0 then ' (tolerância de ' || rec_n((p->>'tolCada')::numeric) || ' min em cada bloco)' else '' end
      || case when coalesce((p->>'teto')::numeric, 0) > 0 then '; nunca passa de ' || rec_brl((p->>'teto')::numeric) else '' end || '.';
  end if;
  t := t || case when coalesce((p->>'pausa')::boolean, true) then ' Pode pausar.' else ' Tempo contínuo, sem pausa.' end;
  if coalesce((p->>'limite')::numeric, 0) > 0 then
    t := t || ' Limite de permanência: ' || rec_fmtmin((p->>'limite')::numeric) || ' ('
      || case p->>'limiteAcao' when 'bloquear' then 'não deixa estender além' when 'autorizacao' then 'precisa do gerente para passar' else 'só avisa' end || ').';
  end if;
  return t;
end;
$$;

-- O que impede salvar (erros) e o que só merece atenção (avisos).
create or replace function rec_validar_faixas(fx jsonb, g text, inout erros text[], inout avisos text[]) language plpgsql immutable as $$
declare n int := coalesce(jsonb_array_length(fx), 0); f jsonb; ant jsonb; prox jsonb; u jsonb;
begin
  if n = 0 then erros := erros || (g || ': cadastre pelo menos uma faixa.'); return; end if;
  for k in 0 .. n - 1 loop
    f := fx->k; ant := case when k > 0 then fx->(k-1) end; prox := case when k < n - 1 then fx->(k+1) end;
    if coalesce((f->>'valor')::numeric, 0) < 0 then erros := erros || (g || ', faixa ' || (k+1) || ': o valor não pode ser negativo.'); end if;
    if coalesce((f->>'tol')::numeric, 0) < 0 then erros := erros || (g || ', faixa ' || (k+1) || ': a tolerância não pode ser negativa.'); end if;
    if f->>'ate' is null and k < n - 1 then
      erros := erros || (g || ', faixa ' || (k+1) || ': está "sem limite", então precisa ser a última. Mova para o fim ou apague as de baixo.');
    end if;
    if f->>'ate' is not null then
      if (f->>'ate')::numeric <= 0 then erros := erros || (g || ', faixa ' || (k+1) || ': informe até quantos minutos ela vai.'); end if;
      if ant is not null and ant->>'ate' is not null and (f->>'ate')::numeric <= (ant->>'ate')::numeric then
        erros := erros || (g || ', faixa ' || (k+1) || ': termina em ' || rec_n((f->>'ate')::numeric) || ' min, mas precisa terminar depois da faixa ' || k || ' (' || rec_n((ant->>'ate')::numeric) || ' min).');
      end if;
      if f->>'depois' = 'trava' and k < n - 1 then
        erros := erros || (g || ', faixa ' || (k+1) || ': trava o preço, então as faixas de baixo nunca seriam usadas. Apague-as ou troque para "passa para a próxima".');
      elsif prox is not null and prox->>'ate' is not null and (f->>'ate')::numeric + coalesce((f->>'tol')::numeric, 0) >= (prox->>'ate')::numeric then
        erros := erros || (g || ', faixa ' || (k+1) || ': a tolerância (' || rec_n(coalesce((f->>'tol')::numeric, 0)) || ' min) chega ao fim da faixa ' || (k+2) || ', então a faixa ' || (k+2) || ' nunca seria usada.');
      end if;
    end if;
    if ant is not null and coalesce((f->>'valor')::numeric, 0) < coalesce((ant->>'valor')::numeric, 0) then
      avisos := avisos || (g || ', faixa ' || (k+1) || ': é mais barata que a anterior. Confira se é isso mesmo.');
    end if;
  end loop;
  u := fx->(n-1);
  if u->>'ate' is not null and coalesce(u->>'depois', 'avanca') <> 'trava' then
    erros := erros || (g || ': falta dizer o que acontece depois de ' || rec_n((u->>'ate')::numeric) || ' min. Marque a última faixa como "sem limite" ou "trava o preço".');
  end if;
end;
$$;

create or replace function rec_validar(p jsonb) returns jsonb language plpgsql immutable as $$
declare erros text[] := '{}'; avisos text[] := '{}'; ex jsonb := coalesce(p->'exc', '{}');
begin
  if coalesce(trim(p->>'nome'), '') = '' then erros := erros || 'Dê um nome ao plano.'::text; end if;
  if p->>'cobranca' = 'entrada' then
    if coalesce((p->>'valor')::numeric, 0) < 0 then erros := erros || 'O valor do plano não pode ser negativo.'::text; end if;
    if p->>'incl' is not null and (p->>'incl')::numeric <= 0 then erros := erros || 'Informe o tempo incluído ou marque "sem limite".'::text; end if;
    if coalesce((p->>'tolIncl')::numeric, 0) < 0 then erros := erros || 'A tolerância não pode ser negativa.'::text; end if;
    if p->>'incl' is not null and coalesce(p->>'depois', 'excedente') = 'excedente' then
      if coalesce(ex->>'modelo', 'faixas') = 'faixas' then
        select v.erros, v.avisos into erros, avisos from rec_validar_faixas(ex->'faixas', 'Excedente', erros, avisos) v;
      else
        if coalesce((ex->>'B')::numeric, 0) <= 0 then erros := erros || 'Excedente: informe o tamanho do bloco.'::text; end if;
        if coalesce((ex->>'Vb')::numeric, 0) < 0 then erros := erros || 'Excedente: o valor do bloco não pode ser negativo.'::text; end if;
      end if;
    end if;
  elsif coalesce(p->>'modelo', 'faixas') = 'faixas' then
    select v.erros, v.avisos into erros, avisos from rec_validar_faixas(p->'faixas', 'Faixas', erros, avisos) v;
  else
    if coalesce((p->>'M0')::numeric, 0) <= 0 then erros := erros || 'Informe quantos minutos o valor inicial cobre.'::text; end if;
    if coalesce((p->>'B')::numeric, 0) <= 0 then erros := erros || 'Informe o tamanho do bloco.'::text; end if;
    if coalesce((p->>'V0')::numeric, 0) < 0 or coalesce((p->>'Vb')::numeric, 0) < 0 then erros := erros || 'Os valores não podem ser negativos.'::text; end if;
    if coalesce((p->>'teto')::numeric, 0) > 0 and (p->>'teto')::numeric < coalesce((p->>'V0')::numeric, 0) then
      erros := erros || 'O teto não pode ser menor que o valor inicial.'::text;
    end if;
  end if;
  if coalesce((p->>'limite')::numeric, 0) < 0 then erros := erros || 'O limite de permanência não pode ser negativo.'::text; end if;
  return jsonb_build_object('erros', to_jsonb(erros), 'avisos', to_jsonb(avisos));
end;
$$;

-- Pontos críticos para testar: 1 s antes, exatamente, durante e no fim da tolerância, 1 s depois.
create or replace function rec_pontos(p jsonb) returns jsonb language plpgsql immutable as $$
declare
  pts jsonb := '[]'; ex jsonb := coalesce(p->'exc', '{}'); incl numeric := (p->>'incl')::numeric;
  f jsonb; ord bigint;
begin
  if p->>'cobranca' = 'entrada' then
    if incl is not null then
      pts := pts || rec_pontos_de('Fim de ' || rec_fmtmin(incl), incl, coalesce((p->>'tolIncl')::numeric, 0));
      if coalesce(p->>'depois', 'excedente') = 'excedente' then
        if coalesce(ex->>'modelo', 'faixas') = 'faixas' then
          for f in select x from jsonb_array_elements(coalesce(ex->'faixas', '[]')) x loop
            if f->>'ate' is not null then
              pts := pts || rec_pontos_de('Excedente de ' || rec_n((f->>'ate')::numeric) || ' min', incl + (f->>'ate')::numeric,
                                          case when f->>'depois' = 'trava' then 0 else coalesce((f->>'tol')::numeric, 0) end);
            end if;
          end loop;
        else
          pts := pts || rec_pontos_de('Fim do 1º bloco', incl + coalesce((ex->>'B')::numeric, 0), coalesce((ex->>'tolCada')::numeric, 0));
          pts := pts || rec_pontos_de('Fim do 2º bloco', incl + 2 * coalesce((ex->>'B')::numeric, 0), coalesce((ex->>'tolCada')::numeric, 0));
        end if;
      end if;
    end if;
  elsif coalesce(p->>'modelo', 'faixas') = 'faixas' then
    for f, ord in select x, o from jsonb_array_elements(coalesce(p->'faixas', '[]')) with ordinality as t(x, o) loop
      if f->>'ate' is not null then
        pts := pts || rec_pontos_de('Fim da faixa ' || ord, (f->>'ate')::numeric, case when f->>'depois' = 'trava' then 0 else coalesce((f->>'tol')::numeric, 0) end);
      end if;
    end loop;
  else
    pts := pts || rec_pontos_de('Fim dos ' || rec_n((p->>'M0')::numeric) || ' min', (p->>'M0')::numeric, coalesce((p->>'tol')::numeric, 0));
    pts := pts || rec_pontos_de('Fim do 1º bloco', (p->>'M0')::numeric + (p->>'B')::numeric, coalesce((p->>'tolCada')::numeric, 0));
    pts := pts || rec_pontos_de('Fim do 2º bloco', (p->>'M0')::numeric + 2 * (p->>'B')::numeric, coalesce((p->>'tolCada')::numeric, 0));
  end if;
  -- sem repetidos, em ordem de tempo
  return coalesce((select jsonb_agg(x order by (x->>'s')::numeric) from (
    select distinct on ((x->>'s')::numeric) x from jsonb_array_elements(pts) x where (x->>'s')::numeric >= 0 order by (x->>'s')::numeric, x->>'nome') d), '[]');
end;
$$;

create or replace function rec_pontos_de(nome text, base_min numeric, tol numeric) returns jsonb language plpgsql immutable as $$
declare b numeric := base_min * 60; r jsonb;
begin
  r := jsonb_build_array(jsonb_build_object('nome', nome || ': 1 s antes', 's', b - 1), jsonb_build_object('nome', nome || ': exatamente', 's', b));
  if coalesce(tol, 0) > 0 then
    r := r || jsonb_build_array(
      jsonb_build_object('nome', nome || ': durante a tolerância', 's', b + round(tol * 30)),
      jsonb_build_object('nome', nome || ': fim da tolerância', 's', b + tol * 60),
      jsonb_build_object('nome', nome || ': 1 s depois da tolerância', 's', b + tol * 60 + 1));
  else
    r := r || jsonb_build_array(jsonb_build_object('nome', nome || ': 1 s depois', 's', b + 1));
  end if;
  return r;
end;
$$;

-- Tudo de uma vez para a tela de configuração (simulador e teste dos limites).
create or replace function rec_simular(p_regra jsonb, p_seg numeric default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p jsonb := rec_normalizar(p_regra); v jsonb := rec_validar(rec_normalizar(p_regra));
begin
  if auth.uid() is null then raise exception 'Entre no sistema.'; end if;
  if jsonb_array_length(v->'erros') > 0 then
    return jsonb_build_object('regra', p, 'validacao', v, 'frase', rec_frase(p));
  end if;
  return jsonb_build_object('regra', p, 'validacao', v, 'frase', rec_frase(p),
    'calc', rec_calcular(p, p_seg),
    'pontos', (select coalesce(jsonb_agg(jsonb_build_object('nome', x->>'nome', 's', (x->>'s')::numeric,
                 'conta', (rec_calcular(p, (x->>'s')::numeric)->>'s')::numeric,
                 'total', (rec_calcular(p, (x->>'s')::numeric)->>'total')::numeric,
                 'expl', (select y from jsonb_array_elements_text(rec_calcular(p, (x->>'s')::numeric)->'expl') y where y not like 'Tempo cobrado%' limit 1 offset 0))
               order by (x->>'s')::numeric), '[]') from jsonb_array_elements(rec_pontos(p)) x));
end;
$$;
revoke all on function rec_simular(jsonb, numeric) from public, anon;
grant execute on function rec_simular(jsonb, numeric) to authenticated;

-- ---------- 6) Configuração da casa ----------
create or replace function rec_config_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c rec_config;
begin
  if auth.uid() is null then raise exception 'Entre no sistema.'; end if;
  select * into c from rec_config where company_id = current_company_id();
  return jsonb_build_object('ligada', rec_ligada(),
    'funcoes', rec_funcoes_padrao() || coalesce(c.funcoes, '{}'),
    'regras', rec_regras_padrao() || coalesce(c.regras, '{}'),
    'termo', coalesce(c.termo, 'Declaro que sou responsável pela criança cadastrada, que informei alergias e cuidados necessários e que a criança só será entregue a mim ou às pessoas autorizadas mediante o código de retirada.'),
    'atualizado_em', c.atualizado_em, 'atualizado_por', c.atualizado_por);
end;
$$;
revoke all on function rec_config_get() from public, anon;
grant execute on function rec_config_get() to authenticated;

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
    'impressora', case when p_regras->>'impressora' in ('nao', '58', '80') then p_regras->>'impressora' else 'nao' end);
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

-- Salva um plano (novo ou alteração). Mudou a regra: nova versão.
create or replace function rec_plano_salvar(p_id uuid, p_plano jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  p jsonb := rec_normalizar(p_plano);
  v jsonb := rec_validar(rec_normalizar(p_plano));
  atual rec_planos; v_id uuid; v_ver int;
begin
  if not rec_pode_configurar() then raise exception 'Sem permissão para configurar a recreação.'; end if;
  if jsonb_array_length(v->'erros') > 0 then raise exception '%', v->'erros'->>0; end if;
  if p_id is null then
    if (select count(*) from rec_planos where company_id = current_company_id()) >= 50 then raise exception 'Limite de 50 planos.'; end if;
    insert into rec_planos (nome, descricao, ativo, ordem, regra, versao, atualizado_por)
    values (p->>'nome', nullif(left(trim(coalesce(p_plano->>'descricao', '')), 200), ''), coalesce((p_plano->>'ativo')::boolean, true),
            coalesce((select max(ordem) + 1 from rec_planos where company_id = current_company_id()), 1), p, 1, current_actor_name())
    returning id into v_id;
    insert into rec_planos_versoes (plano_id, versao, regra, criado_por) values (v_id, 1, p, current_actor_name());
    return v_id;
  end if;
  select * into atual from rec_planos where id = p_id and company_id = current_company_id();
  if not found then raise exception 'Plano não encontrado.'; end if;
  v_ver := atual.versao + case when atual.regra is distinct from p then 1 else 0 end;
  update rec_planos set nome = p->>'nome', descricao = nullif(left(trim(coalesce(p_plano->>'descricao', '')), 200), ''),
         ativo = coalesce((p_plano->>'ativo')::boolean, ativo), regra = p, versao = v_ver, atualizado_em = now(), atualizado_por = current_actor_name()
  where id = p_id;
  if v_ver > atual.versao then
    insert into rec_planos_versoes (plano_id, versao, regra, criado_por) values (p_id, v_ver, p, current_actor_name());
  end if;
  return p_id;
end;
$$;
revoke all on function rec_plano_salvar(uuid, jsonb) from public, anon;
grant execute on function rec_plano_salvar(uuid, jsonb) to authenticated;

-- Ativa/desativa (plano nunca é apagado: fica no histórico das visitas).
create or replace function rec_plano_ativar(p_id uuid, p_ativo boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not rec_pode_configurar() then raise exception 'Sem permissão para configurar a recreação.'; end if;
  update rec_planos set ativo = coalesce(p_ativo, ativo), atualizado_em = now(), atualizado_por = current_actor_name()
  where id = p_id and company_id = current_company_id();
  if not found then raise exception 'Plano não encontrado.'; end if;
end;
$$;
revoke all on function rec_plano_ativar(uuid, boolean) from public, anon;
grant execute on function rec_plano_ativar(uuid, boolean) to authenticated;

-- Ordem dos planos na tela de entrada.
create or replace function rec_planos_ordenar(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not rec_pode_configurar() then raise exception 'Sem permissão para configurar a recreação.'; end if;
  update rec_planos p set ordem = x.o from unnest(p_ids) with ordinality as x(id, o)
  where p.id = x.id and p.company_id = current_company_id();
end;
$$;
revoke all on function rec_planos_ordenar(uuid[]) from public, anon;
grant execute on function rec_planos_ordenar(uuid[]) to authenticated;

create or replace function rec_item_salvar(p_id uuid, p_nome text, p_preco numeric, p_ativo boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not rec_pode_configurar() then raise exception 'Sem permissão para configurar a recreação.'; end if;
  if length(trim(coalesce(p_nome, ''))) = 0 then raise exception 'Dê um nome ao item.'; end if;
  if p_preco is null or p_preco < 0 or p_preco > 100000 then raise exception 'Confira o preço do item.'; end if;
  if p_id is null then
    insert into rec_itens (nome, preco, ativo, ordem)
    values (left(trim(p_nome), 60), round(p_preco, 2), coalesce(p_ativo, true), coalesce((select max(ordem) + 1 from rec_itens where company_id = current_company_id()), 1))
    returning id into v_id;
    return v_id;
  end if;
  update rec_itens set nome = left(trim(p_nome), 60), preco = round(p_preco, 2), ativo = coalesce(p_ativo, ativo)
  where id = p_id and company_id = current_company_id() returning id into v_id;
  if v_id is null then raise exception 'Item não encontrado.'; end if;
  return v_id;
end;
$$;
revoke all on function rec_item_salvar(uuid, text, numeric, boolean) from public, anon;
grant execute on function rec_item_salvar(uuid, text, numeric, boolean) to authenticated;

-- ---------- 7) Funções da recreação: só o administrador geral ----------
create or replace function platform_rec_funcoes(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return rec_funcoes_padrao() || coalesce((select funcoes from rec_config where company_id = p_company), '{}');
end;
$$;
revoke all on function platform_rec_funcoes(uuid) from public, anon;
grant execute on function platform_rec_funcoes(uuid) to authenticated;

create or replace function platform_rec_funcoes_salvar(p_company uuid, p_funcoes jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare f jsonb := '{}'; k text; pad jsonb := rec_funcoes_padrao();
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if not exists (select 1 from companies where id = p_company) then raise exception 'Empresa não encontrada.'; end if;
  -- só as chaves conhecidas, com o tipo certo
  for k in select jsonb_object_keys(pad) loop
    if p_funcoes ? k then
      if jsonb_typeof(pad->k) = 'boolean' then f := f || jsonb_build_object(k, coalesce((p_funcoes->>k)::boolean, (pad->>k)::boolean));
      elsif jsonb_typeof(pad->k) = 'number' then f := f || jsonb_build_object(k, greatest(1, least(999, coalesce(nullif(p_funcoes->>k, '')::int, (pad->>k)::int))));
      else f := f || jsonb_build_object(k, coalesce(p_funcoes->>k, pad->>k));
      end if;
    end if;
  end loop;
  if f ? 'foto' and f->>'foto' not in ('nao', 'cadastro', 'entrada') then raise exception 'Opção de foto inválida.'; end if;
  if f ? 'horaFecha' and f->>'horaFecha' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Horário de fim do expediente inválido.'; end if;
  insert into rec_config (company_id, funcoes, atualizado_em, atualizado_por)
  values (p_company, f, now(), 'Administrador geral')
  on conflict (company_id) do update set funcoes = rec_config.funcoes || excluded.funcoes, atualizado_em = now(), atualizado_por = 'Administrador geral';
end;
$$;
revoke all on function platform_rec_funcoes_salvar(uuid, jsonb) from public, anon;
grant execute on function platform_rec_funcoes_salvar(uuid, jsonb) to authenticated;

-- As funções de cálculo são puras (não leem dados): ficam liberadas para quem entrou.
do $$
declare fn text;
begin
  foreach fn in array array['rec_brl(numeric)', 'rec_n(numeric)', 'rec_dur(numeric)', 'rec_fmtmin(numeric)', 'rec_relogio(numeric)',
    'rec_arred(jsonb,numeric)', 'rec_rotulo(jsonb,integer)', 'rec_faixa(jsonb,numeric)', 'rec_explica_faixa(jsonb,integer,text,text)',
    'rec_nblocos(numeric,numeric,numeric,numeric,numeric)', 'rec_calcular(jsonb,numeric)', 'rec_normalizar(jsonb)', 'rec_frase_faixas(jsonb)',
    'rec_frase(jsonb)', 'rec_validar_faixas(jsonb,text,text[],text[])', 'rec_validar(jsonb)', 'rec_pontos(jsonb)', 'rec_pontos_de(text,numeric,numeric)',
    'rec_funcoes_padrao()', 'rec_regras_padrao()'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

commit;
