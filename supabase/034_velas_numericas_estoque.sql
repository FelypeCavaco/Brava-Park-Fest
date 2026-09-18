-- =========================================================
-- Velas numéricas (0 a 9, nas cores azul e rosa) — 20 itens por unidade.
-- Ficam no estoque como itens de verdade (pra dar pra saber exatamente qual
-- número/cor está em falta), mas a tela de Estoque agrupa elas visualmente
-- numa gradinha compacta em vez de 20 linhas soltas na lista.
-- =========================================================

insert into inventory_items (unit_id, name, category, unit_of_measure, quantity, minimum_quantity)
select u.id, 'Vela ' || d.digito || ' ' || c.cor, 'Decoração', 'un', 0, 1
from units u
cross join generate_series(0, 9) as d(digito)
cross join (values ('Azul'), ('Rosa')) as c(cor)
where not exists (
  select 1 from inventory_items i where i.unit_id = u.id and i.name = 'Vela ' || d.digito || ' ' || c.cor
);
