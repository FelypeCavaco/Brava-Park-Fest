-- Desfaz a 106 (relatórios da recreação). Não apaga nenhum dado.
begin;
drop function if exists rec_relatorio(date, date, uuid);
commit;
