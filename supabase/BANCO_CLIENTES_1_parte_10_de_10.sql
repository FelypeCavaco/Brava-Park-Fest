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
