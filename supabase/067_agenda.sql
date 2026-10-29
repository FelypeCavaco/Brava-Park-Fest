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

begin;

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

commit;

notify pgrst, 'reload schema';
