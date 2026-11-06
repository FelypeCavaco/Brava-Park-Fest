-- =========================================================
-- LUCRO POR FESTA: TIRAR FESTAS DA CONTA
--
-- Festas que ainda não têm os custos lançados distorcem o lucro total e a
-- margem média. Agora dá para marcar uma festa como "fora da conta": ela
-- continua na lista (apagada), mas não entra nos totais da tela Lucro por
-- festa. A marcação fica gravada até alguém desmarcar, e vale para todos os
-- usuários e computadores.
--
-- Não muda nada no caixa, no Financeiro nem na própria festa.
-- Funciona nos dois bancos (Brava e clientes). Roda numa transação.
-- =========================================================

begin;

alter table reservations add column if not exists profit_excluded boolean not null default false;
alter table reservations add column if not exists profit_excluded_by text;
alter table reservations add column if not exists profit_excluded_at timestamptz;

create or replace function set_profit_exclusion(p_res uuid, p_excluded boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'page:lucro_por_festa') then
    raise exception 'Sem permissão para mudar o Lucro por festa.';
  end if;
  if not exists (select 1 from reservations where id = p_res and company_id = current_company_id()) then
    raise exception 'Festa não encontrada.';
  end if;
  update reservations
  set profit_excluded = coalesce(p_excluded, false),
      profit_excluded_by = case when coalesce(p_excluded, false) then current_actor_name() else null end,
      profit_excluded_at = case when coalesce(p_excluded, false) then now() else null end
  where id = p_res;
end;
$$;

revoke all on function set_profit_exclusion(uuid, boolean) from public, anon;
grant execute on function set_profit_exclusion(uuid, boolean) to authenticated;

select fix_definer_owners();

commit;
