-- =========================================================
-- Forma de pagamento de uma conta a pagar, preenchida quando ela é marcada
-- como paga (igual já existe pros pagamentos recebidos das festas).
-- =========================================================

alter table expenses add column if not exists payment_method text;
