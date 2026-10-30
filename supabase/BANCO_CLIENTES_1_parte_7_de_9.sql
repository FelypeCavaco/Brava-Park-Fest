-- =========================================================
-- BANCO DOS CLIENTES — ESTRUTURA, PARTE 7 DE 9
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

-- ---------- Vila Operária: tabela 2027 ----------
-- Os planos atuais da Vila Operária passam a valer para festas até
-- 31/12/2026. Para festas a partir de 01/01/2027 entram cópias "(2027)"
-- com os valores do portfólio 2027 — mesmo conteúdo incluso e mesma
-- quantidade de pratos quentes dos planos atuais.
with vo as (select id from units where name = 'Vila Operária'),
precos (tipo, pessoas, semana, fds) as (values
  ('Classic', 40, 6790.00, 7590.00), ('Classic', 50, 7390.00, 8190.00), ('Classic', 60, 8090.00, 8890.00),
  ('Classic', 70, 8790.00, 9690.00), ('Classic', 80, 9490.00, 10490.00), ('Classic', 90, 10190.00, 11290.00),
  ('Classic', 100, 10890.00, 12090.00),
  ('Gourmet', 40, 7790.00, 8590.00), ('Gourmet', 50, 8390.00, 9190.00), ('Gourmet', 60, 9090.00, 9990.00),
  ('Gourmet', 70, 9790.00, 10790.00), ('Gourmet', 80, 10490.00, 11590.00), ('Gourmet', 90, 11190.00, 12390.00),
  ('Gourmet', 100, 11990.00, 13190.00),
  ('Prime', 40, 9290.00, 10190.00), ('Prime', 50, 9990.00, 10990.00), ('Prime', 60, 10790.00, 11890.00),
  ('Prime', 70, 11590.00, 12790.00), ('Prime', 80, 12390.00, 13690.00), ('Prime', 90, 13190.00, 14590.00),
  ('Prime', 100, 13990.00, 15490.00)
),
atuais as (
  select p.* , pr.semana, pr.fds
  from packages p
  cross join vo
  join precos pr on p.name = pr.tipo || ' ' || pr.pessoas || ' pessoas'
  where p.unit_id = vo.id and p.active and p.valid_from is null
)
insert into packages (name, description, base_price, weekday_price, weekend_price, unit_id, guest_limit, duration_hours,
                      included_items, hot_dish_count, valid_from, valid_until, active)
select a.name || ' (2027)', coalesce(a.description, '') || ' — tabela 2027', a.semana, a.semana, a.fds, a.unit_id, a.guest_limit,
       a.duration_hours, a.included_items, a.hot_dish_count, date '2027-01-01', null, true
from atuais a
where not exists (select 1 from packages x where x.unit_id = a.unit_id and x.name = a.name || ' (2027)');

update packages p
set valid_until = date '2026-12-31'
where p.unit_id = (select id from units where name = 'Vila Operária')
  and p.active and p.valid_from is null and p.valid_until is null
  and p.name ~ '^(Classic|Gourmet|Prime) [0-9]+ pessoas$'
  and exists (select 1 from packages x where x.unit_id = p.unit_id and x.name = p.name || ' (2027)');

-- =========================================================
-- QUEM CADASTROU A FESTA + COMISSÃO SÓ DE QUEM RECEBE + HISTÓRICO
--
-- 1) Toda festa passa a guardar quem a cadastrou (`registered_by`). Na tela
--    o campo já vem com quem está logado e pode ser trocado (ex.: a Kamila
--    cadastrou usando o login de outra pessoa). Se a tela não mandar, o
--    banco preenche com quem está logado.
--    Festas antigas: preenchidas com quem as criou, pelo histórico de
--    alterações (quando o histórico tem essa informação).
-- 2) Comissões: a configuração ganha "de quem são as festas que geram
--    comissão" (`commission_settings.beneficiary_user_id`). Só contam as
--    festas cadastradas por essa pessoa. Se a festa trocar de "cadastrada
--    por" depois de a comissão ter sido paga, ela é abatida no próximo
--    repasse (mesma regra do cancelamento).
-- 3) commission_history: todas as festas desde a data de início, com a
--    situação da comissão de cada uma (paga em tal data, a pagar, abatida,
--    não gera e por quê).
--
-- Não altera valores de festas, pagamentos ou contas.
-- Roda dentro de uma transação.
-- =========================================================


-- ---------- 1) Quem cadastrou ----------
alter table reservations add column if not exists registered_by uuid references user_profiles(id) on delete set null;

update reservations r
set registered_by = a.user_id
from (
  select distinct on (entity_id) entity_id, user_id
  from audit_log
  where entity = 'reservations' and action = 'criou' and user_id is not null
  order by entity_id, created_at
) a
where a.entity_id = r.id and r.registered_by is null
  and exists (select 1 from user_profiles up where up.id = a.user_id);

create or replace function set_reservation_registered_by() returns trigger
language plpgsql as $$
begin
  if new.registered_by is null then
    new.registered_by := auth.uid();
    if new.registered_by is not null and not exists (select 1 from user_profiles where id = new.registered_by) then
      new.registered_by := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_reservation_registered_by on reservations;

create trigger trg_set_reservation_registered_by before insert on reservations
  for each row execute function set_reservation_registered_by();

-- ---------- 2) Comissão só das festas de quem recebe ----------
alter table commission_settings add column if not exists beneficiary_user_id uuid references user_profiles(id) on delete set null;

-- Se existir um único usuário ativo chamado Kamila, já fica configurado.
update commission_settings cs
set beneficiary_user_id = k.id, beneficiary = k.name
from (select id, name from user_profiles where active and name ilike 'kamila%') k
where cs.beneficiary_user_id is null
  and (select count(*) from user_profiles where active and name ilike 'kamila%') = 1;

create or replace function commission_pending(p_until date default null)
returns table (reservation_id uuid, unit_id uuid, cliente text, cadastro date, event_date date, status text,
               cancelada_em date, kind text, amount numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_until date := coalesce(p_until, commission_last_sunday());
  v_benef uuid := (select beneficiary_user_id from commission_settings);
begin
  if not has_permission(auth.uid(), 'page:comissoes') then raise exception 'Sem permissão'; end if;
  return query
  with base as (
    select r.id, r.unit_id, coalesce(c.name, '—') cli, (r.created_at at time zone 'America/Sao_Paulo')::date cad,
           r.event_date ev, r.status::text st, (r.cancelled_at at time zone 'America/Sao_Paulo')::date canc,
           case when r.status <> 'cancelada' and (v_benef is null or r.registered_by = v_benef)
                then coalesce(commission_rate_at((r.created_at at time zone 'America/Sao_Paulo')::date), 0) else 0 end devido,
           coalesce((select sum(i.amount) from commission_payout_items i where i.reservation_id = r.id), 0) pago
    from reservations r left join clients c on c.id = r.client_id
    where (r.created_at at time zone 'America/Sao_Paulo')::date >= (select start_date from commission_settings)
  )
  select b.id, b.unit_id, b.cli, b.cad, b.ev, b.st, b.canc,
         case when b.pago = 0 and b.devido > 0 then 'comissao'
              when b.devido = 0 and b.pago > 0 then 'abatimento'
              else 'ajuste' end,
         b.devido - b.pago
  from base b
  where b.devido - b.pago <> 0
    and (b.devido - b.pago < 0 or b.cad <= v_until)
  order by b.cad, b.cli;
end;
$$;

create or replace function set_commission_settings(p_start date, p_beneficiary text, p_beneficiary_user uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:comissoes.configurar') then raise exception 'Sem permissão'; end if;
  if p_start is null then raise exception 'Informe a data de início.'; end if;
  update commission_settings
  set start_date = p_start,
      beneficiary_user_id = p_beneficiary_user,
      beneficiary = coalesce(nullif(trim(p_beneficiary), ''), (select name from user_profiles where id = p_beneficiary_user), 'Gerente')
  where unica;
end;
$$;

drop function if exists set_commission_settings(date, text);

-- ---------- 3) Histórico por festa ----------
create or replace function commission_history(p_from date default null, p_to date default null)
returns table (reservation_id uuid, unit_id uuid, cliente text, cadastro date, event_date date, status text,
               cancelada_em date, cadastrada_por text, conta boolean, devido numeric, pago numeric,
               ultimo_repasse date, situacao text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_benef uuid := (select beneficiary_user_id from commission_settings);
  v_start date := (select start_date from commission_settings);
  v_last date := commission_last_sunday();
begin
  if not has_permission(auth.uid(), 'page:comissoes') then raise exception 'Sem permissão'; end if;
  return query
  with base as (
    select r.id, r.unit_id, coalesce(c.name, '—') cli, (r.created_at at time zone 'America/Sao_Paulo')::date cad,
           r.event_date ev, r.status::text st, (r.cancelled_at at time zone 'America/Sao_Paulo')::date canc,
           up.name quem, (v_benef is null or r.registered_by = v_benef) conta,
           case when r.status <> 'cancelada' and (v_benef is null or r.registered_by = v_benef)
                then coalesce(commission_rate_at((r.created_at at time zone 'America/Sao_Paulo')::date), 0) else 0 end devido,
           coalesce((select sum(i.amount) from commission_payout_items i where i.reservation_id = r.id), 0) pago,
           (select max(p.paid_date) from commission_payout_items i join commission_payouts p on p.id = i.payout_id where i.reservation_id = r.id) ultimo
    from reservations r
    left join clients c on c.id = r.client_id
    left join user_profiles up on up.id = r.registered_by
    where (r.created_at at time zone 'America/Sao_Paulo')::date >= greatest(v_start, coalesce(p_from, v_start))
      and (p_to is null or (r.created_at at time zone 'America/Sao_Paulo')::date <= p_to)
  )
  select b.id, b.unit_id, b.cli, b.cad, b.ev, b.st, b.canc, coalesce(b.quem, '—'), b.conta, b.devido, b.pago, b.ultimo,
         case
           when b.devido > 0 and b.pago = b.devido then 'paga'
           when b.devido > 0 and b.pago = 0 then case when b.cad <= v_last then 'a_pagar' else 'semana_atual' end
           when b.devido > 0 then 'ajuste_pendente'
           when b.devido = 0 and b.pago > 0 then 'abater'
           when b.devido = 0 and b.pago = 0 and exists (select 1 from commission_payout_items i where i.reservation_id = b.id) then 'abatida'
           when not b.conta then 'outra_pessoa'
           else 'cancelada_antes'
         end
  from base b
  order by b.cad desc, b.cli;
end;
$$;

-- ---------- 4) Estoque: avisar ou não na lista de compras ----------
-- Cada item escolhe se entra na Lista de compras quando fica abaixo do
-- mínimo. Itens que já existem continuam avisando (padrão = sim).
alter table inventory_items add column if not exists notify_shopping boolean not null default true;

revoke all on function commission_history(date, date) from public, anon;

grant execute on function commission_history(date, date) to authenticated;

revoke all on function set_commission_settings(date, text, uuid) from public, anon;

grant execute on function set_commission_settings(date, text, uuid) to authenticated;

-- =========================================================
-- AGENDA — compromissos (além das visitas)
--
-- A "Agenda de visitas" vira "Agenda": um calendário com as visitas (que
-- continuam na tabela visits, sem mudança) e os compromissos que a equipe
-- adiciona (reunião, manutenção, pagar algo...).
--
-- Cada compromisso:
--   - pode se repetir (todo dia, toda semana, todo mês, todo ano), com data
--     final opcional; dá para apagar só um dia da repetição;
--   - guarda quem colocou (preenchido pelo banco, não pela tela);
--   - pode "Avisar no Painel" X dias antes. O aviso aparece para todos que
--     entram no Painel, até alguém marcar "Feito" (cada dia da repetição é
--     marcado separado e fica registrado quem marcou).
--
-- Todos que têm acesso à Agenda veem e editam tudo. Não mexe em nenhuma
-- tabela existente além de incluir a nova no histórico de alterações.
-- Roda dentro de uma transação.
-- =========================================================


create table if not exists agenda_items (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  notes text,
  unit_id uuid references units(id), -- null = as duas unidades
  starts_on date not null,
  all_day boolean not null default true,
  start_time time,
  end_time time,
  repeat text not null default 'nao' check (repeat in ('nao', 'diario', 'semanal', 'mensal', 'anual')),
  repeat_until date,
  skipped_dates date[] not null default '{}', -- dias apagados de uma repetição
  notify boolean not null default false,
  notify_days_before int not null default 0 check (notify_days_before between 0 and 60),
  created_by uuid references user_profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  check (all_day or start_time is not null),
  check (repeat_until is null or repeat_until >= starts_on)
);

create index if not exists idx_agenda_items_starts on agenda_items (starts_on);

-- Dias marcados como "Feito" (um registro por dia de cada compromisso).
create table if not exists agenda_done (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references agenda_items(id) on delete cascade,
  occurrence date not null,
  done_by_name text,
  done_at timestamptz not null default now(),
  unique (item_id, occurrence)
);

-- Quem colocou: sempre quem está logado (a tela não consegue trocar).
create or replace function set_agenda_item_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := case when exists (select 1 from user_profiles where id = auth.uid()) then auth.uid() end;
    new.created_by_name := current_actor_name();
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_by_name := old.created_by_name;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_agenda_item_author on agenda_items;

create trigger trg_set_agenda_item_author before insert or update on agenda_items
  for each row execute function set_agenda_item_author();

alter table agenda_items enable row level security;

alter table agenda_done enable row level security;

drop policy if exists "read_agenda_items" on agenda_items;

create policy "read_agenda_items" on agenda_items for select using (has_permission(auth.uid(), 'page:visitas'));

drop policy if exists "write_agenda_items" on agenda_items;

create policy "write_agenda_items" on agenda_items for all
  using (has_permission(auth.uid(), 'page:visitas'))
  with check (has_permission(auth.uid(), 'page:visitas'));

drop policy if exists "read_agenda_done" on agenda_done;

create policy "read_agenda_done" on agenda_done for select using (has_permission(auth.uid(), 'page:visitas'));

-- "Feito" só pelas funções abaixo (registram quem marcou).

-- Avisos do Painel: aparecem para todos os usuários logados, mesmo quem não
-- tem acesso à Agenda. Devolve os compromissos com aviso ligado e os dias
-- já marcados como feitos; a tela calcula quais dias estão na janela.
create or replace function agenda_painel()
returns table (id uuid, title text, notes text, unit_id uuid, starts_on date, all_day boolean, start_time time, end_time time,
               repeat text, repeat_until date, skipped_dates date[], notify_days_before int, created_by_name text, done_dates date[])
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from user_profiles where user_profiles.id = auth.uid() and active) then
    raise exception 'Sem permissão';
  end if;
  return query
  select a.id, a.title, a.notes, a.unit_id, a.starts_on, a.all_day, a.start_time, a.end_time,
         a.repeat, a.repeat_until, a.skipped_dates, a.notify_days_before, a.created_by_name,
         coalesce((select array_agg(d.occurrence) from agenda_done d where d.item_id = a.id), '{}')
  from agenda_items a
  where a.notify
    and a.starts_on <= today_brazil() + 60
    and (a.repeat = 'nao' or a.repeat_until is null or a.repeat_until >= today_brazil() - 31);
end;
$$;

create or replace function agenda_marcar_feito(p_item uuid, p_occurrence date, p_feito boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from user_profiles where id = auth.uid() and active) then
    raise exception 'Sem permissão';
  end if;
  if not exists (select 1 from agenda_items where id = p_item) then raise exception 'Compromisso não encontrado.'; end if;
  if p_feito then
    insert into agenda_done (item_id, occurrence, done_by_name) values (p_item, p_occurrence, current_actor_name())
    on conflict (item_id, occurrence) do nothing;
  else
    delete from agenda_done where item_id = p_item and occurrence = p_occurrence;
  end if;
end;
$$;

revoke all on function agenda_painel() from public, anon;

grant execute on function agenda_painel() to authenticated;

revoke all on function agenda_marcar_feito(uuid, date, boolean) from public, anon;

grant execute on function agenda_marcar_feito(uuid, date, boolean) to authenticated;

-- Histórico de alterações (quem criou, mudou ou apagou cada compromisso).
drop trigger if exists trg_audit on agenda_items;

create trigger trg_audit after insert or update or delete on agenda_items for each row execute function audit_row_change();

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

-- =========================================================
-- REGRAS DO PORTAL DO CLIENTE POR UNIDADE (venda do sistema — Etapa 2)
--
-- O que era fixo para a Brava vira configuração de cada unidade
-- (Configurações → Unidades → Portal do cliente):
--   - idade a partir da qual conta como convidado;
--   - prazos: cardápio (X dias antes), lista de convidados e saldo;
--   - campo de playlist (Spotify) ligado ou desligado;
--   - roteiro: parabéns X min após o início, pratos quentes e bolo X min
--     após o parabéns;
--   - texto das regras da casa ({{convidados}} e {{idade}} viram os números).
-- O portal também recebe nome, logo, WhatsApp e tema da empresa.
--
-- Brava: preenchido com o que vale hoje — Vila Operária: 5 anos, playlist
-- ligada; São Vicente: 3 anos (como no contrato), sem playlist; prazos 7 e
-- 1 dia; parabéns 1h30 após o início, pratos 10 min e bolo 30 min depois.
-- Continua compatível com a tela atual do portal.
-- Não altera festas, pagamentos, clientes ou contas.
-- Roda dentro de uma transação.
-- =========================================================


alter table units add column if not exists guest_min_age int not null default 5;

alter table units add column if not exists menu_deadline_days int not null default 7;

alter table units add column if not exists guest_deadline_days int not null default 1;

alter table units add column if not exists payment_deadline_days int not null default 1;

alter table units add column if not exists playlist_enabled boolean not null default false;

alter table units add column if not exists parabens_after_min int not null default 90;

alter table units add column if not exists hot_dish_after_parabens_min int not null default 10;

alter table units add column if not exists cake_after_parabens_min int not null default 30;

alter table units add column if not exists portal_rules jsonb not null default '[{"titulo":"Limite de convidados","texto":"Até {{convidados}} pessoas, contando a partir de {{idade}} anos. O excedente depende de aprovação e tem cobrança adicional."},{"titulo":"Horário","texto":"Respeitar início e término. Tempo excedente é cobrado por hora adicional, conforme disponibilidade."},{"titulo":"Itens de fora","texto":"Não é permitida a entrada de bebidas alcoólicas, comidas, decorações ou equipamentos externos sem autorização prévia."},{"titulo":"Bebidas alcoólicas","texto":"Não estão inclusas no pacote; podem ser adquiridas no local."},{"titulo":"Segurança das crianças","texto":"A presença de pais ou responsáveis é obrigatória durante toda a festa. A equipe orienta o uso dos brinquedos, mas a responsabilidade pelas crianças é dos responsáveis."},{"titulo":"Danos","texto":"Danos ao espaço, brinquedos ou equipamentos, causados por convidados ou prestadores externos, são cobrados conforme orçamento."}]'::jsonb;

alter table units drop constraint if exists units_portal_limits_check;

alter table units add constraint units_portal_limits_check check (
  guest_min_age between 0 and 18
  and menu_deadline_days between 0 and 60
  and guest_deadline_days between 0 and 60
  and payment_deadline_days between 0 and 60
  and parabens_after_min between 0 and 720
  and hot_dish_after_parabens_min between 0 and 240
  and cake_after_parabens_min between 0 and 240
  and jsonb_typeof(portal_rules) = 'array'
);

-- Brava: valores de hoje.
update units set playlist_enabled = true, guest_min_age = 5 where code = 'vila-operaria';

update units set playlist_enabled = false, guest_min_age = 3 where code = 'sao-vicente';

update units set portal_rules = '[{"titulo":"Limite de convidados","texto":"Até {{convidados}} pessoas, contando a partir de {{idade}} anos. O excedente depende de aprovação e tem cobrança adicional."},{"titulo":"Horário","texto":"Respeitar início e término. Tempo excedente é cobrado por hora adicional, conforme disponibilidade."},{"titulo":"Itens de fora","texto":"Não é permitida a entrada de bebidas alcoólicas, comidas, decorações ou equipamentos externos sem autorização prévia."},{"titulo":"Bebidas alcoólicas","texto":"Não estão inclusas no pacote; podem ser adquiridas no local."},{"titulo":"Segurança das crianças","texto":"A presença de pais ou responsáveis é obrigatória durante toda a festa. A equipe orienta o uso dos brinquedos, mas a responsabilidade pelas crianças é dos responsáveis."},{"titulo":"Danos","texto":"Danos ao espaço, brinquedos ou equipamentos, causados por convidados ou prestadores externos, são cobrados conforme orçamento."},{"titulo":"Cancelamento e troca de data","texto":"Até 30 dias antes: retenção de 20%. De 15 a 29 dias: 50%. Menos de 15 dias: sem devolução. Troca de data uma única vez, com 15 dias de antecedência."}]'::jsonb
where code in ('vila-operaria', 'sao-vicente');

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

create or replace function portal_add_guests(p_token uuid, p_names text[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_date date;
  v_count integer;
  v_dias int;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  select r.event_date, u.guest_deadline_days into v_date, v_dias from reservations r join units u on u.id = r.unit_id where r.id = v_res;
  if today_brazil() > v_date - v_dias then
    raise exception 'A lista de convidados fechou em %. Para incluir alguém, fale com a equipe.', to_char(v_date - v_dias, 'DD/MM');
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
  v_dias int;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  select r.event_date, u.guest_deadline_days into v_date, v_dias from reservations r join units u on u.id = r.unit_id where r.id = v_res;
  if today_brazil() > v_date - v_dias then
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
  if not coalesce((select u.playlist_enabled from reservations r join units u on u.id = r.unit_id where r.id = v_res), false) then
    raise exception 'A escolha de música não está disponível para esta festa.';
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

commit;
