-- =========================================================
-- Motivo de "não avançou" na agenda de visitas, pra registrar por que o
-- cliente não seguiu adiante depois de visitar o espaço.
-- =========================================================

alter table visits add column if not exists no_advance_reason text;
