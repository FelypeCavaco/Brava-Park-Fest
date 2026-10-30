-- =========================================================
-- BANCO DOS CLIENTES — ESTRUTURA, PARTE 5 DE 9
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

-- Confirmar na tela de Acertos = marcar as contas como pagas (o resto é automático).
create or replace function confirm_settlements(p_ids uuid[], p_paid_date date, p_payment_method text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if not has_permission(auth.uid(), 'action:acertos.confirmar') then raise exception 'Sem permissão para confirmar acertos.'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then raise exception 'Selecione ao menos um acerto.'; end if;
  perform 1 from unit_settlements where id = any(p_ids) for update;
  if (select count(*) from unit_settlements where id = any(p_ids)) <> array_length(p_ids, 1) then raise exception 'Acerto não encontrado.'; end if;
  if exists (select 1 from unit_settlements where id = any(p_ids) and status <> 'pendente') then
    raise exception 'Só é possível confirmar acertos pendentes (algum já foi confirmado ou cancelado).';
  end if;
  if (select count(distinct (from_unit_id, to_unit_id)) from unit_settlements where id = any(p_ids)) > 1 then
    raise exception 'No lote, todos os acertos precisam ter a mesma origem e o mesmo destino.';
  end if;
  for r in select id, due_date from unit_settlements where id = any(p_ids) loop
    perform create_settlement_payable(r.id, coalesce(r.due_date, p_paid_date));
    update expenses set status = 'pago', paid_date = coalesce(p_paid_date, today_brazil()), payment_method = p_payment_method
    where settlement_id = r.id;
  end loop;
  return null;
end;
$$;

-- Desfazer a confirmação de um acerto: a conta volta a não paga (a entrada some sozinha).
create or replace function undo_settlement(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:acertos.desfazer') then raise exception 'Sem permissão para desfazer a confirmação.'; end if;
  if not exists (select 1 from unit_settlements where id = p_id and status = 'pago') then raise exception 'Este acerto não está pago.'; end if;
  update expenses set status = 'a_vencer', paid_date = null, payment_method = null where settlement_id = p_id;
end;
$$;

-- Cancelar acerto pendente cancela também a conta a pagar dele.
create or replace function cancel_settlement(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:acertos.confirmar') then raise exception 'Sem permissão.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  update unit_settlements set status = 'cancelado', cancel_reason = trim(p_reason), cancelled_by_name = current_actor_name()
  where id = p_id and status = 'pendente';
  if not found then raise exception 'Só é possível cancelar acerto pendente.'; end if;
  perform set_config('app.expense_fn', '1', true);
  update expenses set status = 'cancelado', description = description || ' (cancelado: ' || trim(p_reason) || ')' where settlement_id = p_id;
  perform set_config('app.expense_fn', '', true);
end;
$$;

-- Acertos pendentes que já existiam ganham a conta a pagar agora.
do $$
declare r record;
begin
  for r in select id from unit_settlements where status = 'pendente' and amount > 0 loop
    perform create_settlement_payable(r.id, today_brazil());
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array['transfer_stock(uuid, uuid, numeric, boolean, date)', 'undo_settlement(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- =========================================================
-- PORTAL DO CLIENTE
--
-- Um link por festa (o mesmo token da antiga lista de convidados — os
-- links já enviados continuam funcionando) onde o cliente, sem login:
--   • escolhe o cardápio (pratos quentes + massa e recheio do bolo) até 7
--     dias antes da festa;
--   • envia a lista de convidados até 1 dia antes (vai direto para a lista
--     da recepção que já existe);
--   • escolhe a música (Vila Operária): equipe escolhe ou envia playlist;
--   • vê valores e pagamentos, copia o Pix e envia o comprovante;
--   • manda mensagem para a equipe; avalia a festa quando ela termina.
-- Tudo grava direto nos dados da festa e fica registrado em portal_events
-- (histórico do cliente e avisos no Painel). Quem vê os avisos: permissão
-- "page:portal_avisos" (Administrador, Gerente, Financeiro, Comercial).
--
-- O visitante sem login só chega aos dados pelas funções portal_* abaixo,
-- que exigem o token do link e devolvem só a festa daquele link.
-- =========================================================

-- ---------- Pratos quentes por plano e por adicional ----------
alter table packages add column if not exists hot_dish_count int;

update packages
set hot_dish_count = coalesce(substring(included_items from 'até ([0-9]+)')::int, 0)
where hot_dish_count is null;

-- Único plano sem o número no texto: São Vicente 40 pessoas (2026) = 3.
update packages p set hot_dish_count = 3
from units u
where u.id = p.unit_id and u.name = 'São Vicente' and p.name = 'Festa Completa 40 pessoas' and coalesce(p.hot_dish_count, 0) = 0;

alter table packages alter column hot_dish_count set default 0;

update packages set hot_dish_count = 0 where hot_dish_count is null;

-- Item extra que dá direito a mais pratos quentes (ex: "Prato quente adicional").
alter table extra_items add column if not exists adds_hot_dishes int not null default 0;

update extra_items set adds_hot_dishes = 1 where adds_hot_dishes = 0 and name ilike '%prato quente%';

-- ---------- Cardápio oferecido no portal (editável em Pacotes e itens) ----------
create table if not exists portal_menu_options (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('prato', 'bolo_massa', 'bolo_sabor')),
  name text not null,
  sort int not null default 0,
  active boolean not null default true,
  unique (kind, name)
);

insert into portal_menu_options (kind, name, sort)
select 'prato', n, o from unnest(array[
  'Lasanha de queijo e presunto', 'Lasanha de brócolis', 'Lasanha de frango', 'Lasanha de carne', 'Empadão de palmito',
  'Empadão de frango com requeijão', 'Empadão de carne', 'Empadão de legumes', 'Torta salgada de frango', 'Torta de palmito',
  'Escondidinho de calabresa', 'Escondidinho de linguiça Blumenau', 'Escondidinho de carne desfiada', 'Fricassê',
  'Pão picante de frango', 'Frango à delícia']) with ordinality as t(n, o)
on conflict (kind, name) do nothing;

insert into portal_menu_options (kind, name, sort)
select 'bolo_massa', n, o from unnest(array['Branca', 'Chocolate', 'Mesclada']) with ordinality as t(n, o)
on conflict (kind, name) do nothing;

insert into portal_menu_options (kind, name, sort)
select 'bolo_sabor', n, o from unnest(array[
  'Morango com 4 leites', 'Morango com nata, suspiro e chocolate branco', 'Morango com chocolate ao leite', 'Ameixa com coco',
  'Dois Amores', 'Brigadeiro', 'Beijinho', 'Três brigadeiros', 'Brigadeiro de leite em pó', 'Brigadeiro de leite em pó com creme de avelã',
  'Sonho de Valsa', 'Prestígio', 'Charge', 'Negresco', 'Oreo', 'Red Velvet', '4 leites', '5 leites', 'Strogonoff de nozes',
  'Mousse de maracujá', 'Mousse de limão', 'Síria', 'Frutas vermelhas']) with ordinality as t(n, o)
on conflict (kind, name) do nothing;

alter table portal_menu_options enable row level security;

drop policy if exists "read_active" on portal_menu_options;

create policy "read_active" on portal_menu_options for select using (is_active_user(auth.uid()));

drop policy if exists "write_portal_menu_options" on portal_menu_options;

create policy "write_portal_menu_options" on portal_menu_options for all
  using (has_permission(auth.uid(), 'action:pacotes.criar_editar'))
  with check (has_permission(auth.uid(), 'action:pacotes.criar_editar'));

-- ---------- Dados novos da festa ----------
alter table reservations add column if not exists cake_dough text;

alter table reservations add column if not exists menu_confirmed_at timestamptz;

alter table reservations add column if not exists music_choice text check (music_choice in ('equipe', 'cliente'));

-- ---------- Registro de tudo o que o cliente faz (histórico + avisos) ----------
create table if not exists portal_events (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  kind text not null, -- cardapio, convidados, musica, comprovante, mensagem, avaliacao
  description text not null,
  ref_id uuid,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  seen_by_name text
);

create index if not exists idx_portal_events_reservation on portal_events (reservation_id, created_at desc);

create index if not exists idx_portal_events_unseen on portal_events (created_at desc) where seen_at is null;

create table if not exists portal_messages (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  from_client boolean not null,
  author_name text,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_portal_messages_reservation on portal_messages (reservation_id, created_at);

create table if not exists portal_receipts (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  storage_path text not null,
  status text not null default 'em_analise' check (status in ('em_analise', 'lancado', 'recusado')),
  reject_reason text,
  decided_by_name text,
  decided_at timestamptz,
  payment_id uuid references payments(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_portal_receipts_reservation on portal_receipts (reservation_id, created_at desc);

alter table portal_events enable row level security;

alter table portal_messages enable row level security;

alter table portal_receipts enable row level security;

drop policy if exists "read_portal_events" on portal_events;

create policy "read_portal_events" on portal_events for select
  using (has_permission(auth.uid(), 'page:portal_avisos') or has_permission(auth.uid(), 'page:festa_detalhe'));

drop policy if exists "read_portal_messages" on portal_messages;

create policy "read_portal_messages" on portal_messages for select using (has_permission(auth.uid(), 'page:festa_detalhe') or has_permission(auth.uid(), 'page:portal_avisos'));

drop policy if exists "read_portal_receipts" on portal_receipts;

create policy "read_portal_receipts" on portal_receipts for select
  using (has_permission(auth.uid(), 'page:portal_avisos') or has_permission(auth.uid(), 'action:festa.pagamentos'));

-- Escrita só pelas funções abaixo.

-- Comprovantes: arquivos guardados por pasta = token do link.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal-comprovantes', 'portal-comprovantes', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

create or replace function portal_token_valid(p_token text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from guest_list_pages where token::text = p_token);
$$;

grant execute on function portal_token_valid(text) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'portal_comprovantes_upload') then
    drop policy "portal_comprovantes_upload" on storage.objects;
  end if;
  create policy "portal_comprovantes_upload" on storage.objects for insert to anon, authenticated
    with check (bucket_id = 'portal-comprovantes' and portal_token_valid((storage.foldername(name))[1]));
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'portal_comprovantes_read') then
    drop policy "portal_comprovantes_read" on storage.objects;
  end if;
  create policy "portal_comprovantes_read" on storage.objects for select to authenticated
    using (bucket_id = 'portal-comprovantes' and (has_permission(auth.uid(), 'page:portal_avisos') or has_permission(auth.uid(), 'action:festa.pagamentos')));
end $$;

-- ---------- Permissão dos avisos ----------
insert into role_permission_items (role_id, permission_key, allowed)
select r.id, 'page:portal_avisos', true
from roles r
where not r.is_admin and (r.name ilike '%comercial%' or r.name ilike '%financeiro%' or r.name ilike '%gerente%' or r.name ilike '%gerência%')
on conflict (role_id, permission_key) do nothing;

-- ---------- Funções internas ----------
create or replace function portal_reservation(p_token uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select reservation_id from guest_list_pages where token = p_token;
$$;

revoke all on function portal_reservation(uuid) from public, anon, authenticated;

create or replace function portal_log(p_reservation uuid, p_kind text, p_description text, p_ref uuid default null) returns void
language sql security definer set search_path = public as $$
  insert into portal_events (reservation_id, kind, description, ref_id) values (p_reservation, p_kind, p_description, p_ref);
$$;

revoke all on function portal_log(uuid, text, text, uuid) from public, anon, authenticated;

-- Quantos pratos quentes a festa pode escolher: plano + extras "prato adicional".
create or replace function festa_hot_dish_limit(p_reservation uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'inclusos', coalesce((select p.hot_dish_count from reservations r join packages p on p.id = r.package_id where r.id = p_reservation), 0),
    'adicionais', coalesce((select sum(x.quantity * e.adds_hot_dishes) from reservation_extra_items x join extra_items e on e.id = x.extra_item_id where x.reservation_id = p_reservation), 0)
  );
$$;

revoke all on function festa_hot_dish_limit(uuid) from public, anon;

grant execute on function festa_hot_dish_limit(uuid) to authenticated;

-- Festa já terminou? (data + horário de término, no horário de Brasília)
create or replace function festa_ended(p_reservation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select ((event_date + end_time) at time zone 'America/Sao_Paulo') <= now() from reservations where id = p_reservation;
$$;

revoke all on function festa_ended(uuid) from public, anon, authenticated;

-- ---------- Funções do portal (visitante sem login, com o token) ----------
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
    'bolo_sabor', r.cake_flavor, 'bolo_massa', r.cake_dough, 'cardapio_confirmado_em', r.menu_confirmed_at,
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

create or replace function portal_list_guests(p_token uuid) returns table (id uuid, name text, arrived boolean)
language sql stable security definer set search_path = public as $$
  select id, name, arrived from guest_list_entries where token = p_token order by created_at, name;
$$;

create or replace function portal_save_menu(p_token uuid, p_pratos text[], p_massa text, p_sabor text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_date date;
  v_limit jsonb;
  v_max int;
  v_pratos text[];
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  select event_date into v_date from reservations where id = v_res;
  if today_brazil() > v_date - 7 then
    raise exception 'O prazo para escolher o cardápio terminou em %. Para alterar, fale com a equipe.', to_char(v_date - 7, 'DD/MM');
  end if;
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
    menu_confirmed_at = now()
  where id = v_res;
  perform set_config('app.audit_actor', '', true);
  perform portal_log(v_res, 'cardapio',
    'Confirmou o cardápio: ' || coalesce(nullif(array_to_string(v_pratos, ', '), ''), 'sem pratos quentes') || ' · bolo de massa ' || lower(p_massa) || ', recheio ' || p_sabor);
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

create or replace function portal_submit_receipt(p_token uuid, p_amount numeric, p_path text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_id uuid;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Informe o valor pago.'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> p_token::text then raise exception 'Arquivo inválido.'; end if;
  if (select count(*) from portal_receipts where reservation_id = v_res and status = 'em_analise') >= 5 then
    raise exception 'Já existem comprovantes aguardando conferência. Aguarde a equipe.';
  end if;
  insert into portal_receipts (reservation_id, amount, storage_path) values (v_res, round(p_amount, 2), p_path) returning id into v_id;
  perform portal_log(v_res, 'comprovante', 'Enviou comprovante de pagamento de ' || fmt_brl(p_amount), v_id);
  return v_id;
end;
$$;

create or replace function portal_send_message(p_token uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_body text := left(trim(coalesce(p_body, '')), 1000);
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  if v_body = '' then raise exception 'Escreva a mensagem.'; end if;
  if (select count(*) from portal_messages where reservation_id = v_res and from_client and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Muitas mensagens hoje. Fale com a equipe pelo WhatsApp.';
  end if;
  insert into portal_messages (reservation_id, from_client, author_name, body)
  values (v_res, true, (select split_part(c.name, ' ', 1) from reservations r join clients c on c.id = r.client_id where r.id = v_res), v_body);
  perform portal_log(v_res, 'mensagem', 'Mandou uma mensagem: “' || left(v_body, 140) || case when length(v_body) > 140 then '…' else '' end || '”');
end;
$$;

create or replace function portal_submit_review(p_token uuid, p_pratos int, p_bolo int, p_doces int, p_salgados int, p_atendimento int, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_review_token uuid;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  if not festa_ended(v_res) then raise exception 'A avaliação libera quando a festa terminar.'; end if;
  if least(p_pratos, p_bolo, p_doces, p_salgados, p_atendimento) < 1 or greatest(p_pratos, p_bolo, p_doces, p_salgados, p_atendimento) > 5 then
    raise exception 'Dê uma nota de 1 a 5 para cada item.';
  end if;
  select token into v_review_token from review_links where reservation_id = v_res;
  if v_review_token is null then
    insert into review_links (reservation_id, client_name, unit_name)
    select r.id, c.name, u.name from reservations r join clients c on c.id = r.client_id join units u on u.id = r.unit_id where r.id = v_res
    returning token into v_review_token;
  end if;
  if (select count(*) from party_reviews where token = v_review_token) >= 3 then raise exception 'Esta festa já foi avaliada.'; end if;
  insert into party_reviews (token, hot_dish_rating, cake_rating, sweets_rating, snacks_rating, service_rating, comment)
  values (v_review_token, p_pratos, p_bolo, p_doces, p_salgados, p_atendimento, nullif(left(trim(coalesce(p_comment, '')), 2000), ''));
  perform portal_log(v_res, 'avaliacao', 'Enviou a avaliação da festa');
end;
$$;

-- ---------- Funções da equipe ----------
create or replace function mark_portal_events_seen(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'page:portal_avisos') then raise exception 'Sem permissão'; end if;
  update portal_events set seen_at = now(), seen_by_name = current_actor_name() where id = any(p_ids) and seen_at is null;
end;
$$;

create or replace function staff_reply_portal(p_reservation uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (has_permission(auth.uid(), 'page:festa_detalhe') or has_permission(auth.uid(), 'page:portal_avisos')) then raise exception 'Sem permissão'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Escreva a resposta.'; end if;
  insert into portal_messages (reservation_id, from_client, author_name, body) values (p_reservation, false, current_actor_name(), left(trim(p_body), 1000));
  update portal_events set seen_at = now(), seen_by_name = current_actor_name() where reservation_id = p_reservation and kind = 'mensagem' and seen_at is null;
end;
$$;

-- Lança o pagamento do comprovante (tudo junto: pagamento + comprovante "lançado").
create or replace function launch_portal_receipt(p_receipt uuid, p_amount numeric, p_date date, p_method text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  rc portal_receipts%rowtype;
  v_payment uuid;
begin
  if not has_permission(auth.uid(), 'action:festa.pagamentos') then raise exception 'Sem permissão para registrar pagamentos.'; end if;
  select * into rc from portal_receipts where id = p_receipt for update;
  if not found then raise exception 'Comprovante não encontrado.'; end if;
  if rc.status <> 'em_analise' then raise exception 'Este comprovante já foi analisado.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Informe o valor.'; end if;
  insert into payments (reservation_id, amount, payment_date, payment_method, notes)
  values (rc.reservation_id, round(p_amount, 2), coalesce(p_date, today_brazil()), p_method, 'Comprovante enviado pelo portal do cliente')
  returning id into v_payment;
  update portal_receipts set status = 'lancado', payment_id = v_payment, decided_by_name = current_actor_name(), decided_at = now() where id = p_receipt;
  update portal_events set seen_at = now(), seen_by_name = current_actor_name() where ref_id = p_receipt and seen_at is null;
  return v_payment;
end;
$$;

create or replace function reject_portal_receipt(p_receipt uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:festa.pagamentos') then raise exception 'Sem permissão.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Informe a justificativa da recusa.'; end if;
  update portal_receipts set status = 'recusado', reject_reason = left(trim(p_reason), 500), decided_by_name = current_actor_name(), decided_at = now()
  where id = p_receipt and status = 'em_analise';
  if not found then raise exception 'Este comprovante já foi analisado.'; end if;
  update portal_events set seen_at = now(), seen_by_name = current_actor_name() where ref_id = p_receipt and seen_at is null;
end;
$$;

-- ---------- Acessos ----------
do $$
declare f text;
begin
  foreach f in array array[
    'portal_get(uuid)', 'portal_list_guests(uuid)', 'portal_save_menu(uuid, text[], text, text)', 'portal_add_guests(uuid, text[])',
    'portal_remove_guest(uuid, uuid)', 'portal_set_music(uuid, text, text)', 'portal_submit_receipt(uuid, numeric, text)',
    'portal_send_message(uuid, text)', 'portal_submit_review(uuid, int, int, int, int, int, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  foreach f in array array[
    'mark_portal_events_seen(uuid[])', 'staff_reply_portal(uuid, text)', 'launch_portal_receipt(uuid, numeric, date, text)', 'reject_portal_receipt(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Histórico de quem fez o quê também nas tabelas novas.
drop trigger if exists trg_audit on portal_receipts;

create trigger trg_audit after insert or update or delete on portal_receipts for each row execute function audit_row_change();

drop trigger if exists trg_audit on portal_menu_options;

create trigger trg_audit after insert or update or delete on portal_menu_options for each row execute function audit_row_change();

-- =========================================================
-- CORREÇÃO DO PORTAL DO CLIENTE ("Link não encontrado")
--
-- A tabela de pagamentos do sistema real foi criada antes de existir a
-- coluna created_at (o instalador schema.sql já tinha, o banco real não).
-- O portal ordena os pagamentos por ela e dava erro, aparecendo como
-- "Link não encontrado". Esta correção cria a coluna; os pagamentos que já
-- existem ficam com a data do próprio pagamento.
-- =========================================================

alter table payments add column if not exists created_at timestamptz;

update payments set created_at = payment_date::timestamptz where created_at is null;

alter table payments alter column created_at set default now();

alter table payments alter column created_at set not null;

-- =========================================================
-- CARDÁPIO DEPOIS DO PRAZO
--
-- O cliente pode enviar (ou trocar) o cardápio mesmo depois do prazo de
-- 7 dias antes da festa, até o dia da festa. Nesse caso fica marcado
-- "enviado após o prazo" na festa, no histórico do cliente e no aviso
-- do Painel.
-- =========================================================

alter table reservations add column if not exists menu_sent_late boolean not null default false;

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

-- =========================================================
-- EDITAR O CUSTO DE QUALQUER ITEM DO ESTOQUE
--
-- Antes só dava para definir o custo de item "sem custo". Agora dá para
-- corrigir o custo (R$ por litro, por pacote, por unidade...) de qualquer
-- item: o valor em estoque passa a ser quantidade × novo custo. Não cria
-- lançamento no Financeiro e não muda consumos já lançados nas festas (o
-- custo deles fica congelado). Fica registrado no histórico do item.
-- =========================================================

drop function if exists set_initial_stock_cost(uuid, numeric);

create or replace function set_initial_stock_cost(p_item uuid, p_unit_cost numeric, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  it inventory_items%rowtype;
  v_old_unit numeric;
begin
  if not has_permission(auth.uid(), 'action:estoque.custo_inicial') then raise exception 'Sem permissão'; end if;
  if p_unit_cost is null or p_unit_cost < 0 then raise exception 'Informe um custo unitário válido.'; end if;
  select * into it from inventory_items where id = p_item for update;
  if not found then raise exception 'Item não encontrado.'; end if;
  v_old_unit := case when it.quantity > 0 then it.total_value / it.quantity else it.last_unit_cost end;

  perform set_config('app.stock_fn', '1', true);
  update inventory_items set total_value = round(quantity * p_unit_cost, 6), has_cost = true, last_unit_cost = p_unit_cost, updated_at = now() where id = p_item;
  insert into inventory_movements (inventory_item_id, unit_id, kind, quantity, value, reason, created_by_name)
  values (p_item, it.unit_id, 'custo_inicial', 0, round(it.quantity * p_unit_cost, 6) - it.total_value,
          case when it.has_cost
               then 'Custo corrigido: de ' || fmt_brl(v_old_unit) || ' para ' || fmt_brl(p_unit_cost) || ' por ' || it.unit_of_measure
               else 'Custo inicial definido: ' || fmt_brl(p_unit_cost) || ' por ' || it.unit_of_measure end
          || coalesce(' · ' || nullif(trim(p_reason), ''), ''),
          current_actor_name());
  perform set_config('app.stock_fn', '', true);
end;
$$;

revoke all on function set_initial_stock_cost(uuid, numeric, text) from public, anon;

grant execute on function set_initial_stock_cost(uuid, numeric, text) to authenticated;

commit;
