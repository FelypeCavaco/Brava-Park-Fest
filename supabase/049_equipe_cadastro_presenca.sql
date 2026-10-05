-- =========================================================
-- Equipe da festa:
--   • cadastro fixo de funcionários (staff_members) — a escala de cada festa
--     passa a ser montada marcando quem vai trabalhar, sem redigitar nomes;
--   • presença ("Compareceu") e vínculo com o custo lançado na festa, pra
--     não lançar o pagamento do mesmo funcionário duas vezes;
--   • substituição registrada (quem substituiu, por quê).
-- Lista de convidados: marcação "sinalizado" (ex: veio sem estar na lista).
-- =========================================================

create table if not exists staff_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  default_role text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table staff_members enable row level security;

create policy "read_staff_members" on staff_members for select
  using (has_permission(auth.uid(), 'page:festa_detalhe') or has_permission(auth.uid(), 'page:escalas'));
create policy "write_staff_members" on staff_members for all
  using (has_permission(auth.uid(), 'action:festa.equipe'))
  with check (has_permission(auth.uid(), 'action:festa.equipe'));

alter table staff_assignments add column if not exists staff_member_id uuid references staff_members(id) on delete set null;
alter table staff_assignments add column if not exists attended boolean not null default false;
alter table staff_assignments add column if not exists attended_at timestamptz;
alter table staff_assignments add column if not exists payment_cost_id uuid references reservation_costs(id) on delete set null;
alter table staff_assignments add column if not exists status text not null default 'escalado'
  check (status in ('escalado', 'substituido'));
alter table staff_assignments add column if not exists substituted_by_name text;
alter table staff_assignments add column if not exists substitution_reason text;
alter table staff_assignments add column if not exists replaces_assignment_id uuid references staff_assignments(id) on delete set null;
alter table staff_assignments add column if not exists created_at timestamptz not null default now();

-- Quem já trabalhou em alguma festa vira funcionário cadastrado
-- automaticamente (um por nome), e as escalas antigas ficam ligadas a ele.
insert into staff_members (name, default_role)
select distinct on (lower(trim(staff_name))) trim(staff_name), role
from staff_assignments
where trim(staff_name) <> ''
  and not exists (select 1 from staff_members sm where lower(trim(sm.name)) = lower(trim(staff_assignments.staff_name)))
order by lower(trim(staff_name)), role nulls last;

update staff_assignments sa
set staff_member_id = sm.id
from staff_members sm
where sa.staff_member_id is null
  and lower(trim(sa.staff_name)) = lower(trim(sm.name));

alter table guest_list_entries add column if not exists flagged boolean not null default false;
