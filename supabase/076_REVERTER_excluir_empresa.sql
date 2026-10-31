-- =========================================================
-- REVERTER a migração 076 (excluir empresa) — só use se for para desfazer.
-- Tira o botão de excluir do banco. ATENÇÃO: apaga também as cópias
-- guardadas das empresas já excluídas (baixe antes as que quiser manter).
-- Empresas já excluídas NÃO voltam.
-- =========================================================
begin;

drop function if exists platform_delete_company(uuid, text);
drop function if exists platform_list_deleted_companies();
drop function if exists platform_deleted_company_copy(uuid);
drop function if exists platform_drop_deleted_copy(uuid);
drop table if exists platform_deleted_companies;

commit;

notify pgrst, 'reload schema';
