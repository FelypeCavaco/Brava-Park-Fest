-- =========================================================
-- DESFAZ a 101 (vendas no bar). Nos dois bancos.
-- O que já foi vendido continua como está: o estoque não volta, as entradas
-- do Financeiro ficam (como entradas comuns) e o que foi para a conta do
-- dono continua no valor da festa. Some só a tela e o registro das vendas.
-- =========================================================

begin;

-- Resultado do mês volta a somar só o consumo na receita da festa.
do $$
declare
  fn text; d text;
  antigo text := 'coalesce((select sum(x.quantity * x.unit_price) from reservation_consumption x where x.reservation_id = rs.id), 0) consumo,';
  novo text := 'coalesce((select sum(x.quantity * x.unit_price) from reservation_consumption x where x.reservation_id = rs.id), 0)'
            || ' + coalesce((select sum(ob.amount) from other_incomes ob where ob.reservation_id = rs.id and ob.kind = ''bar''), 0) consumo,';
begin
  foreach fn in array array['finance_month_views(date,uuid)', 'finance_range_views(date,date,uuid)'] loop
    if to_regprocedure(fn) is null then continue; end if;
    d := pg_get_functiondef(to_regprocedure(fn));
    if position(novo in d) > 0 then execute replace(d, novo, antigo); end if;
  end loop;
end $$;

drop function if exists bar_cancelar(uuid, text);
drop function if exists bar_vender(uuid, text, text, jsonb);

alter table reservation_consumption drop constraint if exists reservation_consumption_bar_venda_fkey;
alter table other_incomes drop constraint if exists other_incomes_bar_venda_fkey;
alter table reservation_consumption drop column if exists bar_venda_id;
alter table reservation_consumption drop column if exists inventory_item_id;
alter table other_incomes drop column if exists bar_venda_id;
update other_incomes set kind = 'manual' where kind = 'bar';
drop table if exists bar_venda_itens;
drop table if exists bar_vendas;

-- volta as duas funções como eram (063 e 057)
create or replace function undo_stock_consumption(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c reservation_stock_consumption%rowtype;
begin
  if not has_permission(auth.uid(), 'action:festa.consumo_pos_festa') then raise exception 'Sem permissão'; end if;
  select * into c from reservation_stock_consumption where id = p_id for update;
  if not found then return; end if;
  if c.inventory_item_id is not null then
    perform stock_apply_in(c.inventory_item_id, c.quantity, case when c.no_cost then null else coalesce(c.total_cost, 0) end,
                           'consumo_desfeito', 'Consumo pós-festa desfeito', null, p_id, null, c.reservation_id);
  end if;
  delete from reservation_stock_consumption where id = p_id;
end;
$$;

create or replace function consumption_averages(p_unit uuid default null, p_limit int default 10)
returns table (
  inventory_item_id uuid, unit_id uuid, item_name text, unit_of_measure text, consumption_type text,
  festas int, total_qty numeric, total_guests numeric, avg_per_guest numeric, min_per_guest numeric, max_per_guest numeric,
  avg_per_festa numeric, total_cost numeric, avg_cost_per_guest numeric, avg_cost_per_festa numeric,
  configured_per_guest numeric, current_unit_cost numeric, current_quantity numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission(auth.uid(), 'page:estoque') or has_permission(auth.uid(), 'page:lucro_por_festa')
          or has_permission(auth.uid(), 'page:financeiro')) then raise exception 'Sem permissão'; end if;
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

alter table reservation_stock_consumption drop constraint if exists reservation_stock_consumption_origem_check;
alter table reservation_stock_consumption drop column if exists origem;
alter table inventory_items drop constraint if exists inventory_items_sale_price_check;
alter table inventory_items drop column if exists sale_price;

commit;
