-- =========================================================
-- Festas com mais de um aniversariante (ex: irmãos fazendo festa
-- junta). O primeiro aniversariante continua em reservations.child_name/
-- child_age — esta tabela guarda só os ADICIONAIS.
-- =========================================================

create table if not exists reservation_birthday_kids (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  name text not null,
  age int,
  created_at timestamptz not null default now()
);

create index if not exists idx_reservation_birthday_kids_reservation on reservation_birthday_kids (reservation_id);

alter table reservation_birthday_kids enable row level security;

create policy "authenticated_full_access" on reservation_birthday_kids
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
