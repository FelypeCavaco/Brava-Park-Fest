-- =========================================================
-- QUEM CADASTROU A FESTA + COMISSÃO SÓ DE QUEM RECEBE + HISTÓRICO
--
-- 1) Toda festa passa a guardar quem a cadastrou (`registered_by`). Na tela
--    o campo já vem com quem está logado e pode ser trocado (ex.: a Kamila
--    cadastrou usando o login de outra pessoa). Se a tela não mandar, o
--    banco preenche com quem está logado.
--    Festas antigas: preenchidas com quem as criou, pelo histórico de
--    alterações (quando o histórico tem essa informação).
-- 2) Comissões: a configuração ganha "de quem são as festas que geram
--    comissão" (`commission_settings.beneficiary_user_id`). Só contam as
--    festas cadastradas por essa pessoa. Se a festa trocar de "cadastrada
--    por" depois de a comissão ter sido paga, ela é abatida no próximo
--    repasse (mesma regra do cancelamento).
-- 3) commission_history: todas as festas desde a data de início, com a
--    situação da comissão de cada uma (paga em tal data, a pagar, abatida,
--    não gera e por quê).
-- 4) Estoque: cada item escolhe se avisa na Lista de compras.
--
-- Não altera valores de festas, pagamentos ou contas.
-- Roda dentro de uma transação.
-- =========================================================

begin;

-- ---------- 1) Quem cadastrou ----------
alter table reservations add column if not exists registered_by uuid references user_profiles(id) on delete set null;

update reservations r
set registered_by = a.user_id
from (
  select distinct on (entity_id) entity_id, user_id
  from audit_log
  where entity = 'reservations' and action = 'criou' and user_id is not null
  order by entity_id, created_at
) a
where a.entity_id = r.id and r.registered_by is null
  and exists (select 1 from user_profiles up where up.id = a.user_id);

create or replace function set_reservation_registered_by() returns trigger
language plpgsql as $$
begin
  if new.registered_by is null then
    new.registered_by := auth.uid();
    if new.registered_by is not null and not exists (select 1 from user_profiles where id = new.registered_by) then
      new.registered_by := null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_set_reservation_registered_by on reservations;
create trigger trg_set_reservation_registered_by before insert on reservations
  for each row execute function set_reservation_registered_by();

-- ---------- 2) Comissão só das festas de quem recebe ----------
alter table commission_settings add column if not exists beneficiary_user_id uuid references user_profiles(id) on delete set null;

-- Se existir um único usuário ativo chamado Kamila, já fica configurado.
update commission_settings cs
set beneficiary_user_id = k.id, beneficiary = k.name
from (select id, name from user_profiles where active and name ilike 'kamila%') k
where cs.beneficiary_user_id is null
  and (select count(*) from user_profiles where active and name ilike 'kamila%') = 1;

create or replace function commission_pending(p_until date default null)
returns table (reservation_id uuid, unit_id uuid, cliente text, cadastro date, event_date date, status text,
               cancelada_em date, kind text, amount numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_until date := coalesce(p_until, commission_last_sunday());
  v_benef uuid := (select beneficiary_user_id from commission_settings);
begin
  if not has_permission(auth.uid(), 'page:comissoes') then raise exception 'Sem permissão'; end if;
  return query
  with base as (
    select r.id, r.unit_id, coalesce(c.name, '—') cli, (r.created_at at time zone 'America/Sao_Paulo')::date cad,
           r.event_date ev, r.status::text st, (r.cancelled_at at time zone 'America/Sao_Paulo')::date canc,
           case when r.status <> 'cancelada' and (v_benef is null or r.registered_by = v_benef)
                then coalesce(commission_rate_at((r.created_at at time zone 'America/Sao_Paulo')::date), 0) else 0 end devido,
           coalesce((select sum(i.amount) from commission_payout_items i where i.reservation_id = r.id), 0) pago
    from reservations r left join clients c on c.id = r.client_id
    where (r.created_at at time zone 'America/Sao_Paulo')::date >= (select start_date from commission_settings)
  )
  select b.id, b.unit_id, b.cli, b.cad, b.ev, b.st, b.canc,
         case when b.pago = 0 and b.devido > 0 then 'comissao'
              when b.devido = 0 and b.pago > 0 then 'abatimento'
              else 'ajuste' end,
         b.devido - b.pago
  from base b
  where b.devido - b.pago <> 0
    and (b.devido - b.pago < 0 or b.cad <= v_until)
  order by b.cad, b.cli;
end;
$$;

create or replace function set_commission_settings(p_start date, p_beneficiary text, p_beneficiary_user uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:comissoes.configurar') then raise exception 'Sem permissão'; end if;
  if p_start is null then raise exception 'Informe a data de início.'; end if;
  update commission_settings
  set start_date = p_start,
      beneficiary_user_id = p_beneficiary_user,
      beneficiary = coalesce(nullif(trim(p_beneficiary), ''), (select name from user_profiles where id = p_beneficiary_user), 'Gerente')
  where unica;
end;
$$;
drop function if exists set_commission_settings(date, text);

-- ---------- 3) Histórico por festa ----------
create or replace function commission_history(p_from date default null, p_to date default null)
returns table (reservation_id uuid, unit_id uuid, cliente text, cadastro date, event_date date, status text,
               cancelada_em date, cadastrada_por text, conta boolean, devido numeric, pago numeric,
               ultimo_repasse date, situacao text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_benef uuid := (select beneficiary_user_id from commission_settings);
  v_start date := (select start_date from commission_settings);
  v_last date := commission_last_sunday();
begin
  if not has_permission(auth.uid(), 'page:comissoes') then raise exception 'Sem permissão'; end if;
  return query
  with base as (
    select r.id, r.unit_id, coalesce(c.name, '—') cli, (r.created_at at time zone 'America/Sao_Paulo')::date cad,
           r.event_date ev, r.status::text st, (r.cancelled_at at time zone 'America/Sao_Paulo')::date canc,
           up.name quem, (v_benef is null or r.registered_by = v_benef) conta,
           case when r.status <> 'cancelada' and (v_benef is null or r.registered_by = v_benef)
                then coalesce(commission_rate_at((r.created_at at time zone 'America/Sao_Paulo')::date), 0) else 0 end devido,
           coalesce((select sum(i.amount) from commission_payout_items i where i.reservation_id = r.id), 0) pago,
           (select max(p.paid_date) from commission_payout_items i join commission_payouts p on p.id = i.payout_id where i.reservation_id = r.id) ultimo
    from reservations r
    left join clients c on c.id = r.client_id
    left join user_profiles up on up.id = r.registered_by
    where (r.created_at at time zone 'America/Sao_Paulo')::date >= greatest(v_start, coalesce(p_from, v_start))
      and (p_to is null or (r.created_at at time zone 'America/Sao_Paulo')::date <= p_to)
  )
  select b.id, b.unit_id, b.cli, b.cad, b.ev, b.st, b.canc, coalesce(b.quem, '—'), b.conta, b.devido, b.pago, b.ultimo,
         case
           when b.devido > 0 and b.pago = b.devido then 'paga'
           when b.devido > 0 and b.pago = 0 then case when b.cad <= v_last then 'a_pagar' else 'semana_atual' end
           when b.devido > 0 then 'ajuste_pendente'
           when b.devido = 0 and b.pago > 0 then 'abater'
           when b.devido = 0 and b.pago = 0 and exists (select 1 from commission_payout_items i where i.reservation_id = b.id) then 'abatida'
           when not b.conta then 'outra_pessoa'
           else 'cancelada_antes'
         end
  from base b
  order by b.cad desc, b.cli;
end;
$$;

-- ---------- 4) Estoque: avisar ou não na lista de compras ----------
-- Cada item escolhe se entra na Lista de compras quando fica abaixo do
-- mínimo. Itens que já existem continuam avisando (padrão = sim).
alter table inventory_items add column if not exists notify_shopping boolean not null default true;

revoke all on function commission_history(date, date) from public, anon;
grant execute on function commission_history(date, date) to authenticated;
revoke all on function set_commission_settings(date, text, uuid) from public, anon;
grant execute on function set_commission_settings(date, text, uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
