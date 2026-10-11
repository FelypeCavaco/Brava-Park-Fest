-- Só leitura — não altera nada. Lista cada pacote ativo com o que ele inclui,
-- para descobrir quantos pratos quentes cada plano dá direito.
select
  u.name as unidade,
  p.name as pacote,
  p.guest_limit as convidados,
  p.valid_from as vale_de,
  p.valid_until as vale_ate,
  p.included_items as o_que_inclui
from packages p
join units u on u.id = p.unit_id
where p.active
order by u.name, p.name;
