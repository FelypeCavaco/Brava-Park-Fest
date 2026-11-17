-- Desfaz a 099: remove a função de período livre. As telas e o relatório por mês
-- continuam usando finance_month_views, que não é alterada.
begin;
drop function if exists finance_range_views(date, date, uuid);
commit;

notify pgrst, 'reload schema';
