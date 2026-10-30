-- =========================================================
-- BANCO DOS CLIENTES — ESTRUTURA, PARTE 2 DE 9
-- Rode as partes EM ORDEM (1, 2, 3...), cada uma numa query nova do SQL
-- Editor do projeto NOVO. Se aparecer a pergunta sobre "Row Level Security",
-- escolha rodar SEM o Supabase acrescentar nada (a segurança já está aqui).
-- Cada parte roda inteira ou nada.
-- =========================================================

begin;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'units') then
    raise exception 'Rode antes a parte 1 (e as seguintes, em ordem).';
  end if;
end $$;

create policy "read_active" on reservation_costs for select using (is_active_user(auth.uid()));

create policy "write_reservation_costs" on reservation_costs for insert
  with check (has_permission(auth.uid(), 'page:festa_detalhe') or has_permission(auth.uid(), 'page:lucro_por_festa'));

create policy "delete_reservation_costs" on reservation_costs for delete
  using (has_permission(auth.uid(), 'page:festa_detalhe') or has_permission(auth.uid(), 'page:lucro_por_festa'));

create policy "read_active" on inventory_items for select using (is_active_user(auth.uid()));

create policy "write_inventory_items" on inventory_items for insert
  with check (has_permission(auth.uid(), 'page:estoque'));

create policy "update_inventory_items" on inventory_items for update
  using (has_permission(auth.uid(), 'page:estoque') or has_permission(auth.uid(), 'page:festa_detalhe') or has_permission(auth.uid(), 'page:financeiro'))
  with check (has_permission(auth.uid(), 'page:estoque') or has_permission(auth.uid(), 'page:festa_detalhe') or has_permission(auth.uid(), 'page:financeiro'));

create policy "delete_inventory_items" on inventory_items for delete
  using (has_permission(auth.uid(), 'page:estoque'));

create policy "read_active" on marketing_spend for select using (is_active_user(auth.uid()));

create policy "write_marketing_spend" on marketing_spend for insert with check (has_permission(auth.uid(), 'page:marketing'));

create policy "update_marketing_spend" on marketing_spend for update using (has_permission(auth.uid(), 'page:marketing')) with check (has_permission(auth.uid(), 'page:marketing'));

create policy "read_active" on unit_goals for select using (is_active_user(auth.uid()));

create policy "write_unit_goals" on unit_goals for insert with check (has_permission(auth.uid(), 'page:relatorios'));

create policy "update_unit_goals" on unit_goals for update using (has_permission(auth.uid(), 'page:relatorios')) with check (has_permission(auth.uid(), 'page:relatorios'));

create policy "read_active" on payment_method_fees for select using (is_active_user(auth.uid()));

create policy "write_payment_method_fees" on payment_method_fees for all
  using (has_permission(auth.uid(), 'page:pagamentos'))
  with check (has_permission(auth.uid(), 'page:pagamentos'));

-- ---------- Tabelas de uma tela só — leitura e escrita pela mesma chave ----------

create policy "read_visits" on visits for select using (has_permission(auth.uid(), 'page:visitas'));

create policy "write_visits" on visits for all
  using (has_permission(auth.uid(), 'page:visitas'))
  with check (has_permission(auth.uid(), 'page:visitas'));

create policy "read_suppliers" on suppliers for select using (has_permission(auth.uid(), 'page:fornecedores'));

create policy "write_suppliers" on suppliers for all
  using (has_permission(auth.uid(), 'page:fornecedores'))
  with check (has_permission(auth.uid(), 'page:fornecedores'));

create policy "read_supplier_bookings" on supplier_bookings for select using (has_permission(auth.uid(), 'page:fornecedores'));

create policy "write_supplier_bookings" on supplier_bookings for all
  using (has_permission(auth.uid(), 'page:fornecedores'))
  with check (has_permission(auth.uid(), 'page:fornecedores'));

create policy "read_proposals" on proposals for select using (has_permission(auth.uid(), 'page:propostas'));

create policy "write_proposals" on proposals for all
  using (has_permission(auth.uid(), 'page:propostas'))
  with check (has_permission(auth.uid(), 'page:propostas'));

create policy "read_nps_responses" on nps_responses for select using (has_permission(auth.uid(), 'page:satisfacao'));

create policy "write_nps_responses" on nps_responses for all
  using (has_permission(auth.uid(), 'page:satisfacao'))
  with check (has_permission(auth.uid(), 'page:satisfacao'));

create policy "read_party_reviews" on party_reviews for select using (has_permission(auth.uid(), 'page:satisfacao'));

create policy "read_contract_templates" on contract_templates for select
  using (has_permission(auth.uid(), 'page:contratos') or has_permission(auth.uid(), 'page:festa_detalhe'));

create policy "write_contract_templates" on contract_templates for all
  using (has_permission(auth.uid(), 'page:contratos'))
  with check (has_permission(auth.uid(), 'page:contratos'));

create policy "read_contracts" on contracts for select
  using (has_permission(auth.uid(), 'page:contratos') or has_permission(auth.uid(), 'page:festa_detalhe'));

create policy "write_contracts" on contracts for all
  using (has_permission(auth.uid(), 'page:contratos') or has_permission(auth.uid(), 'page:festa_detalhe'))
  with check (has_permission(auth.uid(), 'page:contratos') or has_permission(auth.uid(), 'page:festa_detalhe'));

create policy "read_recurring_expenses" on recurring_expenses for select using (has_permission(auth.uid(), 'page:financeiro'));

create policy "write_recurring_expenses" on recurring_expenses for all
  using (has_permission(auth.uid(), 'action:financeiro.despesas_fixas'))
  with check (has_permission(auth.uid(), 'action:financeiro.despesas_fixas'));

create policy "read_expense_items" on expense_items for select using (has_permission(auth.uid(), 'page:financeiro'));

-- sem política de escrita direta: expense_items só é gravado/apagado pelas
-- funções record_stock_purchase/undo_stock_purchase, que são security
-- definer e não passam por RLS.

create policy "read_inventory_purchase_variants" on inventory_purchase_variants for select
  using (has_permission(auth.uid(), 'page:financeiro') or has_permission(auth.uid(), 'page:estoque'));

-- ---------- Tabelas da Central da festa ----------

create policy "read_active" on reservations for select using (is_active_user(auth.uid()));

create policy "write_reservations" on reservations for insert with check (has_permission(auth.uid(), 'action:reservas.nova_reserva'));

create policy "update_reservations" on reservations for update
  using (has_permission(auth.uid(), 'action:festa.editar_dados') or has_permission(auth.uid(), 'action:festa.trocar_pacote'))
  with check (has_permission(auth.uid(), 'action:festa.editar_dados') or has_permission(auth.uid(), 'action:festa.trocar_pacote'));

create policy "delete_reservations" on reservations for delete using (has_permission(auth.uid(), 'action:festa.excluir_festa'));

create policy "read_festa_detalhe" on reservation_extra_items for select using (has_permission(auth.uid(), 'page:festa_detalhe'));

create policy "write_reservation_extra_items" on reservation_extra_items for all
  using (has_permission(auth.uid(), 'action:festa.itens_extras'))
  with check (has_permission(auth.uid(), 'action:festa.itens_extras'));

create policy "read_festa_detalhe" on checklist_items for select using (has_permission(auth.uid(), 'page:festa_detalhe'));

create policy "write_checklist_items" on checklist_items for all
  using (has_permission(auth.uid(), 'action:festa.checklist'))
  with check (has_permission(auth.uid(), 'action:festa.checklist'));

create policy "read_staff_assignments" on staff_assignments for select
  using (has_permission(auth.uid(), 'page:festa_detalhe') or has_permission(auth.uid(), 'page:escalas'));

create policy "write_staff_assignments" on staff_assignments for all
  using (has_permission(auth.uid(), 'action:festa.equipe'))
  with check (has_permission(auth.uid(), 'action:festa.equipe'));

create policy "read_festa_detalhe" on reservation_consumption for select using (has_permission(auth.uid(), 'page:festa_detalhe'));

create policy "write_reservation_consumption" on reservation_consumption for all
  using (has_permission(auth.uid(), 'action:festa.consumo_pos_festa'))
  with check (has_permission(auth.uid(), 'action:festa.consumo_pos_festa'));

create policy "read_festa_detalhe" on reservation_stock_consumption for select using (has_permission(auth.uid(), 'page:festa_detalhe'));

create policy "write_reservation_stock_consumption" on reservation_stock_consumption for all
  using (has_permission(auth.uid(), 'action:festa.consumo_pos_festa'))
  with check (has_permission(auth.uid(), 'action:festa.consumo_pos_festa'));

create policy "read_festa_detalhe" on reservation_documents for select using (has_permission(auth.uid(), 'page:festa_detalhe'));

create policy "write_reservation_documents" on reservation_documents for all
  using (has_permission(auth.uid(), 'action:festa.documentos'))
  with check (has_permission(auth.uid(), 'action:festa.documentos'));

create policy "read_festa_detalhe" on message_templates for select using (has_permission(auth.uid(), 'page:festa_detalhe'));

create policy "write_message_templates" on message_templates for all
  using (has_permission(auth.uid(), 'page:festa_detalhe'))
  with check (has_permission(auth.uid(), 'page:festa_detalhe'));

create policy "read_festa_detalhe" on reservation_birthday_kids for select using (has_permission(auth.uid(), 'page:festa_detalhe'));

create policy "write_reservation_birthday_kids" on reservation_birthday_kids for all
  using (has_permission(auth.uid(), 'action:reservas.nova_reserva') or has_permission(auth.uid(), 'action:festa.editar_dados'))
  with check (has_permission(auth.uid(), 'action:reservas.nova_reserva') or has_permission(auth.uid(), 'action:festa.editar_dados'));

-- ---------- Observações da festa (com lembrete opcional por data) ----------
-- A partir de remind_on, a observação aparece no Painel até ser marcada
-- como concluída (reminder_done).
create table if not exists reservation_notes (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  body text not null,
  remind_on date,
  reminder_done boolean not null default false,
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_reservation_notes_reservation on reservation_notes (reservation_id);

create index if not exists idx_reservation_notes_remind on reservation_notes (remind_on) where remind_on is not null and not reminder_done;

alter table reservation_notes enable row level security;

create policy "read_active" on reservation_notes for select using (is_active_user(auth.uid()));

create policy "write_reservation_notes" on reservation_notes for all
  using (has_permission(auth.uid(), 'page:festa_detalhe'))
  with check (has_permission(auth.uid(), 'page:festa_detalhe'));

-- ---------- Cadastro de funcionários + presença/pagamento/substituição na escala ----------
create table if not exists staff_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  default_role text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table staff_members enable row level security;

create policy "read_staff_members" on staff_members for select
  using (has_permission(auth.uid(), 'page:festa_detalhe') or has_permission(auth.uid(), 'page:escalas'));

create policy "write_staff_members" on staff_members for all
  using (has_permission(auth.uid(), 'action:festa.equipe'))
  with check (has_permission(auth.uid(), 'action:festa.equipe'));

alter table staff_assignments add column if not exists staff_member_id uuid references staff_members(id) on delete set null;

alter table staff_assignments add column if not exists attended boolean not null default false;

alter table staff_assignments add column if not exists attended_at timestamptz;

alter table staff_assignments add column if not exists payment_cost_id uuid references reservation_costs(id) on delete set null;

alter table staff_assignments add column if not exists status text not null default 'escalado'
  check (status in ('escalado', 'substituido'));

alter table staff_assignments add column if not exists substituted_by_name text;

alter table staff_assignments add column if not exists substitution_reason text;

alter table staff_assignments add column if not exists replaces_assignment_id uuid references staff_assignments(id) on delete set null;

alter table staff_assignments add column if not exists created_at timestamptz not null default now();

-- Convidado sinalizado (ex: veio sem estar na lista) — fica destacado.
alter table guest_list_entries add column if not exists flagged boolean not null default false;

-- ---------- Valores de despesa fixa das festas (entram sozinhos nos custos de cada festa) ----------
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

-- lista de espera
create policy "read_active" on waitlist for select using (is_active_user(auth.uid()));

create policy "write_waitlist" on waitlist for all
  using (has_permission(auth.uid(), 'action:reservas.lista_espera'))
  with check (has_permission(auth.uid(), 'action:reservas.lista_espera'));

-- lista de convidados (lado da equipe — os anons públicos têm política
-- própria, mais abaixo, e continuam intactos)
create policy "read_festa_detalhe" on guest_list_pages for select using (has_permission(auth.uid(), 'page:festa_detalhe'));

create policy "write_guest_list_pages" on guest_list_pages for insert with check (has_permission(auth.uid(), 'action:festa.lista_convidados'));

create policy "staff_read_guest_list_entries" on guest_list_entries for select using (has_permission(auth.uid(), 'page:festa_detalhe'));

create policy "staff_write_guest_list_entries" on guest_list_entries for insert with check (has_permission(auth.uid(), 'action:festa.lista_convidados'));

-- check-in de chegada na portaria (toggle "arrived") é um update feito pela
-- equipe, além de inserir/apagar nome manualmente.
create policy "staff_update_guest_list_entries" on guest_list_entries for update
  using (has_permission(auth.uid(), 'action:festa.lista_convidados'))
  with check (has_permission(auth.uid(), 'action:festa.lista_convidados'));

create policy "staff_delete_guest_list_entries" on guest_list_entries for delete using (has_permission(auth.uid(), 'action:festa.lista_convidados'));

-- link do formulário de avaliação — baixa sensibilidade (só cria um token
-- compartilhável), usado a partir de 3 telas diferentes (Central da festa,
-- Satisfação, Lembretes diários); mantém liberado pra qualquer ativo.
create policy "read_active" on review_links for select using (is_active_user(auth.uid()));

create policy "insert_active" on review_links for insert with check (is_active_user(auth.uid()));

-- user_profiles fica de fora das políticas acima de propósito: escrever ali
-- (em especial role_id) precisa ser exclusivo de administrador, senão
-- qualquer funcionário logado consegue se promover sozinho (bastava ler o
-- id do perfil administrador em `roles`, que é de leitura livre, e trocar
-- o próprio role_id). A leitura continua liberada pra qualquer
-- autenticado — nomes de funcionário não são dado sensível e várias telas
-- precisam listar quem é quem.
create policy "authenticated_read" on user_profiles
  for select using (auth.role() = 'authenticated');

create policy "administrador_write" on user_profiles
  for insert with check (is_admin_user(auth.uid()));

create policy "administrador_update" on user_profiles
  for update using (is_admin_user(auth.uid())) with check (is_admin_user(auth.uid()));

create policy "administrador_delete" on user_profiles
  for delete using (is_admin_user(auth.uid()));

-- Acesso público (sem login) à lista de convidados e à avaliação pós-festa:
-- só pelas funções abaixo, que exigem o código (token) do link e só
-- enxergam/mexem naquela festa. Não há acesso direto às tabelas.
-- ---------- Lista de convidados ----------

create function public_get_guest_list_page(p_token uuid)
returns table (
  token uuid,
  unit_name text,
  event_date date,
  theme text,
  child_name text,
  guest_limit int,
  playlist_enabled boolean,
  playlist_url text
)
language sql stable security definer set search_path = public as $$
  select g.token, g.unit_name, g.event_date, g.theme, g.child_name, g.guest_limit,
         (u.name = 'Vila Operária') as playlist_enabled,
         g.playlist_url
  from guest_list_pages g
  join reservations r on r.id = g.reservation_id
  join units u on u.id = r.unit_id
  where g.token = p_token;
$$;

-- Salva (ou apaga, se vier vazio) o link da playlist. Só aceita links do
-- Spotify e só em festa da Vila Operária.
create or replace function public_set_guest_list_playlist(p_token uuid, p_url text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text := nullif(trim(coalesce(p_url, '')), '');
begin
  if not exists (
    select 1
    from guest_list_pages g
    join reservations r on r.id = g.reservation_id
    join units u on u.id = r.unit_id
    where g.token = p_token and u.name = 'Vila Operária'
  ) then
    raise exception 'Playlist não disponível para esta festa';
  end if;

  if v_url is not null and (
    length(v_url) > 500
    or not (v_url ilike 'https://open.spotify.com/%' or v_url ilike 'https://spotify.link/%')
  ) then
    raise exception 'Link do Spotify inválido';
  end if;

  update guest_list_pages set playlist_url = v_url where token = p_token;
end;
$$;

create or replace function public_list_guest_entries(p_token uuid)
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select e.id, e.name
  from guest_list_entries e
  where e.token = p_token
  order by e.created_at;
$$;

create or replace function public_add_guest_entries(p_token uuid, p_names text[])
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if not exists (select 1 from guest_list_pages where token = p_token) then
    raise exception 'Lista não encontrada';
  end if;
  if coalesce(array_length(p_names, 1), 0) > 300 then
    raise exception 'Muitos nomes de uma vez';
  end if;
  if (select count(*) from guest_list_entries where token = p_token) + coalesce(array_length(p_names, 1), 0) > 1000 then
    raise exception 'Lista cheia';
  end if;

  insert into guest_list_entries (token, name)
  select p_token, left(trim(n), 120)
  from unnest(p_names) as n
  where trim(n) <> '';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- O contratante só tira nomes que ele mesmo pode controlar: quem ainda não
-- chegou e não foi sinalizado pela equipe na portaria.
create or replace function public_remove_guest_entry(p_token uuid, p_entry_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from guest_list_entries
  where id = p_entry_id
    and token = p_token
    and arrived = false
    and flagged = false;
  return found;
end;
$$;

-- ---------- Avaliação pós-festa ----------

create or replace function public_get_review_link(p_token uuid)
returns table (token uuid, client_name text, unit_name text)
language sql stable security definer set search_path = public as $$
  select r.token, r.client_name, r.unit_name
  from review_links r
  where r.token = p_token;
$$;

create or replace function public_submit_party_review(
  p_token uuid,
  p_hot_dish_rating int,
  p_cake_rating int,
  p_sweets_rating int,
  p_snacks_rating int,
  p_service_rating int,
  p_comment text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from review_links where token = p_token) then
    raise exception 'Link de avaliação não encontrado';
  end if;
  -- evita o mesmo link virar canal de spam (permite reenviar se errou)
  if (select count(*) from party_reviews where token = p_token) >= 3 then
    raise exception 'Avaliação já enviada';
  end if;

  insert into party_reviews (token, hot_dish_rating, cake_rating, sweets_rating, snacks_rating, service_rating, comment)
  values (p_token, p_hot_dish_rating, p_cake_rating, p_sweets_rating, p_snacks_rating, p_service_rating, left(p_comment, 2000));
end;
$$;

revoke all on function public_get_guest_list_page(uuid) from public;

revoke all on function public_list_guest_entries(uuid) from public;

revoke all on function public_add_guest_entries(uuid, text[]) from public;

revoke all on function public_remove_guest_entry(uuid, uuid) from public;

revoke all on function public_get_review_link(uuid) from public;

revoke all on function public_submit_party_review(uuid, int, int, int, int, int, text) from public;

grant execute on function public_get_guest_list_page(uuid) to anon, authenticated;

revoke all on function public_set_guest_list_playlist(uuid, text) from public;

grant execute on function public_set_guest_list_playlist(uuid, text) to anon, authenticated;

grant execute on function public_list_guest_entries(uuid) to anon, authenticated;

grant execute on function public_add_guest_entries(uuid, text[]) to anon, authenticated;

grant execute on function public_remove_guest_entry(uuid, uuid) to anon, authenticated;

grant execute on function public_get_review_link(uuid) to anon, authenticated;

grant execute on function public_submit_party_review(uuid, int, int, int, int, int, text) to anon, authenticated;

-- =========================================================
-- Seed inicial — as duas unidades da empresa
-- =========================================================
insert into units (name, address)
values
  ('Vila Operária', null),
  ('São Vicente', null)
on conflict do nothing;

-- 1 espaço por unidade, com o mesmo nome dela (migration 011) — toda
-- reserva precisa apontar para um espaço.
insert into spaces (unit_id, name)
select u.id, u.name
from units u
where not exists (select 1 from spaces s where s.unit_id = u.id);

-- Dados da contratada (CNPJ, endereço, etc.) e planos exclusivos ficam
-- preenchidos só para São Vicente por enquanto — Vila Operária terá seu
-- próprio contrato-base e planos especificados depois.
update units set
  legal_name = 'Brava Park LIMITADA',
  cnpj = '55.747.730/0002-23',
  full_address = 'Avenida Arquiteto Nilson Edson dos Santos, Nº 991, Itajaí - SC, 88309-401',
  responsible_name = 'Evandré Ricardo Cavaco',
  pix_key = '55.747.730/0002-23',
  extra_hour_price = 500.00,
  default_deposit_percent = 30,
  google_review_link = 'https://share.google/1RLrXeYa0JxYHLvGf',
  staff_whatsapp_group_link = 'https://chat.whatsapp.com/Cubq4wnDUfQIZJd2OW4DSh?s=cl&p=i&mlu=4&ilr=4'
where name = 'São Vicente' and legal_name is null;

insert into packages (name, description, base_price, unit_id, guest_limit, duration_hours, included_items)
select
  v.nome,
  'Plano exclusivo da unidade São Vicente',
  0,
  u.id,
  v.limite,
  4,
  'Docinhos, salgados, salgadinhos, refrigerante, bolo, suco e água. Decoração temática (mediante disponibilidade do tema). Serviço de garçom e copeira. Monitoras treinadas. Brinquedos: arena de cama elástica, circuito radical, tobogã, piscina de bolinha, basquete eletrônico, fliperama e arena games.'
from units u
cross join (values
  ('Festa Completa 40 pessoas', 40),
  ('Festa Completa 50 pessoas', 50),
  ('Festa Completa 60 pessoas', 60)
) as v(nome, limite)
where u.name = 'São Vicente'
  and not exists (
    select 1 from packages p where p.unit_id = u.id and p.name = v.nome
  );

insert into contract_templates (unit_id, body)
select u.id, $body$CONTRATO DE FESTA BRAVA PARK FEST

CONTRATANTE: {{contratante_nome}}, C.P.F. nº {{contratante_cpf}}, TELEFONE {{contratante_telefone}}, ENDEREÇO {{contratante_endereco}}.

CONTRATADA: {{contratada_razao_social}}, com sede a {{contratada_endereco}}, pessoa jurídica inscrita no C.N.P.J. sob o nº {{contratada_cnpj}}.

As partes acima identificadas têm, entre si, justo e acertado o presente Contrato de Prestação de Serviços de locação de salão de festas e espaço de recreação, conforme cláusulas abaixo descritas.

Cláusula 1ª. DO OBJETO DO CONTRATO
O presente contrato tem por objeto a prestação de serviços de organização e realização de festa infantil, modalidade {{plano_nome}}, conforme descrito abaixo.
Em evento que se realizará na data de {{evento_data}}, de {{evento_hora_inicio}} horas as {{evento_hora_fim}} horas, no Brava Park Fest, na {{evento_local}}.

Cláusula 2ª. DO EVENTO E SERVIÇOS INCLUSOS
O evento, para cuja realização são contratados os serviços, é uma festa infantil estando como responsável a CONTRATANTE, e contará com a presença de até {{convidados_limite}} convidados entre adultos e crianças acima de 3 (três) anos. Crianças de 0 (zero) a 2 (dois) anos e 11 (onze) meses não serão contabilizadas.
O aniversariante chama-se {{aniversariante_nome}} ({{aniversariante_idade}} ANOS), e o tema da festa será "{{tema}}".
O pacote {{plano_nome}} inclui: {{plano_itens}}
Bebidas alcoólicas NÃO ESTÃO INCLUSAS, podendo ser adquiridas no local com custo adicional.

Cláusula 3ª. DURAÇÃO E HORÁRIO
A duração da festa será de {{evento_duracao_horas}} horas, tendo como início as {{evento_hora_inicio}}.
O tempo excedente será cobrado a parte, no valor de {{valor_hora_extra}} por hora adicional, mediante disponibilidade de agenda.

Cláusula 4ª. VALORES E CONDIÇÕES DE PAGAMENTO
O valor firmado é de {{valor_total}}, sendo pago {{valor_sinal}} via pix mediante a assinatura do contrato e o restante até a data que antecede a festa.
Chave pix: {{pix_chave}}.

Claúsula 5ª. CANCELAMENTO E ALTERAÇÃO DE DATA
Em caso de cancelamento por parte do contratante:
Até 30 dias antes da data da festa: retenção de 20% do valor total do contrato a título de custos administrativos;
Entre 15 a 29 dias antes: retenção de 50% do valor total;
Com menos de 15 dias de antecedência, não haverá devolução dos valores pagos.
Alterações de data serão permitidas apenas uma vez, mediante disponibilidade de agenda e aviso com mínimo de 15 dias de antecedência.

Claúsula 6ª. RESPONSABILIDADE POR DANOS
O contratante será responsável por quaisquer danos materiais causados as instalações, brinquedos ou equipamentos do Brava Park Fest, por ele, seus convidados ou prestadores de serviços externos contratados (fotógrafos, animadores, etc.).
O valor do conserto ou substituição será cobrado mediante orçamento emitido pela contratada.

Claúsula 7ª. REGRAS DE SEGURANÇA
A equipe do Brava Park Fest é treinada para garantir a organização e o bom funcionamento dos brinquedos, contudo, a responsabilidade pela integridade física das crianças é dos pais e/ou responsáveis.
A presença de responsáveis legais durante todo o evento é obrigatória.

Claúsula 8ª. LIMITE DE CONVIDADOS
O limite máximo de convidados é de {{convidados_limite}} pessoas, incluindo adultos e crianças.
O excedente está sujeito a cobrança adicional e a aprovação prévia da contratada.

Claúsula 9ª. OBRIGAÇÕES DA CONTRATADA (BRAVA PARK FEST)
A CONTRATADA se compromete a:
Disponibilizar o espaço em perfeitas condições de uso, limpeza e segurança na data e horário contratados;
Fornecer todos os itens descritos no pacote {{plano_nome}}, conforme a cláusula 2;
Garantir a presença de monitoras treinadas, durante todo o evento, zelando pela boa utilização dos brinquedos;
Assegurar que os equipamentos e brinquedos estejam em conformidade com as normas de segurança aplicáveis;
Cumprir rigorosamente o horário acordado e prestar suporte durante o evento;
Realizar a montagem da decoração conforme o tema escolhido e disponível.

Claúsula 10ª. OBRIGAÇÕES DA CONTRATANTE
O CONTRATANTE se compromete a:
Efetuar os pagamentos conforme as condições estabelecidas na cláusula 4;
Comparecer ou garantir o acesso ao espaço na data e horários agendados;
Respeitar os horários de início e término da festa, bem como as regras internas do Brava Park Fest;
Zelar pela boa conservação do espaço e equipamentos, responsabilizando-se por danos causados por si, seus convidados ou prestadores externos;
Garantir a presença de pais ou responsáveis legais pelas crianças durante todo o evento;
Não realizar a entrada de bebidas alcoólicas, comidas, decorações ou equipamentos externos sem prévia autorização da contratada.
Respeitar o limite máximo de {{convidados_limite}} pessoas no evento.

Claúsula 11ª. RESCISÃO CONTRATUAL
O presente contrato poderá ser rescindido por qualquer das partes em caso de descumprimento de cláusulas aqui previstas.
Em caso de rescisão por parte do contratante após a confirmação da reserva, aplicam-se as penalidades descritas na cláusula 5 (cancelamento).
A contratada reserva-se o direito de rescindir o contrato, com restituição integral dos valores pagos, em casos de força maior que impeçam a realização do evento (como desastres naturais, problemas estruturais ou determinações legais).

Clausula 12ª. AUTORIZAÇÃO DO USO DE IMAGEM
O CONTRATANTE autoriza, de forma gratuita, por prazo indeterminado, a captação, utilização, reprodução e divulgação de fotografias, vídeos e demais registros audiovisuais realizados durante o evento pela CONTRATADA.
A presente autorização destina-se exclusivamente a divulgação institucional e comercial da CONTRATADA, podendo as imagens ser utilizadas em redes sociais, website, materiais publicitários, campanhas promocionais, portfólio, apresentações comerciais e demais meios de comunicação, impressos ou digitais.
Caso o CONTRATANTE não concorde com a utilização das imagens para os fins acima descritos, deverá manifestar sua oposição por escrito a CONTRATADA antes da realização do evento, ficando a CONTRATADA obrigada a respeitar tal decisão.

Claúsula 13ª. DO FORO
Para dirimir quaisquer controvérsias oriundas deste contrato, as partes elegem o foro da comarca de Itajaí/SC, com renúncia expressa a qualquer outro, por mais privilegiado que seja.

E por estarem assim justas e contratadas, firmam o presente contrato em duas vias de igual teor.

Itajaí, {{data_geracao}}

{{contratada_responsavel}}
BRAVA PARK FEST — CNPJ {{contratada_cnpj}}

CONTRATANTE: {{contratante_nome}} — CPF {{contratante_cpf}}$body$
from units u
where u.name = 'São Vicente'
on conflict (unit_id) do nothing;

-- Dados da contratada e template — Vila Operária (segunda unidade, contrato
-- real enviado). Os planos/preços ficam de fora por enquanto — dependem do
-- portfólio que o usuário ainda vai enviar.
update units set
  legal_name = 'Brava Park LIMITADA',
  cnpj = '55.747.730/0001-42',
  full_address = 'Rua Duque de Caxias, Nº 295, Vila Operária, Itajaí - SC, 88303-230',
  responsible_name = 'Evandré Ricardo Cavaco',
  pix_key = '55.747.730/0001-42',
  extra_hour_price = 750.00,
  google_review_link = 'https://share.google/o91H4PhuvDhdI8Z48',
  staff_whatsapp_group_link = 'https://chat.whatsapp.com/Gb2XWzFPbkT2qS8SfxggZz?s=cl&p=i&mlu=4&ilr=4'
where name = 'Vila Operária' and legal_name is null;

insert into contract_templates (unit_id, body)
select u.id, $body$CONTRATO DE FESTA BRAVA PARK FEST

CONTRATANTE: {{contratante_nome}}, C.P.F. nº {{contratante_cpf}}, TELEFONE {{contratante_telefone}}, ENDEREÇO {{contratante_endereco}}.

CONTRATADA: {{contratada_razao_social}}, com sede a {{contratada_endereco}}, pessoa jurídica inscrita no C.N.P.J. sob o nº {{contratada_cnpj}}.

As partes acima identificadas têm, entre si, justo e acertado o presente Contrato de Prestação de Serviços de locação de salão de festas e espaço de recreação, conforme cláusulas abaixo descritas.

Cláusula 1ª. DO OBJETO DO CONTRATO
O presente contrato tem por objeto a prestação de serviços de organização e realização de festa infantil, modalidade {{plano_nome}}, conforme descrito abaixo.
Em evento que se realizará na data de {{evento_data}}, de {{evento_hora_inicio}} horas as {{evento_hora_fim}} horas, no Brava Park Fest, na {{evento_local}}.

Cláusula 2ª. DO EVENTO E SERVIÇOS INCLUSOS
O evento, para cuja realização são contratados os serviços, é uma festa infantil estando como responsável a CONTRATANTE, e contará com a presença de até {{convidados_limite}} convidados entre adultos e crianças.
{{convidados_cortesia_paragrafo}}
O aniversariante chama-se {{aniversariante_nome}} ({{aniversariante_idade}} ANOS), e o tema da festa será "{{tema}}".
O pacote {{plano_nome}} inclui: {{plano_itens}}
Bebidas alcoólicas NÃO ESTÃO INCLUSAS, podendo ser adquiridas no local com custo adicional.

Cláusula 3ª. DURAÇÃO E HORÁRIO
A duração da festa será de {{evento_duracao_horas}} horas, tendo como início as {{evento_hora_inicio}}.
O tempo excedente será cobrado a parte, no valor de {{valor_hora_extra}} por hora adicional, sendo disponibilizado o espaço completo, equipe e bebidas não alcoólicas mediante disponibilidade de agenda.

Cláusula 4ª. VALORES E CONDIÇÕES DE PAGAMENTO
O valor firmado é de {{valor_total}}, sendo pago {{valor_sinal}} via pix mediante a assinatura do contrato.
Chave pix: {{pix_chave}}

Claúsula 5ª. CANCELAMENTO E ALTERAÇÃO DE DATA
Em caso de cancelamento por parte do contratante:
Até 30 dias antes da data da festa: retenção de 20% do valor total do contrato a título de custos administrativos;
Entre 15 a 29 dias antes: retenção de 50% do valor total;
Com menos de 15 dias de antecedência, não haverá devolução dos valores pagos.
Alterações de data serão permitidas apenas uma vez, mediante disponibilidade de agenda e aviso com mínimo de 15 dias de antecedência.

Claúsula 6ª. RESPONSABILIDADE POR DANOS
O contratante será responsável por quaisquer danos materiais causados as instalações, brinquedos ou equipamentos do Brava Park Fest, por ele, seus convidados ou prestadores de servições externos contratados (fotógrafos, animadores, etc.).
O valor do conserto ou substituição será cobrado mediante orçamento emitido pela contratada.

Claúsula 7ª. REGRAS DE SEGURANÇA
A equipe do Brava Park Fest é treinada para garantir a organização e o bom funcionamento dos brinquedos, contudo, a responsabilidade pela integridade física das crianças é dos pais e/ou responsáveis.
A presença de responsáveis legais durante todo o evento é obrigatória.

Claúsula 8ª. LIMITE DE CONVIDADOS
O limite máximo de convidados é de {{convidados_limite_clausula8}} pessoas incluindo adultos e crianças.
O excedente está sujeito a cobrança adicional e a aprovação prévia da contratada.

Claúsula 9ª. OBRIGAÇÕES DA CONTRATADA (BRAVA PARK FEST)
A CONTRATADA se compromete a:
Disponibilizar o espaço em perfeitas condições de uso, limpeza e segurança na data e horário contratados;
Fornecer todos os itens descritos no pacote {{plano_nome}}, conforme a cláusula 2;
Garantir a presença de monitoras treinadas, durante todo o evento, zelando pela boa utilização dos brinquedos;
Assegurar que os equipamentos e brinquedos estejam em conformidade com as normas de segurança aplicáveis;
Cumprir rigorosamente o horário acordado e prestar suporte durante o evento;
Realizar a montagem da decoração conforme o tema escolhido e disponível.

Claúsula 10ª. OBRIGAÇÕES DA CONTRATANTE
O CONTRATANTE se compromete a:
Efetuar os pagamentos conforme as condições estabelecidas na cláusula 4;
Comparecer ou garantir o acesso ao espaço na data e horários agendados;
Respeitar os horários de início e término da festa, bem como as regras internas do Brava Park Fest;
Zelar pela boa conservação do espaço e equipamentos, responsabilizando-se por danos causados por si, seus convidados ou prestadores externos;
Garantir a presença de pais ou responsáveis legais pelas crianças durante todo o evento;
Não realizar a entrada de bebidas alcoólicas, comidas, decorações ou equipamentos externos sem prévia autorização da contratada.

Claúsula 11ª. RESCISÃO CONTRATUAL
O presente contrato poderá ser rescindido por qualquer das partes em caso de descumprimento de cláusulas aqui previstas.
Em caso de rescisão por parte do contratante após a confirmação da reserva, aplicam-se as penalidades descritas na cláusula 5 (cancelamento).
A contratada reserva-se o direito de rescindir o contrato, com restituição integral dos valores pagos, em casos de força maior que impeçam a realização do evento (como desastres naturais, problemas estruturais ou determinações legais).

Claúsula 12ª. DO FORO
Para dirimir quaisquer controvérsias oriundas deste contrato, as partes elegem o foro da comarca de Itajaí/SC, com renúncia expressa a qualquer outro, por mais privilegiado que seja.

E por estarem assim justas e contratadas, firmam o presente contrato em duas vias de igual teor.

Itajaí, {{data_geracao}}

{{contratada_responsavel}}
BRAVA PARK FEST — CNPJ {{contratada_cnpj}}

CONTRATANTE: {{contratante_nome}} — CPF {{contratante_cpf}}$body$
from units u
where u.name = 'Vila Operária'
on conflict (unit_id) do nothing;

commit;
