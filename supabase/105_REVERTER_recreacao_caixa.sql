-- Desfaz a 105 (caixa da recreação). Atenção: apaga os caixas, turnos e movimentos.
-- As entradas já lançadas no Financeiro (tipo 'recreacao') ficam; só perdem o vínculo com o caixa.
begin;
drop trigger if exists trg_zcaixa on rec_pagamentos;
drop trigger if exists trg_zcaixa on rec_visitas;
drop function if exists rec_pagamento_caixa();
drop function if exists rec_visita_caixa();
drop function if exists rec_caixa_historico(uuid, int);
drop function if exists rec_caixa_fechar(uuid, jsonb, text);
drop function if exists rec_caixa_relatorio(uuid);
drop function if exists rec_caixa_assumir(uuid, numeric);
drop function if exists rec_caixa_manter(uuid, text);
drop function if exists rec_caixa_mov(uuid, text, numeric, text);
drop function if exists rec_caixa_abrir(uuid, numeric);
drop function if exists rec_caixa_atual(uuid);
drop function if exists rec_caixa_totais(uuid);
drop function if exists rec_cfg();
alter table other_incomes drop column if exists rec_caixa_id;
alter table rec_pagamentos drop column if exists turno_id;
alter table rec_pagamentos drop column if exists caixa_id;
drop table if exists rec_caixa_movs;
drop table if exists rec_turnos;
drop table if exists rec_caixas;
commit;
