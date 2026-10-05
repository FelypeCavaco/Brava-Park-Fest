-- =========================================================
-- Links públicos (lista de convidados e avaliação pós-festa) — ETAPA 1/2.
--
-- Problema: as páginas públicas (sem login) liam/gravavam direto nas
-- tabelas, com regras "liberado pra todo mundo". Na prática qualquer pessoa
-- conseguia listar as listas de convidados de TODAS as festas (com nome da
-- criança, data, tema), apagar nomes de qualquer lista, listar o nome de
-- todos os clientes com link de avaliação e enviar avaliação por qualquer
-- festa.
--
-- Correção: as páginas públicas passam a usar só as funções abaixo, que
-- exigem o código (token) do link e só enxergam/mexem naquela festa.
--
-- Esta etapa só CRIA as funções — o site atual continua funcionando. Depois
-- que o site novo estiver no ar, rodar a 053, que fecha o acesso direto às
-- tabelas.
-- =========================================================

-- ---------- Lista de convidados ----------

create or replace function public_get_guest_list_page(p_token uuid)
returns table (token uuid, unit_name text, event_date date, theme text, child_name text, guest_limit int)
language sql stable security definer set search_path = public as $$
  select g.token, g.unit_name, g.event_date, g.theme, g.child_name, g.guest_limit
  from guest_list_pages g
  where g.token = p_token;
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

-- O contratante só tira nomes que ele mesmo pode controlar: quem ainda não
-- chegou e não foi sinalizado pela equipe na portaria.
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

-- ---------- Avaliação pós-festa ----------

create or replace function public_get_review_link(p_token uuid)
returns table (token uuid, client_name text, unit_name text)
language sql stable security definer set search_path = public as $$
  select r.token, r.client_name, r.unit_name
  from review_links r
  where r.token = p_token;
$$;

create or replace function public_submit_party_review(
  p_token uuid,
  p_hot_dish_rating int,
  p_cake_rating int,
  p_sweets_rating int,
  p_snacks_rating int,
  p_service_rating int,
  p_comment text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from review_links where token = p_token) then
    raise exception 'Link de avaliação não encontrado';
  end if;
  -- evita o mesmo link virar canal de spam (permite reenviar se errou)
  if (select count(*) from party_reviews where token = p_token) >= 3 then
    raise exception 'Avaliação já enviada';
  end if;

  insert into party_reviews (token, hot_dish_rating, cake_rating, sweets_rating, snacks_rating, service_rating, comment)
  values (p_token, p_hot_dish_rating, p_cake_rating, p_sweets_rating, p_snacks_rating, p_service_rating, left(p_comment, 2000));
end;
$$;

revoke all on function public_get_guest_list_page(uuid) from public;
revoke all on function public_list_guest_entries(uuid) from public;
revoke all on function public_add_guest_entries(uuid, text[]) from public;
revoke all on function public_remove_guest_entry(uuid, uuid) from public;
revoke all on function public_get_review_link(uuid) from public;
revoke all on function public_submit_party_review(uuid, int, int, int, int, int, text) from public;

grant execute on function public_get_guest_list_page(uuid) to anon, authenticated;
grant execute on function public_list_guest_entries(uuid) to anon, authenticated;
grant execute on function public_add_guest_entries(uuid, text[]) to anon, authenticated;
grant execute on function public_remove_guest_entry(uuid, uuid) to anon, authenticated;
grant execute on function public_get_review_link(uuid) to anon, authenticated;
grant execute on function public_submit_party_review(uuid, int, int, int, int, int, text) to anon, authenticated;
