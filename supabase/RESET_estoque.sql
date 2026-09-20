-- =========================================================
-- RESET DO ESTOQUE — rodar UMA VEZ, manualmente, no SQL Editor do
-- Supabase (script de dados, não é migration de schema — por isso sem
-- número e fora do schema.sql).
--
-- Apaga TODOS os itens de estoque cadastrados (eram sobra de teste — a
-- limpeza anterior, LIMPEZA_dados_de_teste.sql, só cobriu clientes e
-- financeiro, não o estoque) e recria do zero só o esquema das velas
-- numéricas (0 a 9, nas cores Azul e Rosa — 20 itens por unidade), igual
-- ao que a migration 034 já cria numa instalação nova.
--
-- Isso também apaga, em cascata, as variantes de compra vinculadas a
-- esses itens (inventory_purchase_variants). Não apaga nenhum registro
-- de consumo pós-festa ou de despesa (reservation_stock_consumption /
-- expense_items) — só o vínculo com o item de estoque nessas linhas fica
-- vazio (o nome do item já digitado na hora continua salvo do mesmo
-- jeito), mas essas tabelas já deviam estar vazias mesmo, já que a
-- limpeza anterior apagou todas as festas e despesas.
--
-- Isso é irreversível — não tem "Desfazer" pra isso, diferente das
-- exclusões feitas pela tela do sistema.
-- =========================================================

delete from inventory_items;

insert into inventory_items (unit_id, name, category, unit_of_measure, quantity, minimum_quantity)
select u.id, 'Vela ' || d.digito || ' ' || c.cor, 'Decoração', 'un', 0, 1
from units u
cross join generate_series(0, 9) as d(digito)
cross join (values ('Azul'), ('Rosa')) as c(cor);
