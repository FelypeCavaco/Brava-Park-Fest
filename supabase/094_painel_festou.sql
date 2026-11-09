-- =========================================================
-- PAINEL DO FESTOU (administrador geral)
--
-- SÓ NO BANCO DOS CLIENTES (a Brava não tem administrador geral).
--
-- 1) Planos: Essencial, Profissional e Master, com preço, limites e as
--    funções que cada um libera. A casa ligada a um plano tem as funções
--    ligadas/desligadas sozinhas; dá para liberar uma função à parte.
--    Casa sem plano continua como hoje (funções escolhidas à mão).
-- 2) Anotações por casa (histórico de conversas).
-- 3) Custos da plataforma (para o Financeiro do Festou).
-- 4) Financeiro do Festou: mês a mês e cobranças do mês.
-- 5) Interessados (quem pediu contato ou teste).
-- 6) Avisos para todas as casas (aparecem no sininho).
--
-- Roda numa transação. Não mexe em nenhum dado das casas, a não ser as
-- funções ligadas de uma casa quando você escolhe o plano dela.
-- =========================================================

begin;

-- ---------- 1) Planos ----------
create table if not exists platform_plans (
  id text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  nome text not null check (length(trim(nome)) > 0),
  preco numeric(10,2) not null default 0 check (preco >= 0),
  unidades_incluidas int not null default 1 check (unidades_incluidas >= 1),
  usuarios_incluidos int check (usuarios_incluidos is null or usuarios_incluidos >= 1),
  unidade_adicional numeric(10,2) not null default 0 check (unidade_adicional >= 0),
  modulos text[] not null default '{}',
  destaque boolean not null default false,
  ordem int not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
alter table platform_plans enable row level security;
revoke all on platform_plans from anon, authenticated;

-- Todas as funções que podem ser ligadas/desligadas (as mesmas de src/lib/modules.ts).
create or replace function platform_all_modules() returns text[]
language sql immutable set search_path = public as $$
  select array['agenda', 'comissoes', 'marketing', 'estoque', 'acertos', 'propostas', 'escalas',
               'reativacao', 'satisfacao', 'lucro', 'fin_avancado', 'relatorio']::text[];
$$;
revoke all on function platform_all_modules() from public, anon;
grant execute on function platform_all_modules() to authenticated;

insert into platform_plans (id, nome, preco, unidades_incluidas, usuarios_incluidos, unidade_adicional, modulos, destaque, ordem) values
  ('essencial', 'Essencial', 189.90, 1, 5, 79.90, array['agenda'], false, 1),
  ('profissional', 'Profissional', 279.90, 2, 10, 79.90,
     array['agenda', 'propostas', 'comissoes', 'escalas', 'estoque', 'satisfacao', 'reativacao', 'lucro'], true, 2),
  ('master', 'Master', 369.90, 3, null, 69.90, platform_all_modules(), false, 3)
on conflict (id) do nothing;

alter table platform_billing add column if not exists plano_id text references platform_plans(id) on update cascade;
alter table platform_billing add column if not exists modulos_extras text[] not null default '{}';

-- Liga/desliga as funções da casa conforme o plano + as liberadas à parte.
-- Casa sem plano: não mexe (funções escolhidas à mão, como antes).
create or replace function platform_apply_plan(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_mod text[]; v_extras text[];
begin
  select pl.modulos, b.modulos_extras into v_mod, v_extras
  from platform_billing b join platform_plans pl on pl.id = b.plano_id
  where b.company_id = p_company;
  if not found then return; end if;
  update companies set disabled_modules = coalesce(array(
    select m from unnest(platform_all_modules()) m
    where not (m = any(coalesce(v_mod, '{}') || coalesce(v_extras, '{}')))
  ), '{}')
  where id = p_company;
end;
$$;
revoke all on function platform_apply_plan(uuid) from public, anon, authenticated;

create or replace function platform_plans_list()
returns table (id text, nome text, preco numeric, unidades_incluidas int, usuarios_incluidos int, unidade_adicional numeric,
               modulos text[], destaque boolean, ordem int, ativo boolean, casas int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query
  select p.id, p.nome, p.preco, p.unidades_incluidas, p.usuarios_incluidos, p.unidade_adicional, p.modulos, p.destaque, p.ordem, p.ativo,
         (select count(*)::int from platform_billing b where b.plano_id = p.id)
  from platform_plans p order by p.ordem, p.preco;
end;
$$;

-- Cria ou altera um plano. Mudou as funções: vale na hora para as casas do plano.
create or replace function platform_plan_save(p_dados jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id text := nullif(trim(p_dados->>'id'), '');
  v_mod text[];
  c record;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if nullif(trim(p_dados->>'nome'), '') is null then raise exception 'Informe o nome do plano.'; end if;
  if v_id is null then
    v_id := left(regexp_replace(lower(translate(trim(p_dados->>'nome'), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')), '[^a-z0-9]+', '_', 'g'), 30);
    v_id := trim(both '_' from v_id);
    if length(v_id) < 2 then v_id := 'plano_' || substr(md5(random()::text), 1, 6); end if;
    if exists (select 1 from platform_plans where id = v_id) then raise exception 'Já existe um plano com esse nome.'; end if;
  end if;
  select coalesce(array_agg(distinct m), '{}') into v_mod
  from jsonb_array_elements_text(coalesce(p_dados->'modulos', '[]'::jsonb)) m
  where m = any(platform_all_modules());

  insert into platform_plans (id, nome, preco, unidades_incluidas, usuarios_incluidos, unidade_adicional, modulos, destaque, ordem, ativo)
  values (v_id, trim(p_dados->>'nome'), coalesce((p_dados->>'preco')::numeric, 0), coalesce((p_dados->>'unidades_incluidas')::int, 1),
          nullif(p_dados->>'usuarios_incluidos', '')::int, coalesce((p_dados->>'unidade_adicional')::numeric, 0), v_mod,
          coalesce((p_dados->>'destaque')::boolean, false), coalesce((p_dados->>'ordem')::int, 99), coalesce((p_dados->>'ativo')::boolean, true))
  on conflict (id) do update set
    nome = excluded.nome, preco = excluded.preco, unidades_incluidas = excluded.unidades_incluidas,
    usuarios_incluidos = excluded.usuarios_incluidos, unidade_adicional = excluded.unidade_adicional,
    modulos = excluded.modulos, destaque = excluded.destaque, ordem = excluded.ordem, ativo = excluded.ativo;

  -- só um plano em destaque
  if coalesce((p_dados->>'destaque')::boolean, false) then
    update platform_plans set destaque = false where id <> v_id and destaque;
  end if;
  -- o nome do plano na mensalidade (vai no contrato) acompanha
  update platform_billing set plano = trim(p_dados->>'nome') where plano_id = v_id;
  for c in select company_id from platform_billing where plano_id = v_id loop
    perform platform_apply_plan(c.company_id);
  end loop;
  return v_id;
exception
  when check_violation then raise exception 'Confira os valores: sem números negativos e pelo menos 1 unidade.';
  when invalid_text_representation then raise exception 'Confira os valores digitados.';
end;
$$;

create or replace function platform_plan_delete(p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if exists (select 1 from platform_billing where plano_id = p_id) then
    raise exception 'Há casas neste plano. Troque o plano delas antes de excluir.';
  end if;
  delete from platform_plans where id = p_id;
end;
$$;

-- Plano e funções à parte de cada casa (para a lista e a ficha).
create or replace function platform_billing_plans()
returns table (company_id uuid, plano_id text, modulos_extras text[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query select b.company_id, b.plano_id, b.modulos_extras from platform_billing b;
end;
$$;

-- Troca o plano da casa: nome, mensalidade e limites passam a ser os do plano,
-- e as funções acompanham. p_plano nulo = sem plano (funções à mão, como antes).
create or replace function platform_set_company_plan(p_company uuid, p_plano text) returns void
language plpgsql security definer set search_path = public as $$
declare p platform_plans;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if not exists (select 1 from platform_billing where company_id = p_company) then
    raise exception 'Cadastre antes a mensalidade da casa (aba Mensalidade).';
  end if;
  if p_plano is null then
    update platform_billing set plano_id = null where company_id = p_company;
    return;
  end if;
  select * into p from platform_plans where id = p_plano;
  if not found then raise exception 'Plano não encontrado.'; end if;
  update platform_billing set plano_id = p.id, plano = p.nome, mensalidade = p.preco,
         unidades_incluidas = p.unidades_incluidas, usuarios_incluidos = p.usuarios_incluidos, unidade_adicional = p.unidade_adicional
  where company_id = p_company;
  perform platform_apply_plan(p_company);
end;
$$;

create or replace function platform_set_company_extras(p_company uuid, p_extras text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  update platform_billing set modulos_extras = coalesce(array(
    select distinct m from unnest(coalesce(p_extras, '{}')) m where m = any(platform_all_modules())
  ), '{}')
  where company_id = p_company and plano_id is not null;
  if not found then raise exception 'Escolha antes o plano da casa.'; end if;
  perform platform_apply_plan(p_company);
end;
$$;

-- Mensalidade: agora aceita o plano da lista (plano_id). Sem plano_id, fica
-- como antes (plano escrito à mão).
create or replace function platform_billing_save(p_company uuid, p_dados jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_plano_id text := nullif(trim(p_dados->>'plano_id'), ''); v_nome text := nullif(trim(p_dados->>'plano'), '');
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if not exists (select 1 from companies where id = p_company) then raise exception 'Empresa não encontrada.'; end if;
  if v_plano_id is not null then
    select nome into v_nome from platform_plans where id = v_plano_id;
    if not found then raise exception 'Plano não encontrado.'; end if;
  end if;
  insert into platform_billing (company_id, plano, plano_id, mensalidade, dia_vencimento, inicio, implantacao, unidade_adicional,
                                unidades_incluidas, usuarios_incluidos, observacao)
  values (p_company, v_nome, v_plano_id, coalesce((p_dados->>'mensalidade')::numeric, 0),
          coalesce((p_dados->>'dia_vencimento')::int, 10), coalesce((p_dados->>'inicio')::date, today_brazil()),
          coalesce((p_dados->>'implantacao')::numeric, 0), coalesce((p_dados->>'unidade_adicional')::numeric, 0),
          coalesce((p_dados->>'unidades_incluidas')::int, 1), nullif(p_dados->>'usuarios_incluidos', '')::int,
          nullif(trim(p_dados->>'observacao'), ''))
  on conflict (company_id) do update set
    -- sem a chave plano_id (tela antiga): mantém o plano que a casa já tinha
    plano = case when p_dados ? 'plano_id' or platform_billing.plano_id is null then excluded.plano else platform_billing.plano end,
    plano_id = case when p_dados ? 'plano_id' then excluded.plano_id else platform_billing.plano_id end,
    mensalidade = excluded.mensalidade, dia_vencimento = excluded.dia_vencimento,
    inicio = excluded.inicio, implantacao = excluded.implantacao, unidade_adicional = excluded.unidade_adicional,
    unidades_incluidas = excluded.unidades_incluidas, usuarios_incluidos = excluded.usuarios_incluidos,
    observacao = excluded.observacao;
  perform platform_apply_plan(p_company);
exception
  when check_violation then raise exception 'Confira os valores: dia de vencimento de 1 a 28, valores sem números negativos.';
  when invalid_text_representation or invalid_datetime_format then raise exception 'Confira os valores digitados.';
end;
$$;

-- ---------- 2) Anotações por casa ----------
create table if not exists platform_company_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  tipo text not null default 'anotacao' check (tipo in ('anotacao', 'ligacao', 'whatsapp', 'email', 'reuniao')),
  texto text not null check (length(trim(texto)) > 0 and length(texto) <= 4000),
  autor text,
  criado_em timestamptz not null default now()
);
create index if not exists platform_company_notes_company on platform_company_notes (company_id, criado_em desc);
alter table platform_company_notes enable row level security;
revoke all on platform_company_notes from anon, authenticated;

create or replace function platform_notes_list(p_company uuid)
returns table (id uuid, tipo text, texto text, autor text, criado_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query select n.id, n.tipo, n.texto, n.autor, n.criado_em from platform_company_notes n
    where n.company_id = p_company order by n.criado_em desc;
end;
$$;

create or replace function platform_note_add(p_company uuid, p_tipo text, p_texto text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if nullif(trim(p_texto), '') is null then raise exception 'Escreva a anotação.'; end if;
  insert into platform_company_notes (company_id, tipo, texto, autor)
  values (p_company, coalesce(nullif(p_tipo, ''), 'anotacao'), trim(p_texto),
          (select name from user_profiles where id = auth.uid()))
  returning id into v;
  return v;
exception when check_violation then raise exception 'Anotação muito longa (até 4.000 letras).';
end;
$$;

create or replace function platform_note_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  delete from platform_company_notes where id = p_id;
end;
$$;

-- ---------- 3) Custos da plataforma ----------
create table if not exists platform_costs (
  id uuid primary key default gen_random_uuid(),
  descricao text not null check (length(trim(descricao)) > 0),
  valor numeric(10,2) not null check (valor >= 0),
  como text,
  inicio date not null default date_trunc('month', current_date)::date check (inicio = date_trunc('month', inicio)::date),
  fim date check (fim is null or (fim = date_trunc('month', fim)::date and fim >= inicio)),
  criado_em timestamptz not null default now()
);
alter table platform_costs enable row level security;
revoke all on platform_costs from anon, authenticated;

create or replace function platform_costs_list()
returns table (id uuid, descricao text, valor numeric, como text, inicio date, fim date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query select c.id, c.descricao, c.valor, c.como, c.inicio, c.fim from platform_costs c
    order by (c.fim is not null), c.valor desc, c.descricao;
end;
$$;

-- Cria ou altera um custo mensal. "fim" = último mês em que ele conta (encerrado).
create or replace function platform_cost_save(p_dados jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid := nullif(p_dados->>'id', '')::uuid;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if nullif(trim(p_dados->>'descricao'), '') is null then raise exception 'Informe o custo.'; end if;
  if v is null then
    insert into platform_costs (descricao, valor, como, inicio, fim)
    values (trim(p_dados->>'descricao'), coalesce((p_dados->>'valor')::numeric, 0), nullif(trim(p_dados->>'como'), ''),
            date_trunc('month', coalesce(nullif(p_dados->>'inicio', '')::date, today_brazil()))::date,
            date_trunc('month', nullif(p_dados->>'fim', '')::date)::date)
    returning id into v;
  else
    update platform_costs set descricao = trim(p_dados->>'descricao'), valor = coalesce((p_dados->>'valor')::numeric, 0),
      como = nullif(trim(p_dados->>'como'), ''),
      inicio = date_trunc('month', coalesce(nullif(p_dados->>'inicio', '')::date, inicio))::date,
      fim = date_trunc('month', nullif(p_dados->>'fim', '')::date)::date
    where id = v;
    if not found then raise exception 'Custo não encontrado.'; end if;
  end if;
  return v;
exception
  when check_violation then raise exception 'Confira: valor sem número negativo e o fim depois do início.';
  when invalid_text_representation or invalid_datetime_format then raise exception 'Confira os valores digitados.';
end;
$$;

create or replace function platform_cost_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  delete from platform_costs where id = p_id;
end;
$$;

-- ---------- 4) Financeiro do Festou ----------
-- Mês a mês: mensalidades recebidas (pela data do pagamento), implantações
-- pagas, custos em vigor e casas que pagaram no mês.
create or replace function platform_finance_months(p_meses int default 12)
returns table (mes date, mensalidades numeric, implantacoes numeric, custos numeric, casas_pagantes int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query
  with meses as (
    select generate_series(date_trunc('month', today_brazil()) - make_interval(months => greatest(least(coalesce(p_meses, 12), 36), 1) - 1),
                           date_trunc('month', today_brazil()), interval '1 month')::date m
  )
  select ms.m,
         coalesce((select sum(p.valor) from platform_billing_payments p where date_trunc('month', p.pago_em) = ms.m), 0),
         coalesce((select sum(b.implantacao) from platform_billing b
                   where b.implantacao_status = 'paga' and date_trunc('month', b.implantacao_paga_em) = ms.m), 0),
         coalesce((select sum(c.valor) from platform_costs c where c.inicio <= ms.m and (c.fim is null or c.fim >= ms.m)), 0),
         (select count(distinct p.company_id)::int from platform_billing_payments p where date_trunc('month', p.pago_em) = ms.m)
  from meses ms order by ms.m;
end;
$$;

-- Cobranças de um mês: a mensalidade de cada casa com vencimento no mês.
create or replace function platform_finance_charges(p_mes date)
returns table (company_id uuid, nome text, vencimento date, valor numeric, pago boolean, pago_em date, forma text, valor_pago numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_mes date := date_trunc('month', coalesce(p_mes, today_brazil()))::date;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query
  select c.id, c.name, d.vencimento, b.mensalidade, d.pago, p.pago_em, p.forma, p.valor
  from companies c
  join platform_billing b on b.company_id = c.id and b.mensalidade > 0
  cross join lateral platform_billing_dues(c.id) d
  left join platform_billing_payments p on p.company_id = c.id and p.competencia = d.competencia
  where d.competencia = v_mes
  order by d.vencimento, c.name;
end;
$$;

-- ---------- 5) Interessados ----------
create table if not exists platform_leads (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  casa text,
  cidade text,
  whatsapp text,
  email text,
  plano_interesse text,
  origem text,
  status text not null default 'novo' check (status in ('novo', 'conversa', 'teste', 'cliente', 'perdido')),
  motivo text,
  observacao text,
  company_id uuid references companies(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table platform_leads enable row level security;
revoke all on platform_leads from anon, authenticated;

create or replace function platform_leads_list()
returns table (id uuid, nome text, casa text, cidade text, whatsapp text, email text, plano_interesse text, origem text,
               status text, motivo text, observacao text, company_id uuid, criado_em timestamptz, atualizado_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query select l.id, l.nome, l.casa, l.cidade, l.whatsapp, l.email, l.plano_interesse, l.origem, l.status, l.motivo,
                      l.observacao, l.company_id, l.criado_em, l.atualizado_em
    from platform_leads l order by (l.status = 'novo') desc, l.criado_em desc;
end;
$$;

create or replace function platform_lead_save(p_dados jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid := nullif(p_dados->>'id', '')::uuid;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if nullif(trim(p_dados->>'nome'), '') is null then raise exception 'Informe o nome.'; end if;
  if v is null then
    insert into platform_leads (nome, casa, cidade, whatsapp, email, plano_interesse, origem, status, motivo, observacao)
    values (trim(p_dados->>'nome'), nullif(trim(p_dados->>'casa'), ''), nullif(trim(p_dados->>'cidade'), ''),
            nullif(trim(p_dados->>'whatsapp'), ''), nullif(trim(p_dados->>'email'), ''), nullif(trim(p_dados->>'plano_interesse'), ''),
            coalesce(nullif(trim(p_dados->>'origem'), ''), 'Cadastro manual'), coalesce(nullif(p_dados->>'status', ''), 'novo'),
            nullif(trim(p_dados->>'motivo'), ''), nullif(trim(p_dados->>'observacao'), ''))
    returning id into v;
  else
    update platform_leads set nome = trim(p_dados->>'nome'), casa = nullif(trim(p_dados->>'casa'), ''),
      cidade = nullif(trim(p_dados->>'cidade'), ''), whatsapp = nullif(trim(p_dados->>'whatsapp'), ''),
      email = nullif(trim(p_dados->>'email'), ''), plano_interesse = nullif(trim(p_dados->>'plano_interesse'), ''),
      origem = coalesce(nullif(trim(p_dados->>'origem'), ''), origem), status = coalesce(nullif(p_dados->>'status', ''), status),
      motivo = nullif(trim(p_dados->>'motivo'), ''), observacao = nullif(trim(p_dados->>'observacao'), ''),
      company_id = coalesce(nullif(p_dados->>'company_id', '')::uuid, company_id), atualizado_em = now()
    where id = v;
    if not found then raise exception 'Interessado não encontrado.'; end if;
  end if;
  return v;
exception when check_violation then raise exception 'Situação inválida.';
end;
$$;

create or replace function platform_lead_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  delete from platform_leads where id = p_id;
end;
$$;

-- ---------- 6) Avisos para todas as casas ----------
create table if not exists platform_announcements (
  id uuid primary key default gen_random_uuid(),
  texto text not null check (length(trim(texto)) > 0 and length(texto) <= 1000),
  plano_id text references platform_plans(id) on update cascade on delete cascade,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null
);
alter table platform_announcements enable row level security;
revoke all on platform_announcements from anon, authenticated;

create or replace function platform_announcement_list()
returns table (id uuid, texto text, plano_id text, criado_em timestamptz, expira_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query select a.id, a.texto, a.plano_id, a.criado_em, a.expira_em from platform_announcements a order by a.criado_em desc limit 50;
end;
$$;

create or replace function platform_announcement_save(p_texto text, p_plano text, p_dias int) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if nullif(trim(p_texto), '') is null then raise exception 'Escreva o aviso.'; end if;
  insert into platform_announcements (texto, plano_id, expira_em)
  values (trim(p_texto), nullif(p_plano, ''), now() + make_interval(days => greatest(least(coalesce(p_dias, 7), 60), 1)))
  returning id into v;
  return v;
exception
  when check_violation then raise exception 'Aviso muito longo (até 1.000 letras).';
  when foreign_key_violation then raise exception 'Plano não encontrado.';
end;
$$;

create or replace function platform_announcement_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  delete from platform_announcements where id = p_id;
end;
$$;

-- Avisos em vigor para a casa de quem está logado (sininho). Só texto do
-- Festou; não revela nada de outras casas.
create or replace function platform_announcements_for_me()
returns table (id uuid, texto text, criado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.texto, a.criado_em from platform_announcements a
  where a.expira_em > now()
    and current_company_id() is not null
    and (a.plano_id is null or a.plano_id = (select b.plano_id from platform_billing b where b.company_id = current_company_id()))
  order by a.criado_em desc limit 5;
$$;

-- ---------- Permissões ----------
revoke all on function platform_plans_list(), platform_plan_save(jsonb), platform_plan_delete(text), platform_billing_plans(),
  platform_set_company_plan(uuid, text), platform_set_company_extras(uuid, text[]), platform_billing_save(uuid, jsonb),
  platform_notes_list(uuid), platform_note_add(uuid, text, text), platform_note_delete(uuid),
  platform_costs_list(), platform_cost_save(jsonb), platform_cost_delete(uuid),
  platform_finance_months(int), platform_finance_charges(date),
  platform_leads_list(), platform_lead_save(jsonb), platform_lead_delete(uuid),
  platform_announcement_list(), platform_announcement_save(text, text, int), platform_announcement_delete(uuid),
  platform_announcements_for_me()
from public, anon;
grant execute on function platform_plans_list(), platform_plan_save(jsonb), platform_plan_delete(text), platform_billing_plans(),
  platform_set_company_plan(uuid, text), platform_set_company_extras(uuid, text[]), platform_billing_save(uuid, jsonb),
  platform_notes_list(uuid), platform_note_add(uuid, text, text), platform_note_delete(uuid),
  platform_costs_list(), platform_cost_save(jsonb), platform_cost_delete(uuid),
  platform_finance_months(int), platform_finance_charges(date),
  platform_leads_list(), platform_lead_save(jsonb), platform_lead_delete(uuid),
  platform_announcement_list(), platform_announcement_save(text, text, int), platform_announcement_delete(uuid),
  platform_announcements_for_me()
to authenticated;

-- As funções "platform_" ficam com o dono atual (enxergam todas as casas).
select fix_definer_owners();

commit;

notify pgrst, 'reload schema';
