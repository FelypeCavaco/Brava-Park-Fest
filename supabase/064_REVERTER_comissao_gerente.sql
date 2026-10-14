-- =========================================================
-- REVERTER A MIGRAÇÃO 064 (comissão da gerente)
--
-- ATENÇÃO: apaga o histórico de repasses de comissão e a configuração.
-- As contas de comissão que já estão no Financeiro CONTINUAM lá (viram
-- contas comuns, destravadas). Nenhuma festa ou pagamento é alterado.
-- Roda numa transação: ou desfaz tudo, ou nada.
-- =========================================================

begin;

drop trigger if exists trg_guard_commission_expense_insert on expenses;
drop function if exists guard_commission_expense_insert();
drop function if exists pay_commissions(date, date, text);
drop function if exists undo_commission_payout(uuid);
drop function if exists set_commission_rate(numeric, date);
drop function if exists set_commission_settings(date, text);
drop function if exists commission_pending(date);
drop function if exists commission_last_sunday();
drop function if exists commission_rate_at(date);

-- Trava das contas como era antes da 064
create or replace function guard_locked_expense() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.expense_fn', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if old.settlement_batch_id is not null then
    raise exception 'Lançamento de acerto entre unidades: altere ou desfaça pela tela Acertos entre unidades.';
  end if;
  if old.is_stock_purchase or (old.category = 'Estorno' and old.reservation_id is not null) or old.settlement_id is not null then
    if tg_op = 'DELETE' then
      raise exception '%', case
        when old.is_stock_purchase then 'Compra de estoque: exclua pela Entrada de compra (tela Estoque).'
        when old.settlement_id is not null then 'Conta de acerto entre unidades: cancele pela tela Acertos entre unidades.'
        else 'Estorno: altere pela festa cancelada.' end;
    end if;
    if new.amount is distinct from old.amount or new.unit_id is distinct from old.unit_id
       or new.category is distinct from old.category or new.description is distinct from old.description
       or new.supplier is distinct from old.supplier or new.is_stock_purchase is distinct from old.is_stock_purchase
       or new.reservation_id is distinct from old.reservation_id or new.settlement_id is distinct from old.settlement_id
       or (old.settlement_id is not null and (new.status = 'cancelado' or old.status = 'cancelado')) then
      raise exception '%', case
        when old.is_stock_purchase then 'Compra de estoque: edite pela Entrada de compra (tela Estoque).'
        when old.settlement_id is not null then 'Conta de acerto entre unidades: o valor vem da transferência; para cancelar, use a tela Acertos entre unidades.'
        else 'Estorno: altere o valor pela festa cancelada.' end;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

alter table expenses drop column if exists commission_payout_id;
drop table if exists commission_payout_items;
drop table if exists commission_payouts;
drop table if exists commission_settings;
drop table if exists commission_rates;
delete from role_permission_items where permission_key in ('page:comissoes', 'action:comissoes.pagar', 'action:comissoes.configurar', 'action:comissoes.desfazer');

commit;
