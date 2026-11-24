-- =========================================================
-- 109 — Recreação, etapa 5d: financeiro básico (casas só de recreação)
-- =========================================================
-- Uma função que resume o mês para quem não tem a gestão de festas:
-- o que entrou (por origem e forma de pagamento), o que saiu (por categoria),
-- o resultado, as contas a pagar e o que ainda está no caixa aberto.
-- Só lê dados; não grava nada. Usa a permissão da tela de Financeiro.
-- Desfazer: 109_REVERTER_recreacao_financeiro_basico.sql
-- =========================================================

begin;

create or replace function rec_financeiro(p_mes date, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_emp uuid := current_company_id(); v_ini date := date_trunc('month', coalesce(p_mes, today_brazil()))::date; v_fim date;
  v_ant date; r jsonb;
begin
  if not (has_permission(auth.uid(), 'page:financeiro') or is_platform_admin(auth.uid())) then raise exception 'Sem permissão para ver o financeiro.'; end if;
  if p_unit is not null and not exists (select 1 from units where id = p_unit and company_id = v_emp) then raise exception 'Unidade não encontrada.'; end if;
  v_fim := (v_ini + interval '1 month')::date;
  v_ant := (v_ini - interval '1 month')::date;

  select jsonb_build_object(
    'mes', v_ini,
    'entradas', jsonb_build_object(
      'total', coalesce((select sum(o.amount) from other_incomes o join units u on u.id = o.unit_id
                          where u.company_id = v_emp and o.received_date >= v_ini and o.received_date < v_fim and (p_unit is null or o.unit_id = p_unit)), 0),
      'anterior', coalesce((select sum(o.amount) from other_incomes o join units u on u.id = o.unit_id
                          where u.company_id = v_emp and o.received_date >= v_ant and o.received_date < v_ini and (p_unit is null or o.unit_id = p_unit)), 0),
      'por_origem', (select coalesce(jsonb_agg(jsonb_build_object('origem', origem, 'valor', valor) order by valor desc), '[]') from (
          select case o.kind when 'recreacao' then 'Recreação' when 'manual' then coalesce(nullif(o.category, ''), 'Lançada à mão') when 'bar' then 'Vendas no bar' else 'Outras' end origem, sum(o.amount) valor
            from other_incomes o join units u on u.id = o.unit_id
           where u.company_id = v_emp and o.received_date >= v_ini and o.received_date < v_fim and (p_unit is null or o.unit_id = p_unit) group by 1) x),
      'por_forma', (select coalesce(jsonb_agg(jsonb_build_object('forma', forma, 'valor', valor) order by valor desc), '[]') from (
          select coalesce(o.payment_method, 'outra') forma, sum(o.amount) valor
            from other_incomes o join units u on u.id = o.unit_id
           where u.company_id = v_emp and o.received_date >= v_ini and o.received_date < v_fim and (p_unit is null or o.unit_id = p_unit) group by 1) x)),
    'saidas', jsonb_build_object(
      'total', coalesce((select sum(e.amount) from expenses e join units u on u.id = e.unit_id
                          where u.company_id = v_emp and e.status = 'pago' and e.paid_date >= v_ini and e.paid_date < v_fim and (p_unit is null or e.unit_id = p_unit)), 0),
      'anterior', coalesce((select sum(e.amount) from expenses e join units u on u.id = e.unit_id
                          where u.company_id = v_emp and e.status = 'pago' and e.paid_date >= v_ant and e.paid_date < v_ini and (p_unit is null or e.unit_id = p_unit)), 0),
      'por_categoria', (select coalesce(jsonb_agg(jsonb_build_object('categoria', cat, 'valor', valor) order by valor desc), '[]') from (
          select coalesce(nullif(e.category, ''), 'Outros') cat, sum(e.amount) valor
            from expenses e join units u on u.id = e.unit_id
           where u.company_id = v_emp and e.status = 'pago' and e.paid_date >= v_ini and e.paid_date < v_fim and (p_unit is null or e.unit_id = p_unit) group by 1) x)),
    'a_pagar', coalesce((select sum(e.amount) from expenses e join units u on u.id = e.unit_id
                          where u.company_id = v_emp and e.status in ('a_vencer', 'atrasado') and (p_unit is null or e.unit_id = p_unit)), 0),
    'atrasado', coalesce((select sum(e.amount) from expenses e join units u on u.id = e.unit_id
                          where u.company_id = v_emp and e.status in ('a_vencer', 'atrasado') and e.due_date < today_brazil() and (p_unit is null or e.unit_id = p_unit)), 0),
    'no_caixa_aberto', coalesce((select sum(p.valor) from rec_pagamentos p join rec_caixas c on c.id = p.caixa_id
                          where c.company_id = v_emp and c.status = 'aberto' and (p_unit is null or c.unit_id = p_unit)), 0),
    'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dia', d.dia, 'entradas', coalesce(a.v, 0), 'saidas', coalesce(b.v, 0)) order by d.dia), '[]')
        from generate_series(v_ini, (v_fim - 1), interval '1 day') g(x)
        cross join lateral (select g.x::date dia) d
        left join (select o.received_date dia, sum(o.amount) v from other_incomes o join units u on u.id = o.unit_id
                    where u.company_id = v_emp and o.received_date >= v_ini and o.received_date < v_fim and (p_unit is null or o.unit_id = p_unit) group by 1) a on a.dia = d.dia
        left join (select e.paid_date dia, sum(e.amount) v from expenses e join units u on u.id = e.unit_id
                    where u.company_id = v_emp and e.status = 'pago' and e.paid_date >= v_ini and e.paid_date < v_fim and (p_unit is null or e.unit_id = p_unit) group by 1) b on b.dia = d.dia),
    'contas', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'vencimento', x.due_date, 'categoria', x.category, 'descricao', x.description,
                 'fornecedor', x.supplier, 'valor', x.amount, 'status', x.status, 'unidade', x.unidade) order by x.due_date), '[]') from (
        select e.id, e.due_date, e.category, e.description, e.supplier, e.amount, e.status, u.name unidade
          from expenses e join units u on u.id = e.unit_id
         where u.company_id = v_emp and e.status in ('a_vencer', 'atrasado') and (p_unit is null or e.unit_id = p_unit)
         order by e.due_date limit 40) x),
    'ultimas_entradas', (select coalesce(jsonb_agg(jsonb_build_object('data', x.received_date, 'descricao', x.description, 'valor', x.amount, 'forma', x.payment_method) order by x.received_date desc, x.id), '[]') from (
        select o.id, o.received_date, o.description, o.amount, o.payment_method
          from other_incomes o join units u on u.id = o.unit_id
         where u.company_id = v_emp and o.received_date >= v_ini and o.received_date < v_fim and (p_unit is null or o.unit_id = p_unit)
         order by o.received_date desc, o.id limit 15) x)
  ) into r;
  return r;
end;
$$;
revoke all on function rec_financeiro(date, uuid) from public, anon;
grant execute on function rec_financeiro(date, uuid) to authenticated;

commit;
