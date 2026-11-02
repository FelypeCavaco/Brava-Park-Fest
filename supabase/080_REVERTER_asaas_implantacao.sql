-- =========================================================
-- REVERTER a migração 080 (implantação no Asaas) — só use se for para desfazer.
-- Volta a regra anterior dos pagamentos e esquece a cobrança da implantação
-- (a cobrança continua existindo no Asaas: cancele lá se não for usar).
-- =========================================================
begin;

create or replace function platform_asaas_event(p_event jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id text := p_event ->> 'id';
  v_evento text := p_event ->> 'event';
  pg jsonb := p_event -> 'payment';
  v_company uuid;
  v_comp date;
  v_res text;
begin
  if v_id is null or v_evento is null then return 'ignorado: sem id'; end if;
  if exists (select 1 from platform_asaas_events where id = v_id) then return 'repetido'; end if;
  if pg is null then
    insert into platform_asaas_events (id, evento, resultado) values (v_id, v_evento, 'sem cobrança');
    return 'sem cobrança';
  end if;

  select b.company_id into v_company from platform_billing b
  where (pg ->> 'subscription' is not null and b.asaas_subscription_id = pg ->> 'subscription')
     or (b.asaas_customer_id = pg ->> 'customer')
  order by (b.asaas_subscription_id = pg ->> 'subscription') desc nulls last
  limit 1;
  if v_company is null and (pg ->> 'externalReference') ~ '^[0-9a-f-]{36}$' then
    select company_id into v_company from platform_billing where company_id = (pg ->> 'externalReference')::uuid;
  end if;
  if v_company is null then
    insert into platform_asaas_events (id, evento, payment_id, resultado) values (v_id, v_evento, pg ->> 'id', 'empresa não encontrada');
    return 'empresa não encontrada';
  end if;

  v_comp := date_trunc('month', (pg ->> 'dueDate')::date)::date;

  if v_evento in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH') then
    if exists (select 1 from platform_billing_payments where asaas_payment_id = pg ->> 'id') then
      v_res := 'pagamento já registrado';
    elsif exists (select 1 from platform_billing_payments where company_id = v_company and competencia = v_comp) then
      v_res := 'mês já estava pago';
    else
      insert into platform_billing_payments (company_id, competencia, valor, pago_em, forma, asaas_payment_id)
      values (v_company, v_comp, coalesce((pg ->> 'value')::numeric, 0.01),
              coalesce((pg ->> 'paymentDate')::date, (pg ->> 'clientPaymentDate')::date, today_brazil()),
              'Asaas' || coalesce(' · ' || lower(pg ->> 'billingType'), ''), pg ->> 'id');
      v_res := 'pago ' || to_char(v_comp, 'MM/YYYY');
    end if;
    -- a fatura paga deixa de ser o link de pagamento
    update platform_billing set link_pagamento = null, link_vencimento = null
    where company_id = v_company and link_vencimento = (pg ->> 'dueDate')::date;
  elsif v_evento in ('PAYMENT_REFUNDED', 'PAYMENT_DELETED', 'PAYMENT_RECEIVED_IN_CASH_UNDONE', 'PAYMENT_CHARGEBACK_REQUESTED') then
    delete from platform_billing_payments where asaas_payment_id = pg ->> 'id';
    v_res := case when found then 'pagamento desfeito' else 'nada a desfazer' end;
  elsif v_evento in ('PAYMENT_CREATED', 'PAYMENT_UPDATED', 'PAYMENT_OVERDUE', 'PAYMENT_RESTORED') then
    -- guarda o link da fatura em aberto mais antiga (é o que o cliente precisa pagar)
    update platform_billing set link_pagamento = pg ->> 'invoiceUrl', link_vencimento = (pg ->> 'dueDate')::date
    where company_id = v_company and pg ->> 'invoiceUrl' is not null
      and (link_vencimento is null or link_vencimento >= (pg ->> 'dueDate')::date
           or not exists (select 1 from platform_billing_dues(v_company) d where not d.pago and d.vencimento = link_vencimento));
    v_res := 'link atualizado';
  else
    v_res := 'ignorado';
  end if;

  insert into platform_asaas_events (id, evento, payment_id, resultado) values (v_id, v_evento, pg ->> 'id', v_res);
  perform platform_apply_billing_blocks();
  return v_res;
end;
$$;
revoke all on function platform_asaas_event(jsonb) from public, anon, authenticated;
grant execute on function platform_asaas_event(jsonb) to service_role;

drop function if exists platform_billing_list();
create or replace function platform_billing_list()
returns table (company_id uuid, cadastrada boolean, plano text, mensalidade numeric, dia_vencimento int, inicio date,
               implantacao numeric, unidade_adicional numeric, unidades_incluidas int, usuarios_incluidos int, observacao text,
               proximo_vencimento date, meses_em_aberto int, valor_em_aberto numeric, dias_atraso int, situacao text, ultimo_pagamento date,
               tolerancia_dias int, asaas boolean, link_pagamento text, bloqueada boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query
  select c.id, b.company_id is not null, b.plano, b.mensalidade, b.dia_vencimento, b.inicio,
         b.implantacao, b.unidade_adicional, b.unidades_incluidas, b.usuarios_incluidos, b.observacao,
         x.prox, coalesce(x.abertos, 0), coalesce(x.abertos, 0) * coalesce(b.mensalidade, 0), coalesce(x.atraso, 0),
         case when b.company_id is null then 'sem_cadastro'
              when b.mensalidade = 0 then 'sem_cobranca'
              when coalesce(x.atraso, 0) > 0 then 'atrasada'
              when x.prox = today_brazil() then 'vence_hoje'
              when x.prox <= today_brazil() + 5 then 'vence_logo'
              else 'em_dia' end,
         (select max(p.pago_em) from platform_billing_payments p where p.company_id = c.id),
         b.tolerancia_dias, b.asaas_subscription_id is not null, b.link_pagamento, c.billing_blocked
  from companies c
  left join platform_billing b on b.company_id = c.id
  left join lateral (
    select min(d.vencimento) filter (where not d.pago) prox,
           count(*) filter (where not d.pago and d.vencimento <= today_brazil())::int abertos,
           coalesce(today_brazil() - min(d.vencimento) filter (where not d.pago and d.vencimento < today_brazil()), 0)::int atraso
    from platform_billing_dues(c.id) d
  ) x on b.company_id is not null
  order by c.created_at;
end;
$$;
revoke all on function platform_billing_list() from public, anon;
grant execute on function platform_billing_list() to authenticated;

drop function if exists platform_asaas_implantacao(uuid, text, text, date, text);
alter table platform_billing
  drop column if exists implantacao_payment_id,
  drop column if exists implantacao_link,
  drop column if exists implantacao_vencimento,
  drop column if exists implantacao_paga_em,
  drop column if exists implantacao_status;

select fix_definer_owners();

commit;

notify pgrst, 'reload schema';
