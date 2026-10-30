-- =========================================================
-- BANCO DOS CLIENTES — ESTRUTURA, PARTE 1 DE 9
-- Rode as partes EM ORDEM (1, 2, 3...), cada uma numa query nova do SQL
-- Editor do projeto NOVO. Se aparecer a pergunta sobre "Row Level Security",
-- escolha rodar SEM o Supabase acrescentar nada (a segurança já está aqui).
-- Cada parte roda inteira ou nada.
-- =========================================================

begin;

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'reservations') then
    raise exception 'Este banco já tem o sistema. Estes arquivos são só para um projeto NOVO do Supabase.';
  end if;
end $$;

-- =========================================================
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
  user_name text, -- nome de quem fez, gravado junto (o vínculo acima é com o login, não com o perfil)
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

-- (supplier_bookings fica mais abaixo, depois de reservations, porque
-- depende dela.)

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
  valid_from date,  -- primeira data de festa em que o plano vale (null = sem limite)
  valid_until date, -- última data de festa em que o plano vale (null = sem limite)
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
  playlist_url text, -- playlist do Spotify enviada pelo contratante (só Vila Operária)
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

-- Edita um lançamento de consumo já salvo, corrigindo o estoque pela
-- diferença entre a quantidade antiga e a nova (não sobrescreve direto).
create or replace function update_stock_consumption(
  p_id uuid,
  p_new_quantity numeric,
  p_new_item_name text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
  v_old_quantity numeric;
begin
  select inventory_item_id, quantity into v_item_id, v_old_quantity
  from reservation_stock_consumption where id = p_id;

  update reservation_stock_consumption
  set quantity = p_new_quantity,
      item_name = coalesce(p_new_item_name, item_name)
  where id = p_id;

  if v_item_id is not null then
    update inventory_items
    set quantity = greatest(0, quantity - (p_new_quantity - v_old_quantity)), updated_at = now()
    where id = v_item_id;
  end if;
end;
$$;

revoke all on function update_stock_consumption(uuid, numeric, text) from public, anon;

grant execute on function update_stock_consumption(uuid, numeric, text) to authenticated;

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

commit;
