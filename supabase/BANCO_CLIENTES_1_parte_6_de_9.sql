-- =========================================================
-- BANCO DOS CLIENTES — ESTRUTURA, PARTE 6 DE 9
-- Rode as partes EM ORDEM (1, 2, 3...), cada uma numa query nova do SQL
-- Editor do projeto NOVO. Se aparecer a pergunta sobre "Row Level Security",
-- escolha rodar SEM o Supabase acrescentar nada (a segurança já está aqui).
-- Cada parte roda inteira ou nada.
-- =========================================================

begin;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'units') then
    raise exception 'Rode antes a parte 1 (e as seguintes, em ordem).';
  end if;
end $$;

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

-- =========================================================
-- COMISSÃO DA GERENTE POR FESTA FECHADA
--
-- Regras combinadas:
--   • Comissão por festa CADASTRADA (data do cadastro, fuso de Brasília).
--   • Valor fixo (hoje R$ 150), editável pela tela. Cada festa usa o valor
--     que valia no dia em que foi cadastrada; o histórico de valores fica
--     guardado.
--   • Repasse toda segunda-feira: paga as festas cadastradas até o domingo
--     anterior que ainda não foram pagas.
--   • Festa com comissão já paga que é cancelada depois: o valor é abatido
--     no próximo repasse. Se a festa voltar (deixar de estar cancelada), a
--     comissão volta a ser devida.
--   • Festa cadastrada e cancelada antes do repasse: não gera comissão.
--   • Só contam festas cadastradas a partir da data de início configurada
--     (para não cobrar de novo o que já foi pago fora do sistema).
--   • Pagar o repasse cria, em cada unidade, uma conta PAGA no Financeiro
--     (categoria "Comissão"), com a lista das festas. Essa conta só muda
--     pela tela Comissões. Unidade cujo total da semana não fica positivo
--     (só abatimentos) não é paga: os itens ficam para o próximo repasse.
--
-- Nada aqui altera festas, pagamentos ou contas já existentes.
-- Roda dentro de uma transação. Para desfazer: 064_REVERTER_comissao_gerente.sql
-- =========================================================


-- ---------- Tabelas ----------
create table if not exists commission_rates (
  id uuid primary key default gen_random_uuid(),
  amount numeric(10,2) not null check (amount >= 0),
  valid_from date not null,
  created_at timestamptz not null default now()
);

create table if not exists commission_settings (
  id uuid primary key default gen_random_uuid(),
  unica boolean not null default true unique check (unica), -- uma linha só
  start_date date not null,
  beneficiary text not null default 'Gerente'
);

create table if not exists commission_payouts (
  id uuid primary key default gen_random_uuid(),
  until_date date not null,       -- festas cadastradas até esta data
  paid_date date not null,
  payment_method text,
  total numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create table if not exists commission_payout_items (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references commission_payouts(id) on delete cascade,
  reservation_id uuid not null references reservations(id) on delete cascade,
  unit_id uuid not null references units(id),
  kind text not null check (kind in ('comissao', 'abatimento', 'ajuste')),
  amount numeric(10,2) not null
);

create index if not exists idx_commission_items_reservation on commission_payout_items (reservation_id);

create index if not exists idx_commission_items_payout on commission_payout_items (payout_id);

alter table expenses add column if not exists commission_payout_id uuid references commission_payouts(id) on delete set null;

-- Valor inicial e data de início: contam as festas cadastradas a partir de
-- segunda, 19/10/2026 (as anteriores foram lançadas à parte como despesa).
-- Os dois podem ser mudados pela tela.
insert into commission_rates (amount, valid_from)
select 150, date '2000-01-01' where not exists (select 1 from commission_rates);

insert into commission_settings (start_date)
select date '2026-10-19'
where not exists (select 1 from commission_settings);

-- ---------- Acesso: só leitura pela tela; gravação só pelas funções ----------
alter table commission_rates enable row level security;

alter table commission_settings enable row level security;

alter table commission_payouts enable row level security;

alter table commission_payout_items enable row level security;

drop policy if exists "read_comissoes" on commission_rates;

drop policy if exists "read_comissoes" on commission_settings;

drop policy if exists "read_comissoes" on commission_payouts;

drop policy if exists "read_comissoes" on commission_payout_items;

create policy "read_comissoes" on commission_rates for select using (has_permission(auth.uid(), 'page:comissoes'));

create policy "read_comissoes" on commission_settings for select using (has_permission(auth.uid(), 'page:comissoes'));

create policy "read_comissoes" on commission_payouts for select using (has_permission(auth.uid(), 'page:comissoes'));

create policy "read_comissoes" on commission_payout_items for select using (has_permission(auth.uid(), 'page:comissoes'));

grant select on commission_rates, commission_settings, commission_payouts, commission_payout_items to authenticated;

-- Permissões: quem já vê o Financeiro vê, paga e configura comissões.
-- Desfazer um repasse: só Administrador (nenhuma linha criada).
insert into role_permission_items (role_id, permission_key, allowed)
select r.id, k, true
from roles r
cross join unnest(array['page:comissoes', 'action:comissoes.pagar', 'action:comissoes.configurar']) k
where not r.is_admin
  and exists (select 1 from role_permission_items x where x.role_id = r.id and x.permission_key = 'page:financeiro' and x.allowed)
on conflict (role_id, permission_key) do nothing;

-- ---------- Trava da conta de comissão ----------
create or replace function guard_locked_expense() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.expense_fn', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if old.commission_payout_id is not null then
    if tg_op = 'DELETE' then
      raise exception 'Conta de comissão: desfaça o repasse pela tela Comissões.';
    end if;
    if new.amount is distinct from old.amount or new.unit_id is distinct from old.unit_id
       or new.category is distinct from old.category or new.description is distinct from old.description
       or new.status is distinct from old.status or new.commission_payout_id is distinct from old.commission_payout_id then
      raise exception 'Conta de comissão: o valor vem do repasse; para mudar, desfaça o repasse pela tela Comissões.';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.commission_payout_id is not null then
    raise exception 'Só a tela Comissões pode ligar uma conta a um repasse.';
  end if;
  if old.settlement_batch_id is not null then
    raise exception 'Lançamento de acerto entre unidades: altere ou desfaça pela tela Acertos entre unidades.';
  end if;
  if old.is_stock_purchase or (old.category = 'Estorno' and old.reservation_id is not null) or old.settlement_id is not null then
    if tg_op = 'DELETE' then
      raise exception '%', case
        when old.is_stock_purchase then 'Compra de estoque: exclua pela Entrada de compra (tela Estoque).'
        when old.settlement_id is not null then 'Conta de acerto entre unidades: cancele pela tela Acertos entre unidades.'
        else 'Estorno: altere pela festa cancelada.' end;
    end if;
    if new.amount is distinct from old.amount or new.unit_id is distinct from old.unit_id
       or new.category is distinct from old.category or new.description is distinct from old.description
       or new.supplier is distinct from old.supplier or new.is_stock_purchase is distinct from old.is_stock_purchase
       or new.reservation_id is distinct from old.reservation_id or new.settlement_id is distinct from old.settlement_id
       or (old.settlement_id is not null and (new.status = 'cancelado' or old.status = 'cancelado')) then
      raise exception '%', case
        when old.is_stock_purchase then 'Compra de estoque: edite pela Entrada de compra (tela Estoque).'
        when old.settlement_id is not null then 'Conta de acerto entre unidades: o valor vem da transferência; para cancelar, use a tela Acertos entre unidades.'
        else 'Estorno: altere o valor pela festa cancelada.' end;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function guard_commission_expense_insert() returns trigger
language plpgsql as $$
begin
  if new.commission_payout_id is not null and coalesce(current_setting('app.expense_fn', true), '') <> '1' then
    raise exception 'Só a tela Comissões pode criar conta de comissão.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_commission_expense_insert on expenses;

create trigger trg_guard_commission_expense_insert before insert on expenses
  for each row execute function guard_commission_expense_insert();

-- ---------- Cálculo ----------
-- Valor da comissão que valia numa data.
create or replace function commission_rate_at(p_date date) returns numeric
language sql stable security definer set search_path = public as $$
  select amount from commission_rates where valid_from <= p_date order by valid_from desc, created_at desc limit 1
$$;

-- Último domingo já encerrado (o repasse de segunda paga até ele).
create or replace function commission_last_sunday() returns date
language sql stable as $$
  select today_brazil() - extract(isodow from today_brazil())::int
$$;

-- O que falta pagar (ou abater) por festa. Devido = valor da comissão do dia
-- do cadastro se a festa não está cancelada, ou zero se está. Já pago = soma
-- dos repasses. A diferença é o que entra no próximo repasse.
-- p_until: comissões de festas cadastradas até esta data (abatimentos entram
-- sempre, qualquer que seja a data do cadastro).
create or replace function commission_pending(p_until date default null)
returns table (reservation_id uuid, unit_id uuid, cliente text, cadastro date, event_date date, status text,
               cancelada_em date, kind text, amount numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_until date := coalesce(p_until, commission_last_sunday());
begin
  if not has_permission(auth.uid(), 'page:comissoes') then raise exception 'Sem permissão'; end if;
  return query
  with base as (
    select r.id, r.unit_id, coalesce(c.name, '—') cli, (r.created_at at time zone 'America/Sao_Paulo')::date cad,
           r.event_date ev, r.status::text st, (r.cancelled_at at time zone 'America/Sao_Paulo')::date canc,
           case when r.status <> 'cancelada' then coalesce(commission_rate_at((r.created_at at time zone 'America/Sao_Paulo')::date), 0) else 0 end devido,
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

-- ---------- Pagar o repasse ----------
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

  -- Unidades com total positivo no período
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

-- Desfaz um repasse (só Administrador): apaga as contas e o repasse; as
-- festas voltam a ficar pendentes.
create or replace function undo_commission_payout(p_payout uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:comissoes.desfazer') then raise exception 'Sem permissão'; end if;
  perform set_config('app.expense_fn', '1', true);
  delete from expenses where commission_payout_id = p_payout;
  perform set_config('app.expense_fn', '', true);
  delete from commission_payouts where id = p_payout;
end;
$$;

-- ---------- Configuração ----------
create or replace function set_commission_rate(p_amount numeric, p_valid_from date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:comissoes.configurar') then raise exception 'Sem permissão'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Informe um valor válido.'; end if;
  if p_valid_from is null then raise exception 'Informe a partir de quando vale.'; end if;
  insert into commission_rates (amount, valid_from) values (round(p_amount, 2), p_valid_from);
end;
$$;

create or replace function set_commission_settings(p_start date, p_beneficiary text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:comissoes.configurar') then raise exception 'Sem permissão'; end if;
  if p_start is null then raise exception 'Informe a data de início.'; end if;
  update commission_settings set start_date = p_start, beneficiary = coalesce(nullif(trim(p_beneficiary), ''), 'Gerente') where unica;
end;
$$;

-- ---------- Acessos às funções ----------
revoke all on function commission_rate_at(date) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'commission_last_sunday()', 'commission_pending(date)', 'pay_commissions(date, date, text)',
    'undo_commission_payout(uuid)', 'set_commission_rate(numeric, date)', 'set_commission_settings(date, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Histórico de alterações
drop trigger if exists trg_audit on commission_rates;

create trigger trg_audit after insert or update or delete on commission_rates for each row execute function audit_row_change();

drop trigger if exists trg_audit on commission_settings;

create trigger trg_audit after insert or update or delete on commission_settings for each row execute function audit_row_change();

drop trigger if exists trg_audit on commission_payouts;

create trigger trg_audit after insert or update or delete on commission_payouts for each row execute function audit_row_change();

-- =========================================================
-- NOVOS PLANOS DE SÃO VICENTE: BRAVA CLASSIC E BRAVA GOURMET
--
-- Fonte: Portfólio Brava Park Fest 2026 e 2027.
--
-- 2026 (festas até 31/12/2026): Classic e Gourmet de 40, 50 e 60 pessoas.
-- 2027 (festas a partir de 01/01/2027): Classic e Gourmet de 40 a 80
--   pessoas, com os valores do portfólio 2027.
--
-- O que vem incluso: o mesmo dos planos de São Vicente que já existiam
-- (buffet, decoração, brinquedos, estrutura e equipe da unidade).
--   • Classic = coquetéis, sem pratos quentes.
--   • Gourmet = coquetéis + pratos quentes, na mesma quantidade do Gourmet
--     da Vila Operária para o mesmo número de pessoas (40 → 3, 50 → 4,
--     60 → 5, 70 → 6, 80 → 7).
--
-- Os planos antigos de São Vicente ("Festa Completa ... pessoas" e
-- "Festa Completa ... pessoas (2027)") deixam de aparecer para festas
-- novas. As festas já cadastradas com eles NÃO mudam: continuam com o
-- mesmo plano e o mesmo valor.
--
-- Vila Operária não muda (o portfólio 2027 traz os mesmos valores).
-- Valores e textos podem ser ajustados depois pela tela Pacotes.
-- Roda numa transação; pode rodar mais de uma vez sem duplicar.
-- =========================================================


-- ---------- Planos novos ----------
with sv as (select id from units where name = 'São Vicente'),
base as (
  select
    'Brinquedos: arena de cama elástica, circuito radical, tobogã, piscina de bolinhas, basquete eletrônico, fliperama (mais de 10 mil jogos), ambiente game (PlayStation) e presença do Urso Theo / Raposa Nino. '
    || 'Decoração inclusa (mediante disponibilidade do tema escolhido). Ambiente climatizado e monitorado, TV, som ambiente, Wi-Fi e convite virtual (padrão Brava Park Fest). '
    || 'Equipe: recepcionista, garçom, recreadoras treinadas e equipe de cozinha.' as estrutura
),
planos (nome, tipo, pessoas, semana, fds, de, ate) as (values
  -- 2026
  ('Classic 40 pessoas', 'classic', 40, 4300.00, 4500.00, null::date, date '2026-12-31'),
  ('Classic 50 pessoas', 'classic', 50, 4900.00, 5200.00, null, date '2026-12-31'),
  ('Classic 60 pessoas', 'classic', 60, 5400.00, 5800.00, null, date '2026-12-31'),
  ('Gourmet 40 pessoas', 'gourmet', 40, 4700.00, 4950.00, null, date '2026-12-31'),
  ('Gourmet 50 pessoas', 'gourmet', 50, 5400.00, 5700.00, null, date '2026-12-31'),
  ('Gourmet 60 pessoas', 'gourmet', 60, 5900.00, 6400.00, null, date '2026-12-31'),
  -- 2027
  ('Classic 40 pessoas (2027)', 'classic', 40, 5430.00, 6100.00, date '2027-01-01', null),
  ('Classic 50 pessoas (2027)', 'classic', 50, 5900.00, 6550.00, date '2027-01-01', null),
  ('Classic 60 pessoas (2027)', 'classic', 60, 6470.00, 7100.00, date '2027-01-01', null),
  ('Classic 70 pessoas (2027)', 'classic', 70, 6900.00, 7750.00, date '2027-01-01', null),
  ('Classic 80 pessoas (2027)', 'classic', 80, 7590.00, 8390.00, date '2027-01-01', null),
  ('Gourmet 40 pessoas (2027)', 'gourmet', 40, 6230.00, 6870.00, date '2027-01-01', null),
  ('Gourmet 50 pessoas (2027)', 'gourmet', 50, 6710.00, 7350.00, date '2027-01-01', null),
  ('Gourmet 60 pessoas (2027)', 'gourmet', 60, 7270.00, 7990.00, date '2027-01-01', null),
  ('Gourmet 70 pessoas (2027)', 'gourmet', 70, 7830.00, 8630.00, date '2027-01-01', null),
  ('Gourmet 80 pessoas (2027)', 'gourmet', 80, 8390.00, 9270.00, date '2027-01-01', null)
),
pratos (pessoas, n, extenso) as (values (40, 3, 'três'), (50, 4, 'quatro'), (60, 5, 'cinco'), (70, 6, 'seis'), (80, 7, 'sete'))
insert into packages (name, description, base_price, weekday_price, weekend_price, unit_id, guest_limit, duration_hours,
                      included_items, hot_dish_count, valid_from, valid_until, active)
select
  p.nome,
  case when p.tipo = 'classic' then 'Brava Classic (coquetéis)' else 'Brava Gourmet (coquetéis e pratos quentes)' end
    || ' — São Vicente, tabela ' || case when p.de is null then '2026' else '2027' end,
  p.semana, p.semana, p.fds, sv.id, p.pessoas, 4,
  case when p.tipo = 'classic'
    then 'Coquetéis: salgados fritos e assados sortidos, docinhos sortidos, bolo, refrigerante, suco e água. '
    else 'Coquetéis e pratos quentes: salgados fritos e assados sortidos, docinhos sortidos, bolo, refrigerante, suco, água e até '
         || pr.n || ' (' || pr.extenso || ') opções de pratos quentes, escolhidas pela contratante dentre o cardápio vigente do Brava Park Fest. '
  end || base.estrutura,
  case when p.tipo = 'classic' then 0 else pr.n end,
  p.de, p.ate, true
from planos p
cross join sv
cross join base
join pratos pr on pr.pessoas = p.pessoas
where not exists (select 1 from packages x where x.unit_id = sv.id and x.name = p.nome);

-- ---------- Planos antigos de São Vicente saem de uso ----------
-- (só para festas novas; as festas já cadastradas continuam com eles)
update packages
set active = false
where unit_id = (select id from units where name = 'São Vicente')
  and name like 'Festa Completa %'
  and active;

commit;
