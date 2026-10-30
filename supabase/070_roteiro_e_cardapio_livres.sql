-- =========================================================
-- ROTEIRO E CARDÁPIO LIVRES (venda do sistema — Etapa 2, parte 2)
--
-- Nem toda casa de festas funciona como a Brava. Duas coisas que eram
-- fixas viram listas que cada empresa monta:
--
-- 1) ROTEIRO (programação sugerida no portal), por unidade:
--    units.schedule_enabled (mostra ou não) e units.schedule_items, uma
--    lista de itens { titulo, detalhe, ref: 'inicio' | 'fim', minutos,
--    secao } — "X min depois do início" ou "X min antes do fim"; `secao`
--    (opcional) = só aparece se a festa tiver escolhas naquela seção do
--    cardápio (ex.: pratos quentes só em pacote com pratos quentes).
--    Início e encerramento continuam automáticos.
--
-- 2) CARDÁPIO, em seções (menu_sections): cada seção tem nome, quantas
--    escolhas ("uma", "várias" = N fixo, ou "pelo pacote" = pratos quentes
--    inclusos + extras), se aceita "outro (combinar com a equipe)", e pode
--    valer para todas as unidades ou só uma. As opções continuam em
--    portal_menu_options, agora ligadas à seção.
--    As escolhas ficam em reservations.menu_choices. Seções ligadas a um
--    campo antigo (prato quente, massa e recheio do bolo) continuam
--    gravando nesse campo, para relatórios, Central da festa e mensagens
--    aos fornecedores funcionarem como hoje.
--
-- Brava: o roteiro de hoje vira 3 itens (parabéns 90 min, pratos quentes
-- 100 min só com pratos, bolo 120 min) e o cardápio de hoje vira 3 seções
-- (Pratos quentes pelo pacote, Massa do bolo, Recheio do bolo com "Outro
-- sabor"). Nada muda para o cliente. Unidade nova nasce com o roteiro
-- desligado; empresa nova começa sem seções de cardápio (portal sem a aba).
--
-- Não altera festas, pagamentos, clientes ou contas já existentes.
-- Roda dentro de uma transação.
-- =========================================================

begin;

-- ---------- 1) Roteiro ----------
alter table units add column if not exists schedule_enabled boolean not null default false;
alter table units add column if not exists schedule_items jsonb not null default '[]'::jsonb;
alter table units drop constraint if exists units_schedule_items_check;
alter table units add constraint units_schedule_items_check check (jsonb_typeof(schedule_items) = 'array');

-- ---------- 2) Seções do cardápio ----------
create table if not exists menu_sections (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  help text,
  mode text not null default 'uma' check (mode in ('uma', 'varias', 'pacote')),
  quantity int not null default 1 check (quantity between 1 and 30),
  allow_other boolean not null default false,
  other_label text not null default 'Outro (combinar com a equipe)',
  unit_id uuid references units(id) on delete cascade, -- null = todas as unidades
  legacy_field text unique check (legacy_field in ('hot_dish_flavors', 'cake_dough', 'cake_flavor')),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table menu_sections enable row level security;
drop policy if exists "read_active" on menu_sections;
create policy "read_active" on menu_sections for select using (is_active_user(auth.uid()));
drop policy if exists "write_menu_sections" on menu_sections;
create policy "write_menu_sections" on menu_sections for all
  using (has_permission(auth.uid(), 'action:pacotes.criar_editar'))
  with check (has_permission(auth.uid(), 'action:pacotes.criar_editar'));
drop trigger if exists trg_audit on menu_sections;
create trigger trg_audit after insert or update or delete on menu_sections for each row execute function audit_row_change();

alter table portal_menu_options add column if not exists section_id uuid references menu_sections(id) on delete cascade;
alter table portal_menu_options alter column kind drop not null;
create unique index if not exists portal_menu_options_section_name on portal_menu_options (section_id, name) where section_id is not null;

alter table reservations add column if not exists menu_choices jsonb;

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

commit;

notify pgrst, 'reload schema';
