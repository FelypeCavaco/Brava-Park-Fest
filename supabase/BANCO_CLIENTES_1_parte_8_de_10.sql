-- =========================================================
-- BANCO DOS CLIENTES — ESTRUTURA, PARTE 8 DE 10
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

-- Brava: o cardápio de hoje vira 3 seções (só se ainda não há seções e já
-- existem opções do modelo antigo — num banco novo não cria nada).
do $$
declare v_p uuid; v_m uuid; v_s uuid;
begin
  if not exists (select 1 from menu_sections) and exists (select 1 from portal_menu_options where kind is not null) then
    insert into menu_sections (name, mode, legacy_field, sort)
      values ('Pratos quentes', 'pacote', 'hot_dish_flavors', 1) returning id into v_p;
    insert into menu_sections (name, mode, legacy_field, sort)
      values ('Massa do bolo', 'uma', 'cake_dough', 2) returning id into v_m;
    insert into menu_sections (name, mode, allow_other, other_label, legacy_field, sort)
      values ('Recheio do bolo', 'uma', true, 'Outro sabor (combinar com a equipe)', 'cake_flavor', 3) returning id into v_s;
    update portal_menu_options set section_id = case kind when 'prato' then v_p when 'bolo_massa' then v_m when 'bolo_sabor' then v_s end
    where section_id is null and kind is not null;
  end if;
end $$;

-- Brava: roteiro de hoje (parabéns 90 min, pratos +10, bolo +30).
update units u set
  schedule_enabled = true,
  schedule_items = jsonb_build_array(
    jsonb_build_object('titulo', 'Parabéns', 'detalhe', '', 'ref', 'inicio', 'minutos', u.parabens_after_min, 'secao', null),
    jsonb_build_object('titulo', 'Pratos quentes', 'detalhe', 'Servidos logo após o parabéns.', 'ref', 'inicio', 'minutos', u.parabens_after_min + u.hot_dish_after_parabens_min,
                       'secao', (select id from menu_sections where legacy_field = 'hot_dish_flavors')),
    jsonb_build_object('titulo', 'Bolo', 'detalhe', 'Servido 30 minutos após o parabéns.', 'ref', 'inicio', 'minutos', u.parabens_after_min + u.cake_after_parabens_min, 'secao', null)
  )
where u.code in ('vila-operaria', 'sao-vicente') and u.schedule_items = '[]'::jsonb;

-- ---------- Funções do cardápio ----------

-- Quantas escolhas a festa faz numa seção.
create or replace function menu_section_quantity(p_section uuid, p_reservation uuid) returns int
language sql stable security definer set search_path = public as $$
  select case s.mode
    when 'uma' then 1
    when 'varias' then s.quantity
    else (select (l ->> 'inclusos')::int + (l ->> 'adicionais')::int from (select festa_hot_dish_limit(p_reservation) l) x)
  end
  from menu_sections s where s.id = p_section;
$$;

-- Seções que valem para a festa (pela unidade), com opções e quantidade.
create or replace function festa_menu_sections(p_reservation uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'nome', s.name, 'ajuda', s.help, 'modo', s.mode,
      'quantidade', menu_section_quantity(s.id, p_reservation),
      'outro', s.allow_other, 'outro_rotulo', s.other_label, 'campo', s.legacy_field,
      'opcoes', coalesce((select jsonb_agg(o.name order by o.sort, o.name) from portal_menu_options o where o.section_id = s.id and o.active), '[]'::jsonb)
    ) order by s.sort, s.created_at), '[]'::jsonb)
  from menu_sections s
  join reservations r on r.id = p_reservation
  where s.active and (s.unit_id is null or s.unit_id = r.unit_id);
$$;

-- Escolhas da festa por seção. Seções ligadas a campo antigo leem desse
-- campo (a equipe pode ter editado lá); as outras, de menu_choices.
create or replace function festa_menu_choices(p_reservation uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(s.id::text,
      case s.legacy_field
        when 'hot_dish_flavors' then case when coalesce(r.hot_dish_flavors, '') = '' then '[]'::jsonb
             else to_jsonb(array(select trim(x) from unnest(string_to_array(r.hot_dish_flavors, '/')) x where trim(x) <> '')) end
        when 'cake_dough' then case when coalesce(r.cake_dough, '') = '' then '[]'::jsonb else jsonb_build_array(r.cake_dough) end
        when 'cake_flavor' then case when coalesce(r.cake_flavor, '') = '' then '[]'::jsonb else jsonb_build_array(r.cake_flavor) end
        else coalesce(r.menu_choices -> s.id::text, '[]'::jsonb)
      end), '{}'::jsonb)
  from menu_sections s
  join reservations r on r.id = p_reservation
  where s.active and (s.unit_id is null or s.unit_id = r.unit_id);
$$;

-- Resumo em texto (Central da festa, relatórios): "Pratos quentes: A, B · Massa do bolo: X".
create or replace function festas_menu_resumo(p_reservations uuid[]) returns table (reservation_id uuid, resumo text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_active_user(auth.uid()) then raise exception 'Sem permissão'; end if;
  return query
  select r.id, (
    select string_agg(sec ->> 'nome' || ': ' || coalesce(nullif((select string_agg(v, ', ') from jsonb_array_elements_text(festa_menu_choices(r.id) -> (sec ->> 'id')) v), ''), '—'), ' · ')
    from jsonb_array_elements(festa_menu_sections(r.id)) sec
    where (sec ->> 'quantidade')::int > 0
  )
  from reservations r where r.id = any(p_reservations);
end;
$$;

-- Cliente salva o cardápio pelo portal. p_escolhas = { "<id da seção>": ["opção", ...] }.
create or replace function portal_save_menu_choices(p_token uuid, p_escolhas jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_date date;
  v_dias int;
  v_late boolean;
  sec jsonb;
  v_vals text[];
  v_qtd int;
  v_choices jsonb := '{}'::jsonb;
  v_resumo text[] := '{}';
  v_hot text; v_dough text; v_flavor text;
  v_set_hot boolean := false; v_set_dough boolean := false; v_set_flavor boolean := false;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  select r.event_date, u.menu_deadline_days into v_date, v_dias from reservations r join units u on u.id = r.unit_id where r.id = v_res;
  if today_brazil() > v_date then
    raise exception 'A festa já aconteceu. Para alterar o cardápio, fale com a equipe.';
  end if;
  if jsonb_array_length(festa_menu_sections(v_res)) = 0 then raise exception 'Esta festa não tem cardápio para escolher.'; end if;
  v_late := today_brazil() > v_date - v_dias;

  for sec in select * from jsonb_array_elements(festa_menu_sections(v_res)) loop
    v_qtd := (sec ->> 'quantidade')::int;
    select coalesce(array_agg(distinct left(trim(x), 200)), '{}') into v_vals
    from jsonb_array_elements_text(coalesce(p_escolhas -> (sec ->> 'id'), '[]'::jsonb)) x where trim(x) <> '';
    if coalesce(array_length(v_vals, 1), 0) <> v_qtd then
      raise exception '%: escolha %.', sec ->> 'nome', case when v_qtd = 1 then '1 opção' else v_qtd || ' opções' end;
    end if;
    if exists (select 1 from unnest(v_vals) v
               where not (sec -> 'opcoes') ? v
                 and not ((sec ->> 'outro')::boolean and v = sec ->> 'outro_rotulo')) then
      raise exception '%: opção inválida.', sec ->> 'nome';
    end if;
    v_choices := v_choices || jsonb_build_object(sec ->> 'id', to_jsonb(v_vals));
    if v_qtd > 0 then v_resumo := v_resumo || ((sec ->> 'nome') || ': ' || array_to_string(v_vals, ', ')); end if;
    case sec ->> 'campo'
      when 'hot_dish_flavors' then v_hot := nullif(array_to_string(v_vals, ' / '), ''); v_set_hot := true;
      when 'cake_dough' then v_dough := v_vals[1]; v_set_dough := true;
      when 'cake_flavor' then v_flavor := v_vals[1]; v_set_flavor := true;
      else null;
    end case;
  end loop;

  perform set_config('app.audit_actor', 'Cliente (portal)', true);
  update reservations set
    menu_choices = v_choices,
    hot_dish_flavors = case when v_set_hot then v_hot else hot_dish_flavors end,
    cake_dough = case when v_set_dough then v_dough else cake_dough end,
    cake_flavor = case when v_set_flavor then v_flavor else cake_flavor end,
    menu_confirmed_at = now(),
    menu_sent_late = v_late
  where id = v_res;
  perform set_config('app.audit_actor', '', true);
  perform portal_log(v_res, 'cardapio',
    case when v_late then 'Enviou o cardápio APÓS O PRAZO (' || to_char(v_date - v_dias, 'DD/MM') || '): ' else 'Confirmou o cardápio: ' end
    || coalesce(nullif(array_to_string(v_resumo, ' · '), ''), 'sem escolhas'));
end;
$$;

revoke all on function menu_section_quantity(uuid, uuid) from public, anon, authenticated;

revoke all on function festa_menu_sections(uuid) from public, anon, authenticated;

revoke all on function festa_menu_choices(uuid) from public, anon, authenticated;

revoke all on function festas_menu_resumo(uuid[]) from public, anon;

grant execute on function festas_menu_resumo(uuid[]) to authenticated;

revoke all on function portal_save_menu_choices(uuid, jsonb) from public;

grant execute on function portal_save_menu_choices(uuid, jsonb) to anon, authenticated;

-- ---------- portal_get: roteiro e cardápio novos ----------
-- (mantém tudo o que já devolvia, para a tela atual continuar funcionando)
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

  return jsonb_build_object(
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
    'empresa', (select jsonb_build_object('nome', co.name, 'logo_url', co.logo_url, 'whatsapp', co.team_whatsapp, 'tema', co.portal_theme) from companies co order by co.created_at limit 1),
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
      'pratos', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'prato' and active), '[]'::jsonb),
      'massas', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'bolo_massa' and active), '[]'::jsonb),
      'sabores', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'bolo_sabor' and active), '[]'::jsonb)
    )
  );
end;
$$;

-- =========================================================
-- VÁRIAS EMPRESAS NO MESMO BANCO (venda do sistema — Etapa 3)
--
-- Prepara o banco para guardar várias casas de festa, cada uma vendo só os
-- próprios dados. Na Brava (banco próprio, uma empresa só) nada muda na
-- prática: tudo é marcado como da Brava.
--
-- Como funciona:
-- 1) Cada usuário pertence a uma empresa (company_members, preenchida a
--    partir de user_profiles.company_id). current_company_id() = empresa de
--    quem está logado.
-- 2) TODAS as tabelas ganham company_id (obrigatório). Ao gravar, o banco
--    preenche sozinho: empresa de quem está logado; em gravação do portal
--    (sem login), a empresa da festa; num banco com uma empresa só, ela.
--    O banco também recusa ligar um registro a algo de outra empresa (ex.:
--    pagamento numa festa de outra empresa) e trocar a empresa de um registro.
-- 3) Bloqueio no próprio banco: uma regra "restritiva" em todas as tabelas
--    só deixa ver, criar, alterar ou apagar o que é da empresa de quem está
--    logado. Ela soma às permissões que já existem (não substitui).
-- 4) As funções que leem dados "por cima" das permissões (relatórios,
--    financeiro, comissões, portal...) passam a rodar com um papel próprio
--    (app_definer), que também obedece ao bloqueio entre empresas. Ficam de
--    fora só as que respondem "sim/não" sobre o próprio usuário (permissões).
-- 5) Regras de "não pode repetir" passam a valer por empresa (nome de
--    perfil, apelido de unidade, opções do cardápio, modelos de mensagem,
--    taxas por forma de pagamento, configuração de comissão).
-- 6) Arquivos: documentos da festa e comprovantes só abrem para a empresa
--    dona da festa; a logo só é enviada na pasta da própria empresa.
--
-- Não altera valores de festas, pagamentos, clientes ou contas: só marca a
-- empresa em cada registro (sem disparar histórico nem travas).
-- Roda dentro de uma transação.
-- =========================================================


-- ---------- 0) Papel das funções que leem por cima das permissões ----------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_definer') then
    create role app_definer nologin;
  end if;
end $$;

grant app_definer to current_user;

grant authenticated to app_definer;

grant usage on schema public to app_definer;

-- algumas funções (ex.: repasse de comissões) usam tabela temporária
-- (no Supabase todos já podem; se o usuário não puder repassar, segue sem travar)
do $$
begin
  execute format('grant temporary on database %I to app_definer', current_database());
exception when others then
  raise notice 'Permissão de tabela temporária não repassada (já é liberada para todos): %', sqlerrm;
end $$;

grant all on all tables in schema public to app_definer;

grant all on all sequences in schema public to app_definer;

alter default privileges in schema public grant all on tables to app_definer;

alter default privileges in schema public grant all on sequences to app_definer;

-- ---------- 1) Empresa de cada usuário ----------
create table if not exists company_members (
  user_id uuid primary key,
  company_id uuid not null references companies(id) on delete cascade
);

alter table company_members enable row level security;

-- sem regras: ninguém lê pela internet
revoke all on company_members from anon, authenticated;

create or replace function current_company_id() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from company_members where user_id = auth.uid();
$$;

revoke all on function current_company_id() from public;

grant execute on function current_company_id() to anon, authenticated, app_definer;

-- Preenche e confere a empresa de cada registro.
create or replace function set_company_id() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j jsonb := to_jsonb(new);
  v uuid := new.company_id;
  m record;
  v_pai uuid;
begin
  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id then
    raise exception 'Não é possível mudar a empresa de um registro.';
  end if;
  if v is null then v := current_company_id(); end if;
  if v is null and j ? 'reservation_id' and j ->> 'reservation_id' is not null then
    select company_id into v from reservations where id = (j ->> 'reservation_id')::uuid;
  end if;
  if v is null and tg_table_name = 'guest_list_entries' then
    select company_id into v from guest_list_pages where token = (j ->> 'token')::uuid;
  end if;
  if v is null and tg_table_name = 'party_reviews' then
    select company_id into v from review_links where token = (j ->> 'token')::uuid;
  end if;
  if v is null and (select count(*) from companies) = 1 then
    select id into v from companies;
  end if;
  if v is null then
    raise exception 'Não foi possível identificar a empresa deste registro (%).', tg_table_name;
  end if;
  new.company_id := v;
  -- Não deixa ligar a algo de outra empresa.
  for m in select * from (values
    ('reservation_id', 'reservations'), ('unit_id', 'units'), ('client_id', 'clients'), ('package_id', 'packages'),
    ('space_id', 'spaces'), ('role_id', 'roles'), ('section_id', 'menu_sections'), ('supplier_id', 'suppliers')
  ) x(col, tab) loop
    if j ? m.col and j ->> m.col is not null and tg_table_name <> m.tab then
      execute format('select company_id from %I where id = $1', m.tab) into v_pai using (j ->> m.col)::uuid;
      if v_pai is not null and v_pai <> v then
        raise exception 'Registro de outra empresa (%).', m.col;
      end if;
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function set_company_id() from public, anon, authenticated;

-- ---------- 2) company_id em todas as tabelas ----------
do $$
declare
  v_brava uuid := (select id from companies order by created_at limit 1);
  t text;
begin
  if v_brava is null then raise exception 'Rode antes a migração 068 (empresa).'; end if;
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('companies', 'company_members')
    order by c.relname
  loop
    execute format('alter table %I add column if not exists company_id uuid references companies(id)', t);
    -- marca o que já existe como da Brava sem disparar histórico nem travas
    execute format('alter table %I disable trigger user', t);
    execute format('update %I set company_id = %L where company_id is null', t, v_brava);
    execute format('alter table %I enable trigger user', t);
    execute format('alter table %I alter column company_id set not null', t);
    -- valor padrão também (tabelas de rascunho copiadas com "like" não têm o gatilho)
    execute format('alter table %I alter column company_id set default current_company_id()', t);
    execute format('create index if not exists %I on %I (company_id)', 'idx_' || t || '_company', t);
    execute format('drop trigger if exists trg_set_company_id on %I', t);
    execute format('create trigger trg_set_company_id before insert or update on %I for each row execute function set_company_id()', t);
    execute format('drop policy if exists company_isolation on %I', t);
    execute format('create policy company_isolation on %I as restrictive for all
      using (company_id = current_company_id() or (auth.uid() is null and current_user = %L))
      with check (company_id = current_company_id() or (auth.uid() is null and current_user = %L))', t, 'app_definer', 'app_definer');
    execute format('drop policy if exists app_definer_all on %I', t);
    execute format('create policy app_definer_all on %I for all to app_definer using (true) with check (true)', t);
  end loop;
end $$;

insert into company_members (user_id, company_id)
select id, company_id from user_profiles
on conflict (user_id) do update set company_id = excluded.company_id;

create or replace function sync_company_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into company_members (user_id, company_id) values (new.id, new.company_id)
  on conflict (user_id) do update set company_id = excluded.company_id;
  return null;
end;
$$;

revoke all on function sync_company_member() from public, anon, authenticated;

drop trigger if exists trg_sync_company_member on user_profiles;

create trigger trg_sync_company_member after insert or update of company_id on user_profiles
  for each row execute function sync_company_member();

-- ---------- 3) Empresa: cada uma vê e edita só a sua ----------
drop policy if exists "read_active" on companies;

drop policy if exists "update_admin" on companies;

drop policy if exists "read_own" on companies;

create policy "read_own" on companies for select using (id = current_company_id() and is_active_user(auth.uid()));

drop policy if exists "update_own_admin" on companies;

create policy "update_own_admin" on companies for update
  using (id = current_company_id() and is_admin_user(auth.uid()))
  with check (id = current_company_id() and is_admin_user(auth.uid()));

drop policy if exists app_definer_all on companies;

create policy app_definer_all on companies for select to app_definer
  using (id = current_company_id() or auth.uid() is null);

-- Marca: logado = a própria empresa; sem login (tela de login) = a primeira.
create or replace function public_company_brand()
returns table (name text, logo_url text, tagline text, team_whatsapp text, mascot_enabled boolean, portal_theme text)
language sql stable security definer set search_path = public as $$
  select c.name, c.logo_url, c.tagline, c.team_whatsapp, c.mascot_enabled, c.portal_theme
  from companies c
  where c.id = coalesce(current_company_id(), (select id from companies order by created_at limit 1));
$$;

-- ---------- 4) "Não pode repetir" por empresa ----------
alter table roles drop constraint if exists roles_name_key;

drop index if exists roles_name_key;

alter table roles drop constraint if exists roles_company_name_key;

alter table roles add constraint roles_company_name_key unique (company_id, name);

alter table portal_menu_options drop constraint if exists portal_menu_options_kind_name_key;

drop index if exists portal_menu_options_kind_name_key;

create unique index if not exists portal_menu_options_company_kind_name on portal_menu_options (company_id, kind, name) where kind is not null;

alter table commission_settings drop constraint if exists commission_settings_unica_key;

alter table commission_settings drop constraint if exists commission_settings_company_unica_key;

alter table commission_settings add constraint commission_settings_company_unica_key unique (company_id, unica);

drop index if exists units_code_key;

create unique index if not exists units_company_code_key on units (company_id, code) where code is not null;

alter table menu_sections drop constraint if exists menu_sections_legacy_field_key;

create unique index if not exists menu_sections_company_legacy_key on menu_sections (company_id, legacy_field) where legacy_field is not null;

alter table message_templates drop constraint if exists message_templates_pkey;

alter table message_templates add primary key (company_id, key);

alter table payment_method_fees drop constraint if exists payment_method_fees_pkey;

alter table payment_method_fees add primary key (company_id, payment_method);

-- ---------- 5) Funções do portal e do histórico ----------
create or replace function audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_actor text := nullif(current_setting('app.audit_actor', true), '');
  v_name text;
  v_action text;
  v_row jsonb;
  v_old jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_reservation text;
begin
  if tg_op = 'INSERT' then
    v_action := 'criou';
    v_row := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action := 'alterou';
    v_row := to_jsonb(new);
    v_old := to_jsonb(old);
    for v_key in select jsonb_object_keys(v_row) loop
      if v_key not in ('updated_at', 'created_at') and (v_row -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('de', v_old -> v_key, 'para', v_row -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;
    end if;
  else
    v_action := 'excluiu';
    v_row := to_jsonb(old);
  end if;

  if v_actor is not null then
    v_uid := null;
    v_name := v_actor;
  elsif v_uid is not null then
    select name into v_name from user_profiles where id = v_uid;
  end if;

  v_reservation := case
    when tg_table_name = 'reservations' then v_row ->> 'id'
    else v_row ->> 'reservation_id'
  end;

  insert into audit_log (company_id, user_id, user_name, action, entity, entity_id, details)
  values (
    coalesce(
      case when tg_table_name = 'companies' then (v_row ->> 'id')::uuid else (v_row ->> 'company_id')::uuid end,
      current_company_id()
    ),
    v_uid,
    coalesce(v_name, case when v_uid is null then 'Link público ou sistema' else 'Usuário sem perfil' end),
    v_action,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    jsonb_strip_nulls(jsonb_build_object(
      'reservation_id', v_reservation,
      'changes', case when tg_op = 'UPDATE' then audit_trim(v_changes) end,
      'row', case when tg_op <> 'UPDATE' then audit_trim(v_row) end
    ))
  );
  return null;
end;
$$;

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

  return jsonb_build_object(
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

create or replace function festa_menu_sections(p_reservation uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'nome', s.name, 'ajuda', s.help, 'modo', s.mode,
      'quantidade', menu_section_quantity(s.id, p_reservation),
      'outro', s.allow_other, 'outro_rotulo', s.other_label, 'campo', s.legacy_field,
      'opcoes', coalesce((select jsonb_agg(o.name order by o.sort, o.name) from portal_menu_options o where o.section_id = s.id and o.active), '[]'::jsonb)
    ) order by s.sort, s.created_at), '[]'::jsonb)
  from menu_sections s
  join reservations r on r.id = p_reservation
  where s.active and s.company_id = r.company_id and (s.unit_id is null or s.unit_id = r.unit_id);
$$;

create or replace function festa_menu_choices(p_reservation uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(s.id::text,
      case s.legacy_field
        when 'hot_dish_flavors' then case when coalesce(r.hot_dish_flavors, '') = '' then '[]'::jsonb
             else to_jsonb(array(select trim(x) from unnest(string_to_array(r.hot_dish_flavors, '/')) x where trim(x) <> '')) end
        when 'cake_dough' then case when coalesce(r.cake_dough, '') = '' then '[]'::jsonb else jsonb_build_array(r.cake_dough) end
        when 'cake_flavor' then case when coalesce(r.cake_flavor, '') = '' then '[]'::jsonb else jsonb_build_array(r.cake_flavor) end
        else coalesce(r.menu_choices -> s.id::text, '[]'::jsonb)
      end), '{}'::jsonb)
  from menu_sections s
  join reservations r on r.id = p_reservation
  where s.active and s.company_id = r.company_id and (s.unit_id is null or s.unit_id = r.unit_id);
$$;

-- Funções antigas, sem uso desde o portal novo (deixavam brecha entre empresas).
drop function if exists portal_save_menu(uuid, text[], text, text);

drop function if exists public_get_guest_list_page(uuid);

drop function if exists public_list_guest_entries(uuid);

drop function if exists public_add_guest_entries(uuid, text[]);

drop function if exists public_remove_guest_entry(uuid, uuid);

drop function if exists public_set_guest_list_playlist(uuid, text);

-- ---------- 6) Arquivos ----------
do $$
begin
  drop policy if exists "festa_documentos_select" on storage.objects;
  create policy "festa_documentos_select" on storage.objects for select to authenticated
    using (bucket_id = 'festa-documentos' and exists (select 1 from reservations r where r.id::text = (storage.foldername(name))[1]));
  drop policy if exists "festa_documentos_insert" on storage.objects;
  create policy "festa_documentos_insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'festa-documentos' and exists (select 1 from reservations r where r.id::text = (storage.foldername(name))[1]));
  drop policy if exists "festa_documentos_delete" on storage.objects;
  create policy "festa_documentos_delete" on storage.objects for delete to authenticated
    using (bucket_id = 'festa-documentos' and exists (select 1 from reservations r where r.id::text = (storage.foldername(name))[1]));
  drop policy if exists "portal_comprovantes_read" on storage.objects;
  create policy "portal_comprovantes_read" on storage.objects for select to authenticated
    using (bucket_id = 'portal-comprovantes'
      and (has_permission(auth.uid(), 'page:portal_avisos') or has_permission(auth.uid(), 'action:festa.pagamentos'))
      and exists (select 1 from portal_receipts pr where pr.storage_path = name));
  drop policy if exists "marca_insert" on storage.objects;
  create policy "marca_insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'marca' and is_admin_user(auth.uid()) and (storage.foldername(name))[1] = current_company_id()::text);
end $$;

-- ---------- 7) Funções passam a rodar com o papel app_definer ----------
-- Ficam com o dono atual só as que respondem sobre o próprio usuário e as
-- que o próprio bloqueio usa (senão o bloqueio chamaria a si mesmo).
create or replace function fix_definer_owners() returns int
language plpgsql set search_path = public as $$
declare f record; n int := 0;
begin
  -- O Postgres só deixa um papel ser dono de função se ele puder "criar" na
  -- área (schema) da função: dá essa permissão só durante a troca.
  execute 'grant create on schema public to app_definer';
  for f in
    select p.oid::regprocedure sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prosecdef and pg_get_userbyid(p.proowner) <> 'app_definer'
      and p.proname not in ('is_active_user', 'is_admin_user', 'has_permission', 'portal_token_valid',
                            'current_company_id', 'current_actor_name', 'set_company_id', 'sync_company_member')
  loop
    execute format('alter function %s owner to app_definer', f.sig);
    n := n + 1;
  end loop;
  execute 'revoke create on schema public from app_definer';
  return n;
end;
$$;

revoke all on function fix_definer_owners() from public, anon, authenticated;

grant execute on all functions in schema public to app_definer;

select fix_definer_owners();

-- =========================================================
-- PAINEL DO ADMINISTRADOR GERAL (venda do sistema — Etapa 4)
--
-- 1) platform_admins: quem administra a plataforma (cadastra empresas). Só é
--    preenchida no banco dos clientes; no banco da Brava fica vazia e o
--    painel nem aparece.
-- 2) companies ganha:
--    - active: empresa suspensa (ex.: sem pagamento) — ninguém dela entra;
--    - disabled_modules: funções desligadas para aquela empresa (comissões,
--      agenda, marketing...). Some do menu e das telas dela.
-- 3) platform_settings: nome/logo do produto, mostrados na tela de login do
--    banco compartilhado (sem login não dá para saber de qual empresa é).
-- 4) Funções do painel (só administrador geral): listar empresas com
--    números, editar nome/funções/suspensão, configurar o produto.
--    platform_create_company: cria empresa + dados iniciais + perfil do
--    primeiro administrador — chamada pela função de servidor
--    "platform-admin", que cria o login (precisa da chave de serviço).
-- 5) is_active_user passa a considerar a empresa suspensa.
-- 6) O histórico de alterações registra também o que o administrador geral
--    faz em outra empresa.
--
-- Na Brava nada muda (ela continua ativa e com todas as funções).
-- Roda dentro de uma transação.
-- =========================================================


-- ---------- 1) Administrador geral ----------
create table if not exists platform_admins (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);

alter table platform_admins enable row level security;

-- sem regras: ninguém lê pela internet
revoke all on platform_admins from anon, authenticated;

create or replace function is_platform_admin(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = p_user);
$$;

revoke all on function is_platform_admin(uuid) from public, anon;

grant execute on function is_platform_admin(uuid) to authenticated;

-- ---------- 2) Empresa: ativa e funções desligadas ----------
alter table companies add column if not exists active boolean not null default true;

alter table companies add column if not exists disabled_modules text[] not null default '{}';

-- Usuário de empresa suspensa deixa de ser "ativo" (todas as permissões caem).
create or replace function is_active_user(check_id uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select coalesce((
    select up.active and coalesce(c.active, true)
    from user_profiles up left join companies c on c.id = up.company_id
    where up.id = check_id
  ), false);
$$;

-- ---------- 3) Produto (tela de login do banco compartilhado) ----------
create table if not exists platform_settings (
  id uuid primary key default gen_random_uuid(),
  unica boolean not null default true unique check (unica),
  name text not null check (length(trim(name)) > 0),
  logo_url text,
  tagline text
);

alter table platform_settings enable row level security;

revoke all on platform_settings from anon, authenticated;

-- Marca: logado = a própria empresa; sem login = o produto (se configurado)
-- ou, num banco de uma empresa só (Brava), a própria empresa.
drop function if exists public_company_brand();

create or replace function public_company_brand()
returns table (name text, logo_url text, tagline text, team_whatsapp text, mascot_enabled boolean, portal_theme text, disabled_modules text[], active boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if current_company_id() is null and exists (select 1 from platform_settings) then
    return query select p.name, p.logo_url, p.tagline, null::text, false, 'padrao'::text, '{}'::text[], true from platform_settings p limit 1;
    return;
  end if;
  return query
  select c.name, c.logo_url, c.tagline, c.team_whatsapp, c.mascot_enabled, c.portal_theme, c.disabled_modules, c.active
  from companies c
  where c.id = coalesce(current_company_id(), (select id from companies order by created_at limit 1));
end;
$$;

revoke all on function public_company_brand() from public;

grant execute on function public_company_brand() to anon, authenticated;

-- ---------- 4) Funções do painel ----------
create or replace function platform_list_companies()
returns table (id uuid, name text, active boolean, created_at timestamptz, disabled_modules text[],
               usuarios int, unidades int, festas int, festas_30d int, ultima_atividade timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query
  select c.id, c.name, c.active, c.created_at, c.disabled_modules,
         (select count(*)::int from user_profiles u where u.company_id = c.id and u.active),
         (select count(*)::int from units un where un.company_id = c.id and un.active),
         (select count(*)::int from reservations r where r.company_id = c.id and r.status <> 'cancelada'),
         (select count(*)::int from reservations r where r.company_id = c.id and r.created_at > now() - interval '30 days'),
         (select max(a.created_at) from audit_log a where a.company_id = c.id)
  from companies c
  order by c.created_at;
end;
$$;

create or replace function platform_update_company(p_company uuid, p_name text, p_active boolean, p_disabled_modules text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Informe o nome da empresa.'; end if;
  update companies set name = trim(p_name), active = coalesce(p_active, active), disabled_modules = coalesce(p_disabled_modules, '{}')
  where id = p_company;
  if not found then raise exception 'Empresa não encontrada.'; end if;
end;
$$;

commit;
