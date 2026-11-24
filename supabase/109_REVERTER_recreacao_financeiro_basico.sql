-- Desfaz a 109 (financeiro básico). Não apaga nenhum dado.
begin;
drop function if exists rec_financeiro(date, uuid);
commit;
