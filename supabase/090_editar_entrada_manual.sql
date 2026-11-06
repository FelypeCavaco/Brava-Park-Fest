-- =========================================================
-- EDITAR ENTRADA LANÇADA À MÃO
--
-- Permite corrigir uma entrada de dinheiro lançada à mão (Novo lançamento →
-- Entrada de dinheiro → Outra entrada): tipo, descrição, valor, data, forma
-- de pagamento e unidade. Só vale para as manuais; acertos entre unidades e
-- multa e juros continuam mudando só pelas telas deles.
--
-- Funciona nos dois bancos (Brava e clientes). Roda numa transação.
-- =========================================================

begin;

create or replace function update_other_income(p_id uuid, p_unit uuid, p_category text, p_description text, p_amount numeric, p_date date, p_method text)
returns void
language plpgsql security definer set search_path = public as $$
declare o other_incomes%rowtype; v_cat text := nullif(trim(coalesce(p_category, '')), ''); v_desc text := nullif(trim(coalesce(p_description, '')), '');
begin
  if not has_permission(auth.uid(), 'action:financeiro.registrar_despesa') then raise exception 'Sem permissão para editar lançamentos.'; end if;
  select * into o from other_incomes where id = p_id and company_id = current_company_id();
  if o.id is null then raise exception 'Entrada não encontrada.'; end if;
  if o.kind <> 'manual' then raise exception 'Esta entrada só muda pela tela que a criou (acertos entre unidades ou parcelas da festa).'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Informe o valor que entrou.'; end if;
  if p_date is null then raise exception 'Informe a data em que o dinheiro entrou.'; end if;
  if not exists (select 1 from units where id = p_unit and company_id = current_company_id()) then raise exception 'Unidade não encontrada.'; end if;
  update other_incomes
  set unit_id = p_unit,
      category = coalesce(v_cat, 'Outras entradas'),
      description = left(coalesce(v_cat, 'Entrada') || coalesce(' — ' || v_desc, ''), 200),
      amount = round(p_amount, 2),
      received_date = p_date,
      payment_method = nullif(trim(coalesce(p_method, '')), '')
  where id = p_id;
end;
$$;

revoke all on function update_other_income(uuid, uuid, text, text, numeric, date, text) from public, anon;
grant execute on function update_other_income(uuid, uuid, text, text, numeric, date, text) to authenticated;

select fix_definer_owners();

commit;
