-- Desfaz a 110 (autocadastro por QR). Apaga os pré-cadastros ainda não tratados.
-- As famílias já aprovadas continuam (só ficam marcadas como cadastradas pelo celular).
begin;
drop function if exists rec_pre_recusar(uuid, text);
drop function if exists rec_pre_aprovar(uuid, jsonb);
drop function if exists rec_pre_listar();
drop function if exists rec_autocad_token(boolean);
drop function if exists rec_autocad_enviar(text, jsonb, text, int);
drop function if exists rec_autocad_casa(text);
drop table if exists rec_pre_cadastros;
drop index if exists uq_rec_config_autocad;
alter table rec_config drop column if exists autocad_token;
create or replace function rec_funcoes_padrao() returns jsonb language sql immutable as $$
  select '{"codigo": true, "qr": true, "foto": "cadastro", "fotoObrig": false, "fotoDias": 30,
           "paginaPais": true, "pedirTempo": true, "chegando": true, "ocorrPais": true,
           "ocorr": true, "ocorrCiente": true,
           "caixaObrig": true, "cego": true, "lembrete": true, "horaFecha": "22:00", "lembreteMin": 30,
           "troca": true, "trocaConta": true, "offline": false}'::jsonb;
$$;
commit;
