-- =========================================================
-- Brava Park Fest — Adição: tema da festa e quantidade de convidados
-- Rode este arquivo no SQL Editor do Supabase.
-- =========================================================

alter table reservations add column if not exists event_type text;
alter table reservations add column if not exists guest_count int;
