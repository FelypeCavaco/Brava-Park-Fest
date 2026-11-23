-- =========================================================
-- RECREAÇÃO — ETAPA 2: cadastro das famílias
--
-- Funciona nos dois bancos (Brava e clientes). Precisa da 100.
-- Roda numa transação. Não mexe em nenhum dado existente.
--
-- 1) Família = responsável (nome, CPF, WhatsApp, e-mail) + crianças (várias)
--    + pessoas autorizadas a buscar + aceite do termo (com data e o texto
--    aceito) + autorização de imagem.
-- 2) Aviso de possível duplicado: mesmo CPF (não deixa salvar), mesmo
--    WhatsApp, nome do responsável quase igual, criança com nome quase igual
--    e a mesma data de nascimento.
-- 3) Juntar dois cadastros da mesma família (com motivo): as crianças e os
--    autorizados vão para o que fica; o outro fica marcado como juntado.
-- 4) Busca por CPF, telefone, nome do responsável ou nome da criança.
-- 5) Foto da criança (pasta privada "recreacao-fotos", por casa).
-- Nada é apagado: criança ou autorizado que sai fica desativado no histórico.
--
-- Permissões novas (Usuários e permissões → Recreação):
--   page:recreacao_familias          ver e procurar as famílias
--   action:recreacao.familias_editar cadastrar e editar
--   action:recreacao.familias_juntar juntar cadastros repetidos
-- Desfazer: 102_REVERTER_recreacao_familias.sql
-- =========================================================

begin;

-- ---------- 1) Tabelas ----------
create table if not exists rec_familias (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  responsavel text not null check (length(trim(responsavel)) between 2 and 120),
  cpf text check (cpf ~ '^[0-9]{11}$'),
  telefone text check (telefone ~ '^[0-9]{10,13}$'),
  email text,
  imagem_autorizada boolean not null default false,
  termo_aceito_em timestamptz,
  termo_texto text,
  termo_registrado_por text,
  observacoes text,
  origem text not null default 'balcao' check (origem in ('balcao', 'autocadastro')),
  ativo boolean not null default true,
  mesclada_para uuid references rec_familias(id),
  mesclada_em timestamptz,
  mesclada_motivo text,
  criado_em timestamptz not null default now(),
  criado_por text,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
create unique index if not exists uq_rec_familias_cpf on rec_familias (company_id, cpf) where cpf is not null and ativo;
create index if not exists idx_rec_familias_tel on rec_familias (company_id, telefone) where ativo;
create index if not exists idx_rec_familias_atualizado on rec_familias (company_id, atualizado_em desc) where ativo;

create table if not exists rec_criancas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  familia_id uuid not null references rec_familias(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 120),
  nascimento date not null check (nascimento > date '1990-01-01'),
  cuidados text,
  foto_path text,
  foto_em timestamptz,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  criado_por text,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
create index if not exists idx_rec_criancas_familia on rec_criancas (familia_id);
create index if not exists idx_rec_criancas_nasc on rec_criancas (company_id, nascimento) where ativo;

create table if not exists rec_autorizados (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  familia_id uuid not null references rec_familias(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 120),
  documento text,
  parentesco text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  criado_por text
);
create index if not exists idx_rec_autorizados_familia on rec_autorizados (familia_id);

do $$
declare t text;
begin
  foreach t in array array['rec_familias', 'rec_criancas', 'rec_autorizados'] loop
    execute format('create index if not exists %I on %I (company_id)', 'idx_' || t || '_company', t);
    execute format('drop trigger if exists trg_set_company_id on %I', t);
    execute format('create trigger trg_set_company_id before insert or update on %I for each row execute function set_company_id()', t);
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists company_isolation on %I', t);
    execute format('create policy company_isolation on %I as restrictive for all
      using (company_id = current_company_id() or (auth.uid() is null and current_user = %L))
      with check (company_id = current_company_id() or (auth.uid() is null and current_user = %L))', t, 'app_definer', 'app_definer');
    execute format('drop policy if exists app_definer_all on %I', t);
    execute format('create policy app_definer_all on %I for all to app_definer using (true) with check (true)', t);
    execute format('drop policy if exists "read_recreacao" on %I', t);
    execute format('create policy "read_recreacao" on %I for select using (has_permission(auth.uid(), %L) or has_permission(auth.uid(), %L) or is_platform_admin(auth.uid()))',
                   t, 'page:recreacao', 'page:recreacao_familias');
    execute format('revoke all on %I from anon', t);
    execute format('grant select on %I to authenticated', t);
    execute format('grant all on %I to app_definer', t);
    execute format('drop trigger if exists trg_audit on %I', t);
    execute format('create trigger trg_audit after insert or update or delete on %I for each row execute function audit_row_change()', t);
  end loop;
end $$;
-- Escrita só pelas funções abaixo.

-- ---------- 2) Ajudantes ----------
-- texto sem acento, minúsculo, espaços simples
create or replace function rec_norm(t text) returns text language sql immutable as $$
  select regexp_replace(trim(lower(translate(coalesce(t, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'))), '\s+', ' ', 'g');
$$;
create or replace function rec_digitos(t text) returns text language sql immutable as $$
  select nullif(regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g'), '');
$$;
-- diferença entre dois textos (quantas letras trocar); para quando passa de p_max
create or replace function rec_lev(a text, b text, p_max int default 3) returns int language plpgsql immutable as $$
declare la int := length(a); lb int := length(b); prev int[]; cur int[]; i int; j int; c int; menor int;
begin
  if abs(la - lb) > p_max then return p_max + 1; end if;
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  prev := array(select generate_series(0, lb));
  for i in 1 .. la loop
    cur := array[i]; menor := i;
    for j in 1 .. lb loop
      c := least(prev[j + 1] + 1, cur[j] + 1, prev[j] + case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end);
      cur := cur || c;
      if c < menor then menor := c; end if;
    end loop;
    if menor > p_max then return p_max + 1; end if;
    prev := cur;
  end loop;
  return prev[lb + 1];
end;
$$;
create or replace function rec_cpf_valido(p text) returns boolean language plpgsql immutable as $$
declare d text := rec_digitos(p); s int; r int; k int;
begin
  if d is null or length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  for k in 0 .. 1 loop
    s := 0;
    for i in 1 .. 9 + k loop s := s + substr(d, i, 1)::int * (11 + k - i); end loop;
    r := s % 11;
    if (case when r < 2 then 0 else 11 - r end) <> substr(d, 10 + k, 1)::int then return false; end if;
  end loop;
  return true;
end;
$$;
create or replace function rec_cpf_fmt(d text) returns text language sql immutable as $$
  select case when d ~ '^[0-9]{11}$' then substr(d, 1, 3) || '.' || substr(d, 4, 3) || '.' || substr(d, 7, 3) || '-' || substr(d, 10, 2) else d end;
$$;

create or replace function rec_pode(p_chave text) returns boolean
language sql stable security definer set search_path = public as $$
  select rec_ligada() and (has_permission(auth.uid(), p_chave) or is_platform_admin(auth.uid()));
$$;
revoke all on function rec_pode(text) from public, anon;
grant execute on function rec_pode(text) to authenticated;

-- ---------- 3) Família completa ----------
create or replace function rec_familia_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', f.id, 'responsavel', f.responsavel, 'cpf', f.cpf, 'telefone', f.telefone, 'email', f.email,
    'imagem_autorizada', f.imagem_autorizada, 'termo_aceito_em', f.termo_aceito_em, 'termo_registrado_por', f.termo_registrado_por,
    'observacoes', f.observacoes, 'origem', f.origem, 'ativo', f.ativo, 'mesclada_para', f.mesclada_para,
    'criado_em', f.criado_em, 'criado_por', f.criado_por, 'atualizado_em', f.atualizado_em, 'atualizado_por', f.atualizado_por,
    'criancas', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'nascimento', c.nascimento, 'cuidados', c.cuidados,
                 'foto_path', c.foto_path, 'ativo', c.ativo) order by c.ativo desc, c.nascimento) from rec_criancas c where c.familia_id = f.id), '[]'),
    'autorizados', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.nome, 'documento', a.documento, 'parentesco', a.parentesco, 'ativo', a.ativo)
                 order by a.ativo desc, a.criado_em) from rec_autorizados a where a.familia_id = f.id), '[]'))
  from rec_familias f where f.id = p_id and f.company_id = current_company_id();
$$;
revoke all on function rec_familia_json(uuid) from public, anon;

create or replace function rec_familia_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (rec_pode('page:recreacao_familias') or rec_pode('page:recreacao')) then raise exception 'Sem permissão para ver as famílias.'; end if;
  return rec_familia_json(p_id);
end;
$$;
revoke all on function rec_familia_get(uuid) from public, anon;
grant execute on function rec_familia_get(uuid) to authenticated;

-- ---------- 4) Busca ----------
-- Texto vazio: as últimas famílias mexidas.
create or replace function rec_familias_buscar(p_texto text default '', p_limite int default 20) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t text := rec_norm(p_texto); d text := rec_digitos(p_texto); r jsonb;
begin
  if not (rec_pode('page:recreacao_familias') or rec_pode('page:recreacao')) then raise exception 'Sem permissão para ver as famílias.'; end if;
  select coalesce(jsonb_agg(rec_familia_json(x.id) order by x.ordem, x.atualizado_em desc), '[]') into r from (
    select f.id, f.atualizado_em,
      case when d is not null and f.cpf = d then 0 when d is not null and f.cpf like d || '%' then 1 else 2 end ordem
    from rec_familias f
    where f.company_id = current_company_id() and f.ativo
      and (
        (length(coalesce(t, '')) < 2 and d is null)
        or (d is not null and length(d) >= 3 and (f.cpf like d || '%' or f.telefone like '%' || d || '%'))
        or (length(t) >= 2 and d is null and (rec_norm(f.responsavel) like '%' || t || '%'
            or exists (select 1 from rec_criancas c where c.familia_id = f.id and c.ativo and rec_norm(c.nome) like '%' || t || '%')))
      )
    order by 3, f.atualizado_em desc
    limit greatest(1, least(coalesce(p_limite, 20), 50))
  ) x;
  return r;
end;
$$;
revoke all on function rec_familias_buscar(text, int) from public, anon;
grant execute on function rec_familias_buscar(text, int) to authenticated;

-- ---------- 5) Possíveis duplicados ----------
-- p_criancas: [{ "nome": "...", "nascimento": "2021-03-14" }]
create or replace function rec_familia_parecidas(p_ignorar uuid, p_cpf text, p_telefone text, p_responsavel text, p_criancas jsonb default '[]')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_cpf text := rec_digitos(p_cpf); v_tel text := rec_digitos(p_telefone); v_nome text := rec_norm(p_responsavel);
  v_nascs date[]; f record; c jsonb; achada record; motivos text[]; out jsonb := '[]'; bloq boolean;
begin
  if not (rec_pode('page:recreacao_familias') or rec_pode('page:recreacao')) then raise exception 'Sem permissão para ver as famílias.'; end if;
  select coalesce(array_agg((x->>'nascimento')::date), '{}') into v_nascs
  from jsonb_array_elements(coalesce(p_criancas, '[]')) x where nullif(x->>'nascimento', '') is not null;
  for f in
    select * from rec_familias fa
    where fa.company_id = current_company_id() and fa.ativo and fa.id is distinct from p_ignorar
      and ((v_cpf is not null and fa.cpf = v_cpf)
        or (v_tel is not null and length(v_tel) >= 10 and fa.telefone = v_tel)
        or (length(v_nome) > 4 and split_part(rec_norm(fa.responsavel), ' ', 1) = split_part(v_nome, ' ', 1))
        or exists (select 1 from rec_criancas cc where cc.familia_id = fa.id and cc.ativo and cc.nascimento = any(v_nascs)))
    limit 300
  loop
    motivos := '{}'; bloq := false;
    if v_cpf is not null and f.cpf = v_cpf then motivos := motivos || 'mesmo CPF'::text; bloq := true; end if;
    if v_tel is not null and f.telefone = v_tel then motivos := motivos || 'mesmo WhatsApp'::text; end if;
    if length(v_nome) > 4 and rec_lev(rec_norm(f.responsavel), v_nome, 2) <= 2 then
      motivos := motivos || case when rec_norm(f.responsavel) = v_nome then 'mesmo nome do responsável' else 'nome do responsável quase igual' end;
    end if;
    for c in select x from jsonb_array_elements(coalesce(p_criancas, '[]')) x loop
      if nullif(c->>'nascimento', '') is null or length(rec_norm(c->>'nome')) < 3 then continue; end if;
      select cc.nome into achada from rec_criancas cc
      where cc.familia_id = f.id and cc.ativo and cc.nascimento = (c->>'nascimento')::date and rec_lev(rec_norm(cc.nome), rec_norm(c->>'nome'), 2) <= 2
      limit 1;
      if found then motivos := motivos || ('criança parecida com ' || achada.nome || ', mesma data de nascimento'); end if;
    end loop;
    if array_length(motivos, 1) > 0 then
      out := out || jsonb_build_array(jsonb_build_object('id', f.id, 'responsavel', f.responsavel, 'cpf', rec_cpf_fmt(f.cpf), 'telefone', f.telefone,
        'criancas', (select coalesce(jsonb_agg(cc.nome order by cc.nascimento), '[]') from rec_criancas cc where cc.familia_id = f.id and cc.ativo),
        'motivos', to_jsonb(motivos), 'bloqueia', bloq));
    end if;
  end loop;
  return out;
end;
$$;
revoke all on function rec_familia_parecidas(uuid, text, text, text, jsonb) from public, anon;
grant execute on function rec_familia_parecidas(uuid, text, text, text, jsonb) to authenticated;

-- ---------- 6) Salvar (nova ou edição) ----------
-- p_dados: { responsavel, cpf, telefone, email, imagem_autorizada, termo_aceito, observacoes,
--            criancas: [{ id?, nome, nascimento, cuidados, ativo }],
--            autorizados: [{ id?, nome, documento, parentesco, ativo }] }
create or replace function rec_familia_salvar(p_id uuid, p_dados jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id; f rec_familias%rowtype;
  v_nome text := left(regexp_replace(trim(coalesce(p_dados->>'responsavel', '')), '\s+', ' ', 'g'), 120);
  v_cpf text := rec_digitos(p_dados->>'cpf'); v_tel text := rec_digitos(p_dados->>'telefone');
  v_email text := nullif(lower(trim(coalesce(p_dados->>'email', ''))), '');
  v_termo boolean := coalesce((p_dados->>'termo_aceito')::boolean, false);
  v_outra text; x jsonb; n_ativas int; v_cid uuid; v_nasc date;
begin
  if not rec_pode('action:recreacao.familias_editar') then raise exception 'Sem permissão para cadastrar famílias.'; end if;
  if length(v_nome) < 2 then raise exception 'Escreva o nome do responsável.'; end if;
  if v_cpf is not null and not rec_cpf_valido(v_cpf) then raise exception 'CPF inválido: confira os números.'; end if;
  if v_tel is null or length(v_tel) < 10 or length(v_tel) > 13 then raise exception 'Informe o WhatsApp com DDD.'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido.'; end if;
  if v_cpf is not null then
    select responsavel into v_outra from rec_familias where company_id = current_company_id() and ativo and cpf = v_cpf and id is distinct from p_id;
    if found then raise exception 'Já existe uma família com este CPF: %.', v_outra; end if;
  end if;

  -- crianças: pelo menos uma ativa, nome e data certos
  select count(*) into n_ativas from jsonb_array_elements(coalesce(p_dados->'criancas', '[]')) k where coalesce((k->>'ativo')::boolean, true);
  if n_ativas = 0 then raise exception 'Cadastre pelo menos uma criança.'; end if;
  if n_ativas > 15 then raise exception 'Muitas crianças num cadastro só.'; end if;
  for x in select y from jsonb_array_elements(p_dados->'criancas') y loop
    if length(trim(coalesce(x->>'nome', ''))) < 2 then raise exception 'Escreva o nome de cada criança.'; end if;
    v_nasc := nullif(x->>'nascimento', '')::date;
    if v_nasc is null then raise exception 'Informe a data de nascimento de %.', trim(x->>'nome'); end if;
    if v_nasc > today_brazil() or v_nasc < today_brazil() - interval '18 years' then raise exception 'Confira a data de nascimento de %.', trim(x->>'nome'); end if;
  end loop;
  for x in select y from jsonb_array_elements(coalesce(p_dados->'autorizados', '[]')) y loop
    if coalesce((x->>'ativo')::boolean, true) and length(trim(coalesce(x->>'nome', ''))) < 2 then raise exception 'Escreva o nome de quem pode buscar.'; end if;
  end loop;

  if v_id is null then
    if not v_termo then raise exception 'O responsável precisa aceitar o termo de responsabilidade.'; end if;
    insert into rec_familias (responsavel, cpf, telefone, email, imagem_autorizada, termo_aceito_em, termo_texto, termo_registrado_por, observacoes, criado_por, atualizado_por)
    values (v_nome, v_cpf, v_tel, v_email, coalesce((p_dados->>'imagem_autorizada')::boolean, false), now(),
            (select coalesce(termo, '') from rec_config where company_id = current_company_id()), current_actor_name(),
            nullif(left(trim(coalesce(p_dados->>'observacoes', '')), 1000), ''), current_actor_name(), current_actor_name())
    returning id into v_id;
  else
    select * into f from rec_familias where id = v_id and company_id = current_company_id() and ativo for update;
    if not found then raise exception 'Família não encontrada.'; end if;
    update rec_familias set responsavel = v_nome, cpf = v_cpf, telefone = v_tel, email = v_email,
      imagem_autorizada = coalesce((p_dados->>'imagem_autorizada')::boolean, imagem_autorizada),
      termo_aceito_em = case when termo_aceito_em is null and v_termo then now() else termo_aceito_em end,
      termo_texto = case when termo_aceito_em is null and v_termo then (select termo from rec_config where company_id = current_company_id()) else termo_texto end,
      termo_registrado_por = case when termo_aceito_em is null and v_termo then current_actor_name() else termo_registrado_por end,
      observacoes = nullif(left(trim(coalesce(p_dados->>'observacoes', '')), 1000), ''),
      atualizado_em = now(), atualizado_por = current_actor_name()
    where id = v_id;
  end if;

  for x in select y from jsonb_array_elements(p_dados->'criancas') y loop
    v_cid := nullif(x->>'id', '')::uuid;
    if v_cid is not null and exists (select 1 from rec_criancas where id = v_cid and familia_id = v_id) then
      update rec_criancas set nome = left(trim(x->>'nome'), 120), nascimento = (x->>'nascimento')::date,
        cuidados = nullif(left(trim(coalesce(x->>'cuidados', '')), 500), ''), ativo = coalesce((x->>'ativo')::boolean, true),
        atualizado_em = now(), atualizado_por = current_actor_name()
      where id = v_cid;
    elsif coalesce((x->>'ativo')::boolean, true) then
      insert into rec_criancas (familia_id, nome, nascimento, cuidados, criado_por, atualizado_por)
      values (v_id, left(trim(x->>'nome'), 120), (x->>'nascimento')::date, nullif(left(trim(coalesce(x->>'cuidados', '')), 500), ''), current_actor_name(), current_actor_name());
    end if;
  end loop;
  for x in select y from jsonb_array_elements(coalesce(p_dados->'autorizados', '[]')) y loop
    v_cid := nullif(x->>'id', '')::uuid;
    if v_cid is not null and exists (select 1 from rec_autorizados where id = v_cid and familia_id = v_id) then
      update rec_autorizados set nome = left(trim(x->>'nome'), 120), documento = nullif(left(trim(coalesce(x->>'documento', '')), 40), ''),
        parentesco = nullif(left(trim(coalesce(x->>'parentesco', '')), 40), ''), ativo = coalesce((x->>'ativo')::boolean, true)
      where id = v_cid;
    elsif coalesce((x->>'ativo')::boolean, true) then
      insert into rec_autorizados (familia_id, nome, documento, parentesco, criado_por)
      values (v_id, left(trim(x->>'nome'), 120), nullif(left(trim(coalesce(x->>'documento', '')), 40), ''), nullif(left(trim(coalesce(x->>'parentesco', '')), 40), ''), current_actor_name());
    end if;
  end loop;
  return v_id;
end;
$$;
revoke all on function rec_familia_salvar(uuid, jsonb) from public, anon;
grant execute on function rec_familia_salvar(uuid, jsonb) to authenticated;

-- ---------- 7) Foto da criança ----------
create or replace function rec_crianca_foto(p_crianca uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not rec_pode('action:recreacao.familias_editar') then raise exception 'Sem permissão para cadastrar famílias.'; end if;
  if p_path is not null and split_part(p_path, '/', 1) <> current_company_id()::text then raise exception 'Foto em lugar errado.'; end if;
  update rec_criancas set foto_path = p_path, foto_em = case when p_path is null then null else now() end, atualizado_em = now(), atualizado_por = current_actor_name()
  where id = p_crianca and company_id = current_company_id();
  if not found then raise exception 'Criança não encontrada.'; end if;
end;
$$;
revoke all on function rec_crianca_foto(uuid, text) from public, anon;
grant execute on function rec_crianca_foto(uuid, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recreacao-fotos', 'recreacao-fotos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
do $$
begin
  drop policy if exists "rec_fotos_ler" on storage.objects;
  create policy "rec_fotos_ler" on storage.objects for select to authenticated
    using (bucket_id = 'recreacao-fotos' and (storage.foldername(name))[1] = current_company_id()::text
           and (has_permission(auth.uid(), 'page:recreacao') or has_permission(auth.uid(), 'page:recreacao_familias') or is_platform_admin(auth.uid())));
  drop policy if exists "rec_fotos_enviar" on storage.objects;
  create policy "rec_fotos_enviar" on storage.objects for insert to authenticated
    with check (bucket_id = 'recreacao-fotos' and (storage.foldername(name))[1] = current_company_id()::text
                and (has_permission(auth.uid(), 'action:recreacao.familias_editar') or is_platform_admin(auth.uid())));
  drop policy if exists "rec_fotos_trocar" on storage.objects;
  create policy "rec_fotos_trocar" on storage.objects for update to authenticated
    using (bucket_id = 'recreacao-fotos' and (storage.foldername(name))[1] = current_company_id()::text
           and (has_permission(auth.uid(), 'action:recreacao.familias_editar') or is_platform_admin(auth.uid())));
  drop policy if exists "rec_fotos_apagar" on storage.objects;
  create policy "rec_fotos_apagar" on storage.objects for delete to authenticated
    using (bucket_id = 'recreacao-fotos' and (storage.foldername(name))[1] = current_company_id()::text
           and (has_permission(auth.uid(), 'action:recreacao.familias_editar') or is_platform_admin(auth.uid())));
end $$;

-- ---------- 8) Juntar dois cadastros da mesma família ----------
create or replace function rec_familias_juntar(p_ficar uuid, p_sair uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a rec_familias%rowtype; b rec_familias%rowtype;
begin
  if not rec_pode('action:recreacao.familias_juntar') then raise exception 'Sem permissão para juntar cadastros.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escreva o motivo.'; end if;
  if p_ficar = p_sair then raise exception 'Escolha dois cadastros diferentes.'; end if;
  select * into a from rec_familias where id = p_ficar and company_id = current_company_id() and ativo for update;
  select * into b from rec_familias where id = p_sair and company_id = current_company_id() and ativo for update;
  if a.id is null or b.id is null then raise exception 'Cadastro não encontrado.'; end if;
  update rec_criancas set familia_id = a.id, atualizado_em = now(), atualizado_por = current_actor_name() where familia_id = b.id;
  update rec_autorizados set familia_id = a.id where familia_id = b.id;
  -- (etapa 3: as visitas da família que sai também passam para a que fica)
  update rec_familias set ativo = false, mesclada_para = a.id, mesclada_em = now(), mesclada_motivo = left(trim(p_motivo), 300),
    atualizado_em = now(), atualizado_por = current_actor_name()
  where id = b.id;
  -- o que só o outro cadastro tinha passa para o que fica
  update rec_familias set
    cpf = coalesce(cpf, b.cpf), email = coalesce(email, b.email),
    termo_aceito_em = coalesce(termo_aceito_em, b.termo_aceito_em), termo_texto = coalesce(termo_texto, b.termo_texto),
    termo_registrado_por = coalesce(termo_registrado_por, b.termo_registrado_por),
    imagem_autorizada = imagem_autorizada or b.imagem_autorizada,
    observacoes = nullif(concat_ws(E'\n', observacoes, b.observacoes), ''),
    atualizado_em = now(), atualizado_por = current_actor_name()
  where id = a.id;
end;
$$;
revoke all on function rec_familias_juntar(uuid, uuid, text) from public, anon;
grant execute on function rec_familias_juntar(uuid, uuid, text) to authenticated;

do $$
declare fn text;
begin
  foreach fn in array array['rec_norm(text)', 'rec_digitos(text)', 'rec_lev(text,text,integer)', 'rec_cpf_valido(text)', 'rec_cpf_fmt(text)'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

commit;
