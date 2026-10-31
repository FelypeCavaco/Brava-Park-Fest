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

begin;

create table if not exists platform_deleted_companies (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  nome text not null,
  excluida_em timestamptz not null default now(),
  copia jsonb not null,
  arquivos int not null default 0,
  logins int not null default 0
);
alter table platform_deleted_companies enable row level security; -- sem regras: só pelas funções abaixo
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

commit;

notify pgrst, 'reload schema';
