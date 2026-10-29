-- =========================================================
-- REVERTER a migração 067 (Agenda) — só use se for para desfazer.
-- ATENÇÃO: apaga todos os compromissos cadastrados na Agenda.
-- As visitas (tabela visits) não são afetadas.
-- =========================================================
begin;
drop function if exists agenda_painel();
drop function if exists agenda_marcar_feito(uuid, date, boolean);
drop table if exists agenda_done;
drop table if exists agenda_items;
drop function if exists set_agenda_item_author();
commit;
notify pgrst, 'reload schema';
