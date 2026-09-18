-- =========================================================
-- Restaura "Suco de laranja" e "Suco de uva" pra qualquer unidade que
-- tiver ficado sem eles (apagados sem querer, achando que eram
-- duplicados — na verdade cada unidade tem o seu próprio). Recria também
-- os tamanhos de compra (1,5L/3L/5L) desses itens, que somem junto quando
-- o item é apagado.
-- =========================================================

insert into inventory_items (unit_id, name, category, unit_of_measure, quantity, minimum_quantity, quantity_per_guest)
select u.id, v.nome, 'Buffet e bebidas', 'L', 0, 0, 0.2
from units u
cross join (values ('Suco de laranja'), ('Suco de uva')) as v(nome)
where not exists (
  select 1 from inventory_items i where i.unit_id = u.id and i.name = v.nome
);

insert into inventory_purchase_variants (inventory_item_id, label, volume_amount)
select i.id, v.label, v.volume_amount
from inventory_items i
cross join (values ('1,5L', 1.5), ('3L', 3), ('5L', 5)) as v(label, volume_amount)
where i.name in ('Suco de laranja', 'Suco de uva')
  and not exists (
    select 1 from inventory_purchase_variants existing
    where existing.inventory_item_id = i.id and existing.label = v.label
  );
