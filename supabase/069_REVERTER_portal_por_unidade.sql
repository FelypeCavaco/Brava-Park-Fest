-- =========================================================
-- REVERTER a migração 069 (regras do portal por unidade) — só use se for para desfazer.
-- Volta as funções do portal ao que eram (prazos 7/1 dia fixos, playlist só na
-- Vila Operária) e apaga as configurações do portal das unidades.
-- =========================================================
begin;

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
    'unidade', r.unidade, 'vila', r.unidade = 'Vila Operária', 'endereco', r.full_address,
    'pix', r.pix_key, 'google_review_link', r.google_review_link, 'hora_extra', r.extra_hour_price,
    'pacote', r.pacote, 'itens_inclusos', r.included_items,
    'convidados_limite', coalesce(r.guest_count, 0) + coalesce(r.courtesy_guests, 0),
    'pratos_inclusos', (v_limit ->> 'inclusos')::int, 'pratos_adicionais', (v_limit ->> 'adicionais')::int,
    'pratos', case when coalesce(r.hot_dish_flavors, '') = '' then '[]'::jsonb else to_jsonb(array(select trim(x) from unnest(string_to_array(r.hot_dish_flavors, '/')) x where trim(x) <> '')) end,
    'bolo_sabor', r.cake_flavor, 'bolo_massa', r.cake_dough, 'cardapio_confirmado_em', r.menu_confirmed_at, 'cardapio_apos_prazo', coalesce(r.menu_sent_late, false),
    'musica', r.music_choice, 'playlist', r.playlist_url,
    'prazo_cardapio', r.event_date - 7, 'prazo_convidados', r.event_date - 1, 'prazo_pagamento', r.event_date - 1,
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

create or replace function portal_save_menu(p_token uuid, p_pratos text[], p_massa text, p_sabor text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_date date;
  v_limit jsonb;
  v_max int;
  v_pratos text[];
  v_late boolean;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  select event_date into v_date from reservations where id = v_res;
  -- Depois do prazo (7 dias antes) ainda pode enviar, mas fica marcado como
  -- enviado após o prazo. Depois do dia da festa, não.
  if today_brazil() > v_date then
    raise exception 'A festa já aconteceu. Para alterar o cardápio, fale com a equipe.';
  end if;
  v_late := today_brazil() > v_date - 7;
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
    case when v_late then 'Enviou o cardápio APÓS O PRAZO (' || to_char(v_date - 7, 'DD/MM') || '): ' else 'Confirmou o cardápio: ' end || coalesce(nullif(array_to_string(v_pratos, ', '), ''), 'sem pratos quentes') || ' · bolo de massa ' || lower(p_massa) || ', recheio ' || p_sabor);
end;
$$;

create or replace function portal_add_guests(p_token uuid, p_names text[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_date date;
  v_count integer;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  select event_date into v_date from reservations where id = v_res;
  if today_brazil() > v_date - 1 then
    raise exception 'A lista de convidados fechou em %. Para incluir alguém, fale com a equipe.', to_char(v_date - 1, 'DD/MM');
  end if;
  if coalesce(array_length(p_names, 1), 0) > 300 then raise exception 'Muitos nomes de uma vez.'; end if;
  if (select count(*) from guest_list_entries where token = p_token) + coalesce(array_length(p_names, 1), 0) > 1000 then
    raise exception 'Lista cheia.';
  end if;
  insert into guest_list_entries (token, name)
  select p_token, left(trim(n), 120) from unnest(p_names) n where trim(n) <> '';
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform portal_log(v_res, 'convidados',
      case when v_count = 1 then 'Adicionou ' || (select left(trim(n), 120) from unnest(p_names) n where trim(n) <> '' limit 1) || ' à lista de convidados'
           else 'Adicionou ' || v_count || ' convidados à lista' end);
  end if;
  return v_count;
end;
$$;

create or replace function portal_remove_guest(p_token uuid, p_entry_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_date date;
  v_name text;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  select event_date into v_date from reservations where id = v_res;
  if today_brazil() > v_date - 1 then
    raise exception 'A lista de convidados fechou. Para alterar, fale com a equipe.';
  end if;
  delete from guest_list_entries where id = p_entry_id and token = p_token and not arrived and not coalesce(flagged, false)
  returning name into v_name;
  if v_name is not null then perform portal_log(v_res, 'convidados', 'Removeu ' || v_name || ' da lista de convidados'); end if;
end;
$$;

create or replace function portal_set_music(p_token uuid, p_choice text, p_url text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_url text := nullif(trim(coalesce(p_url, '')), '');
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  if (select u.name from reservations r join units u on u.id = r.unit_id where r.id = v_res) <> 'Vila Operária' then
    raise exception 'A escolha de música está disponível só nas festas da Vila Operária.';
  end if;
  if p_choice not in ('equipe', 'cliente') then raise exception 'Escolha inválida.'; end if;
  if p_choice = 'cliente' and (v_url is null or v_url !~ '^https://(open\.spotify\.com|spotify\.link)/') then
    raise exception 'Envie um link do Spotify (open.spotify.com).';
  end if;
  perform set_config('app.audit_actor', 'Cliente (portal)', true);
  update reservations set music_choice = p_choice where id = v_res;
  update guest_list_pages set playlist_url = case when p_choice = 'cliente' then left(v_url, 500) end where token = p_token;
  perform set_config('app.audit_actor', '', true);
  perform portal_log(v_res, 'musica', case when p_choice = 'equipe' then 'Escolheu: músicas sugeridas pela equipe' else 'Enviou a playlist do Spotify' end);
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
         (u.name = 'Vila Operária') as playlist_enabled,
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
    where g.token = p_token and u.name = 'Vila Operária'
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

alter table units drop constraint if exists units_portal_limits_check;
alter table units drop column if exists guest_min_age, drop column if exists menu_deadline_days, drop column if exists guest_deadline_days, drop column if exists payment_deadline_days, drop column if exists playlist_enabled, drop column if exists parabens_after_min, drop column if exists hot_dish_after_parabens_min, drop column if exists cake_after_parabens_min, drop column if exists portal_rules;

commit;
notify pgrst, 'reload schema';
