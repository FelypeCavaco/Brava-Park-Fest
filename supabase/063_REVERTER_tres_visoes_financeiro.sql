-- =========================================================
-- REVERTER A MIGRAÇÃO 063 (três visões no Financeiro)
--
-- Apaga só as duas funções novas e devolve a média de consumo à permissão
-- de antes (Estoque e Lucro por festa). Não toca em nenhum lançamento.
-- Roda numa transação: ou desfaz tudo, ou nada.
-- =========================================================

begin;

drop function if exists finance_month_views(date, uuid);
drop function if exists finance_commitments(uuid);

create or replace function consumption_averages(p_unit uuid default null, p_limit int default 10)
returns table (
  inventory_item_id uuid, unit_id uuid, item_name text, unit_of_measure text, consumption_type text,
  festas int, total_qty numeric, total_guests numeric, avg_per_guest numeric, min_per_guest numeric, max_per_guest numeric,
  avg_per_festa numeric, total_cost numeric, avg_cost_per_guest numeric, avg_cost_per_festa numeric,
  configured_per_guest numeric, current_unit_cost numeric, current_quantity numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission(auth.uid(), 'page:estoque') or has_permission(auth.uid(), 'page:lucro_por_festa')) then raise exception 'Sem permissão'; end if;
  return query
  with fest as (
    select r.id, r.unit_id, (coalesce(r.guest_count, 0) + coalesce(r.courtesy_guests, 0))::numeric g,
           row_number() over (partition by r.unit_id order by r.event_date desc) rn
    from reservations r
    where r.status <> 'cancelada' and r.consumption_finalized and not r.exclude_from_averages
      and r.event_date < today_brazil() and (coalesce(r.guest_count, 0) + coalesce(r.courtesy_guests, 0)) > 0
      and (p_unit is null or r.unit_id = p_unit)
  ), sel as (select * from fest where rn <= greatest(p_limit, 1)),
  per as (
    select i.id item_id, s.id res_id, s.g, coalesce(sum(c.quantity), 0) q, sum(c.total_cost) cost
    from inventory_items i
    join sel s on s.unit_id = i.unit_id
    left join reservation_stock_consumption c on c.reservation_id = s.id and c.inventory_item_id = i.id
    where p_unit is null or i.unit_id = p_unit
    group by i.id, s.id, s.g
  ), amostra as (
    select p.*, i.consumption_type t from per p join inventory_items i on i.id = p.item_id
    where i.consumption_type = 'por_convidado' or p.q > 0
  )
  select i.id, i.unit_id, i.name, i.unit_of_measure, i.consumption_type,
         count(a.res_id)::int, sum(a.q), sum(a.g),
         sum(a.q) / nullif(sum(a.g), 0), min(a.q / a.g), max(a.q / a.g),
         sum(a.q) / nullif(count(a.res_id), 0),
         sum(a.cost), sum(a.cost) / nullif(sum(a.g), 0), sum(a.cost) / nullif(count(a.res_id), 0),
         i.quantity_per_guest,
         case when i.quantity > 0 then i.total_value / i.quantity else i.last_unit_cost end,
         i.quantity
  from amostra a join inventory_items i on i.id = a.item_id
  group by i.id
  having sum(a.q) > 0;
end;
$$;

commit;
