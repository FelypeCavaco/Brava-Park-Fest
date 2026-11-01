-- =========================================================
-- REVERTER a migração 077 — só use se for para desfazer.
-- ATENÇÃO: apaga as mensalidades cadastradas no painel, os pagamentos de
-- mensalidade, os itens de implantação marcados e os seus dados de
-- contratada. Festas, clientes e pagamentos de festas não mudam.
-- =========================================================
begin;

drop function if exists company_export();
drop function if exists password_changed();
drop function if exists platform_billing_list();
drop function if exists platform_billing_save(uuid, jsonb);
drop function if exists platform_billing_pay(uuid, date, numeric, date, text);
drop function if exists platform_billing_history(uuid);
drop function if exists platform_billing_undo(uuid);
drop function if exists platform_billing_dues(uuid);
drop function if exists platform_setup_status();
drop function if exists platform_setup_mark(uuid, text, boolean);
drop function if exists platform_get_contract_settings();
drop function if exists platform_save_contract_settings(jsonb);
drop function if exists platform_contract_data(uuid);
drop table if exists platform_billing_payments;
drop table if exists platform_billing;

alter table platform_settings
  drop column if exists contratada_nome,
  drop column if exists contratada_documento,
  drop column if exists contratada_endereco,
  drop column if exists contratada_email,
  drop column if exists contratada_whatsapp,
  drop column if exists suporte_horario,
  drop column if exists foro;

alter table user_profiles drop column if exists must_change_password;

select fix_definer_owners();

commit;

notify pgrst, 'reload schema';
