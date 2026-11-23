-- =========================================================
-- VENDAS NO BAR DURANTE A FESTA
--
-- Funciona nos dois bancos (Brava e clientes). Roda numa transação.
--
-- 1) Cada item do estoque pode ter um PREÇO DE VENDA (bebidas do bar).
-- 2) Na Central da festa, "Vendas no bar": escolhe as bebidas e quem paga.
--    - Pago na hora (Pix, cartão, dinheiro): vira uma entrada no Financeiro
--      ("Vendas no bar", ligada à festa) no dia da venda.
--    - Na conta do dono da festa: soma no valor da festa (como o consumo
--      avulso de sempre) e entra no Financeiro quando ele pagar.
--    Nos dois casos o estoque baixa na hora e o custo das bebidas entra no
--    custo da festa (Lucro por festa e Resultado do mês). Nada é contado em
--    dobro: o que vai na conta do dono não vira entrada à parte.
-- 3) Venda errada: "cancelar" com motivo devolve o estoque e tira a entrada.
--    Nada é apagado sem rastro: a venda fica marcada como cancelada.
-- 4) As bebidas vendidas não entram na média de consumo por convidado.
--
-- Não altera nenhum dado existente.
-- Atenção: se um dia a 063 ou a 099 forem rodadas de novo, rode esta de novo
-- depois (ela é segura para rodar mais de uma vez).
-- Desfazer: 101_REVERTER_vendas_no_bar.sql
-- =========================================================

begin;

-- ---------- 1) Colunas novas ----------
alter table inventory_items add column if not exists sale_price numeric(10,2);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_items_sale_price_check') then
    alter table inventory_items add constraint inventory_items_sale_price_check check (sale_price is null or sale_price >= 0);
  end if;
end $$;

-- De onde veio a baixa do estoque da festa: consumo pós-festa ou venda no bar.
alter table reservation_stock_consumption add column if not exists origem text not null default 'consumo';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'reservation_stock_consumption_origem_check') then
    alter table reservation_stock_consumption add constraint reservation_stock_consumption_origem_check check (origem in ('consumo', 'bar'));
  end if;
end $$;

alter table reservation_consumption add column if not exists inventory_item_id uuid references inventory_items(id) on delete set null;
alter table reservation_consumption add column if not exists bar_venda_id uuid;
alter table other_incomes add column if not exists bar_venda_id uuid;

-- ---------- 2) Vendas ----------
create table if not exists bar_vendas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id),
  reservation_id uuid not null references reservations(id) on delete cascade,
  unit_id uuid not null references units(id),
  modo text not null check (modo in ('pago', 'conta')),
  forma text,
  total numeric(12,2) not null default 0,
  custo numeric(12,2),
  data date not null default today_brazil(),
  vendido_em timestamptz not null default now(),
  criado_por text,
  other_income_id uuid references other_incomes(id) on delete set null,
  cancelada_em timestamptz,
  cancelada_por text,
  motivo_cancelamento text
);
create index if not exists idx_bar_vendas_reservation on bar_vendas (reservation_id, vendido_em);
create index if not exists idx_bar_vendas_data on bar_vendas (unit_id, data) where cancelada_em is null;

create table if not exists bar_venda_itens (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id),
  venda_id uuid not null references bar_vendas(id) on delete cascade,
  inventory_item_id uuid references inventory_items(id) on delete set null,
  nome text not null,
  quantidade numeric(10,2) not null check (quantidade > 0),
  preco_unit numeric(10,2) not null check (preco_unit >= 0),
  custo numeric(12,2),
  stock_consumption_id uuid references reservation_stock_consumption(id) on delete set null,
  consumption_id uuid references reservation_consumption(id) on delete set null
);
create index if not exists idx_bar_venda_itens_venda on bar_venda_itens (venda_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'reservation_consumption_bar_venda_fkey') then
    alter table reservation_consumption add constraint reservation_consumption_bar_venda_fkey foreign key (bar_venda_id) references bar_vendas(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'other_incomes_bar_venda_fkey') then
    alter table other_incomes add constraint other_incomes_bar_venda_fkey foreign key (bar_venda_id) references bar_vendas(id) on delete set null;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['bar_vendas', 'bar_venda_itens'] loop
    execute format('create index if not exists %I on %I (company_id)', 'idx_' || t || '_company', t);
    execute format('drop trigger if exists trg_set_company_id on %I', t);
    execute format('create trigger trg_set_company_id before insert or update on %I for each row execute function set_company_id()', t);
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists company_isolation on %I', t);
    execute format('create policy company_isolation on %I as restrictive for all
      using (company_id = current_company_id() or (auth.uid() is null and current_user = %L))
      with check (company_id = current_company_id() or (auth.uid() is null and current_user = %L))', t, 'app_definer', 'app_definer');
    execute format('drop policy if exists app_definer_all on %I', t);
    execute format('create policy app_definer_all on %I for all to app_definer using (true) with check (true)', t);
    execute format('drop policy if exists "read_bar" on %I', t);
    execute format('create policy "read_bar" on %I for select using (has_permission(auth.uid(), %L) or has_permission(auth.uid(), %L) or has_permission(auth.uid(), %L))',
                   t, 'page:festa_detalhe', 'page:financeiro', 'page:lucro_por_festa');
    execute format('revoke all on %I from anon', t);
    execute format('grant select on %I to authenticated', t);
    execute format('grant all on %I to app_definer', t);
    execute format('drop trigger if exists trg_audit on %I', t);
    execute format('create trigger trg_audit after insert or update or delete on %I for each row execute function audit_row_change()', t);
  end loop;
end $$;
-- Escrita só pelas funções abaixo.

-- ---------- 3) Vender ----------
-- p_itens: [{ "item": id do estoque, "quantidade": 2, "preco": 8.5 (opcional, senão o preço de venda do item) },
--           { "nome": "Chopp (litro)", "quantidade": 3, "preco": 25 }  -- item fora do estoque: sem baixa e sem custo
-- p_modo: 'pago' (paga na hora, com p_forma) ou 'conta' (vai para a conta do dono da festa)
create or replace function bar_vender(p_reservation uuid, p_modo text, p_forma text, p_itens jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r reservations%rowtype;
  v_id uuid := gen_random_uuid();
  it jsonb;
  inv inventory_items%rowtype;
  v_q numeric; v_p numeric; v_nome text; v_sc uuid; v_cost numeric; v_cons uuid; v_oi uuid;
  v_total numeric := 0; v_custo numeric := 0; v_cliente text;
begin
  if not has_permission(auth.uid(), 'action:festa.vendas_bar') then raise exception 'Sem permissão para vender no bar.'; end if;
  if p_modo not in ('pago', 'conta') then raise exception 'Diga quem paga: na hora ou na conta do dono da festa.'; end if;
  if p_modo = 'pago' and coalesce(trim(p_forma), '') = '' then raise exception 'Escolha a forma de pagamento.'; end if;
  select * into r from reservations where id = p_reservation and company_id = current_company_id();
  if not found then raise exception 'Festa não encontrada.'; end if;
  if r.status = 'cancelada' then raise exception 'Esta festa está cancelada.'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Escolha pelo menos uma bebida.'; end if;
  if jsonb_array_length(p_itens) > 50 then raise exception 'Muitos itens numa venda só.'; end if;

  insert into bar_vendas (id, reservation_id, unit_id, modo, forma, criado_por)
  values (v_id, r.id, r.unit_id, p_modo, case when p_modo = 'pago' then trim(p_forma) end, current_actor_name());

  for it in select x from jsonb_array_elements(p_itens) x loop
    v_q := nullif(it->>'quantidade', '')::numeric;
    if v_q is null or v_q <= 0 or v_q > 10000 then raise exception 'Quantidade inválida.'; end if;
    v_sc := null; v_cost := null; v_cons := null;
    if nullif(it->>'item', '') is not null then
      select * into inv from inventory_items where id = (it->>'item')::uuid and unit_id = r.unit_id;
      if not found then raise exception 'Bebida não encontrada no estoque da unidade desta festa.'; end if;
      v_nome := inv.name;
      v_p := coalesce(nullif(it->>'preco', '')::numeric, inv.sale_price);
      if v_p is null then raise exception 'Defina o preço de venda de "%" no Estoque.', inv.name; end if;
      -- baixa do estoque, do mesmo jeito do consumo pós-festa, marcada como bar
      v_sc := gen_random_uuid();
      v_cost := stock_apply_out(inv.id, v_q, 'venda_bar', 'Venda no bar', null, v_sc, null, r.id);
      insert into reservation_stock_consumption (id, reservation_id, inventory_item_id, item_name, quantity, unit_cost, total_cost, no_cost, origem)
      values (v_sc, r.id, inv.id, inv.name, v_q, case when v_cost is not null then v_cost / v_q end, v_cost, v_cost is null, 'bar');
    else
      v_nome := left(trim(coalesce(it->>'nome', '')), 80);
      if v_nome = '' then raise exception 'Escreva o nome do item.'; end if;
      v_p := nullif(it->>'preco', '')::numeric;
      if v_p is null then raise exception 'Informe o preço de "%".', v_nome; end if;
    end if;
    if v_p < 0 or v_p > 100000 then raise exception 'Preço inválido.'; end if;
    if p_modo = 'conta' then
      insert into reservation_consumption (reservation_id, item, quantity, unit_price, inventory_item_id, bar_venda_id)
      values (r.id, v_nome, v_q, round(v_p, 2), inv.id, v_id)
      returning id into v_cons;
    end if;
    insert into bar_venda_itens (venda_id, inventory_item_id, nome, quantidade, preco_unit, custo, stock_consumption_id, consumption_id)
    values (v_id, case when v_sc is not null then inv.id end, v_nome, v_q, round(v_p, 2), round(v_cost, 2), v_sc, v_cons);
    v_total := v_total + round(v_q * round(v_p, 2), 2);
    v_custo := v_custo + coalesce(v_cost, 0);
    inv := null;
  end loop;

  if p_modo = 'pago' and v_total > 0 then
    select c.name into v_cliente from clients c where c.id = r.client_id;
    insert into other_incomes (unit_id, kind, category, description, amount, received_date, payment_method, reservation_id, bar_venda_id)
    values (r.unit_id, 'bar', 'Vendas no bar',
            left('Vendas no bar — festa de ' || coalesce(nullif(trim(r.child_name), ''), v_cliente, 'cliente') || ' (' || to_char(r.event_date, 'DD/MM') || ')', 200),
            v_total, today_brazil(), trim(p_forma), r.id, v_id)
    returning id into v_oi;
  end if;
  update bar_vendas set total = v_total, custo = round(v_custo, 2), other_income_id = v_oi where id = v_id;
  return v_id;
end;
$$;
revoke all on function bar_vender(uuid, text, text, jsonb) from public, anon;
grant execute on function bar_vender(uuid, text, text, jsonb) to authenticated;

-- ---------- 4) Cancelar uma venda (com motivo) ----------
create or replace function bar_cancelar(p_venda uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v bar_vendas%rowtype; i record; c reservation_stock_consumption%rowtype;
begin
  if not has_permission(auth.uid(), 'action:festa.vendas_bar') then raise exception 'Sem permissão para vender no bar.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escreva o motivo do cancelamento.'; end if;
  select * into v from bar_vendas where id = p_venda and company_id = current_company_id() for update;
  if not found then raise exception 'Venda não encontrada.'; end if;
  if v.cancelada_em is not null then raise exception 'Esta venda já foi cancelada.'; end if;
  for i in select * from bar_venda_itens where venda_id = v.id loop
    if i.stock_consumption_id is not null then
      select * into c from reservation_stock_consumption where id = i.stock_consumption_id for update;
      if found then
        if c.inventory_item_id is not null then
          perform stock_apply_in(c.inventory_item_id, c.quantity, case when c.no_cost then null else coalesce(c.total_cost, 0) end,
                                 'venda_bar_cancelada', left('Venda no bar cancelada: ' || trim(p_motivo), 200), null, c.id, null, c.reservation_id);
        end if;
        delete from reservation_stock_consumption where id = c.id;
      end if;
    end if;
    if i.consumption_id is not null then delete from reservation_consumption where id = i.consumption_id; end if;
  end loop;
  if v.other_income_id is not null then delete from other_incomes where id = v.other_income_id; end if;
  update bar_vendas set cancelada_em = now(), cancelada_por = current_actor_name(), motivo_cancelamento = left(trim(p_motivo), 300), other_income_id = null
  where id = v.id;
end;
$$;
revoke all on function bar_cancelar(uuid, text) from public, anon;
grant execute on function bar_cancelar(uuid, text) to authenticated;

-- ---------- 5) A tela do consumo pós-festa não mexe nas baixas do bar ----------
create or replace function undo_stock_consumption(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c reservation_stock_consumption%rowtype;
begin
  if not has_permission(auth.uid(), 'action:festa.consumo_pos_festa') then raise exception 'Sem permissão'; end if;
  select * into c from reservation_stock_consumption where id = p_id for update;
  if not found then return; end if;
  if c.origem = 'bar' then raise exception 'Esta baixa é de uma venda no bar: cancele a venda em "Vendas no bar".'; end if;
  if c.inventory_item_id is not null then
    perform stock_apply_in(c.inventory_item_id, c.quantity, case when c.no_cost then null else coalesce(c.total_cost, 0) end,
                           'consumo_desfeito', 'Consumo pós-festa desfeito', null, p_id, null, c.reservation_id);
  end if;
  delete from reservation_stock_consumption where id = p_id;
end;
$$;

-- ---------- 6) Média de consumo por convidado: sem as vendas do bar ----------
create or replace function consumption_averages(p_unit uuid default null, p_limit int default 10)
returns table (
  inventory_item_id uuid, unit_id uuid, item_name text, unit_of_measure text, consumption_type text,
  festas int, total_qty numeric, total_guests numeric, avg_per_guest numeric, min_per_guest numeric, max_per_guest numeric,
  avg_per_festa numeric, total_cost numeric, avg_cost_per_guest numeric, avg_cost_per_festa numeric,
  configured_per_guest numeric, current_unit_cost numeric, current_quantity numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission(auth.uid(), 'page:estoque') or has_permission(auth.uid(), 'page:lucro_por_festa')
          or has_permission(auth.uid(), 'page:financeiro')) then raise exception 'Sem permissão'; end if;
  return query
  with fest as (
    select r.id, r.unit_id, (coalesce(r.guest_count, 0) + coalesce(r.courtesy_guests, 0))::numeric g,
           row_number() over (partition by r.unit_id order by r.event_date desc) rn
    from reservations r
    where r.status <> 'cancelada' and r.consumption_finalized and not r.exclude_from_averages
      and r.event_date < today_brazil() and (coalesce(r.guest_count, 0) + coalesce(r.courtesy_guests, 0)) > 0
      and (p_unit is null or r.unit_id = p_unit)
  ), sel as (select * from fest where rn <= greatest(p_limit, 1)),
  per as (
    select i.id item_id, s.id res_id, s.g, coalesce(sum(c.quantity), 0) q, sum(c.total_cost) cost
    from inventory_items i
    join sel s on s.unit_id = i.unit_id
    left join reservation_stock_consumption c on c.reservation_id = s.id and c.inventory_item_id = i.id and c.origem <> 'bar'
    where p_unit is null or i.unit_id = p_unit
    group by i.id, s.id, s.g
  ), amostra as (
    select p.*, i.consumption_type t from per p join inventory_items i on i.id = p.item_id
    where i.consumption_type = 'por_convidado' or p.q > 0
  )
  select i.id, i.unit_id, i.name, i.unit_of_measure, i.consumption_type,
         count(a.res_id)::int, sum(a.q), sum(a.g),
         sum(a.q) / nullif(sum(a.g), 0), min(a.q / a.g), max(a.q / a.g),
         sum(a.q) / nullif(count(a.res_id), 0),
         sum(a.cost), sum(a.cost) / nullif(sum(a.g), 0), sum(a.cost) / nullif(count(a.res_id), 0),
         i.quantity_per_guest,
         case when i.quantity > 0 then i.total_value / i.quantity else i.last_unit_cost end,
         i.quantity
  from amostra a join inventory_items i on i.id = a.item_id
  group by i.id
  having sum(a.q) > 0;
end;
$$;

-- ---------- 7) Resultado do mês: a venda paga na hora é receita da festa ----------
-- O custo das bebidas já entra nos insumos da festa; a venda paga na hora
-- (que fica como entrada "Vendas no bar") passa a somar na receita da festa,
-- junto com o consumo. A troca é feita no texto das duas funções do Financeiro
-- (063 e 099), sem mexer no resto delas.
do $$
declare
  fn text; d text;
  antigo text := 'coalesce((select sum(x.quantity * x.unit_price) from reservation_consumption x where x.reservation_id = rs.id), 0) consumo,';
  novo text := 'coalesce((select sum(x.quantity * x.unit_price) from reservation_consumption x where x.reservation_id = rs.id), 0)'
            || ' + coalesce((select sum(ob.amount) from other_incomes ob where ob.reservation_id = rs.id and ob.kind = ''bar''), 0) consumo,';
begin
  foreach fn in array array['finance_month_views(date,uuid)', 'finance_range_views(date,date,uuid)'] loop
    if to_regprocedure(fn) is null then continue; end if;
    d := pg_get_functiondef(to_regprocedure(fn));
    if position('ob.kind = ''bar''' in d) > 0 then continue; end if; -- já trocado
    if position(antigo in d) = 0 then raise exception 'Não achei a conta do consumo em %. Fale com o suporte antes de rodar.', fn; end if;
    execute replace(d, antigo, novo);
  end loop;
end $$;

commit;
