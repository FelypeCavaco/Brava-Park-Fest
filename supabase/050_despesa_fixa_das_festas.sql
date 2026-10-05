-- =========================================================
-- Valores de despesa fixa das festas: custos que toda festa tem e que
-- entram sozinhos nos custos de cada festa.
--
-- Cada despesa tem um valor padrão e, opcionalmente, um valor por plano
-- (ex: docinhos custam mais no "Classic 70 pessoas" que no "Classic 40
-- pessoas"). A festa recebe o valor do plano dela; plano sem valor
-- próprio (ou festa sem plano) usa o padrão.
--
-- Regras:
--   • Ao salvar, a despesa entra em todas as festas de hoje em diante (não
--     canceladas) da unidade escolhida — ou das duas, se nenhuma for
--     escolhida. Festas que já passaram não mudam.
--   • Toda festa nova cadastrada depois recebe as despesas fixas sozinha.
--   • Editar a despesa (valores, unidade, descrição) atualiza as festas de
--     hoje em diante.
--   • Se a festa troca de plano, os valores dela se ajustam ao plano novo.
--     Se é cancelada, as despesas fixas saem; se volta, entram de novo.
--   • Excluir a despesa tira das festas de hoje em diante.
--   • Na festa, o custo lançado é um custo normal: dá pra apagar ou ajustar
--     só naquela festa.
-- =========================================================

create table if not exists festa_fixed_costs (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  amount numeric(10,2) not null check (amount >= 0), -- valor padrão
  unit_id uuid references units(id) on delete cascade, -- null = as duas unidades
  created_at timestamptz not null default now()
);

create table if not exists festa_fixed_cost_package_amounts (
  fixed_cost_id uuid not null references festa_fixed_costs(id) on delete cascade,
  package_id uuid not null references packages(id) on delete cascade,
  amount numeric(10,2) not null check (amount >= 0),
  primary key (fixed_cost_id, package_id)
);

alter table festa_fixed_costs enable row level security;
alter table festa_fixed_cost_package_amounts enable row level security;

create policy "read_active" on festa_fixed_costs for select using (is_active_user(auth.uid()));
create policy "write_festa_fixed_costs" on festa_fixed_costs for all
  using (has_permission(auth.uid(), 'page:financeiro'))
  with check (has_permission(auth.uid(), 'page:financeiro'));

create policy "read_active" on festa_fixed_cost_package_amounts for select using (is_active_user(auth.uid()));
create policy "write_festa_fixed_cost_package_amounts" on festa_fixed_cost_package_amounts for all
  using (has_permission(auth.uid(), 'page:financeiro'))
  with check (has_permission(auth.uid(), 'page:financeiro'));

alter table reservation_costs add column if not exists fixed_cost_id uuid references festa_fixed_costs(id) on delete set null;
create unique index if not exists idx_reservation_costs_fixed_once
  on reservation_costs (reservation_id, fixed_cost_id) where fixed_cost_id is not null;

-- Valor da despesa para um plano: o do plano, senão o padrão.
create or replace function festa_fixed_cost_amount(p_fixed_cost_id uuid, p_package_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select amount from festa_fixed_cost_package_amounts where fixed_cost_id = p_fixed_cost_id and package_id = p_package_id),
    (select amount from festa_fixed_costs where id = p_fixed_cost_id)
  );
$$;

-- Repassa uma despesa fixa para as festas de hoje em diante: tira de quem
-- não é mais da unidade, atualiza descrição/valor de quem já tem e lança em
-- quem ainda não tem.
create or replace function sync_festa_fixed_cost(p_fixed_cost_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_unit uuid;
  v_desc text;
begin
  select unit_id, description into v_unit, v_desc from festa_fixed_costs where id = p_fixed_cost_id;

  delete from reservation_costs rc
  using reservations r
  where rc.reservation_id = r.id
    and rc.fixed_cost_id = p_fixed_cost_id
    and r.event_date >= current_date
    and (r.status = 'cancelada' or (v_unit is not null and r.unit_id <> v_unit));

  update reservation_costs rc
  set description = v_desc, amount = festa_fixed_cost_amount(p_fixed_cost_id, r.package_id)
  from reservations r
  where rc.reservation_id = r.id
    and rc.fixed_cost_id = p_fixed_cost_id
    and r.event_date >= current_date;

  insert into reservation_costs (reservation_id, description, amount, fixed_cost_id)
  select r.id, v_desc, festa_fixed_cost_amount(p_fixed_cost_id, r.package_id), p_fixed_cost_id
  from reservations r
  where r.status <> 'cancelada'
    and r.event_date >= current_date
    and (v_unit is null or r.unit_id = v_unit)
  on conflict do nothing;
end;
$$;

-- Cria (p_id nulo) ou edita uma despesa fixa, com os valores por plano
-- (p_package_amounts = {"<package_id>": valor, ...}; plano fora da lista
-- usa o padrão), e já repassa para as festas de hoje em diante.
create or replace function save_festa_fixed_cost(
  p_id uuid,
  p_description text,
  p_amount numeric,
  p_unit_id uuid,
  p_package_amounts jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
begin
  if not has_permission(auth.uid(), 'page:financeiro') then
    raise exception 'Sem permissão';
  end if;

  if v_id is null then
    insert into festa_fixed_costs (description, amount, unit_id)
    values (p_description, p_amount, p_unit_id)
    returning id into v_id;
  else
    update festa_fixed_costs set description = p_description, amount = p_amount, unit_id = p_unit_id where id = v_id;
  end if;

  delete from festa_fixed_cost_package_amounts where fixed_cost_id = v_id;
  insert into festa_fixed_cost_package_amounts (fixed_cost_id, package_id, amount)
  select v_id, (kv.key)::uuid, (kv.value)::numeric
  from jsonb_each_text(coalesce(p_package_amounts, '{}'::jsonb)) kv
  where kv.value is not null and kv.value <> '';

  perform sync_festa_fixed_cost(v_id);
  return v_id;
end;
$$;

-- Exclui a despesa fixa, tirando das festas de hoje em diante (as passadas
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

-- Festa nova já nasce com as despesas fixas da unidade e do plano dela.
create or replace function add_fixed_costs_to_new_reservation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'cancelada' then
    insert into reservation_costs (reservation_id, description, amount, fixed_cost_id)
    select new.id, fc.description, festa_fixed_cost_amount(fc.id, new.package_id), fc.id
    from festa_fixed_costs fc
    where fc.unit_id is null or fc.unit_id = new.unit_id
    on conflict do nothing;
  end if;
  return new;
end;
$$;

-- Festa que troca de plano/unidade, é cancelada ou volta: ajusta as
-- despesas fixas dela.
create or replace function refresh_fixed_costs_on_reservation_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelada' then
    delete from reservation_costs where reservation_id = new.id and fixed_cost_id is not null;
    return new;
  end if;

  if new.package_id is distinct from old.package_id then
    update reservation_costs
    set amount = festa_fixed_cost_amount(fixed_cost_id, new.package_id)
    where reservation_id = new.id and fixed_cost_id is not null;
  end if;

  -- Só relança quando a festa volta de cancelada ou muda de unidade — uma
  -- troca de status comum (ex: sinal pago) não pode recolocar uma despesa
  -- que alguém apagou de propósito naquela festa.
  if old.status = 'cancelada' or new.unit_id is distinct from old.unit_id then
    delete from reservation_costs rc
    using festa_fixed_costs fc
    where rc.reservation_id = new.id
      and rc.fixed_cost_id = fc.id
      and fc.unit_id is not null
      and fc.unit_id <> new.unit_id;

    insert into reservation_costs (reservation_id, description, amount, fixed_cost_id)
    select new.id, fc.description, festa_fixed_cost_amount(fc.id, new.package_id), fc.id
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

drop trigger if exists trg_reservation_fixed_costs_change on reservations;
create trigger trg_reservation_fixed_costs_change
  after update of package_id, unit_id, status on reservations
  for each row
  when (old.package_id is distinct from new.package_id
     or old.unit_id is distinct from new.unit_id
     or old.status is distinct from new.status)
  execute function refresh_fixed_costs_on_reservation_change();

revoke all on function sync_festa_fixed_cost(uuid) from public, anon, authenticated;
revoke all on function save_festa_fixed_cost(uuid, text, numeric, uuid, jsonb) from public, anon;
grant execute on function save_festa_fixed_cost(uuid, text, numeric, uuid, jsonb) to authenticated;
revoke all on function delete_festa_fixed_cost(uuid) from public, anon;
grant execute on function delete_festa_fixed_cost(uuid) to authenticated;
