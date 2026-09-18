-- =========================================================
-- Brava Park Fest — Criação de 1 espaço por unidade
-- Cada unidade é o próprio espaço (não existem salões separados dentro
-- dela). Isso cria um espaço com o mesmo nome da unidade, só para as
-- reservas terem um espaço válido pra apontar (é assim que o banco foi
-- desenhado — toda reserva pertence a um espaço, que pertence a uma
-- unidade). Pode rodar quantas vezes quiser, não duplica.
-- =========================================================

insert into spaces (unit_id, name)
select u.id, u.name
from units u
where not exists (
  select 1 from spaces s where s.unit_id = u.id
);
