-- =========================================================
-- ENCERRAR OS PORTAIS DAS FESTAS QUE JÁ PASSARAM
--
-- Todo dia de madrugada, o portal do cliente (o link enviado à família) é
-- encerrado nas festas que aconteceram há 7 dias ou mais e estão quitadas
-- (ou canceladas). Se ainda houver saldo, o link continua funcionando para a
-- família pagar pelo Pix, e só é encerrado 7 dias depois de quitar.
--
-- Ao encerrar, apaga: o link, a lista de convidados (inclusive do histórico
-- de alterações, para não guardar nomes de convidados sem necessidade, LGPD),
-- as mensagens do portal e os avisos do portal.
-- Antes, guarda na festa quantos convidados estavam na lista e quantos
-- chegaram. Pagamentos, contrato, documentos, comprovantes, cardápio e
-- avaliação continuam guardados.
--
-- Funciona nos dois bancos (Brava e clientes). Roda numa transação.
-- =========================================================

begin;

alter table reservations add column if not exists portal_encerrado_em timestamptz;
alter table reservations add column if not exists convidados_na_lista int;
alter table reservations add column if not exists convidados_chegaram int;

create or replace function portal_encerrar_antigos(p_dias int default 7) returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_ids uuid[];
  v_total int;
  v_chegaram int;
  n int := 0;
begin
  -- Roda pelo agendador do banco (sem login) ou pelo administrador geral.
  if auth.uid() is not null and not is_platform_admin(auth.uid()) then
    raise exception 'Sem permissão.';
  end if;
  for r in
    select p.token, p.reservation_id
    from guest_list_pages p
    join reservations rs on rs.id = p.reservation_id
    where rs.event_date <= today_brazil() - greatest(coalesce(p_dias, 7), 1)
      and (
        rs.status in ('cancelada', 'quitada')
        or festa_total_due(rs.id) - coalesce((select sum(amount) from payments where reservation_id = rs.id), 0) <= 0.009
      )
  loop
    select coalesce(array_agg(id), '{}'), count(*), count(*) filter (where arrived)
      into v_ids, v_total, v_chegaram
    from guest_list_entries where token = r.token;

    update reservations
    set portal_encerrado_em = now(),
        convidados_na_lista = coalesce(convidados_na_lista, v_total),
        convidados_chegaram = coalesce(convidados_chegaram, v_chegaram)
    where id = r.reservation_id;

    delete from guest_list_entries where token = r.token;
    -- histórico dos convidados (cadastro, check-in e a exclusão acima)
    delete from audit_log where entity = 'guest_list_entries' and entity_id = any(v_ids);
    delete from portal_messages where reservation_id = r.reservation_id;
    delete from portal_events where reservation_id = r.reservation_id;
    delete from guest_list_pages where token = r.token;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function portal_encerrar_antigos(int) from public, anon;
grant execute on function portal_encerrar_antigos(int) to authenticated;

select fix_definer_owners();

commit;

-- Agendamento diário (06:30 UTC = 03:30 em Brasília). Se o banco não tiver
-- pg_cron, rode "select portal_encerrar_antigos();" de vez em quando.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'festou-encerrar-portais';
  perform cron.schedule('festou-encerrar-portais', '30 6 * * *', 'select public.portal_encerrar_antigos()');
exception when others then
  raise notice 'pg_cron indisponível: %', sqlerrm;
end $$;
