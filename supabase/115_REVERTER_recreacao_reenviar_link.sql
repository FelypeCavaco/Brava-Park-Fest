-- Desfaz a 115 (apaga também o registro de reenvios).
begin;
drop function if exists rec_familia_ficha(uuid);
drop function if exists rec_reenviar_dados(uuid);
-- (rec_relatorio_mais volta à versão da 114: rode a 114 de novo se quiser tirar o identificador da família)
drop table if exists rec_reenvios;
commit;
