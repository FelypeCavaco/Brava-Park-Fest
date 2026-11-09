-- =========================================================
-- VALOR POR HORA DO FUNCIONÁRIO
--
-- Cada funcionário cadastrado pode ter um valor por hora. Ao marcar
-- "Compareceu" na escala da festa, o pagamento sugerido passa a ser
-- valor por hora × duração da festa (continua editável, como antes).
-- Sem valor por hora cadastrado, continua o valor padrão.
--
-- Funciona nos dois bancos (Brava e clientes). Roda numa transação.
-- =========================================================

begin;

alter table staff_members add column if not exists hourly_rate numeric(10,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_members_hourly_rate_check') then
    alter table staff_members add constraint staff_members_hourly_rate_check check (hourly_rate is null or hourly_rate >= 0);
  end if;
end $$;

commit;
