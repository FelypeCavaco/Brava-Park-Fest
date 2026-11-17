-- Desfaz a 098: todas as pessoas voltam a ser pagas toda segunda-feira (até o
-- domingo anterior). Os repasses já feitos não mudam.
begin;

create or replace function commission_history(p_from date default null, p_to date default null, p_rule uuid default null)
returns table (rule_id uuid, rule_name text, reservation_id uuid, unit_id uuid, cliente text, cadastro date, event_date date, status text,
               cancelada_em date, cadastrada_por text, conta boolean, devido numeric, pago numeric, ultimo_repasse date,
               situacao text, modo text, valor_regra numeric, valor_festa numeric, fora_financeiro boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_last date := commission_last_sunday();
begin
  if not has_permission(auth.uid(), 'page:comissoes') then raise exception 'Sem permissão'; end if;
  return query
  select k.rule_id, k.rule_name, k.reservation_id, k.unit_id, k.cliente, k.cadastro, k.event_date, k.status, k.cancelada_em,
         k.cadastrada_por, k.conta, k.devido, k.pago, k.ultimo_repasse,
         case
           when k.devido > 0 and k.pago = k.devido then 'paga'
           when k.devido > 0 and k.pago = 0 then case when k.cadastro <= v_last then 'a_pagar' else 'semana_atual' end
           when k.devido > 0 then 'ajuste_pendente'
           when k.devido = 0 and k.pago > 0 then 'abater'
           when k.devido = 0 and k.pago = 0 and exists (select 1 from commission_payout_items i where i.reservation_id = k.reservation_id and i.rule_id = k.rule_id) then 'abatida'
           when k.cancelada_manual then 'cancelada_manual'
           when not k.conta then 'outra_pessoa'
           else 'cancelada_antes'
         end,
         k.modo, k.valor_regra, k.valor_festa, k.fora_financeiro
  from commission_calc(p_rule) k
  where (p_from is null or k.cadastro >= p_from) and (p_to is null or k.cadastro <= p_to)
  order by k.cadastro desc, k.cliente, k.rule_name;
end;
$$;

drop function if exists set_commission_schedule(uuid, text, int, int, int);
drop function if exists commission_schedules();
drop function if exists commission_cutoff_of(uuid);
drop function if exists commission_next_pay_date(text, int, int, int, date);
drop function if exists commission_last_pay_date(text, int, int, int, date);
drop function if exists commission_month_date(int, int, int);
alter table commission_rules drop column if exists pay_frequency, drop column if exists pay_weekday, drop column if exists pay_day, drop column if exists pay_day2;

select fix_definer_owners();
commit;

notify pgrst, 'reload schema';
