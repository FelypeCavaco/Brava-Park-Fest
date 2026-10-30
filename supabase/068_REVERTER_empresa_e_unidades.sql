-- =========================================================
-- REVERTER a migração 068 (empresa e unidades) — só use se for para desfazer.
-- Apaga a configuração da empresa e as colunas novas das unidades (apelido,
-- cor, ordem). Unidades, espaços e festas continuam como estão.
-- =========================================================
begin;
drop trigger if exists trg_sync_unit_space on units;
drop function if exists sync_unit_space();
drop trigger if exists trg_audit on units;
alter table units drop constraint if exists units_color_check;
alter table units drop constraint if exists units_name_not_blank;
drop index if exists units_code_key;
alter table units drop column if exists code;
alter table units drop column if exists color;
alter table units drop column if exists sort;
drop function if exists public_company_brand();
drop table if exists companies;
commit;
notify pgrst, 'reload schema';
