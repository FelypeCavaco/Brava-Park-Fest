-- =========================================================
-- Brava Park Fest — Adição: email no perfil de usuário
-- (guardado aqui separado porque a tabela de login do Supabase
-- não pode ser consultada diretamente pelas telas do sistema)
-- Rode este arquivo no SQL Editor do Supabase.
-- =========================================================

alter table user_profiles add column if not exists email text;
