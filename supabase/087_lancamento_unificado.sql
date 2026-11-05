-- =========================================================
-- NOVO LANÇAMENTO NO FINANCEIRO
--
-- Uma tela só para: conta a pagar, conta já paga e entrada de dinheiro.
--
-- 1) Categorias criadas pela própria casa (de contas e de entradas). Ficam
--    salvas e aparecem na lista da próxima vez.
-- 2) Entrada de dinheiro avulsa (que não é pagamento de festa): grava em
--    "outras entradas" com o tipo escolhido. Entra no caixa do mês.
-- 3) Apagar uma entrada avulsa lançada à mão (só as manuais; acertos entre
--    unidades e multa/juros continuam mudando só pelas telas deles).
--
-- Funciona nos dois bancos (Brava e clientes). Roda numa transação.
-- =========================================================

begin;

-- ---------- 1) categorias da casa ----------
create table if not exists finance_categories (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('despesa', 'entrada')),
  name text not null check (length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);

alter table finance_categories add column if not exists company_id uuid references companies(id);
alter table finance_categories alter column company_id set default current_company_id();
alter table finance_categories alter column company_id set not null;
create index if not exists idx_finance_categories_company on finance_categories (company_id);
create unique index if not exists uq_finance_categories_nome on finance_categories (company_id, kind, lower(trim(name)));
drop trigger if exists trg_set_company_id on finance_categories;
create trigger trg_set_company_id before insert or update on finance_categories for each row execute function set_company_id();

alter table finance_categories enable row level security;
drop policy if exists company_isolation on finance_categories;
create policy company_isolation on finance_categories as restrictive for all
  using (company_id = current_company_id() or (auth.uid() is null and current_user = 'app_definer'))
  with check (company_id = current_company_id() or (auth.uid() is null and current_user = 'app_definer'));
drop policy if exists app_definer_all on finance_categories;
create policy app_definer_all on finance_categories for all to app_definer using (true) with check (true);
drop policy if exists "read_finance_categories" on finance_categories;
create policy "read_finance_categories" on finance_categories for select using (is_active_user(auth.uid()));
drop policy if exists "insert_finance_categories" on finance_categories;
create policy "insert_finance_categories" on finance_categories for insert
  with check (has_permission(auth.uid(), 'action:financeiro.registrar_despesa') or has_permission(auth.uid(), 'action:financeiro.despesas_fixas'));
drop policy if exists "delete_finance_categories" on finance_categories;
create policy "delete_finance_categories" on finance_categories for delete
  using (has_permission(auth.uid(), 'action:financeiro.remover'));
grant select, insert, delete on finance_categories to authenticated;
grant all on finance_categories to app_definer;

drop trigger if exists trg_audit on finance_categories;
create trigger trg_audit after insert or update or delete on finance_categories for each row execute function audit_row_change();

-- ---------- 2) entrada avulsa ----------
alter table other_incomes add column if not exists category text;

create or replace function register_other_income(p_unit uuid, p_category text, p_description text, p_amount numeric, p_date date, p_method text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_cat text := nullif(trim(coalesce(p_category, '')), ''); v_desc text := nullif(trim(coalesce(p_description, '')), '');
begin
  if not has_permission(auth.uid(), 'action:financeiro.registrar_despesa') then raise exception 'Sem permissão para lançar no financeiro.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Informe o valor que entrou.'; end if;
  if p_date is null then raise exception 'Informe a data em que o dinheiro entrou.'; end if;
  if not exists (select 1 from units where id = p_unit and company_id = current_company_id()) then raise exception 'Unidade não encontrada.'; end if;
  insert into other_incomes (unit_id, kind, category, description, amount, received_date, payment_method)
  values (p_unit, 'manual', coalesce(v_cat, 'Outras entradas'),
          left(coalesce(v_cat, 'Entrada') || coalesce(' — ' || v_desc, ''), 200),
          round(p_amount, 2), p_date, nullif(trim(coalesce(p_method, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function delete_other_income(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o other_incomes%rowtype;
begin
  if not has_permission(auth.uid(), 'action:financeiro.remover') then raise exception 'Sem permissão para remover lançamentos.'; end if;
  select * into o from other_incomes where id = p_id and company_id = current_company_id();
  if o.id is null then raise exception 'Entrada não encontrada.'; end if;
  if o.kind <> 'manual' then raise exception 'Esta entrada só muda pela tela que a criou (acertos entre unidades ou parcelas da festa).'; end if;
  delete from other_incomes where id = p_id;
end;
$$;

revoke all on function register_other_income(uuid, text, text, numeric, date, text), delete_other_income(uuid) from public, anon;
grant execute on function register_other_income(uuid, text, text, numeric, date, text), delete_other_income(uuid) to authenticated;

select fix_definer_owners();

commit;
