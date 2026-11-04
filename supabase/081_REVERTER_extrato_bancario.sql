-- =========================================================
-- REVERTER a migração 081 (extrato do banco) — só use se for para desfazer.
-- Apaga os extratos enviados, as regras aprendidas e as funções do extrato.
-- Os lançamentos que o extrato já criou (pagamentos, despesas e receitas)
-- CONTINUAM no financeiro, como se tivessem sido lançados à mão.
-- =========================================================
begin;

drop function if exists bank_preview(uuid, jsonb);
drop function if exists bank_dup_text(bank_statement_lines);
drop function if exists bank_rule_delete(uuid);
drop function if exists bank_undo(uuid);
drop function if exists bank_resolve(uuid, text, jsonb);
drop function if exists bank_import(uuid, text, jsonb);
drop function if exists bank_classify(uuid, boolean);
drop function if exists bank_matches(text, text);
drop function if exists bank_payment_method(text);
drop function if exists bank_counterpart(text);
drop function if exists bank_norm(text);

drop table if exists bank_statement_lines;
drop table if exists bank_statement_imports;
drop table if exists bank_rules;

commit;
