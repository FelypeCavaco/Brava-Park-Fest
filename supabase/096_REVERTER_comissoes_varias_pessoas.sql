-- =========================================================
-- DESFAZ A 096 (comissões de várias pessoas)
-- Volta ao modelo de uma pessoa só. Recusa se houver mais de uma pessoa ou
-- repasse marcado "sem lançar no Financeiro" (desfazer perderia informação).
-- Os repasses e as contas já lançadas ficam como estão.
-- =========================================================

begin;

do $$
begin
  if (select count(*) from commission_rules) > 1
     or exists (select 1 from commission_payouts where not finance_launched)
     or exists (select 1 from commission_cancellations) then
    raise exception 'Há mais de uma pessoa, comissão cancelada ou repasse sem lançar no Financeiro: desfazer perderia informações. Nada foi alterado.';
  end if;
end $$;

drop function if exists commission_pending(date, uuid);
drop function if exists commission_history(date, date, uuid);
drop function if exists pay_commissions(uuid, date, date, text, boolean, uuid[], text);
drop function if exists cancel_commission(uuid, uuid, text);
drop function if exists restore_commission(uuid, uuid);
drop function if exists create_commission_rule(text, uuid, text, date, text, numeric);
drop function if exists update_commission_rule(uuid, text, uuid, text, date);
drop function if exists set_commission_value(uuid, text, numeric, date);
drop function if exists delete_commission_rule(uuid);
drop function if exists commission_calc(uuid);

-- ---------- funções antigas (064 / 066) ----------
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

create or replace function pay_commissions(p_until date, p_paid_date date, p_payment_method text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_payout uuid;
  v_total numeric := 0;
  u record;
  v_benef text := (select beneficiary from commission_settings);
begin
  if not has_permission(auth.uid(), 'action:comissoes.pagar') then raise exception 'Sem permissão'; end if;
  if p_until is null or p_until > today_brazil() then raise exception 'Escolha até que dia o repasse paga (não pode ser no futuro).'; end if;
  if p_paid_date is null then raise exception 'Informe a data do pagamento.'; end if;

  create temp table if not exists tmp_comissao (like commission_payout_items including defaults) on commit drop;
  delete from tmp_comissao;
  insert into tmp_comissao (payout_id, reservation_id, unit_id, kind, amount)
  select '00000000-0000-0000-0000-000000000000'::uuid, p.reservation_id, p.unit_id, p.kind, p.amount
  from commission_pending(p_until) p;
  delete from tmp_comissao t where t.unit_id in (select x.unit_id from tmp_comissao x group by x.unit_id having sum(x.amount) <= 0);
  select coalesce(sum(amount), 0) into v_total from tmp_comissao;
  if v_total <= 0 then raise exception 'Não há comissão a pagar até esta data.'; end if;

  insert into commission_payouts (until_date, paid_date, payment_method, total)
  values (p_until, p_paid_date, p_payment_method, v_total) returning id into v_payout;
  insert into commission_payout_items (payout_id, reservation_id, unit_id, kind, amount)
  select v_payout, reservation_id, unit_id, kind, amount from tmp_comissao;

  perform set_config('app.expense_fn', '1', true);
  for u in
    select t.unit_id, sum(t.amount) total,
           count(*) filter (where t.kind = 'comissao') n_com, coalesce(sum(t.amount) filter (where t.kind = 'comissao'), 0) v_com,
           count(*) filter (where t.kind = 'abatimento') n_ab, coalesce(-sum(t.amount) filter (where t.kind = 'abatimento'), 0) v_ab,
           count(*) filter (where t.kind = 'ajuste') n_aj
    from tmp_comissao t group by t.unit_id
  loop
    insert into expenses (unit_id, category, description, supplier, amount, due_date, paid_date, status, payment_method, commission_payout_id)
    values (u.unit_id, 'Comissão',
            'Comissão de ' || v_benef || ' — festas cadastradas até ' || to_char(p_until, 'DD/MM/YYYY') || ': '
              || u.n_com || ' festa(s) (' || fmt_brl(u.v_com) || ')'
              || case when u.n_ab > 0 then ', ' || u.n_ab || ' cancelada(s) abatida(s) (−' || fmt_brl(u.v_ab) || ')' else '' end
              || case when u.n_aj > 0 then ', ' || u.n_aj || ' ajuste(s) de valor' else '' end,
            v_benef, u.total, p_paid_date, p_paid_date, 'pago', p_payment_method, v_payout);
  end loop;
  perform set_config('app.expense_fn', '', true);
  return v_payout;
end;
$$;

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

do $$
declare f text;
begin
  foreach f in array array['commission_pending(date)', 'pay_commissions(date, date, text)', 'commission_history(date, date)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------- tira o que a 096 criou ----------
alter table commission_payout_items drop column if exists rule_id;
alter table commission_payouts drop column if exists rule_id;
alter table commission_payouts drop column if exists finance_launched;
alter table commission_payouts drop column if exists note;
drop table if exists commission_cancellations;
drop table if exists commission_rule_versions;
drop table if exists commission_rules;

select fix_definer_owners();

commit;

notify pgrst, 'reload schema';
