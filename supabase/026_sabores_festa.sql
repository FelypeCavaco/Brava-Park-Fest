-- =========================================================
-- Sabores escolhidos para a festa: pratos quentes (o número
-- varia com o plano, por isso é um texto livre com os sabores
-- separados por "/") e sabor do bolo. Usados no relatório de
-- aniversariantes por período (cozinha/fornecedores).
-- =========================================================

alter table reservations add column if not exists hot_dish_flavors text;
alter table reservations add column if not exists cake_flavor text;
