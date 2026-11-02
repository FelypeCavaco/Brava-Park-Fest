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
-- LIMPEZA: nenhum dado da Brava (nem de ninguém) fica no banco novo.
-- =========================================================
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('truncate table %I cascade', t);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
