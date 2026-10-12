-- =========================================================
-- CORREÇÃO DO PORTAL DO CLIENTE ("Link não encontrado")
--
-- A tabela de pagamentos do sistema real foi criada antes de existir a
-- coluna created_at (o instalador schema.sql já tinha, o banco real não).
-- O portal ordena os pagamentos por ela e dava erro, aparecendo como
-- "Link não encontrado". Esta correção cria a coluna; os pagamentos que já
-- existem ficam com a data do próprio pagamento.
-- =========================================================

alter table payments add column if not exists created_at timestamptz;
update payments set created_at = payment_date::timestamptz where created_at is null;
alter table payments alter column created_at set default now();
alter table payments alter column created_at set not null;
