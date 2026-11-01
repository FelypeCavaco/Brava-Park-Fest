-- =========================================================
-- MENSALIDADES, IMPLANTAÇÃO, CONTRATO DO SISTEMA, TROCA DE SENHA E EXPORTAÇÃO
--
-- Pode rodar nos DOIS bancos (Brava e clientes). Na Brava, as partes do
-- painel da plataforma ficam sem uso (lá não há administrador geral).
--
-- 1) Troca de senha no primeiro acesso: todo login novo criado por outra
--    pessoa (funcionário ou administrador de empresa nova) precisa trocar a
--    senha provisória ao entrar. Quem já existe não é afetado.
-- 2) Mensalidades (painel da plataforma): valor, dia de vencimento e início
--    de cada empresa; pagamentos por mês; situação (em dia / vence logo /
--    atrasada).
-- 3) Implantação: o que já foi configurado em cada empresa (automático) e
--    itens marcados à mão (treinamento, login entregue).
-- 4) Contrato do sistema: os seus dados (contratada) e os dados da empresa
--    para gerar o contrato em PDF pelo painel.
-- 5) Exportar dados: o administrador de cada empresa baixa todos os dados
--    dela em planilha.
-- 6) Nome do produto no banco dos clientes: "Festou".
--
-- Não altera festas, pagamentos ou valores existentes. Roda numa transação.
-- =========================================================

begin;

-- ---------- 1) Troca de senha no primeiro acesso ----------
alter table user_profiles add column if not exists must_change_password boolean not null default false;
-- quem já existe fica com "false"; daqui em diante, todo perfil novo nasce com "true"
alter table user_profiles alter column must_change_password set default true;

create or replace function password_changed() returns void
language plpgsql security definer set search_path = public as $$
begin
  update user_profiles set must_change_password = false where id = auth.uid() and must_change_password;
end;
$$;
revoke all on function password_changed() from public, anon;
grant execute on function password_changed() to authenticated;

-- ---------- 2) Mensalidades ----------
create table if not exists platform_billing (
  company_id uuid primary key references companies(id) on delete cascade,
  plano text,
  mensalidade numeric(10,2) not null default 0 check (mensalidade >= 0),
  dia_vencimento int not null default 10 check (dia_vencimento between 1 and 28),
  inicio date not null default current_date,
  implantacao numeric(10,2) not null default 0 check (implantacao >= 0),
  unidade_adicional numeric(10,2) not null default 0 check (unidade_adicional >= 0),
  unidades_incluidas int not null default 1 check (unidades_incluidas >= 1),
  usuarios_incluidos int check (usuarios_incluidos is null or usuarios_incluidos >= 1),
  observacao text,
  checklist jsonb not null default '{}'::jsonb
);
alter table platform_billing enable row level security; -- sem regras: só pelas funções do painel
revoke all on platform_billing from anon, authenticated;

create table if not exists platform_billing_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  competencia date not null check (competencia = date_trunc('month', competencia)::date),
  valor numeric(10,2) not null check (valor > 0),
  pago_em date not null default current_date,
  forma text,
  criado_em timestamptz not null default now(),
  unique (company_id, competencia)
);
alter table platform_billing_payments enable row level security;
revoke all on platform_billing_payments from anon, authenticated;

-- Vencimentos de uma empresa: do início até o mês que vem, com o que foi pago.
create or replace function platform_billing_dues(p_company uuid)
returns table (vencimento date, competencia date, pago boolean)
language sql stable security definer set search_path = public as $$
  with b as (
    select inicio, dia_vencimento from platform_billing where company_id = p_company
  ), primeiro as (
    select case when make_date(extract(year from inicio)::int, extract(month from inicio)::int, dia_vencimento) >= inicio
                then make_date(extract(year from inicio)::int, extract(month from inicio)::int, dia_vencimento)
                else (make_date(extract(year from inicio)::int, extract(month from inicio)::int, dia_vencimento) + interval '1 month')::date end d
    from b
  )
  select s::date, date_trunc('month', s)::date,
         exists (select 1 from platform_billing_payments p where p.company_id = p_company and p.competencia = date_trunc('month', s)::date)
  from primeiro, generate_series(primeiro.d, (today_brazil() + interval '1 month')::date, interval '1 month') s;
$$;
revoke all on function platform_billing_dues(uuid) from public, anon, authenticated;

create or replace function platform_billing_list()
returns table (company_id uuid, cadastrada boolean, plano text, mensalidade numeric, dia_vencimento int, inicio date,
               implantacao numeric, unidade_adicional numeric, unidades_incluidas int, usuarios_incluidos int, observacao text,
               proximo_vencimento date, meses_em_aberto int, valor_em_aberto numeric, dias_atraso int, situacao text, ultimo_pagamento date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query
  select c.id, b.company_id is not null, b.plano, b.mensalidade, b.dia_vencimento, b.inicio,
         b.implantacao, b.unidade_adicional, b.unidades_incluidas, b.usuarios_incluidos, b.observacao,
         x.prox, coalesce(x.abertos, 0), coalesce(x.abertos, 0) * coalesce(b.mensalidade, 0), coalesce(x.atraso, 0),
         case when b.company_id is null then 'sem_cadastro'
              when b.mensalidade = 0 then 'sem_cobranca'
              when coalesce(x.atraso, 0) > 0 then 'atrasada'
              when x.prox = today_brazil() then 'vence_hoje'
              when x.prox <= today_brazil() + 5 then 'vence_logo'
              else 'em_dia' end,
         (select max(p.pago_em) from platform_billing_payments p where p.company_id = c.id)
  from companies c
  left join platform_billing b on b.company_id = c.id
  left join lateral (
    select min(d.vencimento) filter (where not d.pago) prox,
           count(*) filter (where not d.pago and d.vencimento <= today_brazil())::int abertos,
           coalesce(today_brazil() - min(d.vencimento) filter (where not d.pago and d.vencimento < today_brazil()), 0)::int atraso
    from platform_billing_dues(c.id) d
  ) x on b.company_id is not null
  order by c.created_at;
end;
$$;

create or replace function platform_billing_save(p_company uuid, p_dados jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if not exists (select 1 from companies where id = p_company) then raise exception 'Empresa não encontrada.'; end if;
  insert into platform_billing (company_id, plano, mensalidade, dia_vencimento, inicio, implantacao, unidade_adicional,
                                unidades_incluidas, usuarios_incluidos, observacao)
  values (p_company, nullif(trim(p_dados->>'plano'), ''), coalesce((p_dados->>'mensalidade')::numeric, 0),
          coalesce((p_dados->>'dia_vencimento')::int, 10), coalesce((p_dados->>'inicio')::date, today_brazil()),
          coalesce((p_dados->>'implantacao')::numeric, 0), coalesce((p_dados->>'unidade_adicional')::numeric, 0),
          coalesce((p_dados->>'unidades_incluidas')::int, 1), nullif(p_dados->>'usuarios_incluidos', '')::int,
          nullif(trim(p_dados->>'observacao'), ''))
  on conflict (company_id) do update set
    plano = excluded.plano, mensalidade = excluded.mensalidade, dia_vencimento = excluded.dia_vencimento,
    inicio = excluded.inicio, implantacao = excluded.implantacao, unidade_adicional = excluded.unidade_adicional,
    unidades_incluidas = excluded.unidades_incluidas, usuarios_incluidos = excluded.usuarios_incluidos,
    observacao = excluded.observacao;
exception
  when check_violation then raise exception 'Confira os valores: dia de vencimento de 1 a 28, valores sem números negativos.';
  when invalid_text_representation or invalid_datetime_format then raise exception 'Confira os valores digitados.';
end;
$$;

-- Registra o pagamento de um mês (sem mês informado: o mais antigo em aberto).
create or replace function platform_billing_pay(p_company uuid, p_competencia date, p_valor numeric, p_pago_em date, p_forma text) returns date
language plpgsql security definer set search_path = public as $$
declare v_comp date;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if not exists (select 1 from platform_billing where company_id = p_company) then raise exception 'Cadastre antes a mensalidade da empresa.'; end if;
  v_comp := coalesce(date_trunc('month', p_competencia)::date,
                     (select min(d.competencia) from platform_billing_dues(p_company) d where not d.pago));
  if v_comp is null then raise exception 'Não há mês em aberto.'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor.'; end if;
  if exists (select 1 from platform_billing_payments where company_id = p_company and competencia = v_comp) then
    raise exception 'O mês % já está pago.', to_char(v_comp, 'MM/YYYY');
  end if;
  insert into platform_billing_payments (company_id, competencia, valor, pago_em, forma)
  values (p_company, v_comp, round(p_valor, 2), coalesce(p_pago_em, today_brazil()), nullif(trim(p_forma), ''));
  return v_comp;
end;
$$;

create or replace function platform_billing_history(p_company uuid)
returns table (id uuid, competencia date, valor numeric, pago_em date, forma text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query select p.id, p.competencia, p.valor, p.pago_em, p.forma
    from platform_billing_payments p where p.company_id = p_company order by p.competencia desc;
end;
$$;

create or replace function platform_billing_undo(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  delete from platform_billing_payments where id = p_id;
end;
$$;

-- ---------- 3) Implantação ----------
create or replace function platform_setup_status()
returns table (company_id uuid, itens jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query
  select c.id, jsonb_build_object(
    'unidades', exists (select 1 from units u where u.company_id = c.id and u.active),
    'dados_unidades', exists (select 1 from units u where u.company_id = c.id and u.active)
                      and not exists (select 1 from units u where u.company_id = c.id and u.active
                                      and (coalesce(trim(u.legal_name), '') = '' or coalesce(trim(u.cnpj), '') = ''
                                           or coalesce(trim(u.full_address), '') = '' or coalesce(trim(u.pix_key), '') = '')),
    'pacotes', exists (select 1 from packages p where p.company_id = c.id and p.active),
    'contrato_base', exists (select 1 from contract_templates t where t.company_id = c.id),
    'cardapio', exists (select 1 from menu_sections m where m.company_id = c.id),
    'logo', coalesce(trim(c.logo_url), '') <> '',
    'whatsapp', coalesce(trim(c.team_whatsapp), '') <> '',
    'avaliacao_google', exists (select 1 from units u where u.company_id = c.id and u.active)
                        and not exists (select 1 from units u where u.company_id = c.id and u.active and coalesce(trim(u.google_review_link), '') = ''),
    'equipe', (select count(*) from user_profiles p where p.company_id = c.id and p.active) >= 2,
    'primeira_festa', exists (select 1 from reservations r where r.company_id = c.id),
    'manual', coalesce((select b.checklist from platform_billing b where b.company_id = c.id), '{}'::jsonb)
  )
  from companies c;
end;
$$;

create or replace function platform_setup_mark(p_company uuid, p_item text, p_feito boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if p_item not in ('treinamento', 'login_entregue', 'contrato_assinado') then raise exception 'Item desconhecido.'; end if;
  insert into platform_billing (company_id, checklist) values (p_company, jsonb_build_object(p_item, p_feito))
  on conflict (company_id) do update set checklist = platform_billing.checklist || jsonb_build_object(p_item, p_feito);
end;
$$;

-- ---------- 4) Contrato do sistema ----------
alter table platform_settings add column if not exists contratada_nome text;
alter table platform_settings add column if not exists contratada_documento text;
alter table platform_settings add column if not exists contratada_endereco text;
alter table platform_settings add column if not exists contratada_email text;
alter table platform_settings add column if not exists contratada_whatsapp text;
alter table platform_settings add column if not exists suporte_horario text;
alter table platform_settings add column if not exists foro text;

create or replace function platform_get_contract_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return coalesce((select jsonb_build_object(
    'contratada_nome', s.contratada_nome, 'contratada_documento', s.contratada_documento,
    'contratada_endereco', s.contratada_endereco, 'contratada_email', s.contratada_email,
    'contratada_whatsapp', s.contratada_whatsapp, 'suporte_horario', s.suporte_horario, 'foro', s.foro)
    from platform_settings s limit 1), '{}'::jsonb);
end;
$$;

create or replace function platform_save_contract_settings(p_dados jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if not exists (select 1 from platform_settings) then
    insert into platform_settings (name) values ('Festou');
  end if;
  update platform_settings set
    contratada_nome = nullif(trim(p_dados->>'contratada_nome'), ''),
    contratada_documento = nullif(trim(p_dados->>'contratada_documento'), ''),
    contratada_endereco = nullif(trim(p_dados->>'contratada_endereco'), ''),
    contratada_email = nullif(trim(p_dados->>'contratada_email'), ''),
    contratada_whatsapp = nullif(trim(p_dados->>'contratada_whatsapp'), ''),
    suporte_horario = nullif(trim(p_dados->>'suporte_horario'), ''),
    foro = nullif(trim(p_dados->>'foro'), '');
end;
$$;

-- Dados da empresa para o contrato: a primeira unidade ativa (razão social,
-- CNPJ, endereço, responsável), quantas unidades tem e o plano cadastrado.
create or replace function platform_contract_data(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  select jsonb_build_object(
    'empresa', c.name,
    'unidade', (select jsonb_build_object('razao_social', u.legal_name, 'cnpj', u.cnpj, 'endereco', u.full_address, 'responsavel', u.responsible_name)
                from units u where u.company_id = c.id and u.active order by u.sort, u.name limit 1),
    'unidades', (select count(*) from units u where u.company_id = c.id and u.active),
    'plano', (select to_jsonb(b) - 'checklist' - 'company_id' from platform_billing b where b.company_id = c.id),
    'desligados', to_jsonb(c.disabled_modules))
  into v from companies c where c.id = p_company;
  if v is null then raise exception 'Empresa não encontrada.'; end if;
  return v;
end;
$$;

revoke all on function platform_billing_list(), platform_billing_save(uuid, jsonb), platform_billing_pay(uuid, date, numeric, date, text),
  platform_billing_history(uuid), platform_billing_undo(uuid), platform_setup_status(), platform_setup_mark(uuid, text, boolean),
  platform_get_contract_settings(), platform_save_contract_settings(jsonb), platform_contract_data(uuid) from public, anon;
grant execute on function platform_billing_list(), platform_billing_save(uuid, jsonb), platform_billing_pay(uuid, date, numeric, date, text),
  platform_billing_history(uuid), platform_billing_undo(uuid), platform_setup_status(), platform_setup_mark(uuid, text, boolean),
  platform_get_contract_settings(), platform_save_contract_settings(jsonb), platform_contract_data(uuid) to authenticated;

-- ---------- 5) Exportar os dados da própria empresa ----------
-- Só o administrador da empresa. Passa pelas regras de cada tabela, então
-- só sai o que é da empresa de quem pediu.
create or replace function company_export() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t text;
  v jsonb;
  v_dados jsonb := '{}'::jsonb;
  v_company uuid := current_company_id();
begin
  if v_company is null or not is_admin_user(auth.uid()) then raise exception 'Só o administrador da empresa pode exportar os dados.'; end if;
  for t in
    select cl.relname from pg_class cl
    join pg_namespace n on n.oid = cl.relnamespace
    join pg_attribute a on a.attrelid = cl.oid and a.attname = 'company_id' and not a.attisdropped
    where n.nspname = 'public' and cl.relkind = 'r'
      and cl.relname not in ('companies', 'company_members') and cl.relname not like 'platform\_%'
    order by cl.relname
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from %I x where company_id = $1', t) into v using v_company;
    if jsonb_array_length(v) > 0 then v_dados := v_dados || jsonb_build_object(t, v); end if;
  end loop;
  return jsonb_build_object('gerada_em', now(), 'empresa', (select to_jsonb(c) from companies c where c.id = v_company), 'tabelas', v_dados);
end;
$$;
revoke all on function company_export() from public, anon;
grant execute on function company_export() to authenticated;

-- ---------- 6) Nome do produto no banco dos clientes ----------
update platform_settings set name = 'Festou', tagline = coalesce(tagline, 'Sistema para casas de festa')
where name = 'Gestão de Festas';

grant execute on all functions in schema public to app_definer;
select fix_definer_owners();

commit;

notify pgrst, 'reload schema';
