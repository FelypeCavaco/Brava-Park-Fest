-- =========================================================
-- DESFAZ a 102 (recreação — famílias). Nos dois bancos.
-- APAGA os cadastros de famílias, crianças e autorizados da recreação.
-- As fotos ficam na pasta "recreacao-fotos" (apague pelo painel do Supabase
-- se quiser).
-- =========================================================

begin;

drop function if exists rec_familias_juntar(uuid, uuid, text);
drop function if exists rec_crianca_foto(uuid, text);
drop function if exists rec_familia_salvar(uuid, jsonb);
drop function if exists rec_familia_parecidas(uuid, text, text, text, jsonb);
drop function if exists rec_familias_buscar(text, int);
drop function if exists rec_familia_get(uuid);
drop function if exists rec_familia_json(uuid);
drop function if exists rec_pode(text);
drop function if exists rec_cpf_fmt(text);
drop function if exists rec_cpf_valido(text);
drop function if exists rec_lev(text, text, int);
drop function if exists rec_digitos(text);
drop function if exists rec_norm(text);

drop policy if exists "rec_fotos_ler" on storage.objects;
drop policy if exists "rec_fotos_enviar" on storage.objects;
drop policy if exists "rec_fotos_trocar" on storage.objects;
drop policy if exists "rec_fotos_apagar" on storage.objects;

drop table if exists rec_autorizados;
drop table if exists rec_criancas;
drop table if exists rec_familias;

commit;
