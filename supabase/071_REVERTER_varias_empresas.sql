-- =========================================================
-- REVERTER a migração 071 (várias empresas) — só use se for para desfazer.
-- Tira a marcação de empresa de todas as tabelas, o bloqueio entre empresas
-- e o papel app_definer; volta as funções e regras como eram antes.
-- Só faz sentido num banco com UMA empresa (como o da Brava).
-- =========================================================
begin;

do $$
begin
  if (select count(*) from companies) > 1 then
    raise exception 'Há mais de uma empresa neste banco: não dá para desfazer sem misturar os dados.';
  end if;
end $$;

-- funções voltam para o dono atual (quem roda este arquivo)
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
           where ns.nspname = 'public' and pg_get_userbyid(p.proowner) = 'app_definer'
  loop
    execute format('alter function %s owner to %I', f.sig, current_user);
  end loop;
end $$;

-- regras de "não pode repetir" como eram
alter table roles drop constraint if exists roles_company_name_key;
alter table roles add constraint roles_name_key unique (name);
drop index if exists portal_menu_options_company_kind_name;
alter table portal_menu_options add constraint portal_menu_options_kind_name_key unique (kind, name);
alter table commission_settings drop constraint if exists commission_settings_company_unica_key;
alter table commission_settings add constraint commission_settings_unica_key unique (unica);
drop index if exists units_company_code_key;
create unique index if not exists units_code_key on units (code) where code is not null;
drop index if exists menu_sections_company_legacy_key;
alter table menu_sections add constraint menu_sections_legacy_field_key unique (legacy_field);
alter table message_templates drop constraint if exists message_templates_pkey;
alter table message_templates add primary key (key);
alter table payment_method_fees drop constraint if exists payment_method_fees_pkey;
alter table payment_method_fees add primary key (payment_method);

drop trigger if exists trg_sync_company_member on user_profiles;

-- empresa em cada tabela
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('companies', 'company_members')
             and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = c.relname and column_name = 'company_id')
  loop
    execute format('drop policy if exists company_isolation on %I', t);
    execute format('drop policy if exists app_definer_all on %I', t);
    execute format('drop trigger if exists trg_set_company_id on %I', t);
    execute format('alter table %I drop column company_id', t);
  end loop;
end $$;

drop function if exists sync_company_member();
drop function if exists set_company_id();

-- empresa: regras como na 068
drop policy if exists "read_own" on companies;
drop policy if exists "update_own_admin" on companies;
drop policy if exists app_definer_all on companies;
create policy "read_active" on companies for select using (is_active_user(auth.uid()));
create policy "update_admin" on companies for update using (is_admin_user(auth.uid())) with check (is_admin_user(auth.uid()));

-- arquivos: regras como antes
do $$
begin
  drop policy if exists "festa_documentos_select" on storage.objects;
  create policy "festa_documentos_select" on storage.objects for select to authenticated using (bucket_id = 'festa-documentos');
  drop policy if exists "festa_documentos_insert" on storage.objects;
  create policy "festa_documentos_insert" on storage.objects for insert to authenticated with check (bucket_id = 'festa-documentos');
  drop policy if exists "festa_documentos_delete" on storage.objects;
  create policy "festa_documentos_delete" on storage.objects for delete to authenticated using (bucket_id = 'festa-documentos');
  drop policy if exists "portal_comprovantes_read" on storage.objects;
  create policy "portal_comprovantes_read" on storage.objects for select to authenticated
    using (bucket_id = 'portal-comprovantes' and (has_permission(auth.uid(), 'page:portal_avisos') or has_permission(auth.uid(), 'action:festa.pagamentos')));
  drop policy if exists "marca_insert" on storage.objects;
  create policy "marca_insert" on storage.objects for insert to authenticated with check (bucket_id = 'marca' and is_admin_user(auth.uid()));
end $$;

-- funções como eram
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

  insert into audit_log (user_id, user_name, action, entity, entity_id, details)
  values (
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

create or replace function public_company_brand()
returns table (name text, logo_url text, tagline text, team_whatsapp text, mascot_enabled boolean, portal_theme text)
language sql stable security definer set search_path = public as $$
  select c.name, c.logo_url, c.tagline, c.team_whatsapp, c.mascot_enabled, c.portal_theme
  from companies c order by c.created_at limit 1;
$$;

create or replace function portal_save_menu(p_token uuid, p_pratos text[], p_massa text, p_sabor text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_date date;
  v_limit jsonb;
  v_max int;
  v_pratos text[];
  v_late boolean;
  v_dias int;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  select r.event_date, u.menu_deadline_days into v_date, v_dias from reservations r join units u on u.id = r.unit_id where r.id = v_res;
  -- Depois do prazo (X dias antes, configurado na unidade) ainda pode enviar,
  -- mas fica marcado como enviado após o prazo. Depois do dia da festa, não.
  if today_brazil() > v_date then
    raise exception 'A festa já aconteceu. Para alterar o cardápio, fale com a equipe.';
  end if;
  v_late := today_brazil() > v_date - v_dias;
  v_limit := festa_hot_dish_limit(v_res);
  v_max := (v_limit ->> 'inclusos')::int + (v_limit ->> 'adicionais')::int;
  select array(select distinct trim(x) from unnest(coalesce(p_pratos, '{}')) x where trim(x) <> '') into v_pratos;
  if coalesce(array_length(v_pratos, 1), 0) <> v_max then
    raise exception 'Escolha % prato(s) quente(s).', v_max;
  end if;
  if exists (select 1 from unnest(v_pratos) x where not exists (select 1 from portal_menu_options where kind = 'prato' and active and name = x)) then
    raise exception 'Prato quente inválido.';
  end if;
  if not exists (select 1 from portal_menu_options where kind = 'bolo_massa' and active and name = p_massa) then
    raise exception 'Escolha a massa do bolo.';
  end if;
  if p_sabor is distinct from 'Outro sabor (combinar com a equipe)' and not exists (select 1 from portal_menu_options where kind = 'bolo_sabor' and active and name = p_sabor) then
    raise exception 'Escolha o recheio do bolo.';
  end if;

  perform set_config('app.audit_actor', 'Cliente (portal)', true);
  update reservations set
    hot_dish_flavors = nullif(array_to_string(v_pratos, ' / '), ''),
    cake_dough = p_massa,
    cake_flavor = p_sabor,
    menu_confirmed_at = now(),
    menu_sent_late = v_late
  where id = v_res;
  perform set_config('app.audit_actor', '', true);
  perform portal_log(v_res, 'cardapio',
    case when v_late then 'Enviou o cardápio APÓS O PRAZO (' || to_char(v_date - v_dias, 'DD/MM') || '): ' else 'Confirmou o cardápio: ' end || coalesce(nullif(array_to_string(v_pratos, ', '), ''), 'sem pratos quentes') || ' · bolo de massa ' || lower(p_massa) || ', recheio ' || p_sabor);
end;
$$;

create or replace function public_get_guest_list_page(p_token uuid)
returns table (
  token uuid,
  unit_name text,
  event_date date,
  theme text,
  child_name text,
  guest_limit int,
  playlist_enabled boolean,
  playlist_url text
)
language sql stable security definer set search_path = public as $$
  select g.token, g.unit_name, g.event_date, g.theme, g.child_name, g.guest_limit,
         u.playlist_enabled as playlist_enabled,
         g.playlist_url
  from guest_list_pages g
  join reservations r on r.id = g.reservation_id
  join units u on u.id = r.unit_id
  where g.token = p_token;
$$;

create or replace function public_set_guest_list_playlist(p_token uuid, p_url text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text := nullif(trim(coalesce(p_url, '')), '');
begin
  if not exists (
    select 1
    from guest_list_pages g
    join reservations r on r.id = g.reservation_id
    join units u on u.id = r.unit_id
    where g.token = p_token and u.playlist_enabled
  ) then
    raise exception 'Playlist não disponível para esta festa';
  end if;

  if v_url is not null and (
    length(v_url) > 500
    or not (v_url ilike 'https://open.spotify.com/%' or v_url ilike 'https://spotify.link/%')
  ) then
    raise exception 'Link do Spotify inválido';
  end if;

  update guest_list_pages set playlist_url = v_url where token = p_token;
end;
$$;

create or replace function public_list_guest_entries(p_token uuid)
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select e.id, e.name
  from guest_list_entries e
  where e.token = p_token
  order by e.created_at;
$$;

create or replace function public_add_guest_entries(p_token uuid, p_names text[])
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if not exists (select 1 from guest_list_pages where token = p_token) then
    raise exception 'Lista não encontrada';
  end if;
  if coalesce(array_length(p_names, 1), 0) > 300 then
    raise exception 'Muitos nomes de uma vez';
  end if;
  if (select count(*) from guest_list_entries where token = p_token) + coalesce(array_length(p_names, 1), 0) > 1000 then
    raise exception 'Lista cheia';
  end if;

  insert into guest_list_entries (token, name)
  select p_token, left(trim(n), 120)
  from unnest(p_names) as n
  where trim(n) <> '';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public_remove_guest_entry(p_token uuid, p_entry_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from guest_list_entries
  where id = p_entry_id
    and token = p_token
    and arrived = false
    and flagged = false;
  return found;
end;
$$;

grant execute on function portal_save_menu(uuid, text[], text, text) to anon, authenticated;
grant execute on function public_get_guest_list_page(uuid), public_list_guest_entries(uuid), public_add_guest_entries(uuid, text[]),
  public_remove_guest_entry(uuid, uuid), public_set_guest_list_playlist(uuid, text) to anon, authenticated;

drop function if exists fix_definer_owners();
drop function if exists current_company_id();
drop table if exists company_members;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_definer') then
    execute 'revoke all on all tables in schema public from app_definer';
    execute 'revoke all on all sequences in schema public from app_definer';
    execute 'revoke all on all functions in schema public from app_definer';
    execute 'alter default privileges in schema public revoke all on tables from app_definer';
    execute 'alter default privileges in schema public revoke all on sequences from app_definer';
    execute format('revoke temporary on database %I from app_definer', current_database());
    execute 'revoke usage on schema public from app_definer';
    execute 'revoke authenticated from app_definer';
    execute 'drop role app_definer';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
