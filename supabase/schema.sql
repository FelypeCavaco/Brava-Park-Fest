-- =========================================================
-- Brava Park Fest — Schema do banco de dados (Supabase/Postgres)
-- Rode este arquivo no SQL Editor do seu projeto Supabase.
-- =========================================================

-- Extensão para gerar UUID
create extension if not exists "pgcrypto";

-- ---------- Usuários e permissões ----------
-- Login e senha são controlados pelo Supabase Auth (criados manualmente pelo
-- administrador em Authentication > Users). Perfis de acesso (Administrador,
-- Financeiro, Comercial, Operacional, e quantos outros o dono quiser criar,
-- ex: "Recepção") são totalmente dinâmicos — cadastrados/editados pela tela
-- de Usuários e permissões, não fixos no banco.
create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_admin boolean not null default false, -- perfil com acesso total, nunca passa por checagem de permissão
  created_at timestamptz not null default now()
);

create table if not exists user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text,
  role_id uuid references roles(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Permissões por perfil + ajuste individual ----------
-- Cada página e cada ação/botão sensível vira uma "chave de permissão"
-- (permission_key) ligada/desligada por perfil na tela de Usuários e
-- permissões. Pra quando duas pessoas do mesmo perfil precisarem de acessos
-- diferentes, dá pra fazer um ajuste pontual só numa pessoa
-- (user_permission_overrides), que sempre vence o que o perfil dela diz.
create table if not exists role_permission_items (
  role_id uuid not null references roles(id) on delete cascade,
  permission_key text not null,
  allowed boolean not null default true,
  primary key (role_id, permission_key)
);

create table if not exists user_permission_overrides (
  user_id uuid not null references user_profiles(id) on delete cascade,
  permission_key text not null,
  allowed boolean not null default true,
  primary key (user_id, permission_key)
);

alter table roles enable row level security;
alter table role_permission_items enable row level security;
alter table user_permission_overrides enable row level security;

-- Checa se alguém é administrador com privilégio elevado (dono da tabela,
-- que não passa pelas próprias políticas de segurança) — evitando que uma
-- política em "roles" precise reconsultar "roles" e cause loop infinito.
create or replace function is_admin_user(check_id uuid) returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from user_profiles up
    join roles r on r.id = up.role_id
    where up.id = check_id and r.is_admin and up.active
  );
$$;

revoke all on function is_admin_user(uuid) from public, anon;
grant execute on function is_admin_user(uuid) to authenticated;

-- Checa se um usuário (qualquer perfil, não só administrador) está ativo —
-- usada nas políticas de todas as tabelas pra cortar acesso na hora de
-- quem foi desativado, mesmo que o token de sessão dele ainda seja válido.
create or replace function is_active_user(check_id uuid) returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select active from user_profiles where id = check_id), false);
$$;

revoke all on function is_active_user(uuid) from public, anon;
grant execute on function is_active_user(uuid) to authenticated;

create policy "authenticated_read" on roles
  for select using (auth.role() = 'authenticated');
create policy "administrador_write" on roles
  for all using (is_admin_user(auth.uid())) with check (is_admin_user(auth.uid()));

create policy "authenticated_read" on role_permission_items
  for select using (auth.role() = 'authenticated');
create policy "administrador_write" on role_permission_items
  for all using (is_admin_user(auth.uid())) with check (is_admin_user(auth.uid()));

create policy "self_or_admin_read" on user_permission_overrides
  for select using (user_id = auth.uid() or is_admin_user(auth.uid()));
create policy "administrador_write" on user_permission_overrides
  for all using (is_admin_user(auth.uid())) with check (is_admin_user(auth.uid()));

-- ---------- Auditoria ----------
-- Registro de criação/alteração/cancelamento/exclusão de informações
-- importantes (reservas, contratos, pagamentos). Popule via trigger no banco
-- ou diretamente pela aplicação ao salvar cada ação sensível.
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  action text not null, -- ex: 'criou', 'alterou', 'cancelou', 'excluiu'
  entity text not null, -- ex: 'reservation', 'contract', 'payment'
  entity_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_entity on audit_log (entity, entity_id);

-- ---------- Unidades ----------
-- A empresa opera mais de uma casa de festas (ex: Vila Operária, São Vicente).
-- Espaços, reservas e o gasto de marketing são sempre vinculados a uma unidade;
-- clientes são compartilhados entre unidades (mesmo cadastro, podem fechar
-- festa em qualquer uma).
create table if not exists units (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  active boolean not null default true,
  -- dados da contratada, usados na geração do contrato (preenchidos por
  -- unidade, já que cada casa de festas tem seu próprio CNPJ/endereço)
  legal_name text,
  cnpj text,
  full_address text,
  responsible_name text,
  pix_key text,
  extra_hour_price numeric(10,2),
  default_deposit_percent numeric(5,2),
  google_review_link text, -- link de avaliação do Google, usado no pedido pós-festa
  staff_whatsapp_group_link text, -- grupo de WhatsApp com os fornecedores/prestadores desta unidade
  created_at timestamptz not null default now()
);

-- ---------- Espaços/salões ----------
create table if not exists spaces (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete cascade,
  name text not null,
  capacity int,
  description text,
  buffer_minutes int not null default 60, -- tempo mínimo entre eventos, para montagem/desmontagem
  availability_notes text, -- regras específicas de disponibilidade deste espaço, se houver
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_spaces_unit on spaces (unit_id);

-- ---------- Clientes ----------
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  birthday date,
  notes text,
  is_loyalty boolean not null default false,
  -- fidelidade por pontos, indicação e dados para reativação (CRM)
  loyalty_points numeric(10,2) not null default 0,
  referred_by uuid references clients(id),
  referral_discount_status text, -- 'pendente', 'aplicado'
  child_name text,
  child_birthday date,
  last_party_date date,
  total_spent numeric(10,2) not null default 0,
  last_commercial_contact date,
  reactivation_status text not null default 'nova_oportunidade',
  -- 'nova_oportunidade', 'contatado', 'negociacao', 'nova_reserva', 'sem_interesse'
  -- dados estruturados exigidos no contrato (CPF e endereço completo)
  cpf text,
  cep text,
  street text,
  address_number text,
  neighborhood text,
  city text,
  state text,
  source text, -- de onde veio o cliente: 'instagram', 'google', 'facebook', 'indicacao', 'outro'
  created_at timestamptz not null default now()
);

-- ---------- Agenda de visitas ao espaço ----------
create table if not exists visits (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  unit_id uuid not null references units(id),
  space_name text,
  scheduled_at timestamptz not null,
  responsible text,
  result text, -- 'virou_orcamento', 'nao_avancou'
  no_advance_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_visits_unit on visits (unit_id);

-- ---------- Histórico de contato (WhatsApp e futuros canais) ----------
create table if not exists contact_history (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  type text not null,
  channel text not null default 'whatsapp',
  user_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_contact_history_client on contact_history (client_name);

-- ---------- Fornecedores e avaliação pós-evento ----------
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  service_type text not null,
  contact text,
  default_price numeric(10,2),
  rating numeric(2,1),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists supplier_bookings (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id) on delete cascade,
  reservation_id uuid references reservations(id) on delete set null,
  amount numeric(10,2) not null,
  evaluation_note text,
  evaluation_rating int check (evaluation_rating between 1 and 5),
  created_at timestamptz not null default now()
);

create index if not exists idx_supplier_bookings_supplier on supplier_bookings (supplier_id);

-- ---------- Leads / Funil de conversão ----------
create type lead_status as enum ('orcamento', 'negociacao', 'fechado', 'perdido');
create type lead_source as enum ('instagram', 'google', 'facebook', 'indicacao', 'outro');

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  unit_id uuid references units(id),
  source lead_source not null default 'outro',
  status lead_status not null default 'orcamento',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Pacotes ----------
create table if not exists packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  base_price numeric(10,2) not null default 0,
  active boolean not null default true,
  -- pacotes podem pertencer a uma unidade específica (planos e inclusos
  -- diferentes por casa de festas); null = disponível para qualquer unidade
  unit_id uuid references units(id),
  guest_limit int,
  duration_hours numeric(4,1),
  included_items text,
  -- preço muda por dia da semana (seg-qui x sex-dom); base_price fica como
  -- referência/fallback para pacotes sem essa distinção
  weekday_price numeric(10,2),
  weekend_price numeric(10,2),
  created_at timestamptz not null default now()
);

create index if not exists idx_packages_unit on packages (unit_id);

-- ---------- Itens extras (catálogo) ----------
create table if not exists extra_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(10,2) not null default 0,
  active boolean not null default true
);

-- ---------- Ficha técnica: custo estimado por categoria, por pacote ----------
create table if not exists package_costs (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  category text not null, -- 'Alimentos', 'Bebidas', 'Equipe', 'Decoração', 'Outros'
  amount numeric(10,2) not null default 0
);

create index if not exists idx_package_costs_package on package_costs (package_id);

-- ---------- Reservas ----------
create type reservation_status as enum (
  'orcamento', 'confirmada', 'sinal_pago', 'quitada', 'cancelada'
);

create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id),
  client_id uuid not null references clients(id) on delete cascade,
  space_id uuid not null references spaces(id),
  package_id uuid references packages(id),
  lead_id uuid references leads(id) on delete set null,
  event_date date not null,
  start_time time not null,
  end_time time not null,
  status reservation_status not null default 'orcamento',
  total_value numeric(10,2) not null default 0,
  notes text,
  event_type text, -- ex: 'Aniversário infantil', 'Debutante', 'Casamento', 'Corporativo'
  guest_count int,
  -- dados do evento usados no contrato
  child_name text,
  child_age int,
  theme text,
  hot_dish_flavors text, -- sabores dos pratos quentes escolhidos, separados por "/" (a qtd de pratos varia com o plano)
  cake_flavor text,
  -- desconto sobre o valor cheio do pacote + extras (total_value)
  discount_type text check (discount_type in ('percentual', 'valor_fixo')),
  discount_value numeric(10,2),
  final_value numeric(10,2) not null default 0, -- valor firmado, já com desconto aplicado
  courtesy_guests int, -- convidados de cortesia (promoções pontuais, por reserva — não é do pacote)
  -- cancelamento
  cancellation_reason text,
  cancellation_fee_percent numeric(5,2),
  refund_amount numeric(10,2),
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_reservations_space_date on reservations (space_id, event_date);
create index if not exists idx_reservations_unit on reservations (unit_id);

-- Só pode ter 2 festas na mesma unidade/data se uma delas estiver cancelada
-- (não conta mais como ocupando a data).
create unique index if not exists idx_reservations_unit_date_ativa
  on reservations (unit_id, event_date)
  where status <> 'cancelada';

-- Festas com mais de um aniversariante (ex: irmãos fazendo festa junta) — o
-- primeiro continua em reservations.child_name/child_age, esta tabela
-- guarda só os adicionais.
create table if not exists reservation_birthday_kids (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  name text not null,
  age int,
  created_at timestamptz not null default now()
);

create index if not exists idx_reservation_birthday_kids_reservation on reservation_birthday_kids (reservation_id);

-- ---------- Lista de espera ----------
-- Quando um cliente quer uma data/espaço já ocupado, fica registrado aqui até
-- surgir vaga (cancelamento) ou o cliente escolher outra data.
create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  space_id uuid references spaces(id),
  desired_date date not null,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------- Itens extras vinculados a uma reserva ----------
create table if not exists reservation_extra_items (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  extra_item_id uuid references extra_items(id),
  quantity int not null default 1,
  price_snapshot numeric(10,2) not null
);

-- ---------- Contratos ----------
create table if not exists contracts (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  terms_text text,
  pdf_url text,
  generated_at timestamptz,
  nfe_number text,
  nfe_status text not null default 'nao_emitida' -- 'nao_emitida', 'emitida', 'cancelada'
);

-- ---------- Pagamentos (pagamentos flexíveis — lançamentos recebidos) ----------
-- Não existe cronograma fixo de parcelas: cada linha é um valor
-- efetivamente recebido, numa data livre, por qualquer forma de
-- pagamento. Saldo devedor = reservations.final_value − soma dos
-- pagamentos da reserva (calculado sempre na hora, nunca guardado).
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  amount numeric(10,2) not null,
  payment_date date not null default current_date,
  payment_method text, -- 'pix', 'cartao_credito', 'cartao_debito', 'dinheiro', 'boleto', 'transferencia', 'outro'
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_payments_reservation on payments (reservation_id);

-- Taxa da maquininha por forma de pagamento, editável pela tela de
-- Pagamentos (antes era fixa no código).
create table if not exists payment_method_fees (
  payment_method text primary key,
  fee_percent numeric(5,2) not null default 0
);

insert into payment_method_fees (payment_method, fee_percent) values
  ('pix', 0),
  ('cartao_credito', 3.5),
  ('cartao_debito', 1.5),
  ('dinheiro', 0),
  ('boleto', 1.9),
  ('transferencia', 0),
  ('outro', 0)
on conflict (payment_method) do nothing;

-- ---------- Templates de contrato (um texto-base por unidade) ----------
-- O texto com variáveis {{...}} fica aqui, editável na tela de Contratos.
-- contracts.terms_text guarda o resultado já preenchido de cada reserva —
-- se o template mudar depois, contratos já gerados não são alterados.
create table if not exists contract_templates (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null unique references units(id) on delete cascade,
  body text not null,
  updated_at timestamptz not null default now()
);

-- Mensagens de WhatsApp editáveis pelo dono, sem precisar mexer em código
-- (ex: "confirmar_fornecedores"). Se a chave não existir, o app usa um
-- texto padrão fixo como reserva.
create table if not exists message_templates (
  key text primary key,
  body text not null,
  updated_at timestamptz not null default now()
);

-- ---------- Checklist de preparação por festa ----------
create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  description text not null,
  done boolean not null default false,
  due_date date, -- prazo da tarefa, editável por item (padrão sugerido: 7 dias antes da festa)
  unique (reservation_id, description)
);

-- ---------- Escala de funcionários por evento ----------
create table if not exists staff_assignments (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  staff_name text not null,
  role text
);

-- ---------- Gasto mensal com tráfego pago (para cálculo de CAC) ----------
create table if not exists marketing_spend (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id),
  month date not null, -- salvar sempre como primeiro dia do mês (ex: 2026-09-01)
  amount numeric(10,2) not null default 0,
  notes text,
  unique (unit_id, month)
);

-- ---------- Despesas / Contas a pagar ----------
-- Categoria fica como texto livre (não enum) de propósito: é mais fácil
-- acrescentar uma categoria nova no futuro sem precisar alterar o banco.
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id),
  category text not null, -- ex: 'Aluguel', 'Folha de pagamento', 'Fornecedores', 'Manutenção', 'Marketing', 'Impostos', 'Outros'
  description text,
  supplier text,
  amount numeric(10,2) not null,
  due_date date not null,
  paid_date date,
  status text not null default 'a_vencer', -- 'a_vencer', 'pago', 'atrasado', 'cancelado'
  payment_method text, -- preenchido quando marcada como paga
  recurring_expense_id uuid, -- referencia recurring_expenses(id); FK criada mais abaixo, depois da tabela existir
  created_at timestamptz not null default now()
);

create index if not exists idx_expenses_unit_date on expenses (unit_id, due_date);

-- ---------- Despesas fixas recorrentes (aluguel, folha de pagamento, etc.) ----------
-- É só o "molde" (valor, categoria, dia do vencimento). O lançamento de
-- verdade em `expenses` (que pode ser marcado como pago, aparece como
-- pendente/vencido, etc.) é gerado sozinho todo mês pela função
-- `ensure_recurring_expenses_current_month()`, chamada ao abrir o Painel ou
-- o Financeiro — não depende de pg_cron nem Edge Function agendada.
create table if not exists recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id),
  category text not null,
  description text not null,
  amount numeric(10,2) not null,
  day_of_month int not null default 5,
  active boolean not null default true,
  -- primeiro mês (dia 1) em que deve gerar lançamento — nulo = já vale desde
  -- já; preenchido quando a pessoa escolhe "só começar a valer mês que vem".
  first_charge_month date,
  created_at timestamptz not null default now()
);

create index if not exists idx_recurring_expenses_unit on recurring_expenses (unit_id);

alter table expenses add constraint expenses_recurring_expense_id_fkey
  foreign key (recurring_expense_id) references recurring_expenses(id) on delete set null;
create index if not exists idx_expenses_recurring on expenses (recurring_expense_id);

create or replace function ensure_recurring_expenses_current_month() returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_month_start date := date_trunc('month', current_date)::date;
  v_days_in_month int := extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'))::int;
  v_due_date date;
begin
  for r in select * from recurring_expenses where active loop
    if r.first_charge_month is not null and v_month_start < r.first_charge_month then
      continue;
    end if;

    if exists (
      select 1 from expenses
      where recurring_expense_id = r.id
        and due_date >= v_month_start
        and due_date < (v_month_start + interval '1 month')
    ) then
      continue;
    end if;

    v_due_date := (v_month_start + (least(r.day_of_month, v_days_in_month) - 1) * interval '1 day')::date;

    insert into expenses (unit_id, category, description, amount, due_date, status, recurring_expense_id)
    values (r.unit_id, r.category, r.description, r.amount, v_due_date, 'a_vencer', r.id);
  end loop;
end;
$$;

revoke all on function ensure_recurring_expenses_current_month() from public, anon;
grant execute on function ensure_recurring_expenses_current_month() to authenticated;

-- ---------- Custos de uma festa específica (para calcular lucro real por festa) ----------
create table if not exists reservation_costs (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  description text not null, -- ex: 'Buffet', 'Decoração', 'Equipe extra', 'DJ'
  amount numeric(10,2) not null
);

create index if not exists idx_reservation_costs_reservation on reservation_costs (reservation_id);

-- ---------- Consumo avulso da festa (ex: chopp cobrado por litro, fechado no final) ----------
create table if not exists reservation_consumption (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  item text not null,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(10,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_reservation_consumption_reservation on reservation_consumption (reservation_id);

-- ---------- Estoque de insumos ----------
-- Controla a quantidade de cada insumo por unidade, para saber o que precisa
-- ser comprado (quantidade abaixo de minimum_quantity).
create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id),
  name text not null,
  category text not null default 'Outros', -- ex: 'Buffet e bebidas', 'Descartáveis', 'Decoração', 'Limpeza', 'Manutenção', 'Outros'
  unit_of_measure text not null default 'un', -- ex: 'un', 'kg', 'litro', 'pacote', 'caixa'
  quantity numeric(10,2) not null default 0,
  minimum_quantity numeric(10,2) not null default 0,
  -- quando preenchido, o mínimo "de verdade" no dia passa a ser
  -- quantity_per_guest × convidados das festas daquele dia (o que for maior
  -- entre esse cálculo e minimum_quantity)
  quantity_per_guest numeric(10,4),
  supplier text,
  updated_at timestamptz not null default now()
);

-- Itens comprados em tamanhos variados (ex: suco em garrafa de 1,5L/3L/5L)
-- mas controlados no estoque numa unidade só (ex: litros) — na hora da
-- compra escolhe o tamanho + quantas garrafas, converte pra a unidade do
-- item sozinho.
create table if not exists inventory_purchase_variants (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  label text not null,
  volume_amount numeric(10, 3) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_purchase_variants_item on inventory_purchase_variants (inventory_item_id);

create index if not exists idx_inventory_items_unit on inventory_items (unit_id);

-- ---------- Metas de faturamento por unidade ----------
create table if not exists unit_goals (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id),
  month date not null, -- salvar sempre como primeiro dia do mês (ex: 2026-09-01)
  goal_amount numeric(10,2) not null default 0,
  unique (unit_id, month)
);

-- ---------- Propostas comerciais ----------
create table if not exists proposals (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id),
  client_name text not null, -- TODO: trocar por client_id quando os clientes forem reais
  event_date date,
  package_id uuid references packages(id),
  extra_items jsonb,
  total_value numeric(10,2) not null default 0,
  status text not null default 'enviada', -- 'enviada', 'aceita', 'recusada'
  decline_reason text, -- preenchido quando status = 'recusada'
  created_at timestamptz not null default now()
);

create index if not exists idx_proposals_unit on proposals (unit_id);

-- ---------- Pesquisa de satisfação (NPS) ----------
create table if not exists nps_responses (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references reservations(id) on delete set null,
  client_name text not null,
  score int not null check (score >= 0 and score <= 10),
  comment text,
  created_at timestamptz not null default now()
);

-- ---------- Lista de convidados enviada pelo contratante (link público) ----------
-- Tabelas separadas das reservas de propósito: a página pública (sem login)
-- só pode enxergar dados leves (data, tema, nome do aniversariante, unidade),
-- nunca telefone, CPF ou valores.
create table if not exists guest_list_pages (
  token uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade unique,
  unit_name text not null,
  event_date date not null,
  theme text,
  child_name text,
  guest_limit int,
  created_at timestamptz not null default now()
);

create table if not exists guest_list_entries (
  id uuid primary key default gen_random_uuid(),
  token uuid not null references guest_list_pages(token) on delete cascade,
  name text not null,
  arrived boolean not null default false, -- check-in feito pela equipe na portaria
  arrived_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_guest_list_entries_token on guest_list_entries (token);

-- ---------- Avaliação pós-festa por link público (mesmo molde acima) ----------
create table if not exists review_links (
  token uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade unique,
  client_name text not null,
  unit_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists party_reviews (
  id uuid primary key default gen_random_uuid(),
  token uuid not null references review_links(token) on delete cascade,
  hot_dish_rating int check (hot_dish_rating between 1 and 5),
  cake_rating int check (cake_rating between 1 and 5),
  sweets_rating int check (sweets_rating between 1 and 5),
  snacks_rating int check (snacks_rating between 1 and 5),
  service_rating int check (service_rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists idx_party_reviews_token on party_reviews (token);

-- ---------- Documentos da festa (arquivo em si fica no Supabase Storage) ----------
insert into storage.buckets (id, name, public)
values ('festa-documentos', 'festa-documentos', false)
on conflict (id) do nothing;

create table if not exists reservation_documents (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_reservation_documents_reservation on reservation_documents (reservation_id);

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'festa_documentos_select') then
    create policy "festa_documentos_select" on storage.objects for select to authenticated using (bucket_id = 'festa-documentos');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'festa_documentos_insert') then
    create policy "festa_documentos_insert" on storage.objects for insert to authenticated with check (bucket_id = 'festa-documentos');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'festa_documentos_delete') then
    create policy "festa_documentos_delete" on storage.objects for delete to authenticated using (bucket_id = 'festa-documentos');
  end if;
end $$;

-- ---------- Checklist de consumo pós-festa (debita do estoque da unidade) ----------
create table if not exists reservation_stock_consumption (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  inventory_item_id uuid references inventory_items(id) on delete set null,
  item_name text not null,
  quantity numeric(10,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_reservation_stock_consumption_reservation on reservation_stock_consumption (reservation_id);

-- Lança o consumo e debita o estoque na mesma operação; desfaz devolve a
-- quantidade ao estoque. Só a equipe logada pode chamar (grants abaixo).
create or replace function record_stock_consumption(
  p_reservation_id uuid,
  p_inventory_item_id uuid,
  p_item_name text,
  p_quantity numeric
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into reservation_stock_consumption (reservation_id, inventory_item_id, item_name, quantity)
  values (p_reservation_id, p_inventory_item_id, p_item_name, p_quantity)
  returning id into v_id;

  if p_inventory_item_id is not null then
    update inventory_items
    set quantity = greatest(0, quantity - p_quantity), updated_at = now()
    where id = p_inventory_item_id;
  end if;

  return v_id;
end;
$$;

create or replace function undo_stock_consumption(p_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
  v_qty numeric;
begin
  select inventory_item_id, quantity into v_item_id, v_qty from reservation_stock_consumption where id = p_id;

  if v_item_id is not null then
    update inventory_items set quantity = quantity + v_qty, updated_at = now() where id = v_item_id;
  end if;

  delete from reservation_stock_consumption where id = p_id;
end;
$$;

revoke all on function record_stock_consumption(uuid, uuid, text, numeric) from public, anon;
grant execute on function record_stock_consumption(uuid, uuid, text, numeric) to authenticated;

revoke all on function undo_stock_consumption(uuid) from public, anon;
grant execute on function undo_stock_consumption(uuid) to authenticated;

-- ---------- Compra de insumos (soma no estoque, espelha o consumo pós-festa) ----------
create table if not exists expense_items (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses(id) on delete cascade,
  inventory_item_id uuid references inventory_items(id) on delete set null,
  item_name text not null,
  quantity numeric(10,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_expense_items_expense on expense_items (expense_id);

create or replace function record_stock_purchase(
  p_expense_id uuid,
  p_inventory_item_id uuid,
  p_item_name text,
  p_quantity numeric
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into expense_items (expense_id, inventory_item_id, item_name, quantity)
  values (p_expense_id, p_inventory_item_id, p_item_name, p_quantity)
  returning id into v_id;

  if p_inventory_item_id is not null then
    update inventory_items
    set quantity = quantity + p_quantity, updated_at = now()
    where id = p_inventory_item_id;
  end if;

  return v_id;
end;
$$;

create or replace function undo_stock_purchase(p_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
  v_qty numeric;
begin
  select inventory_item_id, quantity into v_item_id, v_qty from expense_items where id = p_id;

  if v_item_id is not null then
    update inventory_items set quantity = greatest(0, quantity - v_qty), updated_at = now() where id = v_item_id;
  end if;

  delete from expense_items where id = p_id;
end;
$$;

revoke all on function record_stock_purchase(uuid, uuid, text, numeric) from public, anon;
grant execute on function record_stock_purchase(uuid, uuid, text, numeric) to authenticated;

revoke all on function undo_stock_purchase(uuid) from public, anon;
grant execute on function undo_stock_purchase(uuid) to authenticated;

-- =========================================================
-- Row Level Security — cada tabela checa a permissão de verdade (não só
-- escondendo botão no front-end), via `has_permission()`/`is_admin_user()`/
-- `is_active_user()`, mapeada pra chave de permissão da tela/ação
-- correspondente (ver src/lib/permissionRegistry.ts). Leitura fica ampla
-- (qualquer usuário ativo) nas tabelas consultadas por vários módulos
-- diferentes ao mesmo tempo (ex: reservations, clients, expenses, payments)
-- — restringir a leitura delas exigiria separar "resumo agregado" de "dado
-- bruto" em RPCs próprias, o que ainda não foi feito; ver documentação para
-- esse próximo passo. Escrita (insert/update/delete) é sempre restrita pela
-- permissão específica da ação. Corresponde às migrations 045 (fecha a
-- escalação de privilégio de user_profiles) e 046 (RBAC fail-closed nas
-- demais tabelas).
-- =========================================================
alter table units enable row level security;
alter table user_profiles enable row level security;
alter table audit_log enable row level security;
alter table waitlist enable row level security;
alter table spaces enable row level security;
alter table clients enable row level security;
alter table leads enable row level security;
alter table packages enable row level security;
alter table extra_items enable row level security;
alter table reservations enable row level security;
alter table reservation_extra_items enable row level security;
alter table contracts enable row level security;
alter table payments enable row level security;
alter table checklist_items enable row level security;
alter table staff_assignments enable row level security;
alter table marketing_spend enable row level security;
alter table expenses enable row level security;
alter table reservation_costs enable row level security;
alter table inventory_items enable row level security;
alter table recurring_expenses enable row level security;
alter table unit_goals enable row level security;
alter table proposals enable row level security;
alter table nps_responses enable row level security;
alter table reservation_consumption enable row level security;
alter table package_costs enable row level security;
alter table visits enable row level security;
alter table contact_history enable row level security;
alter table suppliers enable row level security;
alter table supplier_bookings enable row level security;
alter table contract_templates enable row level security;
alter table guest_list_pages enable row level security;
alter table guest_list_entries enable row level security;
alter table reservation_documents enable row level security;
alter table reservation_stock_consumption enable row level security;
alter table expense_items enable row level security;
alter table inventory_purchase_variants enable row level security;
alter table message_templates enable row level security;
alter table reservation_birthday_kids enable row level security;
alter table payment_method_fees enable row level security;
alter table review_links enable row level security;
alter table party_reviews enable row level security;

-- RBAC de verdade, aplicado no banco (não só escondendo botão no
-- front-end) — cada tabela abaixo tem sua política mapeada pra chave de
-- permissão da tela/ação correspondente (ver src/lib/permissionRegistry.ts).
-- `has_permission` resolve: administrador sempre passa; senão o ajuste
-- individual da pessoa (user_permission_overrides) se houver; senão o
-- perfil dela (role_permission_items); sem nenhuma linha, NEGA
-- (fail-closed) — diferente do front-end, que trata "sem linha" como
-- liberado (mantido assim de propósito só pra não esconder um botão de um
-- perfil recém-criado antes do administrador configurar as permissões
-- dele; a trava de verdade é sempre a do banco).
create or replace function has_permission(p_user_id uuid, p_key text) returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select is_active_user(p_user_id) and (
    is_admin_user(p_user_id)
    or coalesce(
      (select allowed from user_permission_overrides where user_id = p_user_id and permission_key = p_key),
      (
        select rpi.allowed
        from role_permission_items rpi
        join user_profiles up on up.role_id = rpi.role_id
        where up.id = p_user_id and rpi.permission_key = p_key
      ),
      false
    )
  );
$$;

revoke all on function has_permission(uuid, text) from public, anon;
grant execute on function has_permission(uuid, text) to authenticated;

-- ---------- Leitura ampla, escrita restrita por permissão ----------
-- (tabelas de referência/consulta cruzada — várias telas de módulos
-- diferentes leem, então restringir leitura quebraria painel/relatórios
-- pra quem não tem aquela página específica; a escrita é o que importa
-- travar de verdade.)

create policy "read_active" on units for select using (is_active_user(auth.uid()));
create policy "insert_admin" on units for insert with check (is_admin_user(auth.uid()));
create policy "update_admin" on units for update using (is_admin_user(auth.uid())) with check (is_admin_user(auth.uid()));

create policy "read_active" on spaces for select using (is_active_user(auth.uid()));
create policy "insert_admin" on spaces for insert with check (is_admin_user(auth.uid()));
create policy "update_admin" on spaces for update using (is_admin_user(auth.uid())) with check (is_admin_user(auth.uid()));

create policy "read_active" on leads for select using (is_active_user(auth.uid()));
create policy "write_admin" on leads for all using (is_admin_user(auth.uid())) with check (is_admin_user(auth.uid()));

create policy "read_active" on audit_log for select using (is_active_user(auth.uid()));
create policy "insert_active" on audit_log for insert with check (is_active_user(auth.uid()));

create policy "read_active" on contact_history for select using (is_active_user(auth.uid()));
create policy "insert_active" on contact_history for insert with check (is_active_user(auth.uid()));

create policy "read_active" on clients for select using (is_active_user(auth.uid()));
create policy "write_clients" on clients for insert with check (has_permission(auth.uid(), 'action:clientes.criar_editar'));
create policy "update_clients" on clients for update using (has_permission(auth.uid(), 'action:clientes.criar_editar')) with check (has_permission(auth.uid(), 'action:clientes.criar_editar'));
create policy "delete_clients" on clients for delete using (has_permission(auth.uid(), 'action:clientes.excluir'));

create policy "read_active" on packages for select using (is_active_user(auth.uid()));
create policy "write_packages" on packages for insert with check (has_permission(auth.uid(), 'action:pacotes.criar_editar'));
create policy "update_packages" on packages for update using (has_permission(auth.uid(), 'action:pacotes.criar_editar')) with check (has_permission(auth.uid(), 'action:pacotes.criar_editar'));
create policy "delete_packages" on packages for delete using (has_permission(auth.uid(), 'action:pacotes.excluir'));

create policy "read_active" on extra_items for select using (is_active_user(auth.uid()));
create policy "write_extra_items" on extra_items for insert with check (has_permission(auth.uid(), 'action:pacotes.criar_editar'));
create policy "update_extra_items" on extra_items for update using (has_permission(auth.uid(), 'action:pacotes.criar_editar')) with check (has_permission(auth.uid(), 'action:pacotes.criar_editar'));
create policy "delete_extra_items" on extra_items for delete using (has_permission(auth.uid(), 'action:pacotes.excluir'));

-- ficha técnica de custo do pacote — mesma chave de gerenciar pacote
create policy "read_active" on package_costs for select using (is_active_user(auth.uid()));
create policy "write_package_costs" on package_costs for all
  using (has_permission(auth.uid(), 'action:pacotes.criar_editar'))
  with check (has_permission(auth.uid(), 'action:pacotes.criar_editar'));

create policy "read_active" on payments for select using (is_active_user(auth.uid()));
create policy "write_payments" on payments for insert with check (has_permission(auth.uid(), 'action:festa.pagamentos'));
create policy "update_payments" on payments for update using (has_permission(auth.uid(), 'action:festa.pagamentos')) with check (has_permission(auth.uid(), 'action:festa.pagamentos'));
create policy "delete_payments" on payments for delete using (has_permission(auth.uid(), 'action:festa.pagamentos'));

create policy "read_active" on expenses for select using (is_active_user(auth.uid()));
create policy "write_expenses" on expenses for insert with check (has_permission(auth.uid(), 'action:financeiro.registrar_despesa'));
create policy "update_expenses" on expenses for update
  using (has_permission(auth.uid(), 'page:financeiro'))
  with check (has_permission(auth.uid(), 'page:financeiro'));
create policy "delete_expenses" on expenses for delete using (has_permission(auth.uid(), 'action:financeiro.remover'));

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

-- Acesso público (o contratante, sem login) à lista de convidados — só o
-- necessário pra essa página funcionar (ver dados da festa daquele link,
-- enviar/corrigir a lista de nomes).
create policy "public_read_guest_page" on guest_list_pages for select to anon using (true);
create policy "public_read_guest_entries" on guest_list_entries for select to anon using (true);
create policy "public_insert_guest_entries" on guest_list_entries for insert to anon with check (true);
create policy "public_delete_guest_entries" on guest_list_entries for delete to anon using (true);

-- Acesso público ao formulário de avaliação pós-festa — só ver os dados
-- leves do link (nome do cliente, unidade) e enviar a resposta uma vez.
create policy "public_read_review_link" on review_links for select to anon using (true);
create policy "public_insert_party_review" on party_reviews for insert to anon with check (true);

-- =========================================================
-- Seed inicial — as duas unidades da empresa
-- =========================================================
insert into units (name, address)
values
  ('Vila Operária', null),
  ('São Vicente', null)
on conflict do nothing;

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

-- Os planos reais (Festa Completa / Somente o Espaço em São Vicente; Classic
-- / Gourmet / Prime em cada faixa de convidados na Vila Operária), preços por
-- dia da semana e itens extras do catálogo (fotógrafo, número em LED, etc.)
-- ficam no arquivo de migração 018_planos_e_precos.sql — não duplicado aqui
-- por serem ~25 pacotes com texto longo. Rode as migrações em ordem (002 a
-- 018) para reproduzir o estado atual em uma instalação nova.

-- Itens fixos do checklist de consumo pós-festa, semeados nas duas unidades
-- (quantidade real fica a cargo do usuário ajustar depois em Estoque).
insert into inventory_items (unit_id, name, category, unit_of_measure, quantity, minimum_quantity)
select u.id, v.nome, 'Buffet e bebidas', 'un', 0, 0
from units u
cross join (values
  ('Coca Normal'), ('Coca Zero'), ('Guaraná'), ('Suco de laranja'),
  ('Suco de uva'), ('Saco de Batata'), ('Água com gás')
) as v(nome)
where not exists (
  select 1 from inventory_items i where i.unit_id = u.id and i.name = v.nome
);

-- Suco de laranja e uva são controlados em litros (comprados em garrafas de
-- tamanho variado — ver inventory_purchase_variants), com 0,2L por
-- convidado (10L numa festa de 50 pessoas).
update inventory_items set unit_of_measure = 'L', quantity_per_guest = 0.2 where name in ('Suco de laranja', 'Suco de uva');

insert into inventory_purchase_variants (inventory_item_id, label, volume_amount)
select i.id, v.label, v.volume_amount
from inventory_items i
cross join (values ('1,5L', 1.5), ('3L', 3), ('5L', 5)) as v(label, volume_amount)
where i.name in ('Suco de laranja', 'Suco de uva')
  and not exists (
    select 1 from inventory_purchase_variants existing
    where existing.inventory_item_id = i.id and existing.label = v.label
  );

-- Velas numéricas (0-9, azul e rosa) — 20 itens por unidade, agrupados
-- visualmente numa gradinha compacta na tela de Estoque.
insert into inventory_items (unit_id, name, category, unit_of_measure, quantity, minimum_quantity)
select u.id, 'Vela ' || d.digito || ' ' || c.cor, 'Decoração', 'un', 0, 1
from units u
cross join generate_series(0, 9) as d(digito)
cross join (values ('Azul'), ('Rosa')) as c(cor)
where not exists (
  select 1 from inventory_items i where i.unit_id = u.id and i.name = 'Vela ' || d.digito || ' ' || c.cor
);

-- Mensagem padrão (editável pela tela) de confirmação com fornecedores.
insert into message_templates (key, body)
values (
  'confirmar_fornecedores',
  'Olá Pessoal, tudo certo?

Passando para lembrar que a entrega de hoje do BOLO, DOCINHOS, SALGADINHOS E PRATOS QUENTE está programada para as {{horario_entrega}}

TEMA: {{tema}}

{{aniversariante_idade}}

OBS: {{observacao}}'
)
on conflict (key) do nothing;
