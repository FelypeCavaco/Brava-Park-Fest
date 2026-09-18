-- =========================================================
-- Origem do cliente (de onde ele veio), usada no Funil de
-- conversão por origem. Texto livre (como category/service_type
-- em outras tabelas), com sugestões: instagram, google, facebook,
-- indicacao, outro.
-- =========================================================

alter table clients add column if not exists source text;
