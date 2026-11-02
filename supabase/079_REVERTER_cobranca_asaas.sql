-- =========================================================
-- REVERTER a migração 079 (cobrança pelo Asaas) — só use se for para desfazer.
-- Desliga o bloqueio automático (todas as empresas desbloqueadas) e esquece
-- a ligação com o Asaas. As assinaturas continuam existindo no Asaas: cancele
-- lá se não for mais usar. Pagamentos registrados continuam.
-- =========================================================
begin;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'festou-bloqueio-mensalidade';
exception when others then null;
end $$;

create or replace function is_active_user(check_id uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select is_platform_admin(check_id) or coalesce((
    select up.active and coalesce(c.active, true)
    from user_profiles up left join companies c on c.id = up.company_id
    where up.id = check_id
  ), false);
$$;

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
  return v_comp;
end;
$$;

create or replace function platform_billing_undo(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  delete from platform_billing_payments where id = p_id;
end;
$$;

drop function if exists platform_billing_list();
create or replace function platform_billing_list()
returns table (company_id uuid, cadastrada boolean, plano text, mensalidade numeric, dia_vencimento int, inicio date,
               implantacao numeric, unidade_adicional numeric, unidades_incluidas int, usuarios_incluidos int, observacao text,
               proximo_vencimento date, meses_em_aberto int, valor_em_aberto numeric, dias_atraso int, situacao text, ultimo_pagamento date)
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
         (select max(p.pago_em) from platform_billing_payments p where p.company_id = c.id)
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

drop function if exists platform_company_billing_status();
drop function if exists platform_billing_set_tolerance(uuid, int);
drop function if exists platform_asaas_event(jsonb);
drop function if exists platform_asaas_dados(uuid);
drop function if exists platform_asaas_link(uuid, text, text, text, date);
drop function if exists platform_apply_billing_blocks();
drop table if exists platform_asaas_events;

alter table companies drop column if exists billing_blocked;
alter table platform_billing_payments drop column if exists asaas_payment_id;
alter table platform_billing
  drop column if exists tolerancia_dias,
  drop column if exists asaas_customer_id,
  drop column if exists asaas_subscription_id,
  drop column if exists link_pagamento,
  drop column if exists link_vencimento;

select fix_definer_owners();

commit;

notify pgrst, 'reload schema';
