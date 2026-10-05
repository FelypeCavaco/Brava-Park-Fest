-- =========================================================
-- Valores de despesa fixa das festas: custos que toda festa tem (ex:
-- decoração R$600) e que entram sozinhos nos custos de cada festa.
--
-- Regras:
--   • Ao cadastrar um valor fixo, ele é lançado em todas as festas de hoje
--     em diante (não canceladas) da unidade escolhida — ou das duas, se
--     nenhuma for escolhida. Festas que já passaram não mudam (o resultado
--     delas já foi fechado).
--   • Toda festa nova cadastrada depois recebe os valores fixos sozinha.
--   • Editar o valor/descrição atualiza as festas de hoje em diante.
--   • Excluir tira das festas de hoje em diante; as passadas ficam como
--     estão.
--   • Na festa, o custo lançado é um custo normal: dá pra apagar ou ajustar
--     só naquela festa sem afetar as outras.
-- =========================================================

create table if not exists festa_fixed_costs (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  amount numeric(10,2) not null check (amount >= 0),
  unit_id uuid references units(id) on delete cascade, -- null = as duas unidades
  created_at timestamptz not null default now()
);

alter table festa_fixed_costs enable row level security;

create policy "read_active" on festa_fixed_costs for select using (is_active_user(auth.uid()));
create policy "write_festa_fixed_costs" on festa_fixed_costs for all
  using (has_permission(auth.uid(), 'page:financeiro'))
  with check (has_permission(auth.uid(), 'page:financeiro'));

alter table reservation_costs add column if not exists fixed_cost_id uuid references festa_fixed_costs(id) on delete set null;
create unique index if not exists idx_reservation_costs_fixed_once
  on reservation_costs (reservation_id, fixed_cost_id) where fixed_cost_id is not null;

-- Lança um valor fixo em todas as festas de hoje em diante que ainda não o
-- tenham. Usada ao cadastrar um valor novo.
create or replace function apply_festa_fixed_cost(p_fixed_cost_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if not has_permission(auth.uid(), 'page:financeiro') then
    raise exception 'Sem permissão';
  end if;

  insert into reservation_costs (reservation_id, description, amount, fixed_cost_id)
  select r.id, fc.description, fc.amount, fc.id
  from festa_fixed_costs fc
  join reservations r on (fc.unit_id is null or r.unit_id = fc.unit_id)
  where fc.id = p_fixed_cost_id
    and r.status <> 'cancelada'
    and r.event_date >= current_date
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Edita o valor fixo e repassa para as festas de hoje em diante.
create or replace function update_festa_fixed_cost(p_id uuid, p_description text, p_amount numeric, p_unit_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'page:financeiro') then
    raise exception 'Sem permissão';
  end if;

  update festa_fixed_costs set description = p_description, amount = p_amount, unit_id = p_unit_id where id = p_id;

  -- festas futuras que deixaram de estar na unidade escolhida perdem o custo
  delete from reservation_costs rc
  using reservations r
  where rc.reservation_id = r.id
    and rc.fixed_cost_id = p_id
    and r.event_date >= current_date
    and p_unit_id is not null
    and r.unit_id <> p_unit_id;

  update reservation_costs rc
  set description = p_description, amount = p_amount
  from reservations r
  where rc.reservation_id = r.id
    and rc.fixed_cost_id = p_id
    and r.event_date >= current_date;

  perform apply_festa_fixed_cost(p_id);
end;
$$;

-- Exclui o valor fixo, tirando das festas de hoje em diante (as passadas
-- ficam com o custo, só perdem o vínculo).
create or replace function delete_festa_fixed_cost(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'page:financeiro') then
    raise exception 'Sem permissão';
  end if;

  delete from reservation_costs rc
  using reservations r
  where rc.reservation_id = r.id
    and rc.fixed_cost_id = p_id
    and r.event_date >= current_date;

  delete from festa_fixed_costs where id = p_id;
end;
$$;

-- Toda festa nova já nasce com os valores fixos da unidade dela.
create or replace function add_fixed_costs_to_new_reservation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'cancelada' then
    insert into reservation_costs (reservation_id, description, amount, fixed_cost_id)
    select new.id, fc.description, fc.amount, fc.id
    from festa_fixed_costs fc
    where fc.unit_id is null or fc.unit_id = new.unit_id
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reservation_fixed_costs on reservations;
create trigger trg_reservation_fixed_costs
  after insert on reservations
  for each row execute function add_fixed_costs_to_new_reservation();

revoke all on function apply_festa_fixed_cost(uuid) from public, anon;
grant execute on function apply_festa_fixed_cost(uuid) to authenticated;
revoke all on function update_festa_fixed_cost(uuid, text, numeric, uuid) from public, anon;
grant execute on function update_festa_fixed_cost(uuid, text, numeric, uuid) to authenticated;
revoke all on function delete_festa_fixed_cost(uuid) from public, anon;
grant execute on function delete_festa_fixed_cost(uuid) to authenticated;
