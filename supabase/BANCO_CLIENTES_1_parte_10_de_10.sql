-- =========================================================
-- BANCO DOS CLIENTES — ESTRUTURA, PARTE 10 DE 10
-- Rode as partes EM ORDEM (1, 2, 3...), cada uma numa query nova do SQL
-- Editor do projeto NOVO. Se aparecer a pergunta sobre "Row Level Security",
-- escolha rodar SEM o Supabase acrescentar nada (a segurança já está aqui).
-- Cada parte roda inteira ou nada.
-- =========================================================

begin;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'units') then
    raise exception 'Rode antes a parte 1 (e as seguintes, em ordem).';
  end if;
end $$;

-- ---------- Portal do cliente: cronograma ----------
create or replace function portal_get(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  r record;
  v_limit jsonb;
  v_due numeric;
  v_paid numeric;
begin
  if v_res is null then return null; end if;
  select res.*, c.name cliente, u.name unidade, u.full_address, u.pix_key, u.google_review_link, u.extra_hour_price,
         u.guest_min_age, u.menu_deadline_days, u.guest_deadline_days, u.payment_deadline_days, u.playlist_enabled,
         u.parabens_after_min, u.hot_dish_after_parabens_min, u.cake_after_parabens_min, u.portal_rules,
         u.schedule_enabled, u.schedule_items,
         p.name pacote, p.included_items, g.playlist_url
  into r
  from reservations res
  join clients c on c.id = res.client_id
  join units u on u.id = res.unit_id
  left join packages p on p.id = res.package_id
  join guest_list_pages g on g.token = p_token
  where res.id = v_res;

  v_limit := festa_hot_dish_limit(v_res);
  select coalesce(sum(amount), 0) into v_paid from payments where reservation_id = v_res;
  v_due := coalesce(r.final_value, 0)
    + coalesce((select sum(price_snapshot * quantity) from reservation_extra_items where reservation_id = v_res), 0)
    + coalesce((select sum(quantity * unit_price) from reservation_consumption where reservation_id = v_res), 0);

  return jsonb_build_object('cobranca', (select jsonb_build_object('modo', co.billing_mode, 'multa_pct', case when co.late_fees_enabled then co.late_fee_percent else 0 end, 'juros_pct', case when co.late_fees_enabled then co.late_interest_percent else 0 end, 'tolerancia', co.late_grace_days, 'cronograma', festa_installments(v_res)) from companies co where co.id = r.company_id)) || jsonb_build_object(
    'cliente', split_part(r.cliente, ' ', 1),
    'cliente_nome', r.cliente,
    'crianca', r.child_name, 'idade', r.child_age, 'tema', r.theme,
    'data', r.event_date, 'inicio', to_char(r.start_time, 'HH24:MI'), 'fim', to_char(r.end_time, 'HH24:MI'),
    'status', r.status,
    'unidade', r.unidade, 'vila', r.playlist_enabled, 'playlist_habilitada', r.playlist_enabled, 'endereco', r.full_address,
    'pix', r.pix_key, 'google_review_link', r.google_review_link, 'hora_extra', r.extra_hour_price,
    'pacote', r.pacote, 'itens_inclusos', r.included_items,
    'convidados_limite', coalesce(r.guest_count, 0) + coalesce(r.courtesy_guests, 0),
    'pratos_inclusos', (v_limit ->> 'inclusos')::int, 'pratos_adicionais', (v_limit ->> 'adicionais')::int,
    'pratos', case when coalesce(r.hot_dish_flavors, '') = '' then '[]'::jsonb else to_jsonb(array(select trim(x) from unnest(string_to_array(r.hot_dish_flavors, '/')) x where trim(x) <> '')) end,
    'bolo_sabor', r.cake_flavor, 'bolo_massa', r.cake_dough, 'cardapio_confirmado_em', r.menu_confirmed_at, 'cardapio_apos_prazo', coalesce(r.menu_sent_late, false),
    'musica', r.music_choice, 'playlist', r.playlist_url,
    'prazo_cardapio', r.event_date - r.menu_deadline_days, 'prazo_convidados', r.event_date - r.guest_deadline_days, 'prazo_pagamento', r.event_date - r.payment_deadline_days,
    'idade_minima', r.guest_min_age,
    'roteiro', jsonb_build_object('parabens', r.parabens_after_min, 'pratos', r.hot_dish_after_parabens_min, 'bolo', r.cake_after_parabens_min),
    'regras', coalesce(r.portal_rules, '[]'::jsonb),
    'roteiro_ligado', r.schedule_enabled, 'roteiro_itens', coalesce(r.schedule_items, '[]'::jsonb),
    'cardapio', jsonb_build_object('secoes', festa_menu_sections(v_res), 'escolhas', festa_menu_choices(v_res)),
    'empresa', (select jsonb_build_object('nome', co.name, 'logo_url', co.logo_url, 'whatsapp', co.team_whatsapp, 'tema', co.portal_theme) from companies co where co.id = r.company_id),
    'hoje', today_brazil(),
    'festa_terminou', festa_ended(v_res),
    'valor_total', v_due, 'pago', v_paid, 'saldo', greatest(v_due - v_paid, 0),
    'pagamentos', coalesce((select jsonb_agg(jsonb_build_object('data', payment_date, 'valor', amount, 'forma', payment_method, 'obs', notes) order by payment_date, created_at)
                            from payments where reservation_id = v_res), '[]'::jsonb),
    'comprovantes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'valor', amount, 'status', status, 'motivo', reject_reason, 'enviado_em', created_at) order by created_at desc)
                              from portal_receipts where reservation_id = v_res), '[]'::jsonb),
    'contrato', (select jsonb_build_object('gerado_em', generated_at, 'texto', terms_text) from contracts where reservation_id = v_res order by generated_at desc nulls last limit 1),
    'mensagens', coalesce((select jsonb_agg(jsonb_build_object('de_cliente', from_client, 'autor', author_name, 'texto', body, 'em', created_at) order by created_at)
                           from portal_messages where reservation_id = v_res), '[]'::jsonb),
    'historico', coalesce((select jsonb_agg(jsonb_build_object('em', created_at, 'texto', description) order by created_at desc)
                           from (select * from portal_events where reservation_id = v_res order by created_at desc limit 100) e), '[]'::jsonb),
    'avaliou', exists (select 1 from party_reviews pr join review_links rl on rl.token = pr.token where rl.reservation_id = v_res),
    'menu', jsonb_build_object(
      'pratos', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'prato' and active and company_id = r.company_id), '[]'::jsonb),
      'massas', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'bolo_massa' and active and company_id = r.company_id), '[]'::jsonb),
      'sabores', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'bolo_sabor' and active and company_id = r.company_id), '[]'::jsonb)
    )
  );
end;
$$;

grant execute on all functions in schema public to app_definer;

select fix_definer_owners();

-- =========================================================
-- EXCLUIR EMPRESA (painel do administrador geral)
--
-- Só para o banco dos CLIENTES. Na Brava não faz nada (lá não há
-- administrador geral), mas também não precisa rodar.
--
-- 1) platform_delete_company: apaga TODOS os dados de uma empresa.
--    Travas: a empresa precisa estar SUSPENSA e o nome digitado precisa
--    bater. Antes de apagar, monta uma cópia completa dos dados e guarda em
--    platform_deleted_companies (o painel baixa a cópia logo depois e dá
--    para baixar de novo). Devolve a lista de arquivos e de logins da
--    empresa, que a função de servidor "platform-admin" apaga em seguida.
--    Só a função de servidor (service_role) chama; ela confere antes se
--    quem pediu é o administrador geral.
-- 2) Cópias guardadas: listar, baixar e apagar (só o administrador geral).
--
-- Não mexe em nenhuma outra empresa. Roda dentro de uma transação.
-- =========================================================


create table if not exists platform_deleted_companies (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  nome text not null,
  excluida_em timestamptz not null default now(),
  copia jsonb not null,
  arquivos int not null default 0,
  logins int not null default 0
);

alter table platform_deleted_companies enable row level security;

-- sem regras: só pelas funções abaixo
revoke all on platform_deleted_companies from anon, authenticated;

create or replace function platform_delete_company(p_company uuid, p_confirm_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c companies%rowtype;
  v_tabelas text[];
  t text;
  v jsonb;
  v_dados jsonb := '{}'::jsonb;
  v_arquivos jsonb;
  v_logins jsonb;
  v_copia uuid;
  v_falhas int;
  v_volta int := 0;
begin
  select * into c from companies where id = p_company for update;
  if not found then raise exception 'Empresa não encontrada.'; end if;
  if c.active then raise exception 'Suspenda a empresa antes de excluir.'; end if;
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(c.name)) then
    raise exception 'O nome digitado não confere com o nome da empresa.';
  end if;

  -- todas as tabelas que guardam dados por empresa
  select array_agg(cl.relname order by cl.relname) into v_tabelas
  from pg_class cl
  join pg_namespace n on n.oid = cl.relnamespace
  join pg_attribute a on a.attrelid = cl.oid and a.attname = 'company_id' and not a.attisdropped
  where n.nspname = 'public' and cl.relkind = 'r' and cl.relname <> 'companies';

  -- 1) cópia completa
  foreach t in array v_tabelas loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from %I x where company_id = $1', t) into v using p_company;
    if jsonb_array_length(v) > 0 then v_dados := v_dados || jsonb_build_object(t, v); end if;
  end loop;

  -- 2) arquivos (logo, documentos das festas, comprovantes do portal)
  select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'path', o.name)), '[]'::jsonb) into v_arquivos
  from storage.objects o
  where (o.bucket_id = 'marca' and split_part(o.name, '/', 1) = p_company::text)
     or (o.bucket_id = 'festa-documentos' and split_part(o.name, '/', 1) in (select id::text from reservations where company_id = p_company))
     or (o.bucket_id = 'portal-comprovantes' and split_part(o.name, '/', 1) in (select token::text from guest_list_pages where company_id = p_company));

  -- 3) logins da empresa (nunca o do administrador geral)
  select coalesce(jsonb_agg(distinct u), '[]'::jsonb) into v_logins
  from (
    select user_id u from company_members where company_id = p_company
    union select id from user_profiles where company_id = p_company
  ) x
  where not exists (select 1 from platform_admins a where a.user_id = x.u);

  insert into platform_deleted_companies (empresa_id, nome, copia, arquivos, logins)
  values (c.id, c.name, jsonb_build_object(
      'sistema', 'Gestão de Festas', 'versao', 1, 'gerada_em', now(),
      'empresa', to_jsonb(c), 'tabelas', v_dados, 'arquivos', v_arquivos),
    jsonb_array_length(v_arquivos), jsonb_array_length(v_logins))
  returning id into v_copia;

  -- 4) apaga, sem histórico nem gatilhos; as ligações entre tabelas
  --    continuam valendo, então repete até não sobrar nada
  foreach t in array v_tabelas || array['companies'] loop
    execute format('alter table %I disable trigger user', t);
  end loop;
  loop
    v_volta := v_volta + 1;
    v_falhas := 0;
    foreach t in array v_tabelas loop
      begin
        execute format('delete from %I where company_id = $1', t) using p_company;
      exception when foreign_key_violation then
        v_falhas := v_falhas + 1;
      end;
    end loop;
    exit when v_falhas = 0;
    if v_volta >= 40 then raise exception 'Não foi possível apagar todos os dados da empresa (ligações entre tabelas).'; end if;
  end loop;
  delete from companies where id = p_company;
  foreach t in array v_tabelas || array['companies'] loop
    execute format('alter table %I enable trigger user', t);
  end loop;

  return jsonb_build_object('copia_id', v_copia, 'arquivos', v_arquivos, 'logins', v_logins);
end;
$$;

revoke all on function platform_delete_company(uuid, text) from public, anon, authenticated;

grant execute on function platform_delete_company(uuid, text) to service_role;

create or replace function platform_list_deleted_companies()
returns table (id uuid, nome text, excluida_em timestamptz, arquivos int, logins int, tamanho_kb int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query
    select d.id, d.nome, d.excluida_em, d.arquivos, d.logins, (pg_column_size(d.copia) / 1024)::int
    from platform_deleted_companies d order by d.excluida_em desc;
end;
$$;

create or replace function platform_deleted_company_copy(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return (select copia from platform_deleted_companies where id = p_id);
end;
$$;

create or replace function platform_drop_deleted_copy(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  delete from platform_deleted_companies where id = p_id;
end;
$$;

revoke all on function platform_list_deleted_companies(), platform_deleted_company_copy(uuid), platform_drop_deleted_copy(uuid) from public, anon;

grant execute on function platform_list_deleted_companies(), platform_deleted_company_copy(uuid), platform_drop_deleted_copy(uuid) to authenticated;

select fix_definer_owners();

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

alter table platform_billing enable row level security;

-- sem regras: só pelas funções do painel
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

-- =========================================================
-- CARDÁPIO POR PACOTE
--
-- Cada opção do cardápio do portal (ex.: "Camarão", "Bolo de nozes") pode
-- valer para todos os pacotes (como hoje) ou só para os pacotes escolhidos.
-- O portal da festa mostra só as opções do pacote daquela festa, e o envio
-- do cardápio só aceita essas opções.
-- Se uma seção ficar sem nenhuma opção para o pacote da festa (e não aceitar
-- "outro"), ela não aparece para essa festa.
--
-- Rodar nos DOIS bancos (Brava e clientes). Nada muda até alguém escolher
-- pacotes numa opção: todas as opções existentes continuam em todos os pacotes.
-- Roda numa transação.
-- =========================================================


alter table portal_menu_options add column if not exists package_ids uuid[];

comment on column portal_menu_options.package_ids is 'Pacotes em que a opção aparece; vazio = todos os pacotes';

create or replace function festa_menu_sections(p_reservation uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'nome', x.name, 'ajuda', x.help, 'modo', x.mode,
      'quantidade', menu_section_quantity(x.id, p_reservation),
      'outro', x.allow_other, 'outro_rotulo', x.other_label, 'campo', x.legacy_field,
      'opcoes', x.opcoes
    ) order by x.sort, x.created_at), '[]'::jsonb)
  from (
    select s.*,
           coalesce((select jsonb_agg(o.name order by o.sort, o.name) from portal_menu_options o
                     where o.section_id = s.id and o.active
                       and (o.package_ids is null or cardinality(o.package_ids) = 0 or r.package_id = any(o.package_ids))), '[]'::jsonb) opcoes,
           exists (select 1 from portal_menu_options o where o.section_id = s.id and o.active) tem_opcoes
    from menu_sections s
    join reservations r on r.id = p_reservation
    where s.active and s.company_id = r.company_id and (s.unit_id is null or s.unit_id = r.unit_id)
  ) x
  -- seção cujas opções são todas de outros pacotes some para esta festa
  where jsonb_array_length(x.opcoes) > 0 or x.allow_other or not x.tem_opcoes;
$$;

revoke all on function festa_menu_sections(uuid) from public, anon, authenticated;

select fix_definer_owners();

-- =========================================================
-- LIMPEZA: nenhum dado da Brava (nem de ninguém) fica no banco novo.
-- =========================================================
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('truncate table %I cascade', t);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
