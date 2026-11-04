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

-- ===== 081: extrato do banco no Financeiro =====
-- ---------- Tabelas ----------
create table if not exists bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete cascade,
  file_name text,
  period_start date,
  period_end date,
  total_lines int not null default 0,
  new_lines int not null default 0,
  created_by_name text,
  created_at timestamptz not null default now()
);

create table if not exists bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  import_id uuid references bank_statement_imports(id) on delete set null,
  unit_id uuid not null references units(id) on delete cascade,
  external_id text not null,            -- código do movimento no banco (FITID do OFX)
  posted_date date not null,
  amount numeric(14,2) not null check (amount <> 0),  -- positivo = entrada, negativo = saída
  description text not null default '',
  -- a_classificar | possivel_duplicado | lancado (o sistema criou o lançamento)
  -- | conciliado (ligado a um lançamento que já existia) | ignorado
  status text not null default 'a_classificar'
    check (status in ('a_classificar', 'possivel_duplicado', 'lancado', 'conciliado', 'ignorado')),
  how text,                              -- o que foi feito, em português
  auto boolean not null default false,   -- feito sozinho pelo sistema
  reservation_id uuid references reservations(id) on delete set null,
  payment_id uuid references payments(id) on delete set null,
  expense_id uuid references expenses(id) on delete set null,
  income_id uuid references other_incomes(id) on delete set null,
  receipt_id uuid references portal_receipts(id) on delete set null,
  created_record boolean not null default false,  -- desfazer apaga o lançamento criado
  expense_prev jsonb,                    -- conta a pagar antes de ser baixada (para desfazer)
  dup_payment_id uuid references payments(id) on delete set null,
  dup_expense_id uuid references expenses(id) on delete set null,
  dup_income_id uuid references other_incomes(id) on delete set null,
  dup_line_id uuid references bank_statement_lines(id) on delete set null,  -- o mesmo movimento veio em outro extrato (outro formato)
  suggestions jsonb not null default '[]'::jsonb,
  decided_by_name text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (unit_id, external_id)
);
create index if not exists idx_bank_lines_unit_date on bank_statement_lines (unit_id, posted_date desc);
create index if not exists idx_bank_lines_status on bank_statement_lines (status);

create table if not exists bank_rules (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references units(id) on delete cascade,   -- vazio = todas as unidades
  direction text not null check (direction in ('entrada', 'saida')),
  match_text text not null check (length(match_text) >= 3),
  action text not null check (action in ('despesa', 'receita', 'ignorar')),
  category text,
  supplier text,
  description text,
  created_by_name text,
  created_at timestamptz not null default now()
);

-- mesma separação por empresa das outras tabelas (migração 071)
do $$
declare t text;
begin
  foreach t in array array['bank_statement_imports', 'bank_statement_lines', 'bank_rules'] loop
    execute format('alter table %I add column if not exists company_id uuid references companies(id)', t);
    execute format('alter table %I alter column company_id set default current_company_id()', t);
    execute format('alter table %I alter column company_id set not null', t);
    execute format('create index if not exists %I on %I (company_id)', 'idx_' || t || '_company', t);
    execute format('drop trigger if exists trg_set_company_id on %I', t);
    execute format('create trigger trg_set_company_id before insert or update on %I for each row execute function set_company_id()', t);
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists company_isolation on %I', t);
    execute format($p$create policy company_isolation on %I as restrictive for all
      using (company_id = current_company_id() or (auth.uid() is null and current_user = 'app_definer'))
      with check (company_id = current_company_id() or (auth.uid() is null and current_user = 'app_definer'))$p$, t);
    execute format('drop policy if exists app_definer_all on %I', t);
    execute format('create policy app_definer_all on %I for all to app_definer using (true) with check (true)', t);
    -- só leitura pela tela; tudo o que grava passa pelas funções abaixo
    execute format('drop policy if exists read_finance on %I', t);
    execute format($p$create policy read_finance on %I for select using (has_permission(auth.uid(), 'page:financeiro'))$p$, t);
    execute format('grant all on %I to app_definer', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;

create unique index if not exists uq_bank_rules on bank_rules (company_id, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid), direction, match_text);

-- ---------- Texto ----------
-- minúsculas, sem acento, só letras e números separados por um espaço
create or replace function bank_norm(p text) returns text
language sql immutable set search_path = public as $$
  select trim(regexp_replace(
    translate(lower(coalesce(p, '')),
      'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', ' ', 'g'));
$$;

-- quem pagou / recebeu: a descrição sem as palavras do banco e sem números
create or replace function bank_counterpart(p text) returns text
language sql immutable set search_path = public as $$
  select trim(regexp_replace(regexp_replace(' ' || bank_norm(p) || ' ',
    ' (pix|recebido|recebida|enviado|enviada|transferencia|transf|ted|doc|de|da|do|para|pagamento|pagto|pgto|qr|code|qrcode|dinamico|estatico|cpf|cnpj|compra|debito|credito|cartao|boleto|conta|ltda|me|eireli|sa|s|a|transacao|via|app|ref|no|na|em|recebimento|venda|vendas|tarifa)(?= )', ' ', 'g'),
    ' [0-9 ]+', ' ', 'g'));
$$;

create or replace function bank_payment_method(p text) returns text
language sql immutable set search_path = public as $$
  select case
    when ' ' || bank_norm(p) || ' ' like '% pix %' then 'pix'
    when bank_norm(p) like '%boleto%' then 'boleto'
    else 'transferencia' end;
$$;

-- a descrição contém o texto da regra como palavras inteiras
create or replace function bank_matches(p_desc text, p_match text) returns boolean
language sql immutable set search_path = public as $$
  select ' ' || bank_norm(p_desc) || ' ' like '% ' || p_match || ' %';
$$;

-- ---------- Classificação automática de uma linha ----------
-- Interna: chamada pela importação e por "são diferentes".
create or replace function bank_classify(p_line uuid, p_skip_dup boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  ln bank_statement_lines%rowtype;
  v_amt numeric;
  v_norm text;
  v_flat text;
  v_id uuid;
  v_id2 uuid;
  v_n int;
  v_res uuid;
  v_label text;
  v_pay uuid;
  rc portal_receipts%rowtype;
  ex expenses%rowtype;
  ru bank_rules%rowtype;
  v_sug jsonb;
begin
  select * into ln from bank_statement_lines where id = p_line for update;
  if not found or ln.status not in ('a_classificar', 'possivel_duplicado') then return; end if;
  v_amt := abs(ln.amount);
  v_norm := ' ' || bank_norm(ln.description) || ' ';
  v_flat := replace(v_norm, ' ', '');

  -- 0) o mesmo movimento já veio em outro extrato (ex.: a mesma semana enviada em OFX e em planilha)
  if not p_skip_dup then
    select b.id into v_id from bank_statement_lines b
    where b.unit_id = ln.unit_id and b.id <> ln.id and b.posted_date = ln.posted_date and b.amount = ln.amount
      and b.import_id is distinct from ln.import_id and b.dup_line_id is null
      and not exists (select 1 from bank_statement_lines c where c.dup_line_id = b.id and c.id <> ln.id)
    order by b.created_at limit 1;
    if v_id is not null then
      update bank_statement_lines set status = 'possivel_duplicado', dup_line_id = v_id,
        how = 'Pode ser um movimento de outro extrato já enviado' where id = ln.id;
      return;
    end if;
  end if;

  if ln.amount > 0 then
    -- 1) possível duplicado: pagamento de festa ou receita já lançados
    if not p_skip_dup then
      select p.id into v_id from payments p join reservations r on r.id = p.reservation_id
      where r.unit_id = ln.unit_id and p.amount = v_amt and p.payment_date between ln.posted_date - 3 and ln.posted_date + 3
        and not exists (select 1 from bank_statement_lines b where b.payment_id = p.id or (b.dup_payment_id = p.id and b.id <> ln.id))
      order by abs(p.payment_date - ln.posted_date), p.created_at limit 1;
      if v_id is null then
        select o.id into v_id2 from other_incomes o
        where o.unit_id = ln.unit_id and o.amount = v_amt and o.received_date between ln.posted_date - 3 and ln.posted_date + 3
          and not exists (select 1 from bank_statement_lines b where b.income_id = o.id or (b.dup_income_id = o.id and b.id <> ln.id))
        order by abs(o.received_date - ln.posted_date) limit 1;
      end if;
      if v_id is not null or v_id2 is not null then
        update bank_statement_lines set status = 'possivel_duplicado', dup_payment_id = v_id, dup_income_id = v_id2,
          how = 'Pode ser um lançamento que já existe' where id = ln.id;
        return;
      end if;
    end if;

    -- 2) comprovante do portal esperando com o mesmo valor (um só)
    select count(*), (array_agg(rc2.id))[1] into v_n, v_id from portal_receipts rc2 join reservations r on r.id = rc2.reservation_id
    where r.unit_id = ln.unit_id and rc2.status = 'em_analise' and rc2.amount = v_amt
      and (rc2.created_at at time zone 'America/Sao_Paulo')::date between ln.posted_date - 5 and ln.posted_date + 2;
    if v_n = 1 then
      select * into rc from portal_receipts where id = v_id for update;
      insert into payments (reservation_id, amount, payment_date, payment_method, notes)
      values (rc.reservation_id, v_amt, ln.posted_date, bank_payment_method(ln.description), 'Comprovante do portal confirmado pelo extrato do banco')
      returning id into v_pay;
      update portal_receipts set status = 'lancado', payment_id = v_pay, decided_by_name = 'Extrato do banco', decided_at = now() where id = rc.id;
      update portal_events set seen_at = now(), seen_by_name = 'Extrato do banco' where ref_id = rc.id and seen_at is null;
      insert into reservation_documents (reservation_id, file_name, storage_path, bucket, receipt_id)
      values (rc.reservation_id, receipt_document_name(v_amt, ln.posted_date, rc.storage_path), rc.storage_path, 'portal-comprovantes', rc.id)
      on conflict do nothing;
      select 'Festa de ' || to_char(r.event_date, 'DD/MM') || coalesce(' · ' || nullif(trim(r.child_name), ''), '') || ' (' || c.name || ')'
        into v_label from reservations r join clients c on c.id = r.client_id where r.id = rc.reservation_id;
      update bank_statement_lines set status = 'lancado', auto = true, created_record = true, payment_id = v_pay, receipt_id = rc.id,
        reservation_id = rc.reservation_id, how = 'Comprovante do portal confirmado · ' || v_label,
        dup_payment_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;
      return;
    end if;

    -- 3) festa pelo nome do cliente ou pelo código do Pix do portal
    with cand as (
      select r.id, r.event_date, c.name as cliente, coalesce(nullif(trim(r.child_name), ''), g.child_name) as crianca,
             festa_total_due(r.id) - coalesce((select sum(amount) from payments p where p.reservation_id = r.id), 0) as saldo,
             split_part(bank_norm(c.name), ' ', 1) as n1,
             regexp_replace(bank_norm(c.name), '^.* ', '') as n2
      from reservations r join clients c on c.id = r.client_id
      left join lateral (select child_name from guest_list_pages where reservation_id = r.id limit 1) g on true
      where r.unit_id = ln.unit_id and r.status <> 'cancelada' and r.event_date >= ln.posted_date - 120
    ), ok as (
      select * from cand
      where saldo > 0.005 and v_amt <= saldo + 0.01
        and ((length(n1) >= 2 and length(n2) >= 2 and n1 <> n2 and v_norm like '% ' || n1 || ' %' and v_norm like '% ' || n2 || ' %')
          or (crianca is not null and length(bank_norm(crianca)) >= 2
              and v_flat like '%' || replace(bank_norm(crianca), ' ', '') || to_char(event_date, 'DDMM') || '%'))
    )
    select count(*), (array_agg(id))[1],
           coalesce(jsonb_agg(jsonb_build_object('reservation_id', id, 'label',
             'Festa de ' || to_char(event_date, 'DD/MM') || coalesce(' · ' || crianca, '') || ' (' || cliente || ') · falta ' || fmt_brl(saldo))
             order by event_date), '[]'::jsonb)
      into v_n, v_res, v_sug from ok;
    if v_n = 1 then
      insert into payments (reservation_id, amount, payment_date, payment_method, notes)
      values (v_res, v_amt, ln.posted_date, bank_payment_method(ln.description), 'Lançado pelo extrato do banco')
      returning id into v_pay;
      update bank_statement_lines set status = 'lancado', auto = true, created_record = true, payment_id = v_pay, reservation_id = v_res,
        how = regexp_replace(v_sug -> 0 ->> 'label', ' · falta .*$', ''), dup_payment_id = null, dup_income_id = null, dup_line_id = null, suggestions = '[]'::jsonb where id = ln.id;
      return;
    end if;
    if v_n = 0 then
      -- sem nome: sugere as festas com esse valor exato em aberto (a pessoa escolhe)
      select coalesce(jsonb_agg(jsonb_build_object('reservation_id', r.id, 'label',
               'Festa de ' || to_char(r.event_date, 'DD/MM') || coalesce(' · ' || nullif(trim(r.child_name), ''), '') || ' (' || c.name || ')' || ' · falta ' || fmt_brl(x.saldo))
               order by r.event_date), '[]'::jsonb)
        into v_sug
      from reservations r join clients c on c.id = r.client_id
      cross join lateral (select festa_total_due(r.id) - coalesce((select sum(amount) from payments p where p.reservation_id = r.id), 0) as saldo) x
      where r.unit_id = ln.unit_id and r.status <> 'cancelada' and r.event_date >= ln.posted_date - 120
        and (abs(x.saldo - v_amt) < 0.01
          or exists (select 1 from reservation_installments i where i.reservation_id = r.id and abs(i.amount - v_amt) < 0.01));
    end if;
  else
    -- 1) possível duplicado: despesa já paga
    if not p_skip_dup then
      select e.id into v_id from expenses e
      where e.unit_id = ln.unit_id and e.status = 'pago' and e.amount = v_amt
        and coalesce(e.paid_date, e.due_date) between ln.posted_date - 3 and ln.posted_date + 3
        and not exists (select 1 from bank_statement_lines b where b.expense_id = e.id or (b.dup_expense_id = e.id and b.id <> ln.id))
      order by abs(coalesce(e.paid_date, e.due_date) - ln.posted_date) limit 1;
      if v_id is not null then
        update bank_statement_lines set status = 'possivel_duplicado', dup_expense_id = v_id,
          how = 'Pode ser um lançamento que já existe' where id = ln.id;
        return;
      end if;
    end if;

    -- 2) uma só conta a pagar em aberto com esse valor
    select count(*), (array_agg(e.id))[1] into v_n, v_id from expenses e
    where e.unit_id = ln.unit_id and e.status in ('a_vencer', 'atrasado') and e.amount = v_amt
      and e.due_date between ln.posted_date - 10 and ln.posted_date + 10
      and not exists (select 1 from bank_statement_lines b where b.expense_id = e.id);
    if v_n = 1 then
      select * into ex from expenses where id = v_id for update;
      update expenses set status = 'pago', paid_date = ln.posted_date, payment_method = coalesce(payment_method, bank_payment_method(ln.description))
      where id = ex.id;
      update bank_statement_lines set status = 'conciliado', auto = true, expense_id = ex.id,
        expense_prev = jsonb_build_object('status', ex.status, 'paid_date', ex.paid_date, 'payment_method', ex.payment_method),
        how = 'Conta a pagar baixada · ' || ex.category || coalesce(' · ' || nullif(coalesce(ex.supplier, ex.description), ''), ''),
        dup_expense_id = null, dup_line_id = null where id = ln.id;
      return;
    end if;
    if v_n > 1 then
      select coalesce(jsonb_agg(jsonb_build_object('expense_id', e.id, 'label',
               e.category || coalesce(' · ' || nullif(coalesce(e.supplier, e.description), ''), '') || ' · vence ' || to_char(e.due_date, 'DD/MM'))
               order by e.due_date), '[]'::jsonb)
        into v_sug from expenses e
      where e.unit_id = ln.unit_id and e.status in ('a_vencer', 'atrasado') and e.amount = v_amt
        and e.due_date between ln.posted_date - 10 and ln.posted_date + 10
        and not exists (select 1 from bank_statement_lines b where b.expense_id = e.id);
    end if;
  end if;

  -- 4) regra aprendida (a mais específica: da unidade antes da geral, texto maior antes)
  select * into ru from bank_rules
  where direction = case when ln.amount > 0 then 'entrada' else 'saida' end
    and (unit_id is null or unit_id = ln.unit_id) and bank_matches(ln.description, match_text)
  order by (unit_id is null), length(match_text) desc limit 1;
  if found then
    if ru.action = 'ignorar' then
      update bank_statement_lines set status = 'ignorado', auto = true, how = 'Ignorado pela regra "' || ru.match_text || '"',
        dup_payment_id = null, dup_expense_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;
      return;
    elsif ru.action = 'despesa' and ln.amount < 0 then
      insert into expenses (unit_id, category, description, supplier, amount, due_date, paid_date, status, payment_method)
      values (ln.unit_id, coalesce(ru.category, 'Outros'), coalesce(nullif(ru.description, ''), left(ln.description, 200)), ru.supplier,
              v_amt, ln.posted_date, ln.posted_date, 'pago', bank_payment_method(ln.description))
      returning id into v_id;
      update bank_statement_lines set status = 'lancado', auto = true, created_record = true, expense_id = v_id,
        how = 'Despesa · ' || coalesce(ru.category, 'Outros') || coalesce(' · ' || ru.supplier, ''), dup_expense_id = null, dup_line_id = null where id = ln.id;
      return;
    elsif ru.action = 'receita' and ln.amount > 0 then
      insert into other_incomes (unit_id, kind, description, amount, received_date, payment_method)
      values (ln.unit_id, 'extrato', coalesce(nullif(ru.description, ''), left(ln.description, 200)), v_amt, ln.posted_date, bank_payment_method(ln.description))
      returning id into v_id;
      update bank_statement_lines set status = 'lancado', auto = true, created_record = true, income_id = v_id,
        how = 'Outra receita · ' || coalesce(nullif(ru.description, ''), ru.match_text), dup_payment_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;
      return;
    end if;
  end if;

  update bank_statement_lines set status = 'a_classificar', how = null, suggestions = coalesce(v_sug, '[]'::jsonb),
    dup_payment_id = null, dup_expense_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;
end;
$$;
revoke all on function bank_classify(uuid, boolean) from public, anon, authenticated;

-- ---------- Enviar o extrato ----------
-- p_lines: [{ "id": FITID, "data": "2026-11-03", "valor": -120.5, "descricao": "...", "acao": {...} }]
-- "acao" é opcional e vem da conferência, movimento por movimento:
--   ausente ou {"tipo": "auto"} → o sistema decide (como sempre)
--   {"tipo": "festa", "reservation_id"} | {"tipo": "conta", "expense_id"}
--   | {"tipo": "despesa", "category", "supplier", "description", "lembrar"}
--   | {"tipo": "receita", "description", "lembrar"} | {"tipo": "ignorar", "lembrar"}
-- "ignorar" fica guardado como ignorado: enviar o arquivo de novo não traz o movimento de volta.
create or replace function bank_import(p_unit uuid, p_file_name text, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_imp uuid;
  v_new uuid;
  v_ids uuid[] := '{}';
  x jsonb;
  v_total int := 0;
  v_res jsonb;
  v_acoes jsonb := '{}'::jsonb;
  v_a jsonb;
  ln bank_statement_lines%rowtype;
begin
  if not has_permission(auth.uid(), 'page:financeiro') then raise exception 'Sem permissão para o Financeiro.'; end if;
  if not exists (select 1 from units where id = p_unit) then raise exception 'Unidade não encontrada.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'O arquivo não tem movimentos.'; end if;
  if jsonb_array_length(p_lines) > 5000 then raise exception 'Arquivo grande demais: envie no máximo 5.000 movimentos por vez.'; end if;

  insert into bank_statement_imports (unit_id, file_name, created_by_name)
  values (p_unit, left(p_file_name, 200), current_actor_name()) returning id into v_imp;

  for x in select * from jsonb_array_elements(p_lines) loop
    v_total := v_total + 1;
    if coalesce(x->>'id', '') = '' or (x->>'valor')::numeric = 0 then continue; end if;
    insert into bank_statement_lines (import_id, unit_id, external_id, posted_date, amount, description)
    values (v_imp, p_unit, left(x->>'id', 200), (x->>'data')::date, round((x->>'valor')::numeric, 2), left(coalesce(x->>'descricao', ''), 500))
    on conflict (unit_id, external_id) do nothing
    returning id into v_new;
    if v_new is not null then
      v_ids := v_ids || v_new;
      if jsonb_typeof(x->'acao') = 'object' and coalesce(x->'acao'->>'tipo', 'auto') <> 'auto' then
        v_acoes := v_acoes || jsonb_build_object(v_new::text, x->'acao');
      end if;
      v_new := null;
    end if;
  end loop;

  -- em ordem de data, para os pagamentos caírem na ordem em que entraram
  for v_new in select id from bank_statement_lines where id = any(v_ids) order by posted_date, amount desc loop
    v_a := v_acoes -> (v_new::text);
    if v_a is null then
      perform bank_classify(v_new);
    else
      begin
        perform bank_resolve(v_new, v_a->>'tipo', v_a);
        if v_a->>'tipo' = 'ignorar' then
          update bank_statement_lines set how = 'Não lançado (escolhido na conferência)' where id = v_new;
        end if;
      exception when others then
        select * into ln from bank_statement_lines where id = v_new;
        raise exception 'Movimento de % (% · %): %', to_char(ln.posted_date, 'DD/MM/YYYY'), fmt_brl(ln.amount), left(ln.description, 60), sqlerrm;
      end;
    end if;
  end loop;

  update bank_statement_imports set total_lines = v_total, new_lines = coalesce(array_length(v_ids, 1), 0),
    period_start = (select min((e->>'data')::date) from jsonb_array_elements(p_lines) e),
    period_end = (select max((e->>'data')::date) from jsonb_array_elements(p_lines) e)
  where id = v_imp;

  select jsonb_build_object(
    'import_id', v_imp,
    'total', v_total,
    'novas', coalesce(array_length(v_ids, 1), 0),
    'lancadas', count(*) filter (where status in ('lancado', 'conciliado')),
    'duplicados', count(*) filter (where status = 'possivel_duplicado'),
    'a_classificar', count(*) filter (where status = 'a_classificar'),
    'ignoradas', count(*) filter (where status = 'ignorado'))
    into v_res from bank_statement_lines where id = any(v_ids);
  return v_res;
end;
$$;

-- ---------- O lançamento que pode ser o mesmo, em português ----------
create or replace function bank_dup_text(l bank_statement_lines) returns text
language sql stable set search_path = public as $$
  select case
    when l.dup_line_id is not null then (
      select 'Movimento “' || b.description || '” do extrato “' || coalesce(i.file_name, '—') || '” enviado em '
             || coalesce(to_char(i.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), '—')
      from bank_statement_lines b left join bank_statement_imports i on i.id = b.import_id where b.id = l.dup_line_id)
    when l.dup_payment_id is not null then (
      select 'Pagamento de ' || fmt_brl(p.amount) || ' em ' || to_char(p.payment_date, 'DD/MM/YYYY') || ' na festa de '
             || to_char(r.event_date, 'DD/MM') || coalesce(' · ' || nullif(trim(r.child_name), ''), '') || ' (' || c.name || ')'
      from payments p join reservations r on r.id = p.reservation_id join clients c on c.id = r.client_id where p.id = l.dup_payment_id)
    when l.dup_expense_id is not null then (
      select 'Despesa paga de ' || fmt_brl(e.amount) || ' em ' || to_char(coalesce(e.paid_date, e.due_date), 'DD/MM/YYYY') || ' · ' || e.category
             || coalesce(' · ' || nullif(coalesce(e.supplier, e.description), ''), '')
      from expenses e where e.id = l.dup_expense_id)
    when l.dup_income_id is not null then (
      select 'Receita de ' || fmt_brl(o.amount) || ' em ' || to_char(o.received_date, 'DD/MM/YYYY') || ' · ' || o.description
      from other_incomes o where o.id = l.dup_income_id)
  end;
$$;
revoke all on function bank_dup_text(bank_statement_lines) from public, anon, authenticated;

-- ---------- Prévia: o que aconteceria com cada movimento ----------
-- Faz o envio de verdade dentro de um "rascunho" e desfaz tudo no fim: nada
-- fica gravado. Devolve, por código do movimento, o que o sistema faria.
create or replace function bank_preview(p_unit uuid, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_out jsonb;
  v_imp uuid;
begin
  if not has_permission(auth.uid(), 'page:financeiro') then raise exception 'Sem permissão para o Financeiro.'; end if;
  begin
    v_imp := (bank_import(p_unit, '(prévia)', p_lines) ->> 'import_id')::uuid;
    select coalesce(jsonb_object_agg(x->>'id', coalesce(
             (select jsonb_build_object('status', l.status, 'how', l.how, 'dup', bank_dup_text(l), 'suggestions', l.suggestions)
              from bank_statement_lines l where l.unit_id = p_unit and l.external_id = left(x->>'id', 200) and l.import_id = v_imp),
             jsonb_build_object('status', 'ja_enviado'))), '{}'::jsonb)
      into v_out
    from jsonb_array_elements(p_lines) x
    where coalesce(x->>'id', '') <> '';
    raise exception 'prévia' using errcode = 'ZX081';
  exception when sqlstate 'ZX081' then
    null; -- desfaz tudo o que o rascunho gravou; v_out continua
  end;
  return v_out;
end;
$$;

-- ---------- Classificar à mão ----------
-- p_action: festa {reservation_id} | conta {expense_id} | despesa {category, supplier, description, lembrar}
--           | receita {description, lembrar} | ignorar {lembrar} | mesmo | diferente
create or replace function bank_resolve(p_line uuid, p_action text, p_data jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  ln bank_statement_lines%rowtype;
  v_amt numeric;
  v_id uuid;
  v_label text;
  v_cat text;
  v_match text;
  ex expenses%rowtype;
  v_pay uuid;
  v_lembrar boolean := coalesce((p_data->>'lembrar')::boolean, false);
begin
  if not has_permission(auth.uid(), 'page:financeiro') then raise exception 'Sem permissão para o Financeiro.'; end if;
  select * into ln from bank_statement_lines where id = p_line for update;
  if not found then raise exception 'Movimento não encontrado.'; end if;
  if ln.status not in ('a_classificar', 'possivel_duplicado') then raise exception 'Este movimento já foi resolvido. Desfaça antes de mudar.'; end if;
  v_amt := abs(ln.amount);

  if p_action = 'mesmo' then
    if ln.status <> 'possivel_duplicado' then raise exception 'Este movimento não está marcado como possível duplicado.'; end if;
    if ln.dup_line_id is not null then
      update bank_statement_lines set status = 'ignorado', auto = false, how = 'Repetido: já veio em outro extrato',
        decided_by_name = current_actor_name(), decided_at = now() where id = ln.id;
      return;
    end if;
    update bank_statement_lines set status = 'conciliado', auto = false, payment_id = dup_payment_id, expense_id = dup_expense_id,
      income_id = dup_income_id, created_record = false, how = 'É o mesmo lançamento que já existia',
      reservation_id = (select reservation_id from payments where id = ln.dup_payment_id),
      decided_by_name = current_actor_name(), decided_at = now() where id = ln.id;
    return;
  elsif p_action = 'diferente' then
    if ln.status <> 'possivel_duplicado' then raise exception 'Este movimento não está marcado como possível duplicado.'; end if;
    update bank_statement_lines set status = 'a_classificar', dup_payment_id = null, dup_expense_id = null, dup_income_id = null, dup_line_id = null,
      decided_by_name = current_actor_name(), decided_at = now() where id = ln.id;
    perform bank_classify(ln.id, true);
    return;
  end if;

  if p_action in ('despesa', 'receita', 'ignorar') and v_lembrar then
    v_match := bank_counterpart(ln.description);
    if length(v_match) < 3 then v_match := bank_norm(ln.description); end if;
    v_match := left(v_match, 120);
  end if;

  if p_action = 'festa' then
    if ln.amount < 0 then raise exception 'Saída não pode ser pagamento de festa.'; end if;
    v_id := (p_data->>'reservation_id')::uuid;
    if not exists (select 1 from reservations where id = v_id and unit_id = ln.unit_id) then raise exception 'Escolha uma festa desta unidade.'; end if;
    insert into payments (reservation_id, amount, payment_date, payment_method, notes)
    values (v_id, v_amt, ln.posted_date, bank_payment_method(ln.description), 'Lançado pelo extrato do banco')
    returning id into v_pay;
    select 'Festa de ' || to_char(r.event_date, 'DD/MM') || coalesce(' · ' || nullif(trim(r.child_name), ''), '') || ' (' || c.name || ')'
      into v_label from reservations r join clients c on c.id = r.client_id where r.id = v_id;
    update bank_statement_lines set status = 'lancado', auto = false, created_record = true, payment_id = v_pay, reservation_id = v_id,
      how = v_label, decided_by_name = current_actor_name(), decided_at = now(),
      dup_payment_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;

  elsif p_action = 'conta' then
    if ln.amount > 0 then raise exception 'Entrada não pode pagar conta.'; end if;
    select * into ex from expenses where id = (p_data->>'expense_id')::uuid and unit_id = ln.unit_id for update;
    if not found then raise exception 'Escolha uma conta desta unidade.'; end if;
    if ex.status not in ('a_vencer', 'atrasado') then raise exception 'Esta conta já está paga ou cancelada.'; end if;
    update expenses set status = 'pago', paid_date = ln.posted_date, payment_method = coalesce(payment_method, bank_payment_method(ln.description)) where id = ex.id;
    update bank_statement_lines set status = 'conciliado', auto = false, expense_id = ex.id,
      expense_prev = jsonb_build_object('status', ex.status, 'paid_date', ex.paid_date, 'payment_method', ex.payment_method),
      how = 'Conta a pagar baixada · ' || ex.category || coalesce(' · ' || nullif(coalesce(ex.supplier, ex.description), ''), ''),
      decided_by_name = current_actor_name(), decided_at = now(), dup_expense_id = null, dup_line_id = null where id = ln.id;

  elsif p_action = 'despesa' then
    if ln.amount > 0 then raise exception 'Entrada não pode ser despesa.'; end if;
    v_cat := nullif(trim(p_data->>'category'), '');
    if v_cat is null then raise exception 'Escolha a categoria.'; end if;
    insert into expenses (unit_id, category, description, supplier, amount, due_date, paid_date, status, payment_method)
    values (ln.unit_id, v_cat, coalesce(nullif(trim(p_data->>'description'), ''), left(ln.description, 200)), nullif(trim(p_data->>'supplier'), ''),
            v_amt, ln.posted_date, ln.posted_date, 'pago', bank_payment_method(ln.description))
    returning id into v_id;
    update bank_statement_lines set status = 'lancado', auto = false, created_record = true, expense_id = v_id,
      how = 'Despesa · ' || v_cat || coalesce(' · ' || nullif(trim(p_data->>'supplier'), ''), ''),
      decided_by_name = current_actor_name(), decided_at = now(), dup_expense_id = null, dup_line_id = null where id = ln.id;
    if v_match is not null then
      insert into bank_rules (unit_id, direction, match_text, action, category, supplier, description, created_by_name)
      values (ln.unit_id, 'saida', v_match, 'despesa', v_cat, nullif(trim(p_data->>'supplier'), ''), nullif(trim(p_data->>'description'), ''), current_actor_name())
      on conflict do nothing;
    end if;

  elsif p_action = 'receita' then
    if ln.amount < 0 then raise exception 'Saída não pode ser receita.'; end if;
    insert into other_incomes (unit_id, kind, description, amount, received_date, payment_method)
    values (ln.unit_id, 'extrato', coalesce(nullif(trim(p_data->>'description'), ''), left(ln.description, 200)), v_amt, ln.posted_date, bank_payment_method(ln.description))
    returning id into v_id;
    update bank_statement_lines set status = 'lancado', auto = false, created_record = true, income_id = v_id,
      how = 'Outra receita · ' || coalesce(nullif(trim(p_data->>'description'), ''), left(ln.description, 80)),
      decided_by_name = current_actor_name(), decided_at = now(), dup_payment_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;
    if v_match is not null then
      insert into bank_rules (unit_id, direction, match_text, action, description, created_by_name)
      values (ln.unit_id, 'entrada', v_match, 'receita', nullif(trim(p_data->>'description'), ''), current_actor_name())
      on conflict do nothing;
    end if;

  elsif p_action = 'ignorar' then
    update bank_statement_lines set status = 'ignorado', auto = false, how = 'Ignorado (não entra no financeiro)', suggestions = '[]'::jsonb,
      decided_by_name = current_actor_name(), decided_at = now(), dup_payment_id = null, dup_expense_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;
    if v_match is not null then
      insert into bank_rules (unit_id, direction, match_text, action, created_by_name)
      values (ln.unit_id, case when ln.amount > 0 then 'entrada' else 'saida' end, v_match, 'ignorar', current_actor_name())
      on conflict do nothing;
    end if;
  else
    raise exception 'Ação desconhecida.';
  end if;
end;
$$;

-- ---------- Desfazer ----------
create or replace function bank_undo(p_line uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  ln bank_statement_lines%rowtype;
begin
  if not has_permission(auth.uid(), 'page:financeiro') then raise exception 'Sem permissão para o Financeiro.'; end if;
  select * into ln from bank_statement_lines where id = p_line for update;
  if not found then raise exception 'Movimento não encontrado.'; end if;
  if ln.status not in ('lancado', 'conciliado', 'ignorado') then raise exception 'Não há nada para desfazer.'; end if;

  if ln.receipt_id is not null then
    -- comprovante volta a esperar análise
    delete from reservation_documents where receipt_id = ln.receipt_id;
    update portal_receipts set status = 'em_analise', payment_id = null, decided_by_name = null, decided_at = null where id = ln.receipt_id;
  end if;
  if ln.created_record then
    if ln.payment_id is not null then delete from payments where id = ln.payment_id; end if;
    if ln.expense_id is not null then delete from expenses where id = ln.expense_id; end if;
    if ln.income_id is not null then delete from other_incomes where id = ln.income_id; end if;
  elsif ln.expense_id is not null and ln.expense_prev is not null then
    update expenses set status = ln.expense_prev->>'status', paid_date = (ln.expense_prev->>'paid_date')::date,
      payment_method = ln.expense_prev->>'payment_method' where id = ln.expense_id;
  end if;

  update bank_statement_lines set status = 'a_classificar', auto = false, how = null, reservation_id = null, payment_id = null,
    expense_id = null, income_id = null, receipt_id = null, created_record = false, expense_prev = null,
    dup_payment_id = null, dup_expense_id = null, dup_income_id = null, dup_line_id = null,
    decided_by_name = current_actor_name(), decided_at = now()
  where id = ln.id;
end;
$$;

create or replace function bank_rule_delete(p_rule uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'page:financeiro') then raise exception 'Sem permissão para o Financeiro.'; end if;
  delete from bank_rules where id = p_rule;
end;
$$;

revoke all on function bank_import(uuid, text, jsonb) from public, anon;
revoke all on function bank_preview(uuid, jsonb) from public, anon;
revoke all on function bank_resolve(uuid, text, jsonb) from public, anon;
revoke all on function bank_undo(uuid) from public, anon;
revoke all on function bank_rule_delete(uuid) from public, anon;
grant execute on function bank_import(uuid, text, jsonb) to authenticated;
grant execute on function bank_preview(uuid, jsonb) to authenticated;
grant execute on function bank_resolve(uuid, text, jsonb) to authenticated;
grant execute on function bank_undo(uuid) to authenticated;
grant execute on function bank_rule_delete(uuid) to authenticated;
grant execute on function bank_norm(text), bank_counterpart(text), bank_payment_method(text), bank_matches(text, text) to authenticated, app_definer;
grant execute on function bank_classify(uuid, boolean) to app_definer;
grant execute on function bank_dup_text(bank_statement_lines) to app_definer;

select fix_definer_owners();


-- ===== 082: vendas no cartão no extrato =====
alter table bank_statement_lines drop constraint if exists bank_statement_lines_status_check;
alter table bank_statement_lines add constraint bank_statement_lines_status_check
  check (status in ('a_classificar', 'possivel_duplicado', 'cartao', 'lancado', 'conciliado', 'ignorado'));
-- vendas no cartão já lançadas que este depósito confere (pode ser mais de uma)
alter table bank_statement_lines add column if not exists linked_payment_ids uuid[] not null default '{}';

-- parece depósito de venda no cartão (e não Pix)
create or replace function bank_is_card(p text) returns boolean
language sql immutable set search_path = public as $$
  select ' ' || bank_norm(p) || ' ' !~ ' pix '
     and ' ' || bank_norm(p) || ' ' ~ ' (venda|vendas|cartao|credito|debito|maquininha|maquina|antecipacao|antecipado|liquidacao|recebiveis|visa|master|mastercard|elo|hipercard|amex|infinitepay|infinite|cielo|stone|getnet|pagseguro|sumup|tap) ';
$$;
grant execute on function bank_is_card(text) to authenticated, app_definer;

create or replace function bank_payment_method(p text) returns text
language sql immutable set search_path = public as $$
  select case
    when ' ' || bank_norm(p) || ' ' like '% pix %' then 'pix'
    when bank_is_card(p) and bank_norm(p) like '%debito%' then 'cartao_debito'
    when bank_is_card(p) then 'cartao_credito'
    when bank_norm(p) like '%boleto%' then 'boleto'
    else 'transferencia' end;
$$;

create or replace function bank_classify(p_line uuid, p_skip_dup boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  ln bank_statement_lines%rowtype;
  v_amt numeric;
  v_norm text;
  v_flat text;
  v_id uuid;
  v_id2 uuid;
  v_n int;
  v_res uuid;
  v_label text;
  v_pay uuid;
  rc portal_receipts%rowtype;
  ex expenses%rowtype;
  ru bank_rules%rowtype;
  v_sug jsonb;
begin
  select * into ln from bank_statement_lines where id = p_line for update;
  if not found or ln.status not in ('a_classificar', 'possivel_duplicado', 'cartao') then return; end if;
  v_amt := abs(ln.amount);
  v_norm := ' ' || bank_norm(ln.description) || ' ';
  v_flat := replace(v_norm, ' ', '');

  -- 0) o mesmo movimento já veio em outro extrato (ex.: a mesma semana enviada em OFX e em planilha)
  if not p_skip_dup then
    select b.id into v_id from bank_statement_lines b
    where b.unit_id = ln.unit_id and b.id <> ln.id and b.posted_date = ln.posted_date and b.amount = ln.amount
      and b.import_id is distinct from ln.import_id and b.dup_line_id is null
      and not exists (select 1 from bank_statement_lines c where c.dup_line_id = b.id and c.id <> ln.id)
    order by b.created_at limit 1;
    if v_id is not null then
      update bank_statement_lines set status = 'possivel_duplicado', dup_line_id = v_id,
        how = 'Pode ser um movimento de outro extrato já enviado' where id = ln.id;
      return;
    end if;
  end if;

  -- 0b) entrada que parece venda no cartão: pode ser de festa e já ter sido lançada
  -- (a maquininha deposita sem a taxa, às vezes parcelado). Nunca lança sozinho:
  -- mostra as vendas no cartão das festas que podem ser este depósito.
  if ln.amount > 0 and bank_is_card(ln.description) then
    select coalesce(jsonb_agg(c.obj order by c.bate desc, c.ligados, c.payment_date desc), '[]'::jsonb) into v_sug
    from (
      select jsonb_build_object('payment_id', p.id, 'reservation_id', r.id, 'bate', x.k is not null,
               'label', 'Festa de ' || to_char(r.event_date, 'DD/MM') || coalesce(' · ' || nullif(trim(r.child_name), ''), '') || ' (' || cl.name || ') · '
                 || case p.payment_method when 'cartao_debito' then 'débito' else 'crédito' end || ' de ' || fmt_brl(p.amount) || ' em ' || to_char(p.payment_date, 'DD/MM')
                 || ' · cai na conta ≈ ' || fmt_brl(round(p.amount * (1 - coalesce(f.fee_percent, 0) / 100), 2))
                 || case when x.k > 1 then ' (parcela de ' || x.k || 'x ≈ ' || fmt_brl(round(p.amount * (1 - coalesce(f.fee_percent, 0) / 100) / x.k, 2)) || ')' else '' end
                 || case when n.ligados > 0 then ' · já conferida em ' || n.ligados || ' depósito(s)' else '' end) as obj,
             x.k is not null as bate, n.ligados, p.payment_date
      from payments p join reservations r on r.id = p.reservation_id join clients cl on cl.id = r.client_id
      left join payment_method_fees f on f.payment_method = p.payment_method
      cross join lateral (select count(*) as ligados from bank_statement_lines b
                          where b.id <> ln.id and (b.payment_id = p.id or p.id = any(b.linked_payment_ids))) n
      left join lateral (select k from generate_series(1, 12) k
                         where abs(p.amount * (1 - coalesce(f.fee_percent, 0) / 100) / k - v_amt) <= greatest(1, v_amt * 0.02)
                            or (k = 1 and abs(p.amount - v_amt) < 0.01)
                         order by k limit 1) x on true
      where r.unit_id = ln.unit_id and p.payment_method in ('cartao_credito', 'cartao_debito')
        and p.payment_date between ln.posted_date - 400 and ln.posted_date
        and (x.k is not null or p.payment_date >= ln.posted_date - 45)
      order by (x.k is not null) desc, n.ligados, p.payment_date desc
      limit 15
    ) c;
    update bank_statement_lines set status = 'cartao', suggestions = v_sug,
      how = 'Parece venda no cartão: pode ser de festa e já ter sido lançada',
      dup_payment_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;
    return;
  end if;

  if ln.amount > 0 then
    -- 1) possível duplicado: pagamento de festa ou receita já lançados
    if not p_skip_dup then
      select p.id into v_id from payments p join reservations r on r.id = p.reservation_id
      where r.unit_id = ln.unit_id and p.amount = v_amt and p.payment_date between ln.posted_date - 3 and ln.posted_date + 3
        and not exists (select 1 from bank_statement_lines b where b.payment_id = p.id or p.id = any(b.linked_payment_ids) or (b.dup_payment_id = p.id and b.id <> ln.id))
      order by abs(p.payment_date - ln.posted_date), p.created_at limit 1;
      if v_id is null then
        select o.id into v_id2 from other_incomes o
        where o.unit_id = ln.unit_id and o.amount = v_amt and o.received_date between ln.posted_date - 3 and ln.posted_date + 3
          and not exists (select 1 from bank_statement_lines b where b.income_id = o.id or (b.dup_income_id = o.id and b.id <> ln.id))
        order by abs(o.received_date - ln.posted_date) limit 1;
      end if;
      if v_id is not null or v_id2 is not null then
        update bank_statement_lines set status = 'possivel_duplicado', dup_payment_id = v_id, dup_income_id = v_id2,
          how = 'Pode ser um lançamento que já existe' where id = ln.id;
        return;
      end if;
    end if;

    -- 2) comprovante do portal esperando com o mesmo valor (um só)
    select count(*), (array_agg(rc2.id))[1] into v_n, v_id from portal_receipts rc2 join reservations r on r.id = rc2.reservation_id
    where r.unit_id = ln.unit_id and rc2.status = 'em_analise' and rc2.amount = v_amt
      and (rc2.created_at at time zone 'America/Sao_Paulo')::date between ln.posted_date - 5 and ln.posted_date + 2;
    if v_n = 1 then
      select * into rc from portal_receipts where id = v_id for update;
      insert into payments (reservation_id, amount, payment_date, payment_method, notes)
      values (rc.reservation_id, v_amt, ln.posted_date, bank_payment_method(ln.description), 'Comprovante do portal confirmado pelo extrato do banco')
      returning id into v_pay;
      update portal_receipts set status = 'lancado', payment_id = v_pay, decided_by_name = 'Extrato do banco', decided_at = now() where id = rc.id;
      update portal_events set seen_at = now(), seen_by_name = 'Extrato do banco' where ref_id = rc.id and seen_at is null;
      insert into reservation_documents (reservation_id, file_name, storage_path, bucket, receipt_id)
      values (rc.reservation_id, receipt_document_name(v_amt, ln.posted_date, rc.storage_path), rc.storage_path, 'portal-comprovantes', rc.id)
      on conflict do nothing;
      select 'Festa de ' || to_char(r.event_date, 'DD/MM') || coalesce(' · ' || nullif(trim(r.child_name), ''), '') || ' (' || c.name || ')'
        into v_label from reservations r join clients c on c.id = r.client_id where r.id = rc.reservation_id;
      update bank_statement_lines set status = 'lancado', auto = true, created_record = true, payment_id = v_pay, receipt_id = rc.id,
        reservation_id = rc.reservation_id, how = 'Comprovante do portal confirmado · ' || v_label,
        dup_payment_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;
      return;
    end if;

    -- 3) festa pelo nome do cliente ou pelo código do Pix do portal
    with cand as (
      select r.id, r.event_date, c.name as cliente, coalesce(nullif(trim(r.child_name), ''), g.child_name) as crianca,
             festa_total_due(r.id) - coalesce((select sum(amount) from payments p where p.reservation_id = r.id), 0) as saldo,
             split_part(bank_norm(c.name), ' ', 1) as n1,
             regexp_replace(bank_norm(c.name), '^.* ', '') as n2
      from reservations r join clients c on c.id = r.client_id
      left join lateral (select child_name from guest_list_pages where reservation_id = r.id limit 1) g on true
      where r.unit_id = ln.unit_id and r.status <> 'cancelada' and r.event_date >= ln.posted_date - 120
    ), ok as (
      select * from cand
      where saldo > 0.005 and v_amt <= saldo + 0.01
        and ((length(n1) >= 2 and length(n2) >= 2 and n1 <> n2 and v_norm like '% ' || n1 || ' %' and v_norm like '% ' || n2 || ' %')
          or (crianca is not null and length(bank_norm(crianca)) >= 2
              and v_flat like '%' || replace(bank_norm(crianca), ' ', '') || to_char(event_date, 'DDMM') || '%'))
    )
    select count(*), (array_agg(id))[1],
           coalesce(jsonb_agg(jsonb_build_object('reservation_id', id, 'label',
             'Festa de ' || to_char(event_date, 'DD/MM') || coalesce(' · ' || crianca, '') || ' (' || cliente || ') · falta ' || fmt_brl(saldo))
             order by event_date), '[]'::jsonb)
      into v_n, v_res, v_sug from ok;
    if v_n = 1 then
      insert into payments (reservation_id, amount, payment_date, payment_method, notes)
      values (v_res, v_amt, ln.posted_date, bank_payment_method(ln.description), 'Lançado pelo extrato do banco')
      returning id into v_pay;
      update bank_statement_lines set status = 'lancado', auto = true, created_record = true, payment_id = v_pay, reservation_id = v_res,
        how = regexp_replace(v_sug -> 0 ->> 'label', ' · falta .*$', ''), dup_payment_id = null, dup_income_id = null, dup_line_id = null, suggestions = '[]'::jsonb where id = ln.id;
      return;
    end if;
    if v_n = 0 then
      -- sem nome: sugere as festas com esse valor exato em aberto (a pessoa escolhe)
      select coalesce(jsonb_agg(jsonb_build_object('reservation_id', r.id, 'label',
               'Festa de ' || to_char(r.event_date, 'DD/MM') || coalesce(' · ' || nullif(trim(r.child_name), ''), '') || ' (' || c.name || ')' || ' · falta ' || fmt_brl(x.saldo))
               order by r.event_date), '[]'::jsonb)
        into v_sug
      from reservations r join clients c on c.id = r.client_id
      cross join lateral (select festa_total_due(r.id) - coalesce((select sum(amount) from payments p where p.reservation_id = r.id), 0) as saldo) x
      where r.unit_id = ln.unit_id and r.status <> 'cancelada' and r.event_date >= ln.posted_date - 120
        and (abs(x.saldo - v_amt) < 0.01
          or exists (select 1 from reservation_installments i where i.reservation_id = r.id and abs(i.amount - v_amt) < 0.01));
    end if;
  else
    -- 1) possível duplicado: despesa já paga
    if not p_skip_dup then
      select e.id into v_id from expenses e
      where e.unit_id = ln.unit_id and e.status = 'pago' and e.amount = v_amt
        and coalesce(e.paid_date, e.due_date) between ln.posted_date - 3 and ln.posted_date + 3
        and not exists (select 1 from bank_statement_lines b where b.expense_id = e.id or (b.dup_expense_id = e.id and b.id <> ln.id))
      order by abs(coalesce(e.paid_date, e.due_date) - ln.posted_date) limit 1;
      if v_id is not null then
        update bank_statement_lines set status = 'possivel_duplicado', dup_expense_id = v_id,
          how = 'Pode ser um lançamento que já existe' where id = ln.id;
        return;
      end if;
    end if;

    -- 2) uma só conta a pagar em aberto com esse valor
    select count(*), (array_agg(e.id))[1] into v_n, v_id from expenses e
    where e.unit_id = ln.unit_id and e.status in ('a_vencer', 'atrasado') and e.amount = v_amt
      and e.due_date between ln.posted_date - 10 and ln.posted_date + 10
      and not exists (select 1 from bank_statement_lines b where b.expense_id = e.id);
    if v_n = 1 then
      select * into ex from expenses where id = v_id for update;
      update expenses set status = 'pago', paid_date = ln.posted_date, payment_method = coalesce(payment_method, bank_payment_method(ln.description))
      where id = ex.id;
      update bank_statement_lines set status = 'conciliado', auto = true, expense_id = ex.id,
        expense_prev = jsonb_build_object('status', ex.status, 'paid_date', ex.paid_date, 'payment_method', ex.payment_method),
        how = 'Conta a pagar baixada · ' || ex.category || coalesce(' · ' || nullif(coalesce(ex.supplier, ex.description), ''), ''),
        dup_expense_id = null, dup_line_id = null where id = ln.id;
      return;
    end if;
    if v_n > 1 then
      select coalesce(jsonb_agg(jsonb_build_object('expense_id', e.id, 'label',
               e.category || coalesce(' · ' || nullif(coalesce(e.supplier, e.description), ''), '') || ' · vence ' || to_char(e.due_date, 'DD/MM'))
               order by e.due_date), '[]'::jsonb)
        into v_sug from expenses e
      where e.unit_id = ln.unit_id and e.status in ('a_vencer', 'atrasado') and e.amount = v_amt
        and e.due_date between ln.posted_date - 10 and ln.posted_date + 10
        and not exists (select 1 from bank_statement_lines b where b.expense_id = e.id);
    end if;
  end if;

  -- 4) regra aprendida (a mais específica: da unidade antes da geral, texto maior antes)
  select * into ru from bank_rules
  where direction = case when ln.amount > 0 then 'entrada' else 'saida' end
    and (unit_id is null or unit_id = ln.unit_id) and bank_matches(ln.description, match_text)
  order by (unit_id is null), length(match_text) desc limit 1;
  if found then
    if ru.action = 'ignorar' then
      update bank_statement_lines set status = 'ignorado', auto = true, how = 'Ignorado pela regra "' || ru.match_text || '"',
        dup_payment_id = null, dup_expense_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;
      return;
    elsif ru.action = 'despesa' and ln.amount < 0 then
      insert into expenses (unit_id, category, description, supplier, amount, due_date, paid_date, status, payment_method)
      values (ln.unit_id, coalesce(ru.category, 'Outros'), coalesce(nullif(ru.description, ''), left(ln.description, 200)), ru.supplier,
              v_amt, ln.posted_date, ln.posted_date, 'pago', bank_payment_method(ln.description))
      returning id into v_id;
      update bank_statement_lines set status = 'lancado', auto = true, created_record = true, expense_id = v_id,
        how = 'Despesa · ' || coalesce(ru.category, 'Outros') || coalesce(' · ' || ru.supplier, ''), dup_expense_id = null, dup_line_id = null where id = ln.id;
      return;
    elsif ru.action = 'receita' and ln.amount > 0 then
      insert into other_incomes (unit_id, kind, description, amount, received_date, payment_method)
      values (ln.unit_id, 'extrato', coalesce(nullif(ru.description, ''), left(ln.description, 200)), v_amt, ln.posted_date, bank_payment_method(ln.description))
      returning id into v_id;
      update bank_statement_lines set status = 'lancado', auto = true, created_record = true, income_id = v_id,
        how = 'Outra receita · ' || coalesce(nullif(ru.description, ''), ru.match_text), dup_payment_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;
      return;
    end if;
  end if;

  update bank_statement_lines set status = 'a_classificar', how = null, suggestions = coalesce(v_sug, '[]'::jsonb),
    dup_payment_id = null, dup_expense_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;
end;
$$;

create or replace function bank_import(p_unit uuid, p_file_name text, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_imp uuid;
  v_new uuid;
  v_ids uuid[] := '{}';
  x jsonb;
  v_total int := 0;
  v_res jsonb;
  v_acoes jsonb := '{}'::jsonb;
  v_a jsonb;
  ln bank_statement_lines%rowtype;
begin
  if not has_permission(auth.uid(), 'page:financeiro') then raise exception 'Sem permissão para o Financeiro.'; end if;
  if not exists (select 1 from units where id = p_unit) then raise exception 'Unidade não encontrada.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'O arquivo não tem movimentos.'; end if;
  if jsonb_array_length(p_lines) > 5000 then raise exception 'Arquivo grande demais: envie no máximo 5.000 movimentos por vez.'; end if;

  insert into bank_statement_imports (unit_id, file_name, created_by_name)
  values (p_unit, left(p_file_name, 200), current_actor_name()) returning id into v_imp;

  for x in select * from jsonb_array_elements(p_lines) loop
    v_total := v_total + 1;
    if coalesce(x->>'id', '') = '' or (x->>'valor')::numeric = 0 then continue; end if;
    insert into bank_statement_lines (import_id, unit_id, external_id, posted_date, amount, description)
    values (v_imp, p_unit, left(x->>'id', 200), (x->>'data')::date, round((x->>'valor')::numeric, 2), left(coalesce(x->>'descricao', ''), 500))
    on conflict (unit_id, external_id) do nothing
    returning id into v_new;
    if v_new is not null then
      v_ids := v_ids || v_new;
      if jsonb_typeof(x->'acao') = 'object' and coalesce(x->'acao'->>'tipo', 'auto') <> 'auto' then
        v_acoes := v_acoes || jsonb_build_object(v_new::text, x->'acao');
      end if;
      v_new := null;
    end if;
  end loop;

  -- em ordem de data, para os pagamentos caírem na ordem em que entraram
  for v_new in select id from bank_statement_lines where id = any(v_ids) order by posted_date, amount desc loop
    v_a := v_acoes -> (v_new::text);
    if v_a is null then
      perform bank_classify(v_new);
    else
      begin
        perform bank_resolve(v_new, v_a->>'tipo', v_a);
        if v_a->>'tipo' = 'ignorar' then
          update bank_statement_lines set how = 'Não lançado (escolhido na conferência)' where id = v_new;
        end if;
      exception when others then
        select * into ln from bank_statement_lines where id = v_new;
        raise exception 'Movimento de % (% · %): %', to_char(ln.posted_date, 'DD/MM/YYYY'), fmt_brl(ln.amount), left(ln.description, 60), sqlerrm;
      end;
    end if;
  end loop;

  update bank_statement_imports set total_lines = v_total, new_lines = coalesce(array_length(v_ids, 1), 0),
    period_start = (select min((e->>'data')::date) from jsonb_array_elements(p_lines) e),
    period_end = (select max((e->>'data')::date) from jsonb_array_elements(p_lines) e)
  where id = v_imp;

  select jsonb_build_object(
    'import_id', v_imp,
    'total', v_total,
    'novas', coalesce(array_length(v_ids, 1), 0),
    'lancadas', count(*) filter (where status in ('lancado', 'conciliado')),
    'duplicados', count(*) filter (where status = 'possivel_duplicado'),
    'cartao', count(*) filter (where status = 'cartao'),
    'a_classificar', count(*) filter (where status = 'a_classificar'),
    'ignoradas', count(*) filter (where status = 'ignorado'))
    into v_res from bank_statement_lines where id = any(v_ids);
  return v_res;
end;
$$;

create or replace function bank_resolve(p_line uuid, p_action text, p_data jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  ln bank_statement_lines%rowtype;
  v_amt numeric;
  v_id uuid;
  v_label text;
  v_cat text;
  v_match text;
  ex expenses%rowtype;
  v_pay uuid;
  v_lembrar boolean := coalesce((p_data->>'lembrar')::boolean, false);
  v_ids uuid[];
  v_valor numeric;
begin
  if not has_permission(auth.uid(), 'page:financeiro') then raise exception 'Sem permissão para o Financeiro.'; end if;
  select * into ln from bank_statement_lines where id = p_line for update;
  if not found then raise exception 'Movimento não encontrado.'; end if;
  if ln.status not in ('a_classificar', 'possivel_duplicado', 'cartao') then raise exception 'Este movimento já foi resolvido. Desfaça antes de mudar.'; end if;
  v_amt := abs(ln.amount);

  if p_action = 'cartao_lancado' then
    -- o depósito é de venda(s) no cartão que já estão lançadas nas festas: só confere
    if ln.amount < 0 then raise exception 'Saída não pode ser venda no cartão.'; end if;
    select coalesce(array_agg(value::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(p_data->'payment_ids', '[]'::jsonb));
    if exists (select 1 from unnest(v_ids) i where not exists (
      select 1 from payments p join reservations r on r.id = p.reservation_id where p.id = i and r.unit_id = ln.unit_id)) then
      raise exception 'Escolha vendas desta unidade.';
    end if;
    select 'Festa de ' || to_char(r.event_date, 'DD/MM') || coalesce(' · ' || nullif(trim(r.child_name), ''), '') || ' (' || c.name || ')'
      into v_label from payments p join reservations r on r.id = p.reservation_id join clients c on c.id = r.client_id where p.id = v_ids[1];
    update bank_statement_lines set status = 'conciliado', auto = false, created_record = false,
      payment_id = v_ids[1], linked_payment_ids = v_ids,
      reservation_id = (select reservation_id from payments where id = v_ids[1]),
      how = case cardinality(v_ids) when 0 then 'Venda no cartão já lançada nas festas'
                 when 1 then 'Venda no cartão já lançada · ' || v_label
                 else cardinality(v_ids) || ' vendas no cartão já lançadas' end,
      decided_by_name = current_actor_name(), decided_at = now() where id = ln.id;
    return;
  elsif p_action = 'mesmo' then
    if ln.status <> 'possivel_duplicado' then raise exception 'Este movimento não está marcado como possível duplicado.'; end if;
    if ln.dup_line_id is not null then
      update bank_statement_lines set status = 'ignorado', auto = false, how = 'Repetido: já veio em outro extrato',
        decided_by_name = current_actor_name(), decided_at = now() where id = ln.id;
      return;
    end if;
    update bank_statement_lines set status = 'conciliado', auto = false, payment_id = dup_payment_id, expense_id = dup_expense_id,
      income_id = dup_income_id, created_record = false, how = 'É o mesmo lançamento que já existia',
      reservation_id = (select reservation_id from payments where id = ln.dup_payment_id),
      decided_by_name = current_actor_name(), decided_at = now() where id = ln.id;
    return;
  elsif p_action = 'diferente' then
    if ln.status <> 'possivel_duplicado' then raise exception 'Este movimento não está marcado como possível duplicado.'; end if;
    update bank_statement_lines set status = 'a_classificar', dup_payment_id = null, dup_expense_id = null, dup_income_id = null, dup_line_id = null,
      decided_by_name = current_actor_name(), decided_at = now() where id = ln.id;
    perform bank_classify(ln.id, true);
    return;
  end if;

  if p_action in ('despesa', 'receita', 'ignorar') and v_lembrar then
    v_match := bank_counterpart(ln.description);
    if length(v_match) < 3 then v_match := bank_norm(ln.description); end if;
    v_match := left(v_match, 120);
  end if;

  if p_action = 'festa' then
    if ln.amount < 0 then raise exception 'Saída não pode ser pagamento de festa.'; end if;
    v_id := (p_data->>'reservation_id')::uuid;
    if not exists (select 1 from reservations where id = v_id and unit_id = ln.unit_id) then raise exception 'Escolha uma festa desta unidade.'; end if;
    -- venda no cartão: a pessoa pode informar o valor da venda (o depósito vem sem a taxa)
    v_valor := coalesce(nullif(p_data->>'valor', '')::numeric, v_amt);
    if v_valor <= 0 then raise exception 'Informe o valor.'; end if;
    insert into payments (reservation_id, amount, payment_date, payment_method, notes)
    values (v_id, round(v_valor, 2), ln.posted_date, bank_payment_method(ln.description),
            case when round(v_valor, 2) <> v_amt then 'Lançado pelo extrato do banco (caiu na conta ' || fmt_brl(v_amt) || ')' else 'Lançado pelo extrato do banco' end)
    returning id into v_pay;
    select 'Festa de ' || to_char(r.event_date, 'DD/MM') || coalesce(' · ' || nullif(trim(r.child_name), ''), '') || ' (' || c.name || ')'
      into v_label from reservations r join clients c on c.id = r.client_id where r.id = v_id;
    update bank_statement_lines set status = 'lancado', auto = false, created_record = true, payment_id = v_pay, reservation_id = v_id,
      how = v_label, decided_by_name = current_actor_name(), decided_at = now(),
      dup_payment_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;

  elsif p_action = 'conta' then
    if ln.amount > 0 then raise exception 'Entrada não pode pagar conta.'; end if;
    select * into ex from expenses where id = (p_data->>'expense_id')::uuid and unit_id = ln.unit_id for update;
    if not found then raise exception 'Escolha uma conta desta unidade.'; end if;
    if ex.status not in ('a_vencer', 'atrasado') then raise exception 'Esta conta já está paga ou cancelada.'; end if;
    update expenses set status = 'pago', paid_date = ln.posted_date, payment_method = coalesce(payment_method, bank_payment_method(ln.description)) where id = ex.id;
    update bank_statement_lines set status = 'conciliado', auto = false, expense_id = ex.id,
      expense_prev = jsonb_build_object('status', ex.status, 'paid_date', ex.paid_date, 'payment_method', ex.payment_method),
      how = 'Conta a pagar baixada · ' || ex.category || coalesce(' · ' || nullif(coalesce(ex.supplier, ex.description), ''), ''),
      decided_by_name = current_actor_name(), decided_at = now(), dup_expense_id = null, dup_line_id = null where id = ln.id;

  elsif p_action = 'despesa' then
    if ln.amount > 0 then raise exception 'Entrada não pode ser despesa.'; end if;
    v_cat := nullif(trim(p_data->>'category'), '');
    if v_cat is null then raise exception 'Escolha a categoria.'; end if;
    insert into expenses (unit_id, category, description, supplier, amount, due_date, paid_date, status, payment_method)
    values (ln.unit_id, v_cat, coalesce(nullif(trim(p_data->>'description'), ''), left(ln.description, 200)), nullif(trim(p_data->>'supplier'), ''),
            v_amt, ln.posted_date, ln.posted_date, 'pago', bank_payment_method(ln.description))
    returning id into v_id;
    update bank_statement_lines set status = 'lancado', auto = false, created_record = true, expense_id = v_id,
      how = 'Despesa · ' || v_cat || coalesce(' · ' || nullif(trim(p_data->>'supplier'), ''), ''),
      decided_by_name = current_actor_name(), decided_at = now(), dup_expense_id = null, dup_line_id = null where id = ln.id;
    if v_match is not null then
      insert into bank_rules (unit_id, direction, match_text, action, category, supplier, description, created_by_name)
      values (ln.unit_id, 'saida', v_match, 'despesa', v_cat, nullif(trim(p_data->>'supplier'), ''), nullif(trim(p_data->>'description'), ''), current_actor_name())
      on conflict do nothing;
    end if;

  elsif p_action = 'receita' then
    if ln.amount < 0 then raise exception 'Saída não pode ser receita.'; end if;
    insert into other_incomes (unit_id, kind, description, amount, received_date, payment_method)
    values (ln.unit_id, 'extrato', coalesce(nullif(trim(p_data->>'description'), ''), left(ln.description, 200)), v_amt, ln.posted_date, bank_payment_method(ln.description))
    returning id into v_id;
    update bank_statement_lines set status = 'lancado', auto = false, created_record = true, income_id = v_id,
      how = 'Outra receita · ' || coalesce(nullif(trim(p_data->>'description'), ''), left(ln.description, 80)),
      decided_by_name = current_actor_name(), decided_at = now(), dup_payment_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;
    if v_match is not null then
      insert into bank_rules (unit_id, direction, match_text, action, description, created_by_name)
      values (ln.unit_id, 'entrada', v_match, 'receita', nullif(trim(p_data->>'description'), ''), current_actor_name())
      on conflict do nothing;
    end if;

  elsif p_action = 'ignorar' then
    update bank_statement_lines set status = 'ignorado', auto = false, how = 'Ignorado (não entra no financeiro)', suggestions = '[]'::jsonb,
      decided_by_name = current_actor_name(), decided_at = now(), dup_payment_id = null, dup_expense_id = null, dup_income_id = null, dup_line_id = null where id = ln.id;
    if v_match is not null then
      insert into bank_rules (unit_id, direction, match_text, action, created_by_name)
      values (ln.unit_id, case when ln.amount > 0 then 'entrada' else 'saida' end, v_match, 'ignorar', current_actor_name())
      on conflict do nothing;
    end if;
  else
    raise exception 'Ação desconhecida.';
  end if;
end;
$$;

create or replace function bank_undo(p_line uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  ln bank_statement_lines%rowtype;
begin
  if not has_permission(auth.uid(), 'page:financeiro') then raise exception 'Sem permissão para o Financeiro.'; end if;
  select * into ln from bank_statement_lines where id = p_line for update;
  if not found then raise exception 'Movimento não encontrado.'; end if;
  if ln.status not in ('lancado', 'conciliado', 'ignorado') then raise exception 'Não há nada para desfazer.'; end if;

  if ln.receipt_id is not null then
    -- comprovante volta a esperar análise
    delete from reservation_documents where receipt_id = ln.receipt_id;
    update portal_receipts set status = 'em_analise', payment_id = null, decided_by_name = null, decided_at = null where id = ln.receipt_id;
  end if;
  if ln.created_record then
    if ln.payment_id is not null then delete from payments where id = ln.payment_id; end if;
    if ln.expense_id is not null then delete from expenses where id = ln.expense_id; end if;
    if ln.income_id is not null then delete from other_incomes where id = ln.income_id; end if;
  elsif ln.expense_id is not null and ln.expense_prev is not null then
    update expenses set status = ln.expense_prev->>'status', paid_date = (ln.expense_prev->>'paid_date')::date,
      payment_method = ln.expense_prev->>'payment_method' where id = ln.expense_id;
  end if;

  update bank_statement_lines set status = 'a_classificar', auto = false, how = null, reservation_id = null, payment_id = null,
    expense_id = null, income_id = null, receipt_id = null, created_record = false, expense_prev = null, linked_payment_ids = '{}',
    dup_payment_id = null, dup_expense_id = null, dup_income_id = null, dup_line_id = null,
    decided_by_name = current_actor_name(), decided_at = now()
  where id = ln.id;
  if ln.amount > 0 and bank_is_card(ln.description) then perform bank_classify(ln.id, true); end if;
end;
$$;

select fix_definer_owners();

commit;

notify pgrst, 'reload schema';
