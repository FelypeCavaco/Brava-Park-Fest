-- =========================================================
-- COBRANÇA AUTOMÁTICA PELO ASAAS (mensalidade das casas de festa)
--
-- SÓ PARA O BANCO DOS CLIENTES. Não rode na Brava.
--
-- 1) Cada empresa pode ser ligada a uma assinatura mensal no Asaas (cliente
--    + assinatura). Quem cria é a função de servidor "platform-admin".
-- 2) O Asaas avisa o sistema (função "asaas-webhook") quando uma cobrança é
--    criada, paga, vence ou é estornada. Pagou: o mês fica pago e, se a
--    empresa estava bloqueada, libera na hora.
-- 3) Bloqueio automático: empresa ligada ao Asaas com mensalidade vencida há
--    mais que a tolerância (padrão 7 dias) fica bloqueada. Ninguém dela
--    consegue usar o sistema até pagar; a tela de bloqueio mostra o link de
--    pagamento. A conferência roda a cada hora (pg_cron) e também na hora
--    de cada pagamento.
-- 4) Aviso dentro do sistema para o administrador da casa: 5 dias antes, no
--    dia do vencimento e enquanto estiver atrasada.
--
-- Empresas sem Asaas continuam como hoje (mensalidade controlada à mão).
-- Roda numa transação.
-- =========================================================

begin;

alter table platform_billing add column if not exists tolerancia_dias int not null default 7 check (tolerancia_dias between 0 and 60);
alter table platform_billing add column if not exists asaas_customer_id text;
alter table platform_billing add column if not exists asaas_subscription_id text;
alter table platform_billing add column if not exists link_pagamento text;
alter table platform_billing add column if not exists link_vencimento date;

alter table platform_billing_payments add column if not exists asaas_payment_id text unique;

alter table companies add column if not exists billing_blocked boolean not null default false;

-- Eventos recebidos do Asaas (cada evento uma vez só).
create table if not exists platform_asaas_events (
  id text primary key,
  evento text not null,
  payment_id text,
  recebido_em timestamptz not null default now(),
  resultado text
);
alter table platform_asaas_events enable row level security;
revoke all on platform_asaas_events from anon, authenticated;

-- Usuário de empresa bloqueada por pagamento não passa nas regras do banco.
create or replace function is_active_user(check_id uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select is_platform_admin(check_id) or coalesce((
    select up.active and coalesce(c.active, true) and not coalesce(c.billing_blocked, false)
    from user_profiles up left join companies c on c.id = up.company_id
    where up.id = check_id
  ), false);
$$;
revoke all on function is_active_user(uuid) from public, anon;
grant execute on function is_active_user(uuid) to authenticated;

-- Confere quem deve ficar bloqueado. Só empresas ligadas ao Asaas: elas têm
-- o link para pagar e se liberar sozinhas.
create or replace function platform_apply_billing_blocks() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with alvo as (
    select c.id,
           coalesce(b.asaas_subscription_id is not null and b.mensalidade > 0 and c.active
             and exists (select 1 from platform_billing_dues(c.id) d
                         where not d.pago and d.vencimento + b.tolerancia_dias < today_brazil()), false) bloquear
    from companies c left join platform_billing b on b.company_id = c.id
  )
  update companies c set billing_blocked = alvo.bloquear
  from alvo where alvo.id = c.id and c.billing_blocked is distinct from alvo.bloquear;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function platform_apply_billing_blocks() from public, anon, authenticated;

-- Liga a empresa ao Asaas (chamada pela função de servidor, chave de serviço).
create or replace function platform_asaas_link(p_company uuid, p_customer text, p_subscription text, p_link text, p_vencimento date) returns void
language plpgsql security definer set search_path = public as $$
begin
  update platform_billing set asaas_customer_id = p_customer, asaas_subscription_id = p_subscription,
         link_pagamento = coalesce(p_link, link_pagamento), link_vencimento = coalesce(p_vencimento, link_vencimento)
  where company_id = p_company;
  if not found then raise exception 'Cadastre antes a mensalidade da empresa.'; end if;
  perform platform_apply_billing_blocks();
end;
$$;
revoke all on function platform_asaas_link(uuid, text, text, text, date) from public, anon, authenticated;
grant execute on function platform_asaas_link(uuid, text, text, text, date) to service_role;

-- Dados para a função de servidor montar o cliente e a assinatura no Asaas.
create or replace function platform_asaas_dados(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'empresa', c.name, 'whatsapp', c.team_whatsapp,
    'razao_social', (select u.legal_name from units u where u.company_id = c.id and u.active order by u.sort, u.name limit 1),
    'cnpj', (select u.cnpj from units u where u.company_id = c.id and u.active order by u.sort, u.name limit 1),
    'email', (select p.email from user_profiles p join roles r on r.id = p.role_id
              where p.company_id = c.id and p.active and r.is_admin and coalesce(p.email, '') <> '' order by p.created_at limit 1),
    'mensalidade', b.mensalidade, 'customer_id', b.asaas_customer_id, 'subscription_id', b.asaas_subscription_id,
    'dia_vencimento', b.dia_vencimento,
    'proximo_vencimento', (select min(d.vencimento) from platform_billing_dues(c.id) d where not d.pago and d.vencimento >= today_brazil()))
  into v
  from companies c join platform_billing b on b.company_id = c.id where c.id = p_company;
  if v is null then raise exception 'Cadastre antes a mensalidade da empresa.'; end if;
  return v;
end;
$$;
revoke all on function platform_asaas_dados(uuid) from public, anon, authenticated;
grant execute on function platform_asaas_dados(uuid) to service_role;

-- Evento do Asaas (chamado pela função "asaas-webhook").
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

-- Situação da mensalidade para quem está dentro da empresa (aviso e bloqueio).
create or replace function platform_company_billing_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid := current_company_id();
  b platform_billing%rowtype;
  v_venc date;
  v_dias int;
begin
  if v_company is null then return null; end if;
  select * into b from platform_billing where company_id = v_company;
  if not found or b.asaas_subscription_id is null or b.mensalidade <= 0 then return null; end if;
  select min(d.vencimento) into v_venc from platform_billing_dues(v_company) d where not d.pago;
  if v_venc is null then return null; end if;
  v_dias := today_brazil() - v_venc; -- > 0: dias de atraso; <= 0: faltam dias
  return jsonb_build_object(
    'bloqueada', (select billing_blocked from companies where id = v_company),
    'vencimento', v_venc,
    'dias_atraso', greatest(v_dias, 0),
    'dias_para_bloqueio', greatest(b.tolerancia_dias - v_dias + 1, 0),
    'valor', b.mensalidade,
    'link', b.link_pagamento,
    'aviso', case when v_dias > 0 then 'atrasada' when v_dias = 0 then 'vence_hoje' when v_dias >= -5 then 'vence_logo' end
  );
end;
$$;
revoke all on function platform_company_billing_status() from public, anon;
grant execute on function platform_company_billing_status() to authenticated;

-- Tolerância editável pelo painel
create or replace function platform_billing_set_tolerance(p_company uuid, p_dias int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if p_dias is null or p_dias < 0 or p_dias > 60 then raise exception 'Tolerância de 0 a 60 dias.'; end if;
  update platform_billing set tolerancia_dias = p_dias where company_id = p_company;
  if not found then raise exception 'Cadastre antes a mensalidade da empresa.'; end if;
  perform platform_apply_billing_blocks();
end;
$$;
revoke all on function platform_billing_set_tolerance(uuid, int) from public, anon;
grant execute on function platform_billing_set_tolerance(uuid, int) to authenticated;

-- Pagamento ou desfazer à mão também reavaliam o bloqueio na hora.
create or replace function platform_billing_pay(p_company uuid, p_competencia date, p_valor numeric, p_pago_em date, p_forma text) returns date
language plpgsql security definer set search_path = public as $$
declare v_comp date;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if not exists (select 1 from platform_billing where company_id = p_company) then raise exception 'Cadastre antes a mensalidade da empresa.'; end if;
  v_comp := coalesce(date_trunc('month', p_competencia)::date,
                     (select min(d.competencia) from platform_billing_dues(p_company) d where not d.pago));
  if v_comp is null then raise exception 'Não há mês em aberto.'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor.'; end if;
  if exists (select 1 from platform_billing_payments where company_id = p_company and competencia = v_comp) then
    raise exception 'O mês % já está pago.', to_char(v_comp, 'MM/YYYY');
  end if;
  insert into platform_billing_payments (company_id, competencia, valor, pago_em, forma)
  values (p_company, v_comp, round(p_valor, 2), coalesce(p_pago_em, today_brazil()), nullif(trim(p_forma), ''));
  perform platform_apply_billing_blocks();
  return v_comp;
end;
$$;

create or replace function platform_billing_undo(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  delete from platform_billing_payments where id = p_id;
  perform platform_apply_billing_blocks();
end;
$$;

-- Lista do painel com o Asaas e o bloqueio.
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

-- Conferência de hora em hora (pg_cron). Se o banco não tiver pg_cron, a
-- conferência ainda roda a cada pagamento e a cada vez que o painel muda algo.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'festou-bloqueio-mensalidade';
  perform cron.schedule('festou-bloqueio-mensalidade', '7 * * * *', 'select public.platform_apply_billing_blocks()');
exception when others then
  raise notice 'pg_cron indisponível: %', sqlerrm;
end $$;

grant execute on all functions in schema public to app_definer;
select fix_definer_owners();

commit;

notify pgrst, 'reload schema';
