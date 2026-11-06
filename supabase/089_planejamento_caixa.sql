-- =========================================================
-- PLANEJAMENTO: SALDO EM CONTA E PROJEÇÃO DO CAIXA
--
-- 1) Saldo em conta informado: o sistema não vê o banco, então a casa
--    informa quanto tem na conta de cada unidade (e atualiza quando quiser).
--    Todos os usuários veem o mesmo número, com a data e quem informou.
-- 2) cash_projection: lista, dia a dia, o que deve entrar e sair nos
--    próximos dias, a partir de hoje:
--      + parcelas a receber das festas (atrasadas contam para hoje);
--      + saldo das festas sem parcelas, na data da festa;
--      − contas a pagar lançadas (atrasadas contam para hoje);
--      − despesas fixas dos meses seguintes (o mês atual já virou conta);
--      − custos lançados nas festas que ainda vão acontecer, na data da festa.
--    Não inclui festas que ainda não foram vendidas.
--
-- Só lê e grava o saldo informado; não muda nenhum lançamento.
-- Funciona nos dois bancos (Brava e clientes). Roda numa transação.
-- =========================================================

begin;

-- ---------- 1) saldo em conta ----------
create table if not exists cash_balances (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete cascade,
  amount numeric(14,2) not null,
  informed_at timestamptz not null default now(),
  informed_by text
);
alter table cash_balances add column if not exists company_id uuid references companies(id);
alter table cash_balances alter column company_id set default current_company_id();
alter table cash_balances alter column company_id set not null;
create unique index if not exists uq_cash_balances_unit on cash_balances (unit_id);
create index if not exists idx_cash_balances_company on cash_balances (company_id);
drop trigger if exists trg_set_company_id on cash_balances;
create trigger trg_set_company_id before insert or update on cash_balances for each row execute function set_company_id();

alter table cash_balances enable row level security;
drop policy if exists company_isolation on cash_balances;
create policy company_isolation on cash_balances as restrictive for all
  using (company_id = current_company_id() or (auth.uid() is null and current_user = 'app_definer'))
  with check (company_id = current_company_id() or (auth.uid() is null and current_user = 'app_definer'));
drop policy if exists app_definer_all on cash_balances;
create policy app_definer_all on cash_balances for all to app_definer using (true) with check (true);
drop policy if exists "read_cash_balances" on cash_balances;
create policy "read_cash_balances" on cash_balances for select using (has_permission(auth.uid(), 'page:financeiro'));
grant select on cash_balances to authenticated;
grant all on cash_balances to app_definer;

drop trigger if exists trg_audit on cash_balances;
create trigger trg_audit after insert or update or delete on cash_balances for each row execute function audit_row_change();

create or replace function set_cash_balance(p_unit uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'page:financeiro') then raise exception 'Sem permissão.'; end if;
  if p_amount is null then raise exception 'Informe o saldo.'; end if;
  if not exists (select 1 from units where id = p_unit and company_id = current_company_id()) then raise exception 'Unidade não encontrada.'; end if;
  insert into cash_balances (unit_id, amount, informed_at, informed_by)
  values (p_unit, round(p_amount, 2), now(), current_actor_name())
  on conflict (unit_id) do update set amount = excluded.amount, informed_at = excluded.informed_at, informed_by = excluded.informed_by;
end;
$$;

-- ---------- 2) projeção ----------
create or replace function cash_projection(p_unit uuid default null, p_days int default 90)
returns table (dia date, tipo text, descricao text, valor numeric, atrasado boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_hoje date := today_brazil();
  v_fim date := today_brazil() + least(greatest(coalesce(p_days, 90), 1), 366);
  r record; p jsonb; v_pago numeric; v_devido numeric;
  rec record; m date; v_venc date; v_dias int;
begin
  if not has_permission(auth.uid(), 'page:financeiro') then raise exception 'Sem permissão'; end if;

  -- parcelas a receber (festas com cronograma)
  for r in select rs.id, c.name cliente from reservations rs join clients c on c.id = rs.client_id
           where rs.status <> 'cancelada' and rs.company_id = current_company_id() and (p_unit is null or rs.unit_id = p_unit)
             and exists (select 1 from reservation_installments i where i.reservation_id = rs.id) loop
    for p in select x from jsonb_array_elements(festa_installments(r.id) -> 'parcelas') x loop
      if (p ->> 'aberto')::numeric > 0 and (p ->> 'vencimento')::date <= v_fim then
        dia := greatest((p ->> 'vencimento')::date, v_hoje);
        tipo := 'receber';
        descricao := r.cliente || ' · ' || coalesce(p ->> 'label', 'parcela');
        valor := (p ->> 'aberto')::numeric;
        atrasado := (p ->> 'vencimento')::date < v_hoje;
        return next;
      end if;
    end loop;
  end loop;

  -- festas sem cronograma: o que falta pagar, na data da festa
  for r in select rs.id, rs.event_date, c.name cliente, rs.child_name from reservations rs join clients c on c.id = rs.client_id
           where rs.status <> 'cancelada' and rs.company_id = current_company_id() and (p_unit is null or rs.unit_id = p_unit)
             and rs.event_date >= v_hoje and rs.event_date <= v_fim
             and not exists (select 1 from reservation_installments i where i.reservation_id = rs.id) loop
    v_devido := festa_total_due(r.id);
    select coalesce(sum(amount), 0) into v_pago from payments where reservation_id = r.id;
    if v_devido - v_pago > 0.009 then
      dia := r.event_date; tipo := 'receber';
      descricao := r.cliente || coalesce(' (festa de ' || r.child_name || ')', '') || ' · saldo da festa';
      valor := round(v_devido - v_pago, 2); atrasado := false;
      return next;
    end if;
  end loop;

  -- contas a pagar lançadas
  for rec in select e.due_date, e.description, e.supplier, e.amount, e.status, e.recurring_expense_id from expenses e
             where e.status in ('a_vencer', 'atrasado') and not e.covers_festa_costs and e.company_id = current_company_id()
               and (p_unit is null or e.unit_id = p_unit) and e.due_date <= v_fim loop
    dia := greatest(rec.due_date, v_hoje);
    tipo := case when rec.recurring_expense_id is not null then 'fixa' else 'conta' end;
    descricao := coalesce(nullif(rec.description, ''), 'Conta') || coalesce(' — ' || nullif(rec.supplier, ''), '');
    valor := -rec.amount; atrasado := rec.due_date < v_hoje;
    return next;
  end loop;

  -- despesas fixas dos próximos meses (o mês atual já virou conta lançada)
  for rec in select x.id, x.description, x.amount, x.day_of_month, x.first_charge_month from recurring_expenses x
             where x.active and x.company_id = current_company_id() and (p_unit is null or x.unit_id = p_unit) loop
    m := (date_trunc('month', v_hoje) + interval '1 month')::date;
    while m <= v_fim loop
      if rec.first_charge_month is null or m >= rec.first_charge_month then
        v_dias := extract(day from (m + interval '1 month - 1 day'))::int;
        v_venc := m + (least(rec.day_of_month, v_dias) - 1);
        if v_venc <= v_fim then
          dia := v_venc; tipo := 'fixa'; descricao := rec.description || ' (despesa fixa)'; valor := -rec.amount; atrasado := false;
          return next;
        end if;
      end if;
      m := (m + interval '1 month')::date;
    end loop;
  end loop;

  -- custos lançados nas festas que ainda vão acontecer
  for rec in select rs.event_date, coalesce(rs.child_name, c.name) quem, sum(rc.amount) total
             from reservations rs join clients c on c.id = rs.client_id join reservation_costs rc on rc.reservation_id = rs.id
             where rs.status <> 'cancelada' and rs.company_id = current_company_id() and (p_unit is null or rs.unit_id = p_unit)
               and rs.event_date > v_hoje and rs.event_date <= v_fim
             group by rs.id, rs.event_date, quem loop
    dia := rec.event_date; tipo := 'festa'; descricao := 'Custos da festa de ' || rec.quem; valor := -rec.total; atrasado := false;
    return next;
  end loop;
end;
$$;

revoke all on function set_cash_balance(uuid, numeric), cash_projection(uuid, int) from public, anon;
grant execute on function set_cash_balance(uuid, numeric), cash_projection(uuid, int) to authenticated;

select fix_definer_owners();

commit;
