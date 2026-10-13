-- =========================================================
-- TRÊS VISÕES NO FINANCEIRO (Caixa, Resultado das festas, Ponte e compromissos)
--
-- Só cria funções de LEITURA: nada aqui cria, altera ou apaga lançamentos.
-- Roda inteira dentro de uma transação: se qualquer parte falhar, nada é
-- criado. Para desfazer, use 063_REVERTER_tres_visoes_financeiro.sql.
--
-- 1. consumption_averages: a mesma média de consumo do Estoque e do Lucro
--    por festa passa a poder ser lida também por quem vê o Financeiro (para
--    a reserva das festas futuras). A conta não muda: continua uma só.
-- 2. finance_month_views(mês, unidade): Saldo do mês (caixa), Resultado das
--    festas e a Ponte entre os dois, para o mês e a unidade (nula = as duas).
-- 3. finance_commitments(unidade): dinheiro já recebido de festas futuras,
--    custos previstos e reserva necessária.
--
-- Corte de "festa realizada": no mês atual, até hoje (fuso de Brasília); em
-- meses passados, até o último dia daquele mês. Assim a ponte de um mês
-- passado não muda sozinha com o tempo (só muda se os lançamentos mudarem).
-- =========================================================

begin;

-- ---------- 1. Média de consumo: liberada também para o Financeiro ----------
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

-- ---------- 2. Caixa, Resultado das festas e Ponte de um mês ----------
create or replace function finance_month_views(p_month date, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month')::date; -- exclusivo
  v_today date := today_brazil();
  v_cut date := least(today_brazil(), (date_trunc('month', p_month) + interval '1 month')::date - 1);
  v jsonb;
begin
  if auth.uid() is null or not has_permission(auth.uid(), 'page:financeiro') then raise exception 'Sem permissão'; end if;
  if p_month is null then raise exception 'Informe o mês.'; end if;

  with
  res as (
    select r.id, r.unit_id, r.event_date, r.status, coalesce(r.final_value, 0) final_value,
           r.consumption_finalized, coalesce(r.refund_amount, 0) refund_amount, r.cancelled_at,
           coalesce(c.name, '—') cliente
    from reservations r left join clients c on c.id = r.client_id
    where p_unit is null or r.unit_id = p_unit
  ),
  -- Festas que interessam ao mês: as do mês (não canceladas) e as canceladas no mês.
  fx as (
    select rs.*,
      case when rs.status = 'cancelada' then 'cancelada'
           when rs.event_date <= v_cut then 'realizada'
           else 'prevista' end tipo,
      (rs.cancelled_at at time zone 'America/Sao_Paulo')::date data_cancelamento,
      coalesce((select sum(x.quantity * x.price_snapshot) from reservation_extra_items x where x.reservation_id = rs.id), 0) extras,
      coalesce((select sum(x.quantity * x.unit_price) from reservation_consumption x where x.reservation_id = rs.id), 0) consumo,
      coalesce((select sum(x.amount) from reservation_costs x where x.reservation_id = rs.id), 0) custos,
      round(coalesce((select sum(x.total_cost) from reservation_stock_consumption x
        where x.reservation_id = rs.id and x.inventory_item_id is not null and not x.no_cost and x.total_cost is not null), 0), 2) insumos,
      (select count(*) from reservation_stock_consumption x
        where x.reservation_id = rs.id and x.inventory_item_id is not null and (x.no_cost or x.total_cost is null))::int sem_custo,
      coalesce((select sum(p.amount) from payments p where p.reservation_id = rs.id), 0) pago,
      coalesce((select sum(p.amount) from payments p where p.reservation_id = rs.id and p.payment_date < v_start), 0) pago_antes,
      coalesce((select sum(p.amount) from payments p where p.reservation_id = rs.id and p.payment_date >= v_start and p.payment_date < v_end), 0) pago_mes,
      coalesce((select sum(p.amount) from payments p where p.reservation_id = rs.id and p.payment_date >= v_end), 0) pago_depois,
      round(coalesce((select sum(p.amount * coalesce(f.fee_percent, 0) / 100) from payments p
        left join payment_method_fees f on f.payment_method = p.payment_method where p.reservation_id = rs.id), 0), 2) taxa
    from res rs
    where (rs.status <> 'cancelada' and rs.event_date >= v_start and rs.event_date < v_end)
       or (rs.status = 'cancelada' and coalesce((rs.cancelled_at at time zone 'America/Sao_Paulo')::date, rs.event_date) >= v_start
           and coalesce((rs.cancelled_at at time zone 'America/Sao_Paulo')::date, rs.event_date) < v_end)
  ),
  fr as (
    select f.*, f.final_value + f.extras + f.consumo receita,
      f.final_value + f.extras + f.consumo - f.custos - f.insumos lucro,
      case when f.sem_custo > 0 or not f.consumption_finalized or (f.custos = 0 and f.insumos = 0) then 'parcial' else 'completo' end status_dados
    from fx f where f.tipo = 'realizada'
  ),
  -- Médias reais de consumo (mesma função do Estoque/Lucro por festa).
  med as (select * from consumption_averages(null, 10)),
  fp as (
    select f.*, f.final_value + f.extras + f.consumo receita,
      (select sum(case when m.consumption_type = 'por_convidado'
                       then coalesce(m.avg_per_guest, 0) * (coalesce(r.guest_count, 0) + coalesce(r.courtesy_guests, 0))
                       else coalesce(m.avg_per_festa, 0) end * coalesce(m.current_unit_cost, 0))
         from med m where m.unit_id = f.unit_id) insumos_previstos
    from fx f join reservations r on r.id = f.id where f.tipo = 'prevista'
  ),
  fc as (
    select f.*, coalesce(f.data_cancelamento, f.event_date) data_ref, f.data_cancelamento is null data_estimada,
      f.pago - f.refund_amount multa, f.pago - f.refund_amount - f.custos - f.insumos efeito
    from fx f where f.tipo = 'cancelada'
  ),
  -- Lançamentos do caixa no mês
  cx_pag as (
    select p.id, p.payment_date data, p.amount valor, rs.id reservation_id, rs.cliente, rs.event_date,
      case when rs.status = 'cancelada' then 'cancelada'
           when rs.event_date < v_start then 'anterior'
           when rs.event_date > v_cut then 'futura'
           else 'realizada' end classe
    from payments p join res rs on rs.id = p.reservation_id
    where p.payment_date >= v_start and p.payment_date < v_end
  ),
  cx_desp as (
    select e.id, e.paid_date data, e.amount valor, coalesce(e.description, e.category) descricao, e.category,
      case when e.category = 'Estorno' and e.reservation_id is not null then 'estorno'
           when e.settlement_id is not null or e.settlement_batch_id is not null then 'acerto'
           when e.is_stock_purchase then 'compra'
           else 'geral' end classe
    from expenses e
    where e.status = 'pago' and not e.covers_festa_costs and e.paid_date >= v_start and e.paid_date < v_end
      and (p_unit is null or e.unit_id = p_unit)
  ),
  cx_ent as (
    select o.id, o.received_date data, o.amount valor, o.description descricao from other_incomes o
    where o.received_date >= v_start and o.received_date < v_end and (p_unit is null or o.unit_id = p_unit)
  ),
  -- Custos das festas do caixa: festas não canceladas do mês até o corte
  -- (mesma regra do card "Custos das festas do mês"), lidos direto da tabela.
  cx_cus as (
    select c.amount valor from reservation_costs c join res rs on rs.id = c.reservation_id
    where rs.status <> 'cancelada' and rs.event_date >= v_start and rs.event_date < v_end and rs.event_date <= v_cut
  ),
  tot as (
    select
      (select coalesce(sum(valor), 0) from cx_pag) cx_entradas,
      (select coalesce(sum(valor), 0) from cx_ent) cx_acertos,
      (select coalesce(sum(valor), 0) from cx_desp) cx_contas,
      (select coalesce(sum(valor), 0) from cx_cus) cx_custos,
      (select count(*) from fr)::int n_festas,
      (select coalesce(sum(receita), 0) from fr) receita,
      (select coalesce(sum(custos), 0) from fr) custos,
      (select coalesce(sum(insumos), 0) from fr) insumos,
      (select coalesce(sum(taxa), 0) from fr) taxa,
      (select coalesce(sum(valor), 0) from cx_desp where classe = 'geral') despesas_gerais,
      (select coalesce(sum(valor), 0) from cx_desp where classe = 'compra') compras_estoque,
      (select coalesce(sum(valor), 0) from cx_desp where classe = 'estorno') estornos,
      (select coalesce(sum(valor), 0) from cx_desp where classe = 'acerto') acertos_pagos,
      (select coalesce(sum(multa), 0) from fc) multa,
      (select coalesce(sum(custos + insumos), 0) from fc) custos_canceladas,
      (select coalesce(sum(efeito), 0) from fc) efeito_cancelamentos,
      (select coalesce(sum(valor), 0) from cx_pag where classe = 'anterior') l_anterior,
      (select coalesce(sum(valor), 0) from cx_pag where classe = 'futura') l_futura,
      (select coalesce(sum(valor), 0) from cx_pag where classe = 'cancelada') l_cancelada,
      (select coalesce(sum(pago_antes), 0) from fr) l_antes,
      (select coalesce(sum(pago_depois), 0) from fr) l_depois,
      (select coalesce(sum(receita - pago), 0) from fr) l_receber
  ),
  calc as (
    select t.*,
      t.cx_entradas + t.cx_acertos - t.cx_contas - t.cx_custos saldo_caixa,
      t.receita - t.custos - t.insumos - t.taxa resultado_direto,
      t.receita - t.custos - t.insumos - t.taxa - t.despesas_gerais + t.efeito_cancelamentos resultado
    from tot t
  )
  select jsonb_build_object(
    'mes', to_char(v_start, 'YYYY-MM'),
    'hoje', v_today,
    'corte', v_cut,
    'mes_atual', v_today >= v_start and v_today < v_end,
    'caixa', jsonb_build_object('entradas', c.cx_entradas, 'acertos_recebidos', c.cx_acertos, 'contas_pagas', c.cx_contas,
                                'custos_festas', c.cx_custos, 'saldo', c.saldo_caixa),
    'resultado', jsonb_build_object(
      'festas', c.n_festas, 'receita', c.receita, 'custos_lancados', c.custos, 'insumos', c.insumos, 'taxa', c.taxa,
      'resultado_direto', c.resultado_direto, 'despesas_gerais', c.despesas_gerais,
      'efeito_cancelamentos', c.efeito_cancelamentos, 'resultado', c.resultado,
      'compras_estoque', c.compras_estoque),
    'festas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'data', event_date, 'cliente', cliente, 'unit_id', unit_id, 'valor_firmado', final_value,
        'extras', extras, 'consumo', consumo, 'receita', receita, 'recebido', pago, 'a_receber', receita - pago,
        'custos', custos, 'insumos', insumos, 'itens_sem_custo', sem_custo, 'consumo_finalizado', consumption_finalized,
        'taxa', taxa, 'lucro', lucro, 'status', status_dados) order by event_date, cliente) from fr), '[]'::jsonb),
    'previstas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'data', event_date, 'cliente', cliente, 'unit_id', unit_id, 'receita', receita, 'recebido', pago,
        'a_receber', receita - pago, 'custos', custos, 'insumos_previstos', round(insumos_previstos, 2),
        'sem_media', insumos_previstos is null,
        'lucro_estimado', receita - custos - coalesce(round(insumos_previstos, 2), 0)) order by event_date, cliente) from fp), '[]'::jsonb),
    'cancelamentos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'data', data_ref, 'data_estimada', data_estimada, 'data_festa', event_date, 'cliente', cliente,
        'unit_id', unit_id, 'pago', pago, 'devolvido', refund_amount, 'multa', multa, 'custos', custos + insumos,
        'efeito', efeito) order by data_ref, cliente) from fc), '[]'::jsonb),
    'ponte', jsonb_build_array(
      jsonb_build_object('chave', 'anterior', 'valor', -c.l_anterior,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', data, 'descricao', cliente || ' (festa de ' || to_char(event_date, 'DD/MM/YYYY') || ')', 'valor', valor, 'reservation_id', reservation_id) order by data) from cx_pag where classe = 'anterior'), '[]'::jsonb)),
      jsonb_build_object('chave', 'futura', 'valor', -c.l_futura,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', data, 'descricao', cliente || ' (festa de ' || to_char(event_date, 'DD/MM/YYYY') || ')', 'valor', valor, 'reservation_id', reservation_id) order by data) from cx_pag where classe = 'futura'), '[]'::jsonb)),
      jsonb_build_object('chave', 'cancelada_recebido', 'valor', -c.l_cancelada,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', data, 'descricao', cliente || ' (festa cancelada)', 'valor', valor, 'reservation_id', reservation_id) order by data) from cx_pag where classe = 'cancelada'), '[]'::jsonb)),
      jsonb_build_object('chave', 'antes', 'valor', c.l_antes,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', event_date, 'descricao', cliente, 'valor', pago_antes, 'reservation_id', id) order by event_date) from fr where pago_antes <> 0), '[]'::jsonb)),
      jsonb_build_object('chave', 'depois', 'valor', c.l_depois,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', event_date, 'descricao', cliente, 'valor', pago_depois, 'reservation_id', id) order by event_date) from fr where pago_depois <> 0), '[]'::jsonb)),
      jsonb_build_object('chave', 'a_receber', 'valor', c.l_receber,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', event_date, 'descricao', cliente, 'valor', receita - pago, 'reservation_id', id) order by event_date) from fr where receita - pago <> 0), '[]'::jsonb)),
      jsonb_build_object('chave', 'multa', 'valor', c.multa,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', data_ref, 'descricao', cliente || ' — pago ' || pago || ', devolvido ' || refund_amount, 'valor', multa, 'reservation_id', id) order by data_ref) from fc), '[]'::jsonb)),
      jsonb_build_object('chave', 'custos_canceladas', 'valor', -c.custos_canceladas,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', data_ref, 'descricao', cliente, 'valor', custos + insumos, 'reservation_id', id) order by data_ref) from fc where custos + insumos <> 0), '[]'::jsonb)),
      jsonb_build_object('chave', 'estornos', 'valor', c.estornos,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', data, 'descricao', descricao, 'valor', valor) order by data) from cx_desp where classe = 'estorno'), '[]'::jsonb)),
      jsonb_build_object('chave', 'compras_estoque', 'valor', c.compras_estoque,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', data, 'descricao', descricao, 'valor', valor) order by data) from cx_desp where classe = 'compra'), '[]'::jsonb)),
      jsonb_build_object('chave', 'insumos', 'valor', -c.insumos,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', event_date, 'descricao', cliente, 'valor', insumos, 'reservation_id', id) order by event_date) from fr where insumos <> 0), '[]'::jsonb)),
      jsonb_build_object('chave', 'acertos_recebidos', 'valor', -c.cx_acertos,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', data, 'descricao', descricao, 'valor', valor) order by data) from cx_ent), '[]'::jsonb)),
      jsonb_build_object('chave', 'acertos_pagos', 'valor', c.acertos_pagos,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', data, 'descricao', descricao, 'valor', valor) order by data) from cx_desp where classe = 'acerto'), '[]'::jsonb)),
      jsonb_build_object('chave', 'taxa', 'valor', -c.taxa,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', event_date, 'descricao', cliente, 'valor', taxa, 'reservation_id', id) order by event_date) from fr where taxa <> 0), '[]'::jsonb))
    ),
    -- Resíduo: resultado calculado pelas festas menos (caixa + linhas da
    -- ponte). Calculado pelos dois lados de forma independente.
    'diferenca', c.resultado - (c.saldo_caixa - c.l_anterior - c.l_futura - c.l_cancelada + c.l_antes + c.l_depois + c.l_receber
                  + c.multa - c.custos_canceladas + c.estornos + c.compras_estoque - c.insumos - c.cx_acertos + c.acertos_pagos - c.taxa)
  ) into v
  from calc c;

  return v;
end;
$$;

-- ---------- 3. Compromissos com festas futuras ----------
create or replace function finance_commitments(p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := today_brazil();
  v jsonb;
begin
  if auth.uid() is null or not has_permission(auth.uid(), 'page:financeiro') then raise exception 'Sem permissão'; end if;

  with
  med as (select * from consumption_averages(null, 10)),
  fut as (
    select r.id, r.unit_id, r.event_date, coalesce(c.name, '—') cliente, coalesce(r.final_value, 0) contratado,
      coalesce(r.final_value, 0)
        + coalesce((select sum(x.quantity * x.price_snapshot) from reservation_extra_items x where x.reservation_id = r.id), 0)
        + coalesce((select sum(x.quantity * x.unit_price) from reservation_consumption x where x.reservation_id = r.id), 0) devido,
      coalesce((select sum(p.amount) from payments p where p.reservation_id = r.id), 0) recebido,
      coalesce((select sum(x.amount) from reservation_costs x where x.reservation_id = r.id), 0) custos_lancados,
      round((select sum(case when m.consumption_type = 'por_convidado'
                       then coalesce(m.avg_per_guest, 0) * (coalesce(r.guest_count, 0) + coalesce(r.courtesy_guests, 0))
                       else coalesce(m.avg_per_festa, 0) end * coalesce(m.current_unit_cost, 0))
         from med m where m.unit_id = r.unit_id), 2) insumos_estimados
    from reservations r left join clients c on c.id = r.client_id
    where r.status <> 'cancelada' and r.event_date > v_today and (p_unit is null or r.unit_id = p_unit)
  )
  select jsonb_build_object(
    'hoje', v_today,
    'recebido', coalesce(sum(recebido), 0),
    'custos_previstos', coalesce(sum(custos_lancados + coalesce(insumos_estimados, 0)), 0),
    'reserva', coalesce(sum(custos_lancados + coalesce(insumos_estimados, 0)) filter (where recebido > 0), 0),
    'reserva_custos_lancados', coalesce(sum(custos_lancados) filter (where recebido > 0), 0),
    'reserva_insumos_estimados', coalesce(sum(coalesce(insumos_estimados, 0)) filter (where recebido > 0), 0),
    'festas_sem_media', count(*) filter (where insumos_estimados is null),
    'festas', coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'data', event_date, 'cliente', cliente, 'unit_id', unit_id, 'contratado', contratado, 'devido', devido,
      'recebido', recebido, 'a_receber', devido - recebido, 'custos_lancados', custos_lancados,
      'insumos_estimados', insumos_estimados, 'sem_media', insumos_estimados is null,
      'custos_previstos', custos_lancados + coalesce(insumos_estimados, 0)) order by event_date, cliente), '[]'::jsonb)
  ) into v
  from fut;

  return v;
end;
$$;

revoke all on function finance_month_views(date, uuid) from public, anon;
grant execute on function finance_month_views(date, uuid) to authenticated;
revoke all on function finance_commitments(uuid) from public, anon;
grant execute on function finance_commitments(uuid) to authenticated;

commit;
