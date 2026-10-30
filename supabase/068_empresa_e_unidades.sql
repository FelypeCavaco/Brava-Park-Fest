-- =========================================================
-- EMPRESA E UNIDADES CONFIGURÁVEIS (venda do sistema — Etapa 1)
--
-- 1) companies: nome, logo, frase da marca, WhatsApp da equipe, mascote e tema do portal da
--    empresa. Hoje só existe a Brava; na etapa de várias empresas cada
--    cadastro vai apontar para uma linha desta tabela.
-- 2) units ganha: code (apelido fixo usado pelas telas), color (cor nos
--    gráficos) e sort (ordem). Toda unidade nova já nasce com o seu espaço
--    (toda reserva precisa de um espaço), e trocar o nome da unidade troca
--    o nome do espaço junto.
-- 3) public_company_brand(): nome/logo/WhatsApp/tema para a tela de login e
--    o portal do cliente (que abrem sem login). Nada sigiloso.
-- 4) Arquivo da logo: pasta pública "marca" (só administrador envia).
--
-- Brava: tudo é preenchido com os valores de hoje — nada muda na tela.
-- Não altera festas, pagamentos, clientes ou contas.
-- Roda dentro de uma transação.
-- =========================================================

begin;

-- ---------- 1) Empresa ----------
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  logo_url text,
  tagline text, -- frase da marca (tela de login)
  team_whatsapp text,
  mascot_enabled boolean not null default false,
  portal_theme text not null default 'padrao' check (portal_theme in ('padrao', 'mario')),
  created_at timestamptz not null default now()
);

insert into companies (name, logo_url, tagline, team_whatsapp, mascot_enabled, portal_theme)
select 'Brava Park Fest', '/marca/logo-brava-park-fest.png', 'Aqui a diversão é garantida', '47992261550', true, 'mario'
where not exists (select 1 from companies);

alter table companies enable row level security;
drop policy if exists "read_active" on companies;
create policy "read_active" on companies for select using (is_active_user(auth.uid()));
drop policy if exists "update_admin" on companies;
create policy "update_admin" on companies for update using (is_admin_user(auth.uid())) with check (is_admin_user(auth.uid()));
-- (sem insert/delete pela tela: empresa nova só pelo painel do administrador geral, numa etapa futura)

create or replace function public_company_brand()
returns table (name text, logo_url text, tagline text, team_whatsapp text, mascot_enabled boolean, portal_theme text)
language sql stable security definer set search_path = public as $$
  select c.name, c.logo_url, c.tagline, c.team_whatsapp, c.mascot_enabled, c.portal_theme
  from companies c order by c.created_at limit 1;
$$;
revoke all on function public_company_brand() from public;
grant execute on function public_company_brand() to anon, authenticated;

-- ---------- 2) Unidades ----------
alter table units add column if not exists code text;
alter table units add column if not exists color text;
alter table units add column if not exists sort int not null default 0;
create unique index if not exists units_code_key on units (code) where code is not null;

update units set code = 'vila-operaria', color = coalesce(color, '#6D28D9'), sort = 1 where name = 'Vila Operária' and code is null;
update units set code = 'sao-vicente', color = coalesce(color, '#7CB92E'), sort = 2 where name = 'São Vicente' and code is null;

alter table units drop constraint if exists units_color_check;
alter table units add constraint units_color_check check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
alter table units drop constraint if exists units_name_not_blank;
alter table units add constraint units_name_not_blank check (length(trim(name)) > 0);

create or replace function sync_unit_space() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from spaces where unit_id = new.id) then
      insert into spaces (unit_id, name) values (new.id, new.name);
    end if;
  elsif new.name is distinct from old.name then
    -- Unidade com um espaço só (o padrão): o espaço acompanha o nome.
    if (select count(*) from spaces where unit_id = new.id) = 1 then
      update spaces set name = new.name where unit_id = new.id;
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_sync_unit_space on units;
create trigger trg_sync_unit_space after insert or update of name on units
  for each row execute function sync_unit_space();

-- Histórico de alterações (quem mudou CNPJ, Pix, nome...).
drop trigger if exists trg_audit on units;
create trigger trg_audit after insert or update or delete on units for each row execute function audit_row_change();
drop trigger if exists trg_audit on companies;
create trigger trg_audit after insert or update or delete on companies for each row execute function audit_row_change();

-- ---------- 3) Logo: pasta pública "marca" ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marca', 'marca', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'marca_insert') then
    create policy "marca_insert" on storage.objects for insert to authenticated with check (bucket_id = 'marca' and is_admin_user(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'marca_update') then
    create policy "marca_update" on storage.objects for update to authenticated using (bucket_id = 'marca' and is_admin_user(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'marca_delete') then
    create policy "marca_delete" on storage.objects for delete to authenticated using (bucket_id = 'marca' and is_admin_user(auth.uid()));
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
