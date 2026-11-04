-- =========================================================
-- BANCO DOS CLIENTES — ESTRUTURA, PARTE 11 DE 11
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

-- =========================================================
-- ASAAS: TAXA DE IMPLANTAÇÃO E CORREÇÃO DOS PAGAMENTOS AVULSOS
--
-- SÓ PARA O BANCO DOS CLIENTES (depois da 079). Não rode na Brava.
--
-- 1) Correção: só conta como mensalidade o pagamento que vem da ASSINATURA
--    mensal da empresa. Qualquer outra cobrança do mesmo cliente no Asaas
--    (implantação, serviço extra) não marca mês como pago nem mexe no
--    bloqueio.
-- 2) Taxa de implantação: cobrança única no Asaas, criada pelo painel. O
--    sistema guarda o link, o vencimento e quando foi paga. Não bloqueia o
--    acesso se atrasar.
--
-- Roda numa transação.
-- =========================================================


alter table platform_billing add column if not exists implantacao_payment_id text;

alter table platform_billing add column if not exists implantacao_link text;

alter table platform_billing add column if not exists implantacao_vencimento date;

alter table platform_billing add column if not exists implantacao_paga_em date;

alter table platform_billing add column if not exists implantacao_status text
  check (implantacao_status is null or implantacao_status in ('pendente', 'vencida', 'paga', 'cancelada', 'estornada'));

-- Cobrança da implantação criada no Asaas (chamada pela função de servidor).
create or replace function platform_asaas_implantacao(p_company uuid, p_payment text, p_link text, p_vencimento date, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update platform_billing set implantacao_payment_id = p_payment, implantacao_link = p_link,
         implantacao_vencimento = p_vencimento, implantacao_status = p_status,
         implantacao_paga_em = case when p_status = 'paga' then implantacao_paga_em else null end
  where company_id = p_company;
  if not found then raise exception 'Cadastre antes a mensalidade da empresa.'; end if;
end;
$$;

revoke all on function platform_asaas_implantacao(uuid, text, text, date, text) from public, anon, authenticated;

grant execute on function platform_asaas_implantacao(uuid, text, text, date, text) to service_role;

-- Evento do Asaas: mensalidade só da assinatura; implantação à parte; o resto ignorado.
create or replace function platform_asaas_event(p_event jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id text := p_event ->> 'id';
  v_evento text := p_event ->> 'event';
  pg jsonb := p_event -> 'payment';
  b platform_billing%rowtype;
  v_comp date;
  v_res text;
begin
  if v_id is null or v_evento is null then return 'ignorado: sem id'; end if;
  if exists (select 1 from platform_asaas_events where id = v_id) then return 'repetido'; end if;
  if pg is null then
    insert into platform_asaas_events (id, evento, resultado) values (v_id, v_evento, 'sem cobrança');
    return 'sem cobrança';
  end if;

  select * into b from platform_billing x
  where (pg ->> 'subscription' is not null and x.asaas_subscription_id = pg ->> 'subscription')
     or (x.implantacao_payment_id = pg ->> 'id')
     or (x.asaas_customer_id = pg ->> 'customer')
  order by (x.asaas_subscription_id = pg ->> 'subscription') desc nulls last, (x.implantacao_payment_id = pg ->> 'id') desc nulls last
  limit 1;
  if not found then
    insert into platform_asaas_events (id, evento, payment_id, resultado) values (v_id, v_evento, pg ->> 'id', 'empresa não encontrada');
    return 'empresa não encontrada';
  end if;

  if b.implantacao_payment_id is not null and b.implantacao_payment_id = pg ->> 'id' then
    -- ---------- taxa de implantação ----------
    if v_evento in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH') then
      update platform_billing set implantacao_status = 'paga', implantacao_link = null,
             implantacao_paga_em = coalesce((pg ->> 'paymentDate')::date, (pg ->> 'clientPaymentDate')::date, today_brazil())
      where company_id = b.company_id;
      v_res := 'implantação paga';
    elsif v_evento = 'PAYMENT_OVERDUE' then
      update platform_billing set implantacao_status = 'vencida' where company_id = b.company_id and implantacao_status <> 'paga';
      v_res := 'implantação vencida';
    elsif v_evento in ('PAYMENT_REFUNDED', 'PAYMENT_RECEIVED_IN_CASH_UNDONE', 'PAYMENT_CHARGEBACK_REQUESTED') then
      update platform_billing set implantacao_status = 'estornada', implantacao_paga_em = null where company_id = b.company_id;
      v_res := 'implantação estornada';
    elsif v_evento = 'PAYMENT_DELETED' then
      update platform_billing set implantacao_status = 'cancelada', implantacao_link = null where company_id = b.company_id and implantacao_status <> 'paga';
      v_res := 'implantação cancelada';
    elsif v_evento in ('PAYMENT_CREATED', 'PAYMENT_UPDATED', 'PAYMENT_RESTORED') then
      update platform_billing set implantacao_link = coalesce(pg ->> 'invoiceUrl', implantacao_link),
             implantacao_vencimento = coalesce((pg ->> 'dueDate')::date, implantacao_vencimento),
             implantacao_status = case when implantacao_status in ('paga') then implantacao_status else 'pendente' end
      where company_id = b.company_id;
      v_res := 'implantação atualizada';
    else
      v_res := 'ignorado';
    end if;

  elsif pg ->> 'subscription' is null or b.asaas_subscription_id is null or pg ->> 'subscription' <> b.asaas_subscription_id then
    -- ---------- cobrança avulsa: não é mensalidade ----------
    v_res := 'avulsa (não conta como mensalidade)';

  else
    -- ---------- mensalidade (assinatura) ----------
    v_comp := date_trunc('month', (pg ->> 'dueDate')::date)::date;
    if v_evento in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH') then
      if exists (select 1 from platform_billing_payments where asaas_payment_id = pg ->> 'id') then
        v_res := 'pagamento já registrado';
      elsif exists (select 1 from platform_billing_payments where company_id = b.company_id and competencia = v_comp) then
        v_res := 'mês já estava pago';
      else
        insert into platform_billing_payments (company_id, competencia, valor, pago_em, forma, asaas_payment_id)
        values (b.company_id, v_comp, coalesce((pg ->> 'value')::numeric, 0.01),
                coalesce((pg ->> 'paymentDate')::date, (pg ->> 'clientPaymentDate')::date, today_brazil()),
                'Asaas' || coalesce(' · ' || lower(pg ->> 'billingType'), ''), pg ->> 'id');
        v_res := 'pago ' || to_char(v_comp, 'MM/YYYY');
      end if;
      update platform_billing set link_pagamento = null, link_vencimento = null
      where company_id = b.company_id and link_vencimento = (pg ->> 'dueDate')::date;
    elsif v_evento in ('PAYMENT_REFUNDED', 'PAYMENT_DELETED', 'PAYMENT_RECEIVED_IN_CASH_UNDONE', 'PAYMENT_CHARGEBACK_REQUESTED') then
      delete from platform_billing_payments where asaas_payment_id = pg ->> 'id';
      v_res := case when found then 'pagamento desfeito' else 'nada a desfazer' end;
    elsif v_evento in ('PAYMENT_CREATED', 'PAYMENT_UPDATED', 'PAYMENT_OVERDUE', 'PAYMENT_RESTORED') then
      update platform_billing set link_pagamento = pg ->> 'invoiceUrl', link_vencimento = (pg ->> 'dueDate')::date
      where company_id = b.company_id and pg ->> 'invoiceUrl' is not null
        and (link_vencimento is null or link_vencimento >= (pg ->> 'dueDate')::date
             or not exists (select 1 from platform_billing_dues(b.company_id) d where not d.pago and d.vencimento = link_vencimento));
      v_res := 'link atualizado';
    else
      v_res := 'ignorado';
    end if;
  end if;

  insert into platform_asaas_events (id, evento, payment_id, resultado) values (v_id, v_evento, pg ->> 'id', v_res);
  perform platform_apply_billing_blocks();
  return v_res;
end;
$$;

revoke all on function platform_asaas_event(jsonb) from public, anon, authenticated;

grant execute on function platform_asaas_event(jsonb) to service_role;

-- Lista do painel com a implantação.
drop function if exists platform_billing_list();

create or replace function platform_billing_list()
returns table (company_id uuid, cadastrada boolean, plano text, mensalidade numeric, dia_vencimento int, inicio date,
               implantacao numeric, unidade_adicional numeric, unidades_incluidas int, usuarios_incluidos int, observacao text,
               proximo_vencimento date, meses_em_aberto int, valor_em_aberto numeric, dias_atraso int, situacao text, ultimo_pagamento date,
               tolerancia_dias int, asaas boolean, link_pagamento text, bloqueada boolean,
               implantacao_status text, implantacao_link text, implantacao_vencimento date, implantacao_paga_em date)
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
         b.tolerancia_dias, b.asaas_subscription_id is not null, b.link_pagamento, c.billing_blocked,
         b.implantacao_status, b.implantacao_link, b.implantacao_vencimento, b.implantacao_paga_em
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

grant execute on all functions in schema public to app_definer;

select fix_definer_owners();

-- =========================================================
-- LIMPEZA: nenhum dado da Brava (nem de ninguém) fica no banco novo.
-- =========================================================
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('truncate table %I cascade', t);
  end loop;
end $$;

-- ===== 083: aceite dos Termos de Uso =====
create table if not exists platform_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  company_id uuid references companies(id) on delete cascade,
  version text not null,
  user_name text,
  user_email text,
  user_agent text,
  accepted_at timestamptz not null default now(),
  unique (user_id, version)
);
create index if not exists idx_platform_terms_company on platform_terms_acceptances (company_id, accepted_at desc);
alter table platform_terms_acceptances enable row level security;
-- sem políticas: só as funções abaixo leem e gravam
revoke all on platform_terms_acceptances from anon, authenticated;

-- situação do usuário: 'aceito' (esta versão), 'antiga' (aceitou outra versão) ou 'nunca'
create or replace function platform_terms_status(p_version text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from platform_terms_acceptances where user_id = auth.uid() and version = p_version) then 'aceito'
    when exists (select 1 from platform_terms_acceptances where user_id = auth.uid()) then 'antiga'
    else 'nunca' end;
$$;

-- aceitar (uma vez por versão; aceitar de novo não duplica)
create or replace function platform_terms_accept(p_version text, p_user_agent text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Entre no sistema para aceitar os Termos.'; end if;
  if coalesce(trim(p_version), '') = '' then raise exception 'Versão dos Termos não informada.'; end if;
  insert into platform_terms_acceptances (user_id, company_id, version, user_name, user_email, user_agent)
  values (auth.uid(), current_company_id(), left(trim(p_version), 40),
          (select name from user_profiles where id = auth.uid()),
          (select email from auth.users where id = auth.uid()),
          left(p_user_agent, 300))
  on conflict (user_id, version) do nothing;
end;
$$;

-- quem do Fornecedor/plataforma vê: aceites de uma empresa
create or replace function platform_terms_list(p_company uuid)
returns table (user_name text, user_email text, version text, accepted_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query
    select a.user_name, a.user_email, a.version, a.accepted_at
    from platform_terms_acceptances a where a.company_id = p_company
    order by a.accepted_at desc;
end;
$$;

-- quem oferece o sistema, para aparecer nos Termos (nome, documento e contatos)
create or replace function platform_terms_provider() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object(
    'nome', s.contratada_nome, 'documento', s.contratada_documento, 'endereco', s.contratada_endereco,
    'email', s.contratada_email, 'whatsapp', s.contratada_whatsapp, 'foro', s.foro)
    from platform_settings s limit 1), '{}'::jsonb);
$$;

revoke all on function platform_terms_status(text) from public, anon;
revoke all on function platform_terms_accept(text, text) from public, anon;
revoke all on function platform_terms_list(uuid) from public, anon;
revoke all on function platform_terms_provider() from public;
grant execute on function platform_terms_status(text) to authenticated;
grant execute on function platform_terms_accept(text, text) to authenticated;
grant execute on function platform_terms_list(uuid) to authenticated;
-- os Termos também podem ser lidos antes de entrar (página pública /termos)
grant execute on function platform_terms_provider() to anon, authenticated;

select fix_definer_owners();


-- ===== 084: portal sem envio de comprovante =====
create or replace function portal_submit_receipt(p_token uuid, p_amount numeric, p_path text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'O envio de comprovante pelo portal foi desativado. Pague pelo Pix (QR code ou copia e cola): a equipe confirma o pagamento.';
end;
$$;

-- arquivos novos de comprovante não podem mais ser enviados pelo portal
drop policy if exists "portal_comprovantes_upload" on storage.objects;

select fix_definer_owners();

commit;

notify pgrst, 'reload schema';
