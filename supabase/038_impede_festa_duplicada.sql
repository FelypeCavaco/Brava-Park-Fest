-- =========================================================
-- Trava, no banco, duas festas no mesmo dia na mesma unidade — só é
-- permitido quando uma delas está cancelada (aí não conta mais como
-- ocupando aquela data). O aviso pro usuário é dado antes, na tela de
-- Nova reserva; este índice é o cinto de segurança do lado do banco.
-- =========================================================

create unique index if not exists idx_reservations_unit_date_ativa
  on reservations (unit_id, event_date)
  where status <> 'cancelada';
