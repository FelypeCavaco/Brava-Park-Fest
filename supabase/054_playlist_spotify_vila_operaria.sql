-- =========================================================
-- Playlist do Spotify na lista de convidados — só festas da Vila Operária.
-- O contratante cola o link da playlist pela página pública da lista de
-- convidados; a equipe vê o link na Central da festa e coloca na hora.
--
-- Pode rodar antes do site novo: o site atual continua funcionando (a
-- função pública só ganha dois campos a mais na resposta).
-- =========================================================

alter table guest_list_pages add column if not exists playlist_url text;

-- A resposta da função muda (campos novos), então precisa recriar.
drop function if exists public_get_guest_list_page(uuid);

create function public_get_guest_list_page(p_token uuid)
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

-- Salva (ou apaga, se vier vazio) o link da playlist. Só aceita links do
-- Spotify e só em festa da Vila Operária.
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

revoke all on function public_get_guest_list_page(uuid) from public;
revoke all on function public_set_guest_list_playlist(uuid, text) from public;
grant execute on function public_get_guest_list_page(uuid) to anon, authenticated;
grant execute on function public_set_guest_list_playlist(uuid, text) to anon, authenticated;
