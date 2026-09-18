-- =========================================================
-- Check-in de convidados: marcar quem já chegou na festa,
-- direto na lista de convidados (aba Equipe/Visão geral da
-- Central da Festa).
-- =========================================================

alter table guest_list_entries add column if not exists arrived boolean not null default false;
alter table guest_list_entries add column if not exists arrived_at timestamptz;
