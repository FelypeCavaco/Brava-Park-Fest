-- Desfaz a 108 (entrada sem internet). As entradas já enviadas continuam como visitas normais.
begin;
drop function if exists rec_entrada_offline(uuid, uuid, uuid, jsonb, timestamptz, text, uuid);
drop table if exists rec_offline_envios;
alter table rec_visitas drop column if exists offline;
commit;
