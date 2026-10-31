-- =========================================================
-- BANCO DOS CLIENTES — PASSO 1 DE 2: ESTRUTURA
--
-- Para um projeto NOVO do Supabase (vazio). NÃO rode no banco da Brava.
--
-- Cria toda a estrutura do sistema (tabelas, regras de segurança, funções,
-- bloqueio entre empresas, painel da plataforma) e, no fim, APAGA todos os
-- dados que a estrutura cria pelo caminho (unidades, pacotes, cardápio,
-- contratos e a empresa da Brava, que vêm do histórico do sistema). O banco
-- termina sem nenhuma empresa: elas são criadas pelo painel da plataforma.
--
-- Gerado a partir de supabase/schema.sql em 2026-10-31.
-- Roda dentro de uma transação: ou tudo, ou nada.
-- =========================================================

begin;

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'reservations') then
    raise exception 'Este banco já tem o sistema. Este arquivo é só para um projeto NOVO do Supabase.';
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

-- ---------- Tabela 2027 de São Vicente (provisória) ----------
-- Os planos anteriores de São Vicente valem para festas até 31/12/2026;
-- os novos, de 01/01/2027 em diante. "Somente o Espaço" não entra em 2027.
update packages
set valid_until = '2026-12-31'
where unit_id = (select id from units where name = 'São Vicente')
  and valid_from is null
  and valid_until is null;

insert into packages (name, description, base_price, weekday_price, weekend_price, unit_id, guest_limit, duration_hours, included_items, valid_from)
select v.nome, 'Plano de São Vicente — tabela 2027 (provisória)', v.semana, v.semana, v.fds, u.id, v.limite, 4, v.itens, '2027-01-01'
from units u
cross join (values
  ('Festa Completa 40 pessoas (2027)', 4600.00, 4800.00, 40,
    'Buffet completo: salgados fritos e assados sortidos, até 3 (três) opções de pratos assados, docinhos sortidos, bolo, refrigerante, suco e água. Decoração inclusa. Brinquedos: área da cama elástica, circuito radical, tobogã, piscina de bolinhas, basquete eletrônico, fliperama (mais de 10 mil jogos), ambiente game (PlayStation) e presença do Urso Theo. Ambiente climatizado e monitorado, som ambiente, Wi-Fi e convite virtual (padrão Brava Park Fest). Equipe: recepcionista, garçom, copeira, recreadores treinados e equipe de cozinha.'),
  ('Festa Completa 50 pessoas (2027)', 5200.00, 5500.00, 50,
    'Buffet completo: salgados fritos e assados sortidos, até 4 (quatro) opções de pratos assados, docinhos sortidos, bolo, refrigerante, suco e água. Decoração inclusa. Brinquedos: área da cama elástica, circuito radical, tobogã, piscina de bolinhas, basquete eletrônico, fliperama (mais de 10 mil jogos), ambiente game (PlayStation) e presença do Urso Theo. Ambiente climatizado e monitorado, som ambiente, Wi-Fi e convite virtual (padrão Brava Park Fest). Equipe: recepcionista, garçom, copeira, recreadores treinados e equipe de cozinha.'),
  ('Festa Completa 60 pessoas (2027)', 5700.00, 6150.00, 60,
    'Buffet completo: salgados fritos e assados sortidos, até 4 (quatro) opções de pratos assados, docinhos sortidos, bolo, refrigerante, suco e água. Decoração inclusa. Brinquedos: área da cama elástica, circuito radical, tobogã, piscina de bolinhas, basquete eletrônico, fliperama (mais de 10 mil jogos), ambiente game (PlayStation) e presença do Urso Theo. Ambiente climatizado e monitorado, som ambiente, Wi-Fi e convite virtual (padrão Brava Park Fest). Equipe: recepcionista, garçom, copeira, recreadores treinados e equipe de cozinha.')
) as v(nome, semana, fds, limite, itens)
where u.name = 'São Vicente'
  and not exists (select 1 from packages p where p.unit_id = u.id and p.name = v.nome);

-- ---------- Status automático da festa + histórico completo (quem fez o quê) ----------
-- ---------- 1) Status automático ----------

create or replace function recompute_reservation_status(p_reservation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status reservation_status;
  v_final numeric;
  v_paid numeric;
  v_due numeric;
  v_new reservation_status;
begin
  select status, final_value into v_status, v_final from reservations where id = p_reservation_id;
  if v_status is null or v_status = 'cancelada' then
    return;
  end if;

  select coalesce(sum(amount), 0) into v_paid from payments where reservation_id = p_reservation_id;
  v_due := coalesce(v_final, 0)
    + coalesce((select sum(price_snapshot * quantity) from reservation_extra_items where reservation_id = p_reservation_id), 0)
    + coalesce((select sum(quantity * unit_price) from reservation_consumption where reservation_id = p_reservation_id), 0);

  if v_status = 'orcamento' and v_paid <= 0.005 then
    v_new := 'orcamento';
  elsif v_due > 0 and v_paid >= v_due - 0.005 then
    v_new := 'quitada';
  else
    v_new := 'confirmada';
  end if;

  if v_new is distinct from v_status then
    update reservations set status = v_new where id = p_reservation_id;
  end if;
end;
$$;

create or replace function trg_recompute_status_from_child() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform recompute_reservation_status(new.reservation_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and (tg_op = 'DELETE' or old.reservation_id is distinct from new.reservation_id) then
    perform recompute_reservation_status(old.reservation_id);
  end if;
  return null;
end;
$$;

create or replace function trg_recompute_status_from_reservation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform recompute_reservation_status(new.id);
  return null;
end;
$$;

drop trigger if exists trg_status_payments on payments;
create trigger trg_status_payments after insert or update or delete on payments
  for each row execute function trg_recompute_status_from_child();

drop trigger if exists trg_status_extras on reservation_extra_items;
create trigger trg_status_extras after insert or update or delete on reservation_extra_items
  for each row execute function trg_recompute_status_from_child();

drop trigger if exists trg_status_consumption on reservation_consumption;
create trigger trg_status_consumption after insert or update or delete on reservation_consumption
  for each row execute function trg_recompute_status_from_child();

drop trigger if exists trg_status_reservation_value on reservations;
create trigger trg_status_reservation_value after insert or update of final_value, total_value on reservations
  for each row execute function trg_recompute_status_from_reservation();

-- Acerta todas as festas que já existem (inclui as que estavam "Sinal pago").
do $$
declare r record;
begin
  for r in select id from reservations where status <> 'cancelada' loop
    perform recompute_reservation_status(r.id);
  end loop;
end $$;

-- ---------- 2) Histórico completo ----------

-- Encurta textos longos (ex: texto inteiro do contrato) pra não pesar o histórico.
create or replace function audit_trim(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(
    key,
    case when jsonb_typeof(value) = 'string' and length(value #>> '{}') > 300
         then to_jsonb(left(value #>> '{}', 300) || '…')
         else value end
  ), '{}'::jsonb)
  from jsonb_each(p);
$$;

create or replace function audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_action text;
  v_row jsonb;
  v_old jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_reservation text;
begin
  if tg_op = 'INSERT' then
    v_action := 'criou';
    v_row := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action := 'alterou';
    v_row := to_jsonb(new);
    v_old := to_jsonb(old);
    for v_key in select jsonb_object_keys(v_row) loop
      if v_key not in ('updated_at', 'created_at') and (v_row -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('de', v_old -> v_key, 'para', v_row -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;
    end if;
  else
    v_action := 'excluiu';
    v_row := to_jsonb(old);
  end if;

  if v_uid is not null then
    select name into v_name from user_profiles where id = v_uid;
  end if;

  v_reservation := case
    when tg_table_name = 'reservations' then v_row ->> 'id'
    else v_row ->> 'reservation_id'
  end;

  insert into audit_log (user_id, user_name, action, entity, entity_id, details)
  values (
    v_uid,
    coalesce(v_name, case when v_uid is null then 'Link público ou sistema' else 'Usuário sem perfil' end),
    v_action,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    jsonb_strip_nulls(jsonb_build_object(
      'reservation_id', v_reservation,
      'changes', case when tg_op = 'UPDATE' then audit_trim(v_changes) end,
      'row', case when tg_op <> 'UPDATE' then audit_trim(v_row) end
    ))
  );
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'reservations', 'payments', 'reservation_costs', 'reservation_extra_items', 'reservation_consumption',
    'reservation_stock_consumption', 'reservation_birthday_kids', 'reservation_notes', 'reservation_documents',
    'checklist_items', 'staff_assignments', 'staff_members', 'guest_list_entries', 'contracts',
    'clients', 'expenses', 'recurring_expenses', 'packages', 'extra_items', 'inventory_items',
    'festa_fixed_costs', 'suppliers', 'visits', 'proposals', 'waitlist', 'unit_goals', 'marketing_spend'
  ] loop
    execute format('drop trigger if exists trg_audit on %I', t);
    execute format('create trigger trg_audit after insert or update or delete on %I for each row execute function audit_row_change()', t);
  end loop;
end $$;

create index if not exists idx_audit_log_reservation on audit_log ((details ->> 'reservation_id'));
create index if not exists idx_audit_log_created on audit_log (created_at desc);

-- =========================================================
-- FINANCEIRO — três correções:
--
-- 1) CONTA VENCIDA VIRA "ATRASADO" SOZINHA
--    Antes, uma conta a pagar que passava do vencimento continuava "A vencer"
--    até alguém trocar à mão, então o cartão "Atrasado" do Financeiro ficava
--    zerado. Agora:
--      • ao salvar (criar/editar) uma conta não paga, o status é acertado
--        pela data: vencimento antes de hoje → Atrasado; hoje ou depois →
--        A vencer;
--      • toda vez que o Painel ou o Financeiro abrem, as contas que venceram
--        desde a última vez passam para Atrasado (mesma rotina que já gera as
--        despesas fixas do mês).
--    "Hoje" é a data de Brasília, não a do servidor (UTC).
--
-- 2) CONTA QUE PAGA CUSTOS JÁ LANÇADOS NAS FESTAS
--    Nova marcação na conta a pagar: "esta conta paga custos que já estão
--    lançados nas festas" (ex: nota mensal do fornecedor de docinhos, que já
--    entra sozinho como despesa fixa de cada festa). Conta marcada continua
--    na lista para controlar vencimento e pagamento, mas NÃO entra em nenhum
--    total (saldo, resultado do mês, fluxo de caixa, a pagar/atrasado) — o
--    valor dela já está contado pelos custos das festas. Isso acaba com a
--    contagem em dobro.
--
-- 3) HISTÓRICO: ações automáticas aparecem como automáticas
--    As mudanças feitas sozinhas pelo sistema (status da festa recalculado,
--    conta virando atrasada) eram gravadas no histórico com o nome de quem
--    estava usando o sistema naquela hora. Agora aparecem como
--    "Sistema (automático)".
--
-- + SEGURANÇA: fecha três funções internas que podiam ser chamadas sem
--   login (não expunham dados de cliente, mas não precisam ficar abertas).
-- =========================================================

-- ---------- 2) marcação na conta a pagar ----------
alter table expenses add column if not exists covers_festa_costs boolean not null default false;

-- ---------- 3) quem aparece no histórico ----------
-- Funções automáticas setam app.audit_actor durante a própria alteração;
-- o gatilho do histórico usa esse nome no lugar do usuário logado.
create or replace function audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_actor text := nullif(current_setting('app.audit_actor', true), '');
  v_name text;
  v_action text;
  v_row jsonb;
  v_old jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_reservation text;
begin
  if tg_op = 'INSERT' then
    v_action := 'criou';
    v_row := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action := 'alterou';
    v_row := to_jsonb(new);
    v_old := to_jsonb(old);
    for v_key in select jsonb_object_keys(v_row) loop
      if v_key not in ('updated_at', 'created_at') and (v_row -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('de', v_old -> v_key, 'para', v_row -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;
    end if;
  else
    v_action := 'excluiu';
    v_row := to_jsonb(old);
  end if;

  if v_actor is not null then
    v_uid := null;
    v_name := v_actor;
  elsif v_uid is not null then
    select name into v_name from user_profiles where id = v_uid;
  end if;

  v_reservation := case
    when tg_table_name = 'reservations' then v_row ->> 'id'
    else v_row ->> 'reservation_id'
  end;

  insert into audit_log (user_id, user_name, action, entity, entity_id, details)
  values (
    v_uid,
    coalesce(v_name, case when v_uid is null then 'Link público ou sistema' else 'Usuário sem perfil' end),
    v_action,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    jsonb_strip_nulls(jsonb_build_object(
      'reservation_id', v_reservation,
      'changes', case when tg_op = 'UPDATE' then audit_trim(v_changes) end,
      'row', case when tg_op <> 'UPDATE' then audit_trim(v_row) end
    ))
  );
  return null;
end;
$$;

-- Status automático da festa (mesma regra da 055), agora registrado como
-- "Sistema (automático)" no histórico.
create or replace function recompute_reservation_status(p_reservation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status reservation_status;
  v_final numeric;
  v_paid numeric;
  v_due numeric;
  v_new reservation_status;
begin
  select status, final_value into v_status, v_final from reservations where id = p_reservation_id;
  if v_status is null or v_status = 'cancelada' then
    return;
  end if;

  select coalesce(sum(amount), 0) into v_paid from payments where reservation_id = p_reservation_id;
  v_due := coalesce(v_final, 0)
    + coalesce((select sum(price_snapshot * quantity) from reservation_extra_items where reservation_id = p_reservation_id), 0)
    + coalesce((select sum(quantity * unit_price) from reservation_consumption where reservation_id = p_reservation_id), 0);

  if v_status = 'orcamento' and v_paid <= 0.005 then
    v_new := 'orcamento';
  elsif v_due > 0 and v_paid >= v_due - 0.005 then
    v_new := 'quitada';
  else
    v_new := 'confirmada';
  end if;

  if v_new is distinct from v_status then
    perform set_config('app.audit_actor', 'Sistema (status automático)', true);
    update reservations set status = v_new where id = p_reservation_id;
    perform set_config('app.audit_actor', '', true);
  end if;
end;
$$;

-- ---------- 1) atrasado automático ----------
create or replace function today_brazil() returns date
language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- Ao salvar uma conta não paga, acerta A vencer / Atrasado pela data.
create or replace function normalize_expense_status() returns trigger
language plpgsql as $$
begin
  if new.status in ('a_vencer', 'atrasado') then
    new.status := case when new.due_date < today_brazil() then 'atrasado' else 'a_vencer' end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_expense_status on expenses;
create trigger trg_normalize_expense_status before insert or update of status, due_date on expenses
  for each row execute function normalize_expense_status();

-- Gera as despesas fixas do mês (igual antes, agora pela data de Brasília)
-- e passa para Atrasado o que venceu.
create or replace function ensure_recurring_expenses_current_month() returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_today date := today_brazil();
  v_month_start date := date_trunc('month', today_brazil())::date;
  v_days_in_month int := extract(day from (date_trunc('month', today_brazil()) + interval '1 month - 1 day'))::int;
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

  if exists (select 1 from expenses where status = 'a_vencer' and due_date < v_today) then
    perform set_config('app.audit_actor', 'Sistema (conta venceu)', true);
    update expenses set status = 'atrasado' where status = 'a_vencer' and due_date < v_today;
    perform set_config('app.audit_actor', '', true);
  end if;
end;
$$;
revoke all on function ensure_recurring_expenses_current_month() from public, anon;
grant execute on function ensure_recurring_expenses_current_month() to authenticated;

-- Acerta agora as contas que já estão vencidas.
do $$
begin
  perform set_config('app.audit_actor', 'Sistema (conta venceu)', true);
  update expenses set status = 'atrasado' where status = 'a_vencer' and due_date < today_brazil();
  perform set_config('app.audit_actor', '', true);
end $$;

-- ---------- Segurança: funções internas sem acesso externo ----------
revoke all on function recompute_reservation_status(uuid) from public, anon, authenticated;
revoke all on function festa_fixed_cost_amount(uuid, uuid) from public, anon, authenticated;
revoke all on function audit_trim(jsonb) from public, anon, authenticated;
revoke all on function today_brazil() from public, anon;
grant execute on function today_brazil() to authenticated;

-- =========================================================
-- CUSTO NO ESTOQUE, ACERTO ENTRE UNIDADES E ESTORNO DE CANCELAMENTO
--
-- 1) Estoque passa a ter valor (custo médio ponderado). Cada item guarda a
--    quantidade E o valor total em estoque; o custo médio é sempre
--    valor ÷ quantidade (nunca arredondado a cada operação). Toda mudança
--    de quantidade/valor passa por funções do banco e fica registrada em
--    inventory_movements (compra, consumo, ajuste, transferência...).
--    Mudar quantidade/valor direto na tabela fica bloqueado.
-- 2) "Entrada de compra" (tela Estoque): lança a compra uma vez só e o
--    sistema cria a conta a pagar vinculada. Editar/excluir refaz o estoque
--    pela diferença, na mesma conta.
-- 3) Consumo pós-festa grava o custo da linha (congelado). Só informativo
--    (Lucro por festa) — não mexe no caixa nem no Resultado do mês.
-- 4) Transferência entre unidades é atômica e cria um "acerto" pendente.
--    Confirmar o acerto gera, juntos e uma única vez, a saída na unidade que
--    recebeu os produtos e a entrada (novo tipo "outras entradas") na que
--    mandou. Esses lançamentos só mudam pelo acerto.
-- 5) Cancelamento com valor devolvido cria a saída "Estorno" (uma por festa).
-- 6) Médias de consumo por convidado, calculadas na hora a partir dos dados.
--
-- Pode rodar mais de uma vez sem duplicar nada.
-- =========================================================

-- ---------- Permissões novas ----------
-- Estorno: perfis Financeiro e Comercial (Administrador sempre pode).
insert into role_permission_items (role_id, permission_key, allowed)
select r.id, 'action:festa.estorno', true
from roles r
where not r.is_admin and (r.name ilike '%financeiro%' or r.name ilike '%comercial%')
on conflict (role_id, permission_key) do nothing;

-- Ver/confirmar acertos e definir custo inicial: perfis que já veem o Financeiro.
-- Desfazer confirmação de acerto: só Administrador (nenhuma linha criada).
insert into role_permission_items (role_id, permission_key, allowed)
select r.id, k, true
from roles r
cross join unnest(array['page:acertos', 'action:acertos.confirmar', 'action:estoque.custo_inicial']) k
where not r.is_admin
  and exists (select 1 from role_permission_items x where x.role_id = r.id and x.permission_key = 'page:financeiro' and x.allowed)
on conflict (role_id, permission_key) do nothing;

-- ---------- Formatação para descrições automáticas ----------
create or replace function fmt_brl(p numeric) returns text
language sql immutable as $$
  select 'R$ ' || replace(replace(replace(to_char(round(coalesce(p, 0), 2), 'FM999,999,999,990.00'), ',', '#'), '.', ','), '#', '.');
$$;

create or replace function fmt_qtd(p numeric) returns text
language sql immutable as $$
  select replace(rtrim(rtrim(to_char(coalesce(p, 0), 'FM999999990.000'), '0'), '.'), '.', ',');
$$;

-- ---------- 1) Estoque com valor ----------
alter table inventory_items add column if not exists total_value numeric(18,6) not null default 0;
alter table inventory_items add column if not exists has_cost boolean not null default false;
alter table inventory_items add column if not exists last_unit_cost numeric(18,6);
alter table inventory_items add column if not exists consumption_type text;
update inventory_items
set consumption_type = case when quantity_per_guest is not null then 'por_convidado' else 'por_festa' end
where consumption_type is null;
alter table inventory_items alter column consumption_type set default 'por_convidado';
alter table inventory_items alter column consumption_type set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_items_consumption_type_check') then
    alter table inventory_items add constraint inventory_items_consumption_type_check check (consumption_type in ('por_convidado', 'por_festa'));
  end if;
end $$;

create table if not exists inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  unit_id uuid not null references units(id),
  kind text not null, -- compra, compra_ajuste, compra_excluida, consumo, consumo_ajuste, consumo_desfeito, ajuste_entrada, ajuste_saida, custo_inicial, transferencia_saida, transferencia_entrada, cadastro
  quantity numeric(14,3) not null,       -- + entrou / − saiu
  value numeric(18,6) not null default 0, -- + entrou / − saiu (R$)
  reason text,
  expense_id uuid,
  consumption_id uuid,
  settlement_id uuid,
  reservation_id uuid,
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_inventory_movements_item on inventory_movements (inventory_item_id, created_at desc);

alter table inventory_movements enable row level security;
drop policy if exists "read_inventory_movements" on inventory_movements;
create policy "read_inventory_movements" on inventory_movements for select
  using (has_permission(auth.uid(), 'page:estoque') or has_permission(auth.uid(), 'page:financeiro') or has_permission(auth.uid(), 'page:festa_detalhe'));

create or replace function current_actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(current_setting('app.audit_actor', true), ''), (select name from user_profiles where id = auth.uid()), 'Sistema');
$$;

-- Quantidade/valor do estoque só mudam pelas funções abaixo.
create or replace function guard_inventory_stock() returns trigger
language plpgsql as $$
begin
  if (new.quantity is distinct from old.quantity or new.total_value is distinct from old.total_value or new.has_cost is distinct from old.has_cost)
     and coalesce(current_setting('app.stock_fn', true), '') <> '1' then
    raise exception 'A quantidade e o valor do estoque só mudam por Entrada de compra, ajuste, consumo ou transferência.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_inventory_stock on inventory_items;
create trigger trg_guard_inventory_stock before update on inventory_items
  for each row execute function guard_inventory_stock();

-- Item cadastrado já com quantidade fica registrado no histórico.
create or replace function log_inventory_item_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.quantity <> 0 or new.total_value <> 0 then
    insert into inventory_movements (inventory_item_id, unit_id, kind, quantity, value, reason, created_by_name)
    values (new.id, new.unit_id, 'cadastro', new.quantity, new.total_value, 'Item cadastrado', current_actor_name());
  end if;
  return null;
end;
$$;
drop trigger if exists trg_log_inventory_item_created on inventory_items;
create trigger trg_log_inventory_item_created after insert on inventory_items
  for each row execute function log_inventory_item_created();

-- Custo unitário atual do item (médio; sem quantidade, o último conhecido).
create or replace function stock_unit_cost(p_item uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when quantity > 0 then total_value / quantity else last_unit_cost end
  from inventory_items where id = p_item;
$$;

-- ENTRADA. p_value nulo = entra pelo custo médio atual (ajuste, devolução).
-- Devolve o valor que entrou no estoque.
create or replace function stock_apply_in(
  p_item uuid, p_qty numeric, p_value numeric, p_kind text, p_reason text default null,
  p_expense uuid default null, p_consumption uuid default null, p_settlement uuid default null, p_reservation uuid default null
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  it inventory_items%rowtype;
  v_value numeric;
  v_unit numeric;
begin
  select * into it from inventory_items where id = p_item for update;
  if not found then return 0; end if;
  perform set_config('app.stock_fn', '1', true);

  if p_value is null then
    v_unit := case when it.quantity > 0 then it.total_value / it.quantity else it.last_unit_cost end;
    v_value := case when it.has_cost then round(p_qty * coalesce(v_unit, 0), 6) else 0 end;
  else
    v_value := p_value;
    -- Primeira compra com valor de um item que tinha quantidade sem custo:
    -- o que já existia passa a valer o custo desta compra.
    if not it.has_cost and p_value > 0 and it.quantity > 0 and p_qty > 0 then
      update inventory_items set total_value = it.quantity * (p_value / p_qty) where id = p_item;
      insert into inventory_movements (inventory_item_id, unit_id, kind, quantity, value, reason, expense_id, created_by_name)
      values (p_item, it.unit_id, 'custo_inicial', 0, it.quantity * (p_value / p_qty),
              'Custo assumido para o estoque que estava sem custo, pelo valor desta compra', p_expense, 'Sistema');
      it.total_value := it.quantity * (p_value / p_qty);
    end if;
  end if;

  update inventory_items set
    quantity = quantity + p_qty,
    total_value = it.total_value + v_value,
    has_cost = it.has_cost or (p_value is not null and p_value > 0),
    last_unit_cost = case when p_value is not null and p_value > 0 and p_qty > 0 then p_value / p_qty else last_unit_cost end,
    updated_at = now()
  where id = p_item;

  insert into inventory_movements (inventory_item_id, unit_id, kind, quantity, value, reason, expense_id, consumption_id, settlement_id, reservation_id, created_by_name)
  values (p_item, it.unit_id, p_kind, p_qty, v_value, p_reason, p_expense, p_consumption, p_settlement, p_reservation, current_actor_name());

  perform set_config('app.stock_fn', '', true);
  return v_value;
end;
$$;

-- SAÍDA pelo custo médio. Devolve o custo atribuído à saída (nulo se o item
-- está sem custo). Saída maior que o estoque: o estoque vai a zero (nunca
-- negativo) e o excedente é custeado pelo custo médio do momento.
create or replace function stock_apply_out(
  p_item uuid, p_qty numeric, p_kind text, p_reason text default null,
  p_expense uuid default null, p_consumption uuid default null, p_settlement uuid default null, p_reservation uuid default null
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  it inventory_items%rowtype;
  v_unit numeric;
  v_from_stock numeric;
  v_cost numeric;
begin
  select * into it from inventory_items where id = p_item for update;
  if not found then return null; end if;
  perform set_config('app.stock_fn', '1', true);

  v_unit := case when it.quantity > 0 then it.total_value / it.quantity else it.last_unit_cost end;
  if p_qty >= it.quantity then
    v_from_stock := it.total_value;  -- leva todo o valor: sem sobra de centavos
    v_cost := it.total_value + round(greatest(p_qty - greatest(it.quantity, 0), 0) * coalesce(v_unit, 0), 6);
    update inventory_items set quantity = 0, total_value = 0, updated_at = now() where id = p_item;
  else
    v_from_stock := round(p_qty * it.total_value / it.quantity, 6);
    v_cost := v_from_stock;
    update inventory_items set quantity = quantity - p_qty, total_value = total_value - v_from_stock, updated_at = now() where id = p_item;
  end if;

  insert into inventory_movements (inventory_item_id, unit_id, kind, quantity, value, reason, expense_id, consumption_id, settlement_id, reservation_id, created_by_name)
  values (p_item, it.unit_id, p_kind, -least(p_qty, greatest(it.quantity, 0)), -v_from_stock, p_reason, p_expense, p_consumption, p_settlement, p_reservation, current_actor_name());

  perform set_config('app.stock_fn', '', true);
  return case when it.has_cost then v_cost else null end;
end;
$$;

-- Ajuste "cru" por diferença (edição/exclusão de compra). Se deixaria o
-- estoque negativo, exige justificativa; com ela, zera quantidade e valor.
create or replace function stock_apply_delta(
  p_item uuid, p_dqty numeric, p_dvalue numeric, p_kind text, p_reason text, p_justification text, p_expense uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  it inventory_items%rowtype;
  v_q numeric;
  v_v numeric;
begin
  select * into it from inventory_items where id = p_item for update;
  if not found then return; end if;
  v_q := it.quantity + p_dqty;
  v_v := it.total_value + p_dvalue;
  if v_q < 0 then
    if coalesce(trim(p_justification), '') = '' then
      raise exception 'ESTOQUE_NEGATIVO: % — parte dessa compra já foi consumida. Informe uma justificativa para continuar.', it.name;
    end if;
    v_q := 0;
  end if;
  if v_q = 0 or v_v < 0 then v_v := case when v_q = 0 then 0 else greatest(v_v, 0) end; end if;

  perform set_config('app.stock_fn', '1', true);
  update inventory_items set
    quantity = v_q, total_value = v_v,
    has_cost = has_cost or p_dvalue > 0,
    updated_at = now()
  where id = p_item;
  insert into inventory_movements (inventory_item_id, unit_id, kind, quantity, value, reason, expense_id, created_by_name)
  values (p_item, it.unit_id, p_kind, v_q - it.quantity, v_v - it.total_value,
          concat_ws(' · ', p_reason, nullif(trim(p_justification), '')), p_expense, current_actor_name());
  perform set_config('app.stock_fn', '', true);
end;
$$;

revoke all on function stock_apply_in(uuid, numeric, numeric, text, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function stock_apply_out(uuid, numeric, text, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function stock_apply_delta(uuid, numeric, numeric, text, text, text, uuid) from public, anon, authenticated;
revoke all on function stock_unit_cost(uuid) from public, anon;
grant execute on function stock_unit_cost(uuid) to authenticated;
revoke all on function current_actor_name() from public, anon;
grant execute on function current_actor_name() to authenticated;

-- Ajuste manual (+/− e campo de quantidade da tela Estoque). Não cria despesa.
create or replace function adjust_stock(p_item uuid, p_new_quantity numeric, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_q numeric;
begin
  if not has_permission(auth.uid(), 'page:estoque') then raise exception 'Sem permissão'; end if;
  if p_new_quantity < 0 then raise exception 'A quantidade não pode ser negativa.'; end if;
  select quantity into v_q from inventory_items where id = p_item;
  if v_q is null then raise exception 'Item não encontrado.'; end if;
  if p_new_quantity > v_q then
    perform stock_apply_in(p_item, p_new_quantity - v_q, null, 'ajuste_entrada', coalesce(nullif(trim(p_reason), ''), 'Ajuste manual'));
  elsif p_new_quantity < v_q then
    if coalesce(trim(p_reason), '') = '' then raise exception 'Informe o motivo para diminuir o estoque.'; end if;
    perform stock_apply_out(p_item, v_q - p_new_quantity, 'ajuste_saida', p_reason);
  end if;
end;
$$;

-- Custo inicial de um item que está "sem custo". Não cria lançamento financeiro.
create or replace function set_initial_stock_cost(p_item uuid, p_unit_cost numeric) returns void
language plpgsql security definer set search_path = public as $$
declare
  it inventory_items%rowtype;
begin
  if not has_permission(auth.uid(), 'action:estoque.custo_inicial') then raise exception 'Sem permissão'; end if;
  if p_unit_cost is null or p_unit_cost < 0 then raise exception 'Informe um custo unitário válido.'; end if;
  select * into it from inventory_items where id = p_item for update;
  if not found then raise exception 'Item não encontrado.'; end if;
  if it.has_cost then raise exception 'Este item já tem custo.'; end if;
  perform set_config('app.stock_fn', '1', true);
  update inventory_items set total_value = quantity * p_unit_cost, has_cost = true, last_unit_cost = p_unit_cost, updated_at = now() where id = p_item;
  insert into inventory_movements (inventory_item_id, unit_id, kind, quantity, value, reason, created_by_name)
  values (p_item, it.unit_id, 'custo_inicial', 0, it.quantity * p_unit_cost, 'Custo inicial definido: ' || fmt_brl(p_unit_cost) || ' por ' || it.unit_of_measure, current_actor_name());
  perform set_config('app.stock_fn', '', true);
end;
$$;

-- ---------- 2) Entrada de compra ----------
alter table expenses add column if not exists is_stock_purchase boolean not null default false;
alter table expenses add column if not exists other_items_value numeric(14,2) not null default 0;
alter table expenses add column if not exists purchase_date date;
alter table expenses add column if not exists reservation_id uuid references reservations(id) on delete set null;
alter table expenses add column if not exists settlement_batch_id uuid;
create unique index if not exists uq_expenses_settlement_batch on expenses (settlement_batch_id) where settlement_batch_id is not null;
create unique index if not exists uq_expenses_estorno_ativo on expenses (reservation_id) where category = 'Estorno' and status <> 'cancelado' and reservation_id is not null;

alter table expense_items add column if not exists line_value numeric(14,2);
alter table expense_items add column if not exists unit_cost numeric(18,6);
alter table expense_items add column if not exists stock_value numeric(18,6); -- valor que de fato entrou no estoque

-- Lançamentos "travados" (compra de estoque, acerto, estorno) só mudam pelas funções.
create or replace function guard_locked_expense() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.expense_fn', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if old.settlement_batch_id is not null then
    raise exception 'Lançamento de acerto entre unidades: altere ou desfaça pela tela Acertos entre unidades.';
  end if;
  if old.is_stock_purchase or (old.category = 'Estorno' and old.reservation_id is not null) then
    if tg_op = 'DELETE' then
      raise exception '%', case when old.is_stock_purchase then 'Compra de estoque: exclua pela Entrada de compra (tela Estoque).' else 'Estorno: altere pela festa cancelada.' end;
    end if;
    if new.amount is distinct from old.amount or new.unit_id is distinct from old.unit_id
       or new.category is distinct from old.category or new.description is distinct from old.description
       or new.supplier is distinct from old.supplier or new.is_stock_purchase is distinct from old.is_stock_purchase
       or new.reservation_id is distinct from old.reservation_id then
      raise exception '%', case when old.is_stock_purchase then 'Compra de estoque: edite pela Entrada de compra (tela Estoque).' else 'Estorno: altere o valor pela festa cancelada.' end;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists trg_guard_locked_expense on expenses;
create trigger trg_guard_locked_expense before update or delete on expenses
  for each row execute function guard_locked_expense();

-- Cria (p_expense_id nulo) ou edita uma compra de estoque.
-- p_items: [{"inventory_item_id": "...", "item_name": "...", "quantity": 12, "value": 96}] (value pode ser nulo)
create or replace function save_stock_purchase(
  p_expense_id uuid, p_unit_id uuid, p_supplier text, p_purchase_date date, p_category text,
  p_paid boolean, p_payment_method text, p_paid_date date, p_due_date date,
  p_other_value numeric, p_items jsonb, p_justification text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_expense_id;
  v_total numeric := coalesce(p_other_value, 0);
  v_desc text;
  v_line jsonb;
  v_item inventory_items%rowtype;
  v_qty numeric;
  v_val numeric;
  v_unit_cost numeric;
  v_sv numeric;
  v_old expenses%rowtype;
  r record;
begin
  if not has_permission(auth.uid(), 'page:estoque') then raise exception 'Sem permissão'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'A compra precisa ter ao menos um item.'; end if;
  if coalesce(p_other_value, 0) < 0 then raise exception 'Valor de outros itens inválido.'; end if;

  -- validação + total + descrição
  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_line ->> 'quantity')::numeric;
    v_val := nullif(v_line ->> 'value', '')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade deve ser maior que zero.'; end if;
    if v_val is not null and v_val <= 0 then raise exception 'Valor da linha deve ser maior que zero (ou deixe em branco).'; end if;
    select * into v_item from inventory_items where id = (v_line ->> 'inventory_item_id')::uuid;
    if not found or v_item.unit_id <> p_unit_id then raise exception 'Item de estoque inválido para esta unidade.'; end if;
    v_total := v_total + coalesce(v_val, 0);
  end loop;
  if v_total <= 0 then raise exception 'Informe o valor de ao menos um item.'; end if;

  select 'Compra de estoque' || coalesce(' — ' || nullif(trim(p_supplier), ''), '') || ': ' ||
         string_agg(fmt_qtd((l ->> 'quantity')::numeric) || ' ' || i.unit_of_measure || ' ' || i.name ||
                    coalesce(' (' || fmt_brl(nullif(l ->> 'value', '')::numeric) || ')', ' (sem valor)'), ', ') ||
         case when coalesce(p_other_value, 0) > 0 then '; outros itens ' || fmt_brl(p_other_value) else '' end || '.'
  into v_desc
  from jsonb_array_elements(p_items) l
  join inventory_items i on i.id = (l ->> 'inventory_item_id')::uuid;

  perform set_config('app.expense_fn', '1', true);

  if v_id is null then
    insert into expenses (unit_id, category, description, supplier, amount, due_date, paid_date, status, payment_method,
                          is_stock_purchase, other_items_value, purchase_date)
    values (p_unit_id, coalesce(nullif(trim(p_category), ''), 'Fornecedores'), v_desc, nullif(trim(p_supplier), ''), v_total,
            case when p_paid then coalesce(p_paid_date, today_brazil()) else coalesce(p_due_date, today_brazil()) end,
            case when p_paid then coalesce(p_paid_date, today_brazil()) end,
            case when p_paid then 'pago' else 'a_vencer' end,
            case when p_paid then p_payment_method end,
            true, coalesce(p_other_value, 0), coalesce(p_purchase_date, today_brazil()))
    returning id into v_id;

    for v_line in select * from jsonb_array_elements(p_items) loop
      v_qty := (v_line ->> 'quantity')::numeric;
      v_val := nullif(v_line ->> 'value', '')::numeric;
      select * into v_item from inventory_items where id = (v_line ->> 'inventory_item_id')::uuid;
      v_sv := stock_apply_in(v_item.id, v_qty, v_val, 'compra', 'Entrada de compra', v_id);
      insert into expense_items (expense_id, inventory_item_id, item_name, quantity, line_value, unit_cost, stock_value)
      values (v_id, v_item.id, coalesce(v_line ->> 'item_name', v_item.name), v_qty, v_val, case when v_val is not null then v_val / v_qty end, v_sv);
    end loop;
  else
    select * into v_old from expenses where id = v_id for update;
    if not found or not v_old.is_stock_purchase then raise exception 'Compra não encontrada.'; end if;
    if v_old.unit_id <> p_unit_id then raise exception 'Não é possível trocar a unidade de uma compra já lançada.'; end if;

    -- novas linhas: valor que entra no estoque (sem valor = custo médio atual)
    create temp table if not exists tmp_new_lines (item uuid, name text, qty numeric, val numeric, sv numeric) on commit drop;
    delete from tmp_new_lines;
    for v_line in select * from jsonb_array_elements(p_items) loop
      v_qty := (v_line ->> 'quantity')::numeric;
      v_val := nullif(v_line ->> 'value', '')::numeric;
      select * into v_item from inventory_items where id = (v_line ->> 'inventory_item_id')::uuid;
      v_unit_cost := case when v_item.quantity > 0 then v_item.total_value / v_item.quantity else v_item.last_unit_cost end;
      insert into tmp_new_lines values (v_item.id, coalesce(v_line ->> 'item_name', v_item.name), v_qty, v_val,
        coalesce(v_val, case when v_item.has_cost then v_qty * coalesce(v_unit_cost, 0) else 0 end));
    end loop;

    -- diferença por item, em quantidade e em valor
    for r in
      with o as (select inventory_item_id item, sum(quantity) q, sum(coalesce(stock_value, line_value, 0)) v from expense_items where expense_id = v_id and inventory_item_id is not null group by 1),
           n as (select item, sum(qty) q, sum(sv) v from tmp_new_lines group by 1)
      select coalesce(o.item, n.item) item, coalesce(n.q, 0) - coalesce(o.q, 0) dq, coalesce(n.v, 0) - coalesce(o.v, 0) dv
      from o full join n on n.item = o.item
    loop
      if r.dq <> 0 or r.dv <> 0 then
        perform stock_apply_delta(r.item, r.dq, r.dv, 'compra_ajuste', 'Compra editada', p_justification, v_id);
      end if;
    end loop;

    delete from expense_items where expense_id = v_id;
    insert into expense_items (expense_id, inventory_item_id, item_name, quantity, line_value, unit_cost, stock_value)
    select v_id, item, name, qty, val, case when val is not null then val / qty end, sv from tmp_new_lines;

    update expenses set
      category = coalesce(nullif(trim(p_category), ''), 'Fornecedores'),
      description = v_desc, supplier = nullif(trim(p_supplier), ''), amount = v_total,
      due_date = case when p_paid then coalesce(p_paid_date, today_brazil()) else coalesce(p_due_date, due_date) end,
      paid_date = case when p_paid then coalesce(p_paid_date, today_brazil()) end,
      status = case when p_paid then 'pago' else 'a_vencer' end,
      payment_method = case when p_paid then p_payment_method end,
      other_items_value = coalesce(p_other_value, 0),
      purchase_date = coalesce(p_purchase_date, purchase_date)
    where id = v_id;
  end if;

  perform set_config('app.expense_fn', '', true);
  return v_id;
end;
$$;

create or replace function delete_stock_purchase(p_expense_id uuid, p_justification text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_old expenses%rowtype;
  r record;
begin
  if not (has_permission(auth.uid(), 'page:estoque') or has_permission(auth.uid(), 'action:financeiro.remover')) then raise exception 'Sem permissão'; end if;
  select * into v_old from expenses where id = p_expense_id for update;
  if not found then return; end if;
  if not v_old.is_stock_purchase then raise exception 'Esta conta não é uma compra de estoque.'; end if;
  for r in select inventory_item_id item, sum(quantity) q, sum(coalesce(stock_value, line_value, 0)) v
           from expense_items where expense_id = p_expense_id and inventory_item_id is not null group by 1 loop
    perform stock_apply_delta(r.item, -r.q, -r.v, 'compra_excluida', 'Compra excluída', p_justification, p_expense_id);
  end loop;
  perform set_config('app.expense_fn', '1', true);
  delete from expenses where id = p_expense_id;
  perform set_config('app.expense_fn', '', true);
end;
$$;

-- Compras antigas (lançadas pelo Financeiro) continuam funcionando.
create or replace function record_stock_purchase(p_expense_id uuid, p_inventory_item_id uuid, p_item_name text, p_quantity numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_sv numeric := 0;
begin
  if p_inventory_item_id is not null then
    v_sv := stock_apply_in(p_inventory_item_id, p_quantity, null, 'compra', 'Compra lançada pelo Financeiro (sem valor por item)', p_expense_id);
  end if;
  insert into expense_items (expense_id, inventory_item_id, item_name, quantity, stock_value)
  values (p_expense_id, p_inventory_item_id, p_item_name, p_quantity, v_sv)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function undo_stock_purchase(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_line expense_items%rowtype;
begin
  select * into v_line from expense_items where id = p_id;
  if not found then return; end if;
  if v_line.inventory_item_id is not null then
    perform stock_apply_delta(v_line.inventory_item_id, -v_line.quantity, -coalesce(v_line.stock_value, v_line.line_value, 0),
                              'compra_excluida', 'Compra excluída', 'Conta excluída no Financeiro', v_line.expense_id);
  end if;
  delete from expense_items where id = p_id;
end;
$$;

-- ---------- 3) Consumo pós-festa com custo ----------
alter table reservation_stock_consumption add column if not exists unit_cost numeric(18,6);
alter table reservation_stock_consumption add column if not exists total_cost numeric(18,6);
alter table reservation_stock_consumption add column if not exists no_cost boolean not null default false;

create or replace function record_stock_consumption(p_reservation_id uuid, p_inventory_item_id uuid, p_item_name text, p_quantity numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := gen_random_uuid();
  v_cost numeric;
begin
  if not has_permission(auth.uid(), 'action:festa.consumo_pos_festa') then raise exception 'Sem permissão'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantidade deve ser maior que zero.'; end if;
  if p_inventory_item_id is not null then
    v_cost := stock_apply_out(p_inventory_item_id, p_quantity, 'consumo', 'Consumo pós-festa', null, v_id, null, p_reservation_id);
  end if;
  insert into reservation_stock_consumption (id, reservation_id, inventory_item_id, item_name, quantity, unit_cost, total_cost, no_cost)
  values (v_id, p_reservation_id, p_inventory_item_id, p_item_name, p_quantity,
          case when v_cost is not null then v_cost / p_quantity end, v_cost,
          p_inventory_item_id is not null and v_cost is null);
  return v_id;
end;
$$;

create or replace function update_stock_consumption(p_id uuid, p_new_quantity numeric, p_new_item_name text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  c reservation_stock_consumption%rowtype;
  v_delta numeric;
  v_extra numeric;
  v_back numeric;
  v_total numeric;
begin
  if not has_permission(auth.uid(), 'action:festa.consumo_pos_festa') then raise exception 'Sem permissão'; end if;
  if p_new_quantity is null or p_new_quantity <= 0 then raise exception 'Quantidade deve ser maior que zero.'; end if;
  select * into c from reservation_stock_consumption where id = p_id for update;
  if not found then return; end if;
  v_delta := p_new_quantity - c.quantity;
  v_total := c.total_cost;
  if c.inventory_item_id is not null and v_delta > 0 then
    v_extra := stock_apply_out(c.inventory_item_id, v_delta, 'consumo_ajuste', 'Consumo pós-festa editado', null, p_id, null, c.reservation_id);
    if v_total is not null or v_extra is not null then v_total := coalesce(v_total, 0) + coalesce(v_extra, 0); end if;
  elsif c.inventory_item_id is not null and v_delta < 0 then
    -- redução volta pelo custo congelado da linha
    v_back := case when c.total_cost is not null then (-v_delta) * c.total_cost / c.quantity end;
    perform stock_apply_in(c.inventory_item_id, -v_delta, case when c.no_cost then null else coalesce(v_back, 0) end,
                           'consumo_ajuste', 'Consumo pós-festa editado', null, p_id, null, c.reservation_id);
    if v_total is not null then v_total := v_total - v_back; end if;
  end if;
  update reservation_stock_consumption set
    quantity = p_new_quantity,
    item_name = coalesce(p_new_item_name, item_name),
    total_cost = v_total,
    unit_cost = case when v_total is not null then v_total / p_new_quantity end
  where id = p_id;
end;
$$;

create or replace function undo_stock_consumption(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c reservation_stock_consumption%rowtype;
begin
  if not has_permission(auth.uid(), 'action:festa.consumo_pos_festa') then raise exception 'Sem permissão'; end if;
  select * into c from reservation_stock_consumption where id = p_id for update;
  if not found then return; end if;
  if c.inventory_item_id is not null then
    perform stock_apply_in(c.inventory_item_id, c.quantity, case when c.no_cost then null else coalesce(c.total_cost, 0) end,
                           'consumo_desfeito', 'Consumo pós-festa desfeito', null, p_id, null, c.reservation_id);
  end if;
  delete from reservation_stock_consumption where id = p_id;
end;
$$;

-- ---------- 4) Transferência e acertos entre unidades ----------
create table if not exists unit_settlements (
  id uuid primary key default gen_random_uuid(),
  numero bigserial unique,
  from_unit_id uuid not null references units(id), -- quem mandou (a receber)
  to_unit_id uuid not null references units(id),   -- quem recebeu (a pagar)
  from_item_id uuid references inventory_items(id) on delete set null,
  to_item_id uuid references inventory_items(id) on delete set null,
  item_name text not null,
  quantity numeric(14,3) not null,
  unit_of_measure text,
  unit_cost numeric(18,6),
  amount numeric(14,2) not null default 0,
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'cancelado', 'sem_valor')),
  transfer_date date not null default today_brazil(),
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  batch_id uuid,
  paid_date date,
  payment_method text,
  confirmed_by_name text,
  confirmed_at timestamptz,
  cancel_reason text,
  cancelled_by_name text
);
create index if not exists idx_unit_settlements_status on unit_settlements (status);

create table if not exists other_incomes (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id),
  kind text not null default 'acerto_unidades',
  description text not null,
  amount numeric(14,2) not null,
  received_date date not null,
  payment_method text,
  settlement_batch_id uuid unique,
  created_at timestamptz not null default now()
);

alter table unit_settlements enable row level security;
alter table other_incomes enable row level security;
drop policy if exists "read_unit_settlements" on unit_settlements;
create policy "read_unit_settlements" on unit_settlements for select
  using (has_permission(auth.uid(), 'page:acertos') or has_permission(auth.uid(), 'page:estoque') or has_permission(auth.uid(), 'page:financeiro'));
drop policy if exists "read_active" on other_incomes;
create policy "read_active" on other_incomes for select using (is_active_user(auth.uid()));
-- sem políticas de escrita: só as funções abaixo gravam nessas tabelas.

create or replace function transfer_stock(p_item uuid, p_dest_unit uuid, p_quantity numeric, p_allow_zero boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it inventory_items%rowtype;
  v_dest uuid;
  v_dest_has_cost boolean;
  v_cost numeric;
  v_sid uuid := gen_random_uuid();
  v_amount numeric;
  v_num bigint;
begin
  if not has_permission(auth.uid(), 'page:estoque') then raise exception 'Sem permissão'; end if;
  select * into it from inventory_items where id = p_item for update;
  if not found then raise exception 'Item não encontrado.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Informe uma quantidade válida.'; end if;
  if p_quantity > it.quantity then raise exception 'Essa quantidade é maior do que o disponível.'; end if;
  if p_dest_unit = it.unit_id then raise exception 'Escolha outra unidade de destino.'; end if;
  if not it.has_cost and not p_allow_zero then
    raise exception 'SEM_CUSTO: % está sem custo. O acerto entre as unidades ficaria com valor zero.', it.name;
  end if;

  select id, has_cost into v_dest, v_dest_has_cost from inventory_items where unit_id = p_dest_unit and name = it.name limit 1 for update;
  if v_dest is null then
    insert into inventory_items (unit_id, name, category, unit_of_measure, quantity, minimum_quantity, quantity_per_guest, supplier, consumption_type)
    values (p_dest_unit, it.name, it.category, it.unit_of_measure, 0, it.minimum_quantity, it.quantity_per_guest, it.supplier, it.consumption_type)
    returning id into v_dest;
    v_dest_has_cost := false;
  end if;

  v_cost := coalesce(stock_apply_out(p_item, p_quantity, 'transferencia_saida', 'Transferência entre unidades', null, null, v_sid), 0);
  perform stock_apply_in(v_dest, p_quantity,
                         case when it.has_cost then v_cost when v_dest_has_cost then 0 else null end,
                         'transferencia_entrada', 'Transferência entre unidades', null, null, v_sid);

  v_amount := round(v_cost, 2);
  insert into unit_settlements (id, from_unit_id, to_unit_id, from_item_id, to_item_id, item_name, quantity, unit_of_measure,
                                unit_cost, amount, status, created_by_name)
  values (v_sid, it.unit_id, p_dest_unit, p_item, v_dest, it.name, p_quantity, it.unit_of_measure,
          case when it.has_cost then v_cost / p_quantity end, v_amount,
          case when v_amount > 0 then 'pendente' else 'sem_valor' end, current_actor_name())
  returning numero into v_num;

  return jsonb_build_object('settlement_id', v_sid, 'numero', v_num, 'amount', v_amount, 'status', case when v_amount > 0 then 'pendente' else 'sem_valor' end,
                            'from_unit', (select name from units where id = it.unit_id), 'to_unit', (select name from units where id = p_dest_unit),
                            'item', it.name, 'quantity', p_quantity, 'unit_of_measure', it.unit_of_measure, 'dest_item_id', v_dest);
end;
$$;

create or replace function confirm_settlements(p_ids uuid[], p_paid_date date, p_payment_method text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_batch uuid := gen_random_uuid();
  v_from uuid;
  v_to uuid;
  v_total numeric;
  v_count int;
  v_itens text;
  v_numeros text;
  v_datas text;
begin
  if not has_permission(auth.uid(), 'action:acertos.confirmar') then raise exception 'Sem permissão para confirmar acertos.'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then raise exception 'Selecione ao menos um acerto.'; end if;

  perform 1 from unit_settlements where id = any(p_ids) for update;
  if (select count(*) from unit_settlements where id = any(p_ids)) <> array_length(p_ids, 1) then raise exception 'Acerto não encontrado.'; end if;
  if exists (select 1 from unit_settlements where id = any(p_ids) and status <> 'pendente') then
    raise exception 'Só é possível confirmar acertos pendentes (algum já foi confirmado ou cancelado).';
  end if;
  if (select count(distinct (from_unit_id, to_unit_id)) from unit_settlements where id = any(p_ids)) > 1 then
    raise exception 'No lote, todos os acertos precisam ter a mesma origem e o mesmo destino.';
  end if;

  select min(from_unit_id::text)::uuid, min(to_unit_id::text)::uuid, sum(amount),
         string_agg(fmt_qtd(quantity) || ' ' || coalesce(unit_of_measure, 'un') || ' de ' || item_name, ', ' order by numero),
         string_agg(numero::text, ', ' order by numero),
         string_agg(distinct to_char(transfer_date, 'DD/MM'), ', ')
  into v_from, v_to, v_total, v_itens, v_numeros, v_datas
  from unit_settlements where id = any(p_ids);

  perform set_config('app.expense_fn', '1', true);
  insert into expenses (unit_id, category, description, amount, due_date, paid_date, status, payment_method, settlement_batch_id)
  values (v_to, 'Transferência entre unidades',
          'Compra de estoque da unidade ' || (select name from units where id = v_from) || ': ' || v_itens ||
          ' (transferência de ' || v_datas || '). Acerto nº ' || v_numeros || '.',
          v_total, coalesce(p_paid_date, today_brazil()), coalesce(p_paid_date, today_brazil()), 'pago', p_payment_method, v_batch);
  perform set_config('app.expense_fn', '', true);

  insert into other_incomes (unit_id, kind, description, amount, received_date, payment_method, settlement_batch_id)
  values (v_from, 'acerto_unidades',
          'Recebimento da unidade ' || (select name from units where id = v_to) || ' por produtos transferidos: ' || v_itens || '. Acerto nº ' || v_numeros || '.',
          v_total, coalesce(p_paid_date, today_brazil()), p_payment_method, v_batch);

  update unit_settlements set status = 'pago', batch_id = v_batch, paid_date = coalesce(p_paid_date, today_brazil()),
         payment_method = p_payment_method, confirmed_by_name = current_actor_name(), confirmed_at = now()
  where id = any(p_ids);
  return v_batch;
end;
$$;

create or replace function undo_settlement_batch(p_batch_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:acertos.desfazer') then raise exception 'Sem permissão para desfazer a confirmação.'; end if;
  if not exists (select 1 from unit_settlements where batch_id = p_batch_id and status = 'pago') then raise exception 'Confirmação não encontrada.'; end if;
  perform set_config('app.expense_fn', '1', true);
  delete from expenses where settlement_batch_id = p_batch_id;
  perform set_config('app.expense_fn', '', true);
  delete from other_incomes where settlement_batch_id = p_batch_id;
  update unit_settlements set status = 'pendente', batch_id = null, paid_date = null, payment_method = null,
         confirmed_by_name = null, confirmed_at = null
  where batch_id = p_batch_id;
end;
$$;

create or replace function cancel_settlement(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:acertos.confirmar') then raise exception 'Sem permissão.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  update unit_settlements set status = 'cancelado', cancel_reason = trim(p_reason), cancelled_by_name = current_actor_name()
  where id = p_id and status = 'pendente';
  if not found then raise exception 'Só é possível cancelar acerto pendente.'; end if;
end;
$$;

-- ---------- 5) Estorno no cancelamento ----------
-- Cria/atualiza/remove a saída "Estorno" da festa (no máximo uma ativa).
create or replace function sync_cancellation_refund(
  p_reservation_id uuid, p_refund_paid boolean, p_payment_method text, p_paid_date date, p_due_date date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_paid numeric;
  v_desc text;
  v_id uuid;
begin
  select res.id, res.unit_id, res.event_date, res.status, res.cancellation_reason, res.cancellation_fee_percent, res.refund_amount, c.name cliente
  into r from reservations res join clients c on c.id = res.client_id where res.id = p_reservation_id;
  if not found then return null; end if;
  select id into v_id from expenses where reservation_id = p_reservation_id and category = 'Estorno' and status <> 'cancelado' limit 1;

  perform set_config('app.expense_fn', '1', true);
  if r.status <> 'cancelada' or coalesce(r.refund_amount, 0) <= 0 then
    if v_id is not null then delete from expenses where id = v_id; end if;
    perform set_config('app.expense_fn', '', true);
    return null;
  end if;

  select coalesce(sum(amount), 0) into v_paid from payments where reservation_id = p_reservation_id;
  v_desc := 'Estorno — cancelamento da festa de ' || r.cliente || ' de ' || to_char(r.event_date, 'DD/MM') ||
            '. Motivo: ' || coalesce(nullif(trim(r.cancellation_reason), ''), 'não informado') ||
            '. Multa retida: ' || fmt_qtd(coalesce(r.cancellation_fee_percent, 0)) || '%' ||
            '. Valor pago pelo cliente: ' || fmt_brl(v_paid) || '. Valor devolvido: ' || fmt_brl(r.refund_amount) || '.';

  if v_id is null then
    insert into expenses (unit_id, category, description, supplier, amount, due_date, paid_date, status, payment_method, reservation_id)
    values (r.unit_id, 'Estorno', v_desc, r.cliente, r.refund_amount,
            case when p_refund_paid then coalesce(p_paid_date, today_brazil()) else coalesce(p_due_date, today_brazil()) end,
            case when p_refund_paid then coalesce(p_paid_date, today_brazil()) end,
            case when p_refund_paid then 'pago' else 'a_vencer' end,
            case when p_refund_paid then p_payment_method end, p_reservation_id)
    returning id into v_id;
  else
    update expenses set
      description = v_desc, amount = r.refund_amount, supplier = r.cliente,
      due_date = case when p_refund_paid then coalesce(p_paid_date, today_brazil()) else coalesce(p_due_date, due_date) end,
      paid_date = case when p_refund_paid then coalesce(p_paid_date, today_brazil()) end,
      status = case when p_refund_paid then 'pago' else 'a_vencer' end,
      payment_method = case when p_refund_paid then p_payment_method end
    where id = v_id;
  end if;
  perform set_config('app.expense_fn', '', true);
  return v_id;
end;
$$;
revoke all on function sync_cancellation_refund(uuid, boolean, text, date, date) from public, anon, authenticated;

create or replace function cancel_reservation(
  p_id uuid, p_reason text, p_fee_percent numeric, p_refund numeric,
  p_refund_paid boolean, p_payment_method text, p_paid_date date, p_due_date date
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:festa.editar_dados') then raise exception 'Sem permissão para cancelar a festa.'; end if;
  if coalesce(p_refund, 0) > 0 and not has_permission(auth.uid(), 'action:festa.estorno') then
    raise exception 'Sem permissão para registrar estorno de cancelamento.';
  end if;
  if coalesce(p_refund, 0) < 0 then raise exception 'Valor devolvido inválido.'; end if;
  update reservations set status = 'cancelada', cancellation_reason = nullif(trim(p_reason), ''),
         cancellation_fee_percent = p_fee_percent, refund_amount = p_refund, cancelled_at = now()
  where id = p_id;
  if not found then raise exception 'Festa não encontrada.'; end if;
  perform sync_cancellation_refund(p_id, p_refund_paid, p_payment_method, p_paid_date, p_due_date);
end;
$$;

create or replace function save_cancellation_refund(
  p_id uuid, p_refund numeric, p_refund_paid boolean, p_payment_method text, p_paid_date date, p_due_date date
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:festa.estorno') then raise exception 'Sem permissão para registrar estorno.'; end if;
  if coalesce(p_refund, 0) < 0 then raise exception 'Valor devolvido inválido.'; end if;
  update reservations set refund_amount = p_refund where id = p_id and status = 'cancelada';
  if not found then raise exception 'A festa precisa estar cancelada.'; end if;
  perform sync_cancellation_refund(p_id, p_refund_paid, p_payment_method, p_paid_date, p_due_date);
end;
$$;

-- Festa que deixa de estar cancelada: o estorno vinculado é cancelado.
create or replace function cancel_refund_on_uncancel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'cancelada' and new.status <> 'cancelada' then
    perform set_config('app.expense_fn', '1', true);
    perform set_config('app.audit_actor', 'Sistema (festa reativada)', true);
    update expenses set status = 'cancelado', description = description || ' (cancelado: a festa foi reativada)'
    where reservation_id = new.id and category = 'Estorno' and status <> 'cancelado';
    perform set_config('app.audit_actor', '', true);
    perform set_config('app.expense_fn', '', true);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_cancel_refund_on_uncancel on reservations;
create trigger trg_cancel_refund_on_uncancel after update of status on reservations
  for each row execute function cancel_refund_on_uncancel();

-- ---------- 6) Consumo por convidado ----------
alter table reservations add column if not exists consumption_finalized boolean not null default false;
alter table reservations add column if not exists exclude_from_averages boolean not null default false;
alter table reservations add column if not exists exclude_reason text;

create or replace function set_consumption_status(p_id uuid, p_finalized boolean, p_exclude boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:festa.consumo_pos_festa') then raise exception 'Sem permissão'; end if;
  if p_exclude and coalesce(trim(p_reason), '') = '' then raise exception 'Informe o motivo para excluir das médias.'; end if;
  update reservations set consumption_finalized = p_finalized, exclude_from_averages = p_exclude,
         exclude_reason = case when p_exclude then trim(p_reason) end
  where id = p_id;
end;
$$;

-- Médias reais de consumo por item, calculadas na hora (nunca ficam defasadas).
-- Festas: realizadas, não canceladas, consumo finalizado, não excluídas, com
-- convidados (contratados + cortesias). Janela: últimas p_limit por unidade.
-- Item "por convidado": festa sem consumo do item conta como zero.
-- Média ponderada = soma das quantidades ÷ soma dos convidados.
create or replace function consumption_averages(p_unit uuid default null, p_limit int default 10)
returns table (
  inventory_item_id uuid, unit_id uuid, item_name text, unit_of_measure text, consumption_type text,
  festas int, total_qty numeric, total_guests numeric, avg_per_guest numeric, min_per_guest numeric, max_per_guest numeric,
  avg_per_festa numeric, total_cost numeric, avg_cost_per_guest numeric, avg_cost_per_festa numeric,
  configured_per_guest numeric, current_unit_cost numeric, current_quantity numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission(auth.uid(), 'page:estoque') or has_permission(auth.uid(), 'page:lucro_por_festa')) then raise exception 'Sem permissão'; end if;
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
    left join reservation_stock_consumption c on c.reservation_id = s.id and c.inventory_item_id = i.id
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

-- ---------- Acessos às funções ----------
do $$
declare f text;
begin
  foreach f in array array[
    'adjust_stock(uuid, numeric, text)', 'set_initial_stock_cost(uuid, numeric)',
    'save_stock_purchase(uuid, uuid, text, date, text, boolean, text, date, date, numeric, jsonb, text)',
    'delete_stock_purchase(uuid, text)', 'record_stock_purchase(uuid, uuid, text, numeric)', 'undo_stock_purchase(uuid)',
    'record_stock_consumption(uuid, uuid, text, numeric)', 'update_stock_consumption(uuid, numeric, text)', 'undo_stock_consumption(uuid)',
    'transfer_stock(uuid, uuid, numeric, boolean)', 'confirm_settlements(uuid[], date, text)', 'undo_settlement_batch(uuid)',
    'cancel_settlement(uuid, text)', 'cancel_reservation(uuid, text, numeric, numeric, boolean, text, date, date)',
    'save_cancellation_refund(uuid, numeric, boolean, text, date, date)', 'set_consumption_status(uuid, boolean, boolean, text)',
    'consumption_averages(uuid, int)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function fmt_brl(numeric) from anon;
revoke all on function fmt_qtd(numeric) from anon;

-- Histórico de quem fez o quê também nos acertos e entradas avulsas.
drop trigger if exists trg_audit on unit_settlements;
create trigger trg_audit after insert or update or delete on unit_settlements for each row execute function audit_row_change();
drop trigger if exists trg_audit on other_incomes;
create trigger trg_audit after insert or update or delete on other_incomes for each row execute function audit_row_change();

-- =========================================================
-- ACERTO ENTRE UNIDADES VIRA CONTA A PAGAR NA HORA
--
-- Antes (057): a transferência criava só um acerto "pendente", e o dinheiro
-- aparecia no Financeiro apenas quando alguém confirmava o acerto.
-- Agora: ao transferir, a unidade que RECEBEU os produtos já ganha uma conta
-- a pagar (A vencer → Atrasado → Pago, como qualquer conta), categoria
-- "Transferência entre unidades". Quando essa conta é marcada como paga
-- (no Financeiro ou na tela de Acertos), o sistema, sozinho e uma única vez:
--   • marca o acerto como Pago;
--   • lança a entrada na unidade que MANDOU os produtos (recuperação de
--     custo de estoque — não é faturamento).
-- Voltar a conta para não paga desfaz a entrada e o acerto volta a Pendente.
-- Cancelar o acerto cancela a conta. Valor, unidade e descrição da conta não
-- podem ser editados (só pelo acerto).
-- =========================================================

alter table expenses add column if not exists settlement_id uuid references unit_settlements(id) on delete set null;
create unique index if not exists uq_expenses_settlement on expenses (settlement_id) where settlement_id is not null;
alter table other_incomes add column if not exists settlement_id uuid references unit_settlements(id) on delete set null;
create unique index if not exists uq_other_incomes_settlement on other_incomes (settlement_id) where settlement_id is not null;
alter table unit_settlements add column if not exists due_date date;

-- Trava: conta de acerto só muda situação/pagamento; o resto, só pelo acerto.
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

-- Cria a conta a pagar de um acerto pendente (unidade que recebeu os produtos).
create or replace function create_settlement_payable(p_settlement uuid, p_due_date date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s unit_settlements%rowtype;
  v_id uuid;
begin
  select * into s from unit_settlements where id = p_settlement;
  if not found or s.status <> 'pendente' or s.amount <= 0 then return null; end if;
  select id into v_id from expenses where settlement_id = p_settlement;
  if v_id is not null then return v_id; end if;
  perform set_config('app.expense_fn', '1', true);
  insert into expenses (unit_id, category, description, supplier, amount, due_date, status, settlement_id)
  values (s.to_unit_id, 'Transferência entre unidades',
          'Compra de estoque da unidade ' || (select name from units where id = s.from_unit_id) || ': ' ||
          fmt_qtd(s.quantity) || ' ' || coalesce(s.unit_of_measure, 'un') || ' de ' || s.item_name ||
          ' (transferência de ' || to_char(s.transfer_date, 'DD/MM') || '). Acerto nº ' || s.numero || '.',
          (select name from units where id = s.from_unit_id),
          s.amount, coalesce(p_due_date, today_brazil()), 'a_vencer', p_settlement)
  returning id into v_id;
  perform set_config('app.expense_fn', '', true);
  update unit_settlements set due_date = coalesce(p_due_date, today_brazil()) where id = p_settlement;
  return v_id;
end;
$$;
revoke all on function create_settlement_payable(uuid, date) from public, anon, authenticated;

-- Conta do acerto paga / despaga → acerto e entrada da outra unidade acompanham.
create or replace function sync_settlement_from_expense() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s unit_settlements%rowtype;
begin
  if new.settlement_id is null then return null; end if;
  select * into s from unit_settlements where id = new.settlement_id for update;
  if not found then return null; end if;

  if new.status = 'pago' then
    insert into other_incomes (unit_id, kind, description, amount, received_date, payment_method, settlement_id)
    values (s.from_unit_id, 'acerto_unidades',
            'Recebimento da unidade ' || (select name from units where id = s.to_unit_id) || ' por produtos transferidos: ' ||
            fmt_qtd(s.quantity) || ' ' || coalesce(s.unit_of_measure, 'un') || ' de ' || s.item_name || '. Acerto nº ' || s.numero || '.',
            new.amount, coalesce(new.paid_date, today_brazil()), new.payment_method, s.id)
    on conflict (settlement_id) where settlement_id is not null
    do update set received_date = excluded.received_date, payment_method = excluded.payment_method, amount = excluded.amount;
    update unit_settlements set status = 'pago', paid_date = coalesce(new.paid_date, today_brazil()), payment_method = new.payment_method,
           confirmed_by_name = coalesce(confirmed_by_name, current_actor_name()), confirmed_at = coalesce(confirmed_at, now())
    where id = s.id;
  elsif old.status = 'pago' then
    delete from other_incomes where settlement_id = s.id;
    update unit_settlements set status = 'pendente', paid_date = null, payment_method = null, confirmed_by_name = null, confirmed_at = null
    where id = s.id and status = 'pago';
  end if;
  return null;
end;
$$;
drop trigger if exists trg_sync_settlement_from_expense on expenses;
create trigger trg_sync_settlement_from_expense after update of status, paid_date, payment_method on expenses
  for each row execute function sync_settlement_from_expense();

-- Transferência: igual à 057, e já cria a conta a pagar na unidade que recebe.
create or replace function transfer_stock(p_item uuid, p_dest_unit uuid, p_quantity numeric, p_allow_zero boolean default false, p_due_date date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it inventory_items%rowtype;
  v_dest uuid;
  v_dest_has_cost boolean;
  v_cost numeric;
  v_sid uuid := gen_random_uuid();
  v_amount numeric;
  v_num bigint;
begin
  if not has_permission(auth.uid(), 'page:estoque') then raise exception 'Sem permissão'; end if;
  select * into it from inventory_items where id = p_item for update;
  if not found then raise exception 'Item não encontrado.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Informe uma quantidade válida.'; end if;
  if p_quantity > it.quantity then raise exception 'Essa quantidade é maior do que o disponível.'; end if;
  if p_dest_unit = it.unit_id then raise exception 'Escolha outra unidade de destino.'; end if;
  if not it.has_cost and not p_allow_zero then
    raise exception 'SEM_CUSTO: % está sem custo. O acerto entre as unidades ficaria com valor zero.', it.name;
  end if;

  select id, has_cost into v_dest, v_dest_has_cost from inventory_items where unit_id = p_dest_unit and name = it.name limit 1 for update;
  if v_dest is null then
    insert into inventory_items (unit_id, name, category, unit_of_measure, quantity, minimum_quantity, quantity_per_guest, supplier, consumption_type)
    values (p_dest_unit, it.name, it.category, it.unit_of_measure, 0, it.minimum_quantity, it.quantity_per_guest, it.supplier, it.consumption_type)
    returning id into v_dest;
    v_dest_has_cost := false;
  end if;

  v_cost := coalesce(stock_apply_out(p_item, p_quantity, 'transferencia_saida', 'Transferência entre unidades', null, null, v_sid), 0);
  perform stock_apply_in(v_dest, p_quantity,
                         case when it.has_cost then v_cost when v_dest_has_cost then 0 else null end,
                         'transferencia_entrada', 'Transferência entre unidades', null, null, v_sid);

  v_amount := round(v_cost, 2);
  insert into unit_settlements (id, from_unit_id, to_unit_id, from_item_id, to_item_id, item_name, quantity, unit_of_measure,
                                unit_cost, amount, status, created_by_name)
  values (v_sid, it.unit_id, p_dest_unit, p_item, v_dest, it.name, p_quantity, it.unit_of_measure,
          case when it.has_cost then v_cost / p_quantity end, v_amount,
          case when v_amount > 0 then 'pendente' else 'sem_valor' end, current_actor_name())
  returning numero into v_num;

  if v_amount > 0 then
    perform create_settlement_payable(v_sid, coalesce(p_due_date, today_brazil()));
  end if;

  return jsonb_build_object('settlement_id', v_sid, 'numero', v_num, 'amount', v_amount, 'status', case when v_amount > 0 then 'pendente' else 'sem_valor' end,
                            'from_unit', (select name from units where id = it.unit_id), 'to_unit', (select name from units where id = p_dest_unit),
                            'item', it.name, 'quantity', p_quantity, 'unit_of_measure', it.unit_of_measure, 'dest_item_id', v_dest,
                            'due_date', coalesce(p_due_date, today_brazil()));
end;
$$;
drop function if exists transfer_stock(uuid, uuid, numeric, boolean);

-- Confirmar na tela de Acertos = marcar as contas como pagas (o resto é automático).
create or replace function confirm_settlements(p_ids uuid[], p_paid_date date, p_payment_method text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if not has_permission(auth.uid(), 'action:acertos.confirmar') then raise exception 'Sem permissão para confirmar acertos.'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then raise exception 'Selecione ao menos um acerto.'; end if;
  perform 1 from unit_settlements where id = any(p_ids) for update;
  if (select count(*) from unit_settlements where id = any(p_ids)) <> array_length(p_ids, 1) then raise exception 'Acerto não encontrado.'; end if;
  if exists (select 1 from unit_settlements where id = any(p_ids) and status <> 'pendente') then
    raise exception 'Só é possível confirmar acertos pendentes (algum já foi confirmado ou cancelado).';
  end if;
  if (select count(distinct (from_unit_id, to_unit_id)) from unit_settlements where id = any(p_ids)) > 1 then
    raise exception 'No lote, todos os acertos precisam ter a mesma origem e o mesmo destino.';
  end if;
  for r in select id, due_date from unit_settlements where id = any(p_ids) loop
    perform create_settlement_payable(r.id, coalesce(r.due_date, p_paid_date));
    update expenses set status = 'pago', paid_date = coalesce(p_paid_date, today_brazil()), payment_method = p_payment_method
    where settlement_id = r.id;
  end loop;
  return null;
end;
$$;

-- Desfazer a confirmação de um acerto: a conta volta a não paga (a entrada some sozinha).
create or replace function undo_settlement(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:acertos.desfazer') then raise exception 'Sem permissão para desfazer a confirmação.'; end if;
  if not exists (select 1 from unit_settlements where id = p_id and status = 'pago') then raise exception 'Este acerto não está pago.'; end if;
  update expenses set status = 'a_vencer', paid_date = null, payment_method = null where settlement_id = p_id;
end;
$$;

-- Cancelar acerto pendente cancela também a conta a pagar dele.
create or replace function cancel_settlement(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:acertos.confirmar') then raise exception 'Sem permissão.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  update unit_settlements set status = 'cancelado', cancel_reason = trim(p_reason), cancelled_by_name = current_actor_name()
  where id = p_id and status = 'pendente';
  if not found then raise exception 'Só é possível cancelar acerto pendente.'; end if;
  perform set_config('app.expense_fn', '1', true);
  update expenses set status = 'cancelado', description = description || ' (cancelado: ' || trim(p_reason) || ')' where settlement_id = p_id;
  perform set_config('app.expense_fn', '', true);
end;
$$;

-- Acertos pendentes que já existiam ganham a conta a pagar agora.
do $$
declare r record;
begin
  for r in select id from unit_settlements where status = 'pendente' and amount > 0 loop
    perform create_settlement_payable(r.id, today_brazil());
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array['transfer_stock(uuid, uuid, numeric, boolean, date)', 'undo_settlement(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- =========================================================
-- PORTAL DO CLIENTE
--
-- Um link por festa (o mesmo token da antiga lista de convidados — os
-- links já enviados continuam funcionando) onde o cliente, sem login:
--   • escolhe o cardápio (pratos quentes + massa e recheio do bolo) até 7
--     dias antes da festa;
--   • envia a lista de convidados até 1 dia antes (vai direto para a lista
--     da recepção que já existe);
--   • escolhe a música (Vila Operária): equipe escolhe ou envia playlist;
--   • vê valores e pagamentos, copia o Pix e envia o comprovante;
--   • manda mensagem para a equipe; avalia a festa quando ela termina.
-- Tudo grava direto nos dados da festa e fica registrado em portal_events
-- (histórico do cliente e avisos no Painel). Quem vê os avisos: permissão
-- "page:portal_avisos" (Administrador, Gerente, Financeiro, Comercial).
--
-- O visitante sem login só chega aos dados pelas funções portal_* abaixo,
-- que exigem o token do link e devolvem só a festa daquele link.
-- =========================================================

-- ---------- Pratos quentes por plano e por adicional ----------
alter table packages add column if not exists hot_dish_count int;
update packages
set hot_dish_count = coalesce(substring(included_items from 'até ([0-9]+)')::int, 0)
where hot_dish_count is null;
-- Único plano sem o número no texto: São Vicente 40 pessoas (2026) = 3.
update packages p set hot_dish_count = 3
from units u
where u.id = p.unit_id and u.name = 'São Vicente' and p.name = 'Festa Completa 40 pessoas' and coalesce(p.hot_dish_count, 0) = 0;
alter table packages alter column hot_dish_count set default 0;
update packages set hot_dish_count = 0 where hot_dish_count is null;

-- Item extra que dá direito a mais pratos quentes (ex: "Prato quente adicional").
alter table extra_items add column if not exists adds_hot_dishes int not null default 0;
update extra_items set adds_hot_dishes = 1 where adds_hot_dishes = 0 and name ilike '%prato quente%';

-- ---------- Cardápio oferecido no portal (editável em Pacotes e itens) ----------
create table if not exists portal_menu_options (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('prato', 'bolo_massa', 'bolo_sabor')),
  name text not null,
  sort int not null default 0,
  active boolean not null default true,
  unique (kind, name)
);
insert into portal_menu_options (kind, name, sort)
select 'prato', n, o from unnest(array[
  'Lasanha de queijo e presunto', 'Lasanha de brócolis', 'Lasanha de frango', 'Lasanha de carne', 'Empadão de palmito',
  'Empadão de frango com requeijão', 'Empadão de carne', 'Empadão de legumes', 'Torta salgada de frango', 'Torta de palmito',
  'Escondidinho de calabresa', 'Escondidinho de linguiça Blumenau', 'Escondidinho de carne desfiada', 'Fricassê',
  'Pão picante de frango', 'Frango à delícia']) with ordinality as t(n, o)
on conflict (kind, name) do nothing;
insert into portal_menu_options (kind, name, sort)
select 'bolo_massa', n, o from unnest(array['Branca', 'Chocolate', 'Mesclada']) with ordinality as t(n, o)
on conflict (kind, name) do nothing;
insert into portal_menu_options (kind, name, sort)
select 'bolo_sabor', n, o from unnest(array[
  'Morango com 4 leites', 'Morango com nata, suspiro e chocolate branco', 'Morango com chocolate ao leite', 'Ameixa com coco',
  'Dois Amores', 'Brigadeiro', 'Beijinho', 'Três brigadeiros', 'Brigadeiro de leite em pó', 'Brigadeiro de leite em pó com creme de avelã',
  'Sonho de Valsa', 'Prestígio', 'Charge', 'Negresco', 'Oreo', 'Red Velvet', '4 leites', '5 leites', 'Strogonoff de nozes',
  'Mousse de maracujá', 'Mousse de limão', 'Síria', 'Frutas vermelhas']) with ordinality as t(n, o)
on conflict (kind, name) do nothing;

alter table portal_menu_options enable row level security;
drop policy if exists "read_active" on portal_menu_options;
create policy "read_active" on portal_menu_options for select using (is_active_user(auth.uid()));
drop policy if exists "write_portal_menu_options" on portal_menu_options;
create policy "write_portal_menu_options" on portal_menu_options for all
  using (has_permission(auth.uid(), 'action:pacotes.criar_editar'))
  with check (has_permission(auth.uid(), 'action:pacotes.criar_editar'));

-- ---------- Dados novos da festa ----------
alter table reservations add column if not exists cake_dough text;
alter table reservations add column if not exists menu_confirmed_at timestamptz;
alter table reservations add column if not exists music_choice text check (music_choice in ('equipe', 'cliente'));

-- ---------- Registro de tudo o que o cliente faz (histórico + avisos) ----------
create table if not exists portal_events (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  kind text not null, -- cardapio, convidados, musica, comprovante, mensagem, avaliacao
  description text not null,
  ref_id uuid,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  seen_by_name text
);
create index if not exists idx_portal_events_reservation on portal_events (reservation_id, created_at desc);
create index if not exists idx_portal_events_unseen on portal_events (created_at desc) where seen_at is null;

create table if not exists portal_messages (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  from_client boolean not null,
  author_name text,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_portal_messages_reservation on portal_messages (reservation_id, created_at);

create table if not exists portal_receipts (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  storage_path text not null,
  status text not null default 'em_analise' check (status in ('em_analise', 'lancado', 'recusado')),
  reject_reason text,
  decided_by_name text,
  decided_at timestamptz,
  payment_id uuid references payments(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_portal_receipts_reservation on portal_receipts (reservation_id, created_at desc);

alter table portal_events enable row level security;
alter table portal_messages enable row level security;
alter table portal_receipts enable row level security;
drop policy if exists "read_portal_events" on portal_events;
create policy "read_portal_events" on portal_events for select
  using (has_permission(auth.uid(), 'page:portal_avisos') or has_permission(auth.uid(), 'page:festa_detalhe'));
drop policy if exists "read_portal_messages" on portal_messages;
create policy "read_portal_messages" on portal_messages for select using (has_permission(auth.uid(), 'page:festa_detalhe') or has_permission(auth.uid(), 'page:portal_avisos'));
drop policy if exists "read_portal_receipts" on portal_receipts;
create policy "read_portal_receipts" on portal_receipts for select
  using (has_permission(auth.uid(), 'page:portal_avisos') or has_permission(auth.uid(), 'action:festa.pagamentos'));
-- Escrita só pelas funções abaixo.

-- Comprovantes: arquivos guardados por pasta = token do link.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal-comprovantes', 'portal-comprovantes', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

create or replace function portal_token_valid(p_token text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from guest_list_pages where token::text = p_token);
$$;
grant execute on function portal_token_valid(text) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'portal_comprovantes_upload') then
    drop policy "portal_comprovantes_upload" on storage.objects;
  end if;
  create policy "portal_comprovantes_upload" on storage.objects for insert to anon, authenticated
    with check (bucket_id = 'portal-comprovantes' and portal_token_valid((storage.foldername(name))[1]));
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'portal_comprovantes_read') then
    drop policy "portal_comprovantes_read" on storage.objects;
  end if;
  create policy "portal_comprovantes_read" on storage.objects for select to authenticated
    using (bucket_id = 'portal-comprovantes' and (has_permission(auth.uid(), 'page:portal_avisos') or has_permission(auth.uid(), 'action:festa.pagamentos')));
end $$;

-- ---------- Permissão dos avisos ----------
insert into role_permission_items (role_id, permission_key, allowed)
select r.id, 'page:portal_avisos', true
from roles r
where not r.is_admin and (r.name ilike '%comercial%' or r.name ilike '%financeiro%' or r.name ilike '%gerente%' or r.name ilike '%gerência%')
on conflict (role_id, permission_key) do nothing;

-- ---------- Funções internas ----------
create or replace function portal_reservation(p_token uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select reservation_id from guest_list_pages where token = p_token;
$$;
revoke all on function portal_reservation(uuid) from public, anon, authenticated;

create or replace function portal_log(p_reservation uuid, p_kind text, p_description text, p_ref uuid default null) returns void
language sql security definer set search_path = public as $$
  insert into portal_events (reservation_id, kind, description, ref_id) values (p_reservation, p_kind, p_description, p_ref);
$$;
revoke all on function portal_log(uuid, text, text, uuid) from public, anon, authenticated;

-- Quantos pratos quentes a festa pode escolher: plano + extras "prato adicional".
create or replace function festa_hot_dish_limit(p_reservation uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'inclusos', coalesce((select p.hot_dish_count from reservations r join packages p on p.id = r.package_id where r.id = p_reservation), 0),
    'adicionais', coalesce((select sum(x.quantity * e.adds_hot_dishes) from reservation_extra_items x join extra_items e on e.id = x.extra_item_id where x.reservation_id = p_reservation), 0)
  );
$$;
revoke all on function festa_hot_dish_limit(uuid) from public, anon;
grant execute on function festa_hot_dish_limit(uuid) to authenticated;

-- Festa já terminou? (data + horário de término, no horário de Brasília)
create or replace function festa_ended(p_reservation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select ((event_date + end_time) at time zone 'America/Sao_Paulo') <= now() from reservations where id = p_reservation;
$$;
revoke all on function festa_ended(uuid) from public, anon, authenticated;

-- ---------- Funções do portal (visitante sem login, com o token) ----------
create or replace function portal_get(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  r record;
  v_limit jsonb;
  v_due numeric;
  v_paid numeric;
begin
  if v_res is null then return null; end if;
  select res.*, c.name cliente, u.name unidade, u.full_address, u.pix_key, u.google_review_link, u.extra_hour_price,
         p.name pacote, p.included_items, g.playlist_url
  into r
  from reservations res
  join clients c on c.id = res.client_id
  join units u on u.id = res.unit_id
  left join packages p on p.id = res.package_id
  join guest_list_pages g on g.token = p_token
  where res.id = v_res;

  v_limit := festa_hot_dish_limit(v_res);
  select coalesce(sum(amount), 0) into v_paid from payments where reservation_id = v_res;
  v_due := coalesce(r.final_value, 0)
    + coalesce((select sum(price_snapshot * quantity) from reservation_extra_items where reservation_id = v_res), 0)
    + coalesce((select sum(quantity * unit_price) from reservation_consumption where reservation_id = v_res), 0);

  return jsonb_build_object(
    'cliente', split_part(r.cliente, ' ', 1),
    'cliente_nome', r.cliente,
    'crianca', r.child_name, 'idade', r.child_age, 'tema', r.theme,
    'data', r.event_date, 'inicio', to_char(r.start_time, 'HH24:MI'), 'fim', to_char(r.end_time, 'HH24:MI'),
    'status', r.status,
    'unidade', r.unidade, 'vila', r.unidade = 'Vila Operária', 'endereco', r.full_address,
    'pix', r.pix_key, 'google_review_link', r.google_review_link, 'hora_extra', r.extra_hour_price,
    'pacote', r.pacote, 'itens_inclusos', r.included_items,
    'convidados_limite', coalesce(r.guest_count, 0) + coalesce(r.courtesy_guests, 0),
    'pratos_inclusos', (v_limit ->> 'inclusos')::int, 'pratos_adicionais', (v_limit ->> 'adicionais')::int,
    'pratos', case when coalesce(r.hot_dish_flavors, '') = '' then '[]'::jsonb else to_jsonb(array(select trim(x) from unnest(string_to_array(r.hot_dish_flavors, '/')) x where trim(x) <> '')) end,
    'bolo_sabor', r.cake_flavor, 'bolo_massa', r.cake_dough, 'cardapio_confirmado_em', r.menu_confirmed_at,
    'musica', r.music_choice, 'playlist', r.playlist_url,
    'prazo_cardapio', r.event_date - 7, 'prazo_convidados', r.event_date - 1, 'prazo_pagamento', r.event_date - 1,
    'hoje', today_brazil(),
    'festa_terminou', festa_ended(v_res),
    'valor_total', v_due, 'pago', v_paid, 'saldo', greatest(v_due - v_paid, 0),
    'pagamentos', coalesce((select jsonb_agg(jsonb_build_object('data', payment_date, 'valor', amount, 'forma', payment_method, 'obs', notes) order by payment_date, created_at)
                            from payments where reservation_id = v_res), '[]'::jsonb),
    'comprovantes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'valor', amount, 'status', status, 'motivo', reject_reason, 'enviado_em', created_at) order by created_at desc)
                              from portal_receipts where reservation_id = v_res), '[]'::jsonb),
    'contrato', (select jsonb_build_object('gerado_em', generated_at, 'texto', terms_text) from contracts where reservation_id = v_res order by generated_at desc nulls last limit 1),
    'mensagens', coalesce((select jsonb_agg(jsonb_build_object('de_cliente', from_client, 'autor', author_name, 'texto', body, 'em', created_at) order by created_at)
                           from portal_messages where reservation_id = v_res), '[]'::jsonb),
    'historico', coalesce((select jsonb_agg(jsonb_build_object('em', created_at, 'texto', description) order by created_at desc)
                           from (select * from portal_events where reservation_id = v_res order by created_at desc limit 100) e), '[]'::jsonb),
    'avaliou', exists (select 1 from party_reviews pr join review_links rl on rl.token = pr.token where rl.reservation_id = v_res),
    'menu', jsonb_build_object(
      'pratos', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'prato' and active), '[]'::jsonb),
      'massas', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'bolo_massa' and active), '[]'::jsonb),
      'sabores', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'bolo_sabor' and active), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function portal_list_guests(p_token uuid) returns table (id uuid, name text, arrived boolean)
language sql stable security definer set search_path = public as $$
  select id, name, arrived from guest_list_entries where token = p_token order by created_at, name;
$$;

create or replace function portal_save_menu(p_token uuid, p_pratos text[], p_massa text, p_sabor text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_date date;
  v_limit jsonb;
  v_max int;
  v_pratos text[];
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  select event_date into v_date from reservations where id = v_res;
  if today_brazil() > v_date - 7 then
    raise exception 'O prazo para escolher o cardápio terminou em %. Para alterar, fale com a equipe.', to_char(v_date - 7, 'DD/MM');
  end if;
  v_limit := festa_hot_dish_limit(v_res);
  v_max := (v_limit ->> 'inclusos')::int + (v_limit ->> 'adicionais')::int;
  select array(select distinct trim(x) from unnest(coalesce(p_pratos, '{}')) x where trim(x) <> '') into v_pratos;
  if coalesce(array_length(v_pratos, 1), 0) <> v_max then
    raise exception 'Escolha % prato(s) quente(s).', v_max;
  end if;
  if exists (select 1 from unnest(v_pratos) x where not exists (select 1 from portal_menu_options where kind = 'prato' and active and name = x)) then
    raise exception 'Prato quente inválido.';
  end if;
  if not exists (select 1 from portal_menu_options where kind = 'bolo_massa' and active and name = p_massa) then
    raise exception 'Escolha a massa do bolo.';
  end if;
  if p_sabor is distinct from 'Outro sabor (combinar com a equipe)' and not exists (select 1 from portal_menu_options where kind = 'bolo_sabor' and active and name = p_sabor) then
    raise exception 'Escolha o recheio do bolo.';
  end if;

  perform set_config('app.audit_actor', 'Cliente (portal)', true);
  update reservations set
    hot_dish_flavors = nullif(array_to_string(v_pratos, ' / '), ''),
    cake_dough = p_massa,
    cake_flavor = p_sabor,
    menu_confirmed_at = now()
  where id = v_res;
  perform set_config('app.audit_actor', '', true);
  perform portal_log(v_res, 'cardapio',
    'Confirmou o cardápio: ' || coalesce(nullif(array_to_string(v_pratos, ', '), ''), 'sem pratos quentes') || ' · bolo de massa ' || lower(p_massa) || ', recheio ' || p_sabor);
end;
$$;

create or replace function portal_add_guests(p_token uuid, p_names text[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_date date;
  v_count integer;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  select event_date into v_date from reservations where id = v_res;
  if today_brazil() > v_date - 1 then
    raise exception 'A lista de convidados fechou em %. Para incluir alguém, fale com a equipe.', to_char(v_date - 1, 'DD/MM');
  end if;
  if coalesce(array_length(p_names, 1), 0) > 300 then raise exception 'Muitos nomes de uma vez.'; end if;
  if (select count(*) from guest_list_entries where token = p_token) + coalesce(array_length(p_names, 1), 0) > 1000 then
    raise exception 'Lista cheia.';
  end if;
  insert into guest_list_entries (token, name)
  select p_token, left(trim(n), 120) from unnest(p_names) n where trim(n) <> '';
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform portal_log(v_res, 'convidados',
      case when v_count = 1 then 'Adicionou ' || (select left(trim(n), 120) from unnest(p_names) n where trim(n) <> '' limit 1) || ' à lista de convidados'
           else 'Adicionou ' || v_count || ' convidados à lista' end);
  end if;
  return v_count;
end;
$$;

create or replace function portal_remove_guest(p_token uuid, p_entry_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_date date;
  v_name text;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  select event_date into v_date from reservations where id = v_res;
  if today_brazil() > v_date - 1 then
    raise exception 'A lista de convidados fechou. Para alterar, fale com a equipe.';
  end if;
  delete from guest_list_entries where id = p_entry_id and token = p_token and not arrived and not coalesce(flagged, false)
  returning name into v_name;
  if v_name is not null then perform portal_log(v_res, 'convidados', 'Removeu ' || v_name || ' da lista de convidados'); end if;
end;
$$;

create or replace function portal_set_music(p_token uuid, p_choice text, p_url text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_url text := nullif(trim(coalesce(p_url, '')), '');
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  if (select u.name from reservations r join units u on u.id = r.unit_id where r.id = v_res) <> 'Vila Operária' then
    raise exception 'A escolha de música está disponível só nas festas da Vila Operária.';
  end if;
  if p_choice not in ('equipe', 'cliente') then raise exception 'Escolha inválida.'; end if;
  if p_choice = 'cliente' and (v_url is null or v_url !~ '^https://(open\.spotify\.com|spotify\.link)/') then
    raise exception 'Envie um link do Spotify (open.spotify.com).';
  end if;
  perform set_config('app.audit_actor', 'Cliente (portal)', true);
  update reservations set music_choice = p_choice where id = v_res;
  update guest_list_pages set playlist_url = case when p_choice = 'cliente' then left(v_url, 500) end where token = p_token;
  perform set_config('app.audit_actor', '', true);
  perform portal_log(v_res, 'musica', case when p_choice = 'equipe' then 'Escolheu: músicas sugeridas pela equipe' else 'Enviou a playlist do Spotify' end);
end;
$$;

create or replace function portal_submit_receipt(p_token uuid, p_amount numeric, p_path text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_id uuid;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Informe o valor pago.'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> p_token::text then raise exception 'Arquivo inválido.'; end if;
  if (select count(*) from portal_receipts where reservation_id = v_res and status = 'em_analise') >= 5 then
    raise exception 'Já existem comprovantes aguardando conferência. Aguarde a equipe.';
  end if;
  insert into portal_receipts (reservation_id, amount, storage_path) values (v_res, round(p_amount, 2), p_path) returning id into v_id;
  perform portal_log(v_res, 'comprovante', 'Enviou comprovante de pagamento de ' || fmt_brl(p_amount), v_id);
  return v_id;
end;
$$;

create or replace function portal_send_message(p_token uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_body text := left(trim(coalesce(p_body, '')), 1000);
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  if v_body = '' then raise exception 'Escreva a mensagem.'; end if;
  if (select count(*) from portal_messages where reservation_id = v_res and from_client and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Muitas mensagens hoje. Fale com a equipe pelo WhatsApp.';
  end if;
  insert into portal_messages (reservation_id, from_client, author_name, body)
  values (v_res, true, (select split_part(c.name, ' ', 1) from reservations r join clients c on c.id = r.client_id where r.id = v_res), v_body);
  perform portal_log(v_res, 'mensagem', 'Mandou uma mensagem: “' || left(v_body, 140) || case when length(v_body) > 140 then '…' else '' end || '”');
end;
$$;

create or replace function portal_submit_review(p_token uuid, p_pratos int, p_bolo int, p_doces int, p_salgados int, p_atendimento int, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_review_token uuid;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  if not festa_ended(v_res) then raise exception 'A avaliação libera quando a festa terminar.'; end if;
  if least(p_pratos, p_bolo, p_doces, p_salgados, p_atendimento) < 1 or greatest(p_pratos, p_bolo, p_doces, p_salgados, p_atendimento) > 5 then
    raise exception 'Dê uma nota de 1 a 5 para cada item.';
  end if;
  select token into v_review_token from review_links where reservation_id = v_res;
  if v_review_token is null then
    insert into review_links (reservation_id, client_name, unit_name)
    select r.id, c.name, u.name from reservations r join clients c on c.id = r.client_id join units u on u.id = r.unit_id where r.id = v_res
    returning token into v_review_token;
  end if;
  if (select count(*) from party_reviews where token = v_review_token) >= 3 then raise exception 'Esta festa já foi avaliada.'; end if;
  insert into party_reviews (token, hot_dish_rating, cake_rating, sweets_rating, snacks_rating, service_rating, comment)
  values (v_review_token, p_pratos, p_bolo, p_doces, p_salgados, p_atendimento, nullif(left(trim(coalesce(p_comment, '')), 2000), ''));
  perform portal_log(v_res, 'avaliacao', 'Enviou a avaliação da festa');
end;
$$;

-- ---------- Funções da equipe ----------
create or replace function mark_portal_events_seen(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'page:portal_avisos') then raise exception 'Sem permissão'; end if;
  update portal_events set seen_at = now(), seen_by_name = current_actor_name() where id = any(p_ids) and seen_at is null;
end;
$$;

create or replace function staff_reply_portal(p_reservation uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (has_permission(auth.uid(), 'page:festa_detalhe') or has_permission(auth.uid(), 'page:portal_avisos')) then raise exception 'Sem permissão'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Escreva a resposta.'; end if;
  insert into portal_messages (reservation_id, from_client, author_name, body) values (p_reservation, false, current_actor_name(), left(trim(p_body), 1000));
  update portal_events set seen_at = now(), seen_by_name = current_actor_name() where reservation_id = p_reservation and kind = 'mensagem' and seen_at is null;
end;
$$;

-- Lança o pagamento do comprovante (tudo junto: pagamento + comprovante "lançado").
create or replace function launch_portal_receipt(p_receipt uuid, p_amount numeric, p_date date, p_method text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  rc portal_receipts%rowtype;
  v_payment uuid;
begin
  if not has_permission(auth.uid(), 'action:festa.pagamentos') then raise exception 'Sem permissão para registrar pagamentos.'; end if;
  select * into rc from portal_receipts where id = p_receipt for update;
  if not found then raise exception 'Comprovante não encontrado.'; end if;
  if rc.status <> 'em_analise' then raise exception 'Este comprovante já foi analisado.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Informe o valor.'; end if;
  insert into payments (reservation_id, amount, payment_date, payment_method, notes)
  values (rc.reservation_id, round(p_amount, 2), coalesce(p_date, today_brazil()), p_method, 'Comprovante enviado pelo portal do cliente')
  returning id into v_payment;
  update portal_receipts set status = 'lancado', payment_id = v_payment, decided_by_name = current_actor_name(), decided_at = now() where id = p_receipt;
  update portal_events set seen_at = now(), seen_by_name = current_actor_name() where ref_id = p_receipt and seen_at is null;
  return v_payment;
end;
$$;

create or replace function reject_portal_receipt(p_receipt uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:festa.pagamentos') then raise exception 'Sem permissão.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Informe a justificativa da recusa.'; end if;
  update portal_receipts set status = 'recusado', reject_reason = left(trim(p_reason), 500), decided_by_name = current_actor_name(), decided_at = now()
  where id = p_receipt and status = 'em_analise';
  if not found then raise exception 'Este comprovante já foi analisado.'; end if;
  update portal_events set seen_at = now(), seen_by_name = current_actor_name() where ref_id = p_receipt and seen_at is null;
end;
$$;

-- ---------- Acessos ----------
do $$
declare f text;
begin
  foreach f in array array[
    'portal_get(uuid)', 'portal_list_guests(uuid)', 'portal_save_menu(uuid, text[], text, text)', 'portal_add_guests(uuid, text[])',
    'portal_remove_guest(uuid, uuid)', 'portal_set_music(uuid, text, text)', 'portal_submit_receipt(uuid, numeric, text)',
    'portal_send_message(uuid, text)', 'portal_submit_review(uuid, int, int, int, int, int, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  foreach f in array array[
    'mark_portal_events_seen(uuid[])', 'staff_reply_portal(uuid, text)', 'launch_portal_receipt(uuid, numeric, date, text)', 'reject_portal_receipt(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Histórico de quem fez o quê também nas tabelas novas.
drop trigger if exists trg_audit on portal_receipts;
create trigger trg_audit after insert or update or delete on portal_receipts for each row execute function audit_row_change();
drop trigger if exists trg_audit on portal_menu_options;
create trigger trg_audit after insert or update or delete on portal_menu_options for each row execute function audit_row_change();

-- =========================================================
-- CORREÇÃO DO PORTAL DO CLIENTE ("Link não encontrado")
--
-- A tabela de pagamentos do sistema real foi criada antes de existir a
-- coluna created_at (o instalador schema.sql já tinha, o banco real não).
-- O portal ordena os pagamentos por ela e dava erro, aparecendo como
-- "Link não encontrado". Esta correção cria a coluna; os pagamentos que já
-- existem ficam com a data do próprio pagamento.
-- =========================================================

alter table payments add column if not exists created_at timestamptz;
update payments set created_at = payment_date::timestamptz where created_at is null;
alter table payments alter column created_at set default now();
alter table payments alter column created_at set not null;
-- =========================================================
-- CARDÁPIO DEPOIS DO PRAZO
--
-- O cliente pode enviar (ou trocar) o cardápio mesmo depois do prazo de
-- 7 dias antes da festa, até o dia da festa. Nesse caso fica marcado
-- "enviado após o prazo" na festa, no histórico do cliente e no aviso
-- do Painel.
-- =========================================================

alter table reservations add column if not exists menu_sent_late boolean not null default false;

create or replace function portal_get(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  r record;
  v_limit jsonb;
  v_due numeric;
  v_paid numeric;
begin
  if v_res is null then return null; end if;
  select res.*, c.name cliente, u.name unidade, u.full_address, u.pix_key, u.google_review_link, u.extra_hour_price,
         p.name pacote, p.included_items, g.playlist_url
  into r
  from reservations res
  join clients c on c.id = res.client_id
  join units u on u.id = res.unit_id
  left join packages p on p.id = res.package_id
  join guest_list_pages g on g.token = p_token
  where res.id = v_res;

  v_limit := festa_hot_dish_limit(v_res);
  select coalesce(sum(amount), 0) into v_paid from payments where reservation_id = v_res;
  v_due := coalesce(r.final_value, 0)
    + coalesce((select sum(price_snapshot * quantity) from reservation_extra_items where reservation_id = v_res), 0)
    + coalesce((select sum(quantity * unit_price) from reservation_consumption where reservation_id = v_res), 0);

  return jsonb_build_object(
    'cliente', split_part(r.cliente, ' ', 1),
    'cliente_nome', r.cliente,
    'crianca', r.child_name, 'idade', r.child_age, 'tema', r.theme,
    'data', r.event_date, 'inicio', to_char(r.start_time, 'HH24:MI'), 'fim', to_char(r.end_time, 'HH24:MI'),
    'status', r.status,
    'unidade', r.unidade, 'vila', r.unidade = 'Vila Operária', 'endereco', r.full_address,
    'pix', r.pix_key, 'google_review_link', r.google_review_link, 'hora_extra', r.extra_hour_price,
    'pacote', r.pacote, 'itens_inclusos', r.included_items,
    'convidados_limite', coalesce(r.guest_count, 0) + coalesce(r.courtesy_guests, 0),
    'pratos_inclusos', (v_limit ->> 'inclusos')::int, 'pratos_adicionais', (v_limit ->> 'adicionais')::int,
    'pratos', case when coalesce(r.hot_dish_flavors, '') = '' then '[]'::jsonb else to_jsonb(array(select trim(x) from unnest(string_to_array(r.hot_dish_flavors, '/')) x where trim(x) <> '')) end,
    'bolo_sabor', r.cake_flavor, 'bolo_massa', r.cake_dough, 'cardapio_confirmado_em', r.menu_confirmed_at, 'cardapio_apos_prazo', coalesce(r.menu_sent_late, false),
    'musica', r.music_choice, 'playlist', r.playlist_url,
    'prazo_cardapio', r.event_date - 7, 'prazo_convidados', r.event_date - 1, 'prazo_pagamento', r.event_date - 1,
    'hoje', today_brazil(),
    'festa_terminou', festa_ended(v_res),
    'valor_total', v_due, 'pago', v_paid, 'saldo', greatest(v_due - v_paid, 0),
    'pagamentos', coalesce((select jsonb_agg(jsonb_build_object('data', payment_date, 'valor', amount, 'forma', payment_method, 'obs', notes) order by payment_date, created_at)
                            from payments where reservation_id = v_res), '[]'::jsonb),
    'comprovantes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'valor', amount, 'status', status, 'motivo', reject_reason, 'enviado_em', created_at) order by created_at desc)
                              from portal_receipts where reservation_id = v_res), '[]'::jsonb),
    'contrato', (select jsonb_build_object('gerado_em', generated_at, 'texto', terms_text) from contracts where reservation_id = v_res order by generated_at desc nulls last limit 1),
    'mensagens', coalesce((select jsonb_agg(jsonb_build_object('de_cliente', from_client, 'autor', author_name, 'texto', body, 'em', created_at) order by created_at)
                           from portal_messages where reservation_id = v_res), '[]'::jsonb),
    'historico', coalesce((select jsonb_agg(jsonb_build_object('em', created_at, 'texto', description) order by created_at desc)
                           from (select * from portal_events where reservation_id = v_res order by created_at desc limit 100) e), '[]'::jsonb),
    'avaliou', exists (select 1 from party_reviews pr join review_links rl on rl.token = pr.token where rl.reservation_id = v_res),
    'menu', jsonb_build_object(
      'pratos', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'prato' and active), '[]'::jsonb),
      'massas', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'bolo_massa' and active), '[]'::jsonb),
      'sabores', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'bolo_sabor' and active), '[]'::jsonb)
    )
  );
end;
$$;


create or replace function portal_save_menu(p_token uuid, p_pratos text[], p_massa text, p_sabor text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_date date;
  v_limit jsonb;
  v_max int;
  v_pratos text[];
  v_late boolean;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  select event_date into v_date from reservations where id = v_res;
  -- Depois do prazo (7 dias antes) ainda pode enviar, mas fica marcado como
  -- enviado após o prazo. Depois do dia da festa, não.
  if today_brazil() > v_date then
    raise exception 'A festa já aconteceu. Para alterar o cardápio, fale com a equipe.';
  end if;
  v_late := today_brazil() > v_date - 7;
  v_limit := festa_hot_dish_limit(v_res);
  v_max := (v_limit ->> 'inclusos')::int + (v_limit ->> 'adicionais')::int;
  select array(select distinct trim(x) from unnest(coalesce(p_pratos, '{}')) x where trim(x) <> '') into v_pratos;
  if coalesce(array_length(v_pratos, 1), 0) <> v_max then
    raise exception 'Escolha % prato(s) quente(s).', v_max;
  end if;
  if exists (select 1 from unnest(v_pratos) x where not exists (select 1 from portal_menu_options where kind = 'prato' and active and name = x)) then
    raise exception 'Prato quente inválido.';
  end if;
  if not exists (select 1 from portal_menu_options where kind = 'bolo_massa' and active and name = p_massa) then
    raise exception 'Escolha a massa do bolo.';
  end if;
  if p_sabor is distinct from 'Outro sabor (combinar com a equipe)' and not exists (select 1 from portal_menu_options where kind = 'bolo_sabor' and active and name = p_sabor) then
    raise exception 'Escolha o recheio do bolo.';
  end if;

  perform set_config('app.audit_actor', 'Cliente (portal)', true);
  update reservations set
    hot_dish_flavors = nullif(array_to_string(v_pratos, ' / '), ''),
    cake_dough = p_massa,
    cake_flavor = p_sabor,
    menu_confirmed_at = now(),
    menu_sent_late = v_late
  where id = v_res;
  perform set_config('app.audit_actor', '', true);
  perform portal_log(v_res, 'cardapio',
    case when v_late then 'Enviou o cardápio APÓS O PRAZO (' || to_char(v_date - 7, 'DD/MM') || '): ' else 'Confirmou o cardápio: ' end || coalesce(nullif(array_to_string(v_pratos, ', '), ''), 'sem pratos quentes') || ' · bolo de massa ' || lower(p_massa) || ', recheio ' || p_sabor);
end;
$$;


-- =========================================================
-- EDITAR O CUSTO DE QUALQUER ITEM DO ESTOQUE
--
-- Antes só dava para definir o custo de item "sem custo". Agora dá para
-- corrigir o custo (R$ por litro, por pacote, por unidade...) de qualquer
-- item: o valor em estoque passa a ser quantidade × novo custo. Não cria
-- lançamento no Financeiro e não muda consumos já lançados nas festas (o
-- custo deles fica congelado). Fica registrado no histórico do item.
-- =========================================================

drop function if exists set_initial_stock_cost(uuid, numeric);

create or replace function set_initial_stock_cost(p_item uuid, p_unit_cost numeric, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  it inventory_items%rowtype;
  v_old_unit numeric;
begin
  if not has_permission(auth.uid(), 'action:estoque.custo_inicial') then raise exception 'Sem permissão'; end if;
  if p_unit_cost is null or p_unit_cost < 0 then raise exception 'Informe um custo unitário válido.'; end if;
  select * into it from inventory_items where id = p_item for update;
  if not found then raise exception 'Item não encontrado.'; end if;
  v_old_unit := case when it.quantity > 0 then it.total_value / it.quantity else it.last_unit_cost end;

  perform set_config('app.stock_fn', '1', true);
  update inventory_items set total_value = round(quantity * p_unit_cost, 6), has_cost = true, last_unit_cost = p_unit_cost, updated_at = now() where id = p_item;
  insert into inventory_movements (inventory_item_id, unit_id, kind, quantity, value, reason, created_by_name)
  values (p_item, it.unit_id, 'custo_inicial', 0, round(it.quantity * p_unit_cost, 6) - it.total_value,
          case when it.has_cost
               then 'Custo corrigido: de ' || fmt_brl(v_old_unit) || ' para ' || fmt_brl(p_unit_cost) || ' por ' || it.unit_of_measure
               else 'Custo inicial definido: ' || fmt_brl(p_unit_cost) || ' por ' || it.unit_of_measure end
          || coalesce(' · ' || nullif(trim(p_reason), ''), ''),
          current_actor_name());
  perform set_config('app.stock_fn', '', true);
end;
$$;
revoke all on function set_initial_stock_cost(uuid, numeric, text) from public, anon;
grant execute on function set_initial_stock_cost(uuid, numeric, text) to authenticated;
-- =========================================================
-- TRÊS VISÕES NO FINANCEIRO (Caixa, Resultado das festas, Ponte e compromissos)
--
-- Só cria funções de LEITURA: nada aqui cria, altera ou apaga lançamentos.
-- Roda inteira dentro de uma transação: se qualquer parte falhar, nada é
-- criado. Para desfazer, use 063_REVERTER_tres_visoes_financeiro.sql.
--
-- 1. consumption_averages: a mesma média de consumo do Estoque e do Lucro
--    por festa passa a poder ser lida também por quem vê o Financeiro (para
--    a reserva das festas futuras). A conta não muda: continua uma só.
-- 2. finance_month_views(mês, unidade): Saldo do mês (caixa), Resultado das
--    festas e a Ponte entre os dois, para o mês e a unidade (nula = as duas).
-- 3. finance_commitments(unidade): dinheiro já recebido de festas futuras,
--    custos previstos e reserva necessária.
--
-- Corte de "festa realizada": no mês atual, até hoje (fuso de Brasília); em
-- meses passados, até o último dia daquele mês. Assim a ponte de um mês
-- passado não muda sozinha com o tempo (só muda se os lançamentos mudarem).
-- =========================================================


-- ---------- 1. Média de consumo: liberada também para o Financeiro ----------
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
    left join reservation_stock_consumption c on c.reservation_id = s.id and c.inventory_item_id = i.id
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

-- ---------- 2. Caixa, Resultado das festas e Ponte de um mês ----------
create or replace function finance_month_views(p_month date, p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month')::date; -- exclusivo
  v_today date := today_brazil();
  v_cut date := least(today_brazil(), (date_trunc('month', p_month) + interval '1 month')::date - 1);
  v jsonb;
begin
  if auth.uid() is null or not has_permission(auth.uid(), 'page:financeiro') then raise exception 'Sem permissão'; end if;
  if p_month is null then raise exception 'Informe o mês.'; end if;

  with
  res as (
    select r.id, r.unit_id, r.event_date, r.status, coalesce(r.final_value, 0) final_value,
           r.consumption_finalized, coalesce(r.refund_amount, 0) refund_amount, r.cancelled_at,
           coalesce(c.name, '—') cliente
    from reservations r left join clients c on c.id = r.client_id
    where p_unit is null or r.unit_id = p_unit
  ),
  -- Festas que interessam ao mês: as do mês (não canceladas) e as canceladas no mês.
  fx as (
    select rs.*,
      case when rs.status = 'cancelada' then 'cancelada'
           when rs.event_date <= v_cut then 'realizada'
           else 'prevista' end tipo,
      (rs.cancelled_at at time zone 'America/Sao_Paulo')::date data_cancelamento,
      coalesce((select sum(x.quantity * x.price_snapshot) from reservation_extra_items x where x.reservation_id = rs.id), 0) extras,
      coalesce((select sum(x.quantity * x.unit_price) from reservation_consumption x where x.reservation_id = rs.id), 0) consumo,
      coalesce((select sum(x.amount) from reservation_costs x where x.reservation_id = rs.id), 0) custos,
      round(coalesce((select sum(x.total_cost) from reservation_stock_consumption x
        where x.reservation_id = rs.id and x.inventory_item_id is not null and not x.no_cost and x.total_cost is not null), 0), 2) insumos,
      (select count(*) from reservation_stock_consumption x
        where x.reservation_id = rs.id and x.inventory_item_id is not null and (x.no_cost or x.total_cost is null))::int sem_custo,
      coalesce((select sum(p.amount) from payments p where p.reservation_id = rs.id), 0) pago,
      coalesce((select sum(p.amount) from payments p where p.reservation_id = rs.id and p.payment_date < v_start), 0) pago_antes,
      coalesce((select sum(p.amount) from payments p where p.reservation_id = rs.id and p.payment_date >= v_start and p.payment_date < v_end), 0) pago_mes,
      coalesce((select sum(p.amount) from payments p where p.reservation_id = rs.id and p.payment_date >= v_end), 0) pago_depois,
      round(coalesce((select sum(p.amount * coalesce(f.fee_percent, 0) / 100) from payments p
        left join payment_method_fees f on f.payment_method = p.payment_method where p.reservation_id = rs.id), 0), 2) taxa
    from res rs
    where (rs.status <> 'cancelada' and rs.event_date >= v_start and rs.event_date < v_end)
       or (rs.status = 'cancelada' and coalesce((rs.cancelled_at at time zone 'America/Sao_Paulo')::date, rs.event_date) >= v_start
           and coalesce((rs.cancelled_at at time zone 'America/Sao_Paulo')::date, rs.event_date) < v_end)
  ),
  fr as (
    select f.*, f.final_value + f.extras + f.consumo receita,
      f.final_value + f.extras + f.consumo - f.custos - f.insumos lucro,
      case when f.sem_custo > 0 or not f.consumption_finalized or (f.custos = 0 and f.insumos = 0) then 'parcial' else 'completo' end status_dados
    from fx f where f.tipo = 'realizada'
  ),
  -- Médias reais de consumo (mesma função do Estoque/Lucro por festa).
  med as (select * from consumption_averages(null, 10)),
  fp as (
    select f.*, f.final_value + f.extras + f.consumo receita,
      (select sum(case when m.consumption_type = 'por_convidado'
                       then coalesce(m.avg_per_guest, 0) * (coalesce(r.guest_count, 0) + coalesce(r.courtesy_guests, 0))
                       else coalesce(m.avg_per_festa, 0) end * coalesce(m.current_unit_cost, 0))
         from med m where m.unit_id = f.unit_id) insumos_previstos
    from fx f join reservations r on r.id = f.id where f.tipo = 'prevista'
  ),
  fc as (
    select f.*, coalesce(f.data_cancelamento, f.event_date) data_ref, f.data_cancelamento is null data_estimada,
      f.pago - f.refund_amount multa, f.pago - f.refund_amount - f.custos - f.insumos efeito
    from fx f where f.tipo = 'cancelada'
  ),
  -- Lançamentos do caixa no mês
  cx_pag as (
    select p.id, p.payment_date data, p.amount valor, rs.id reservation_id, rs.cliente, rs.event_date,
      case when rs.status = 'cancelada' then 'cancelada'
           when rs.event_date < v_start then 'anterior'
           when rs.event_date > v_cut then 'futura'
           else 'realizada' end classe
    from payments p join res rs on rs.id = p.reservation_id
    where p.payment_date >= v_start and p.payment_date < v_end
  ),
  cx_desp as (
    select e.id, e.paid_date data, e.amount valor, coalesce(e.description, e.category) descricao, e.category,
      case when e.category = 'Estorno' and e.reservation_id is not null then 'estorno'
           when e.settlement_id is not null or e.settlement_batch_id is not null then 'acerto'
           when e.is_stock_purchase then 'compra'
           else 'geral' end classe
    from expenses e
    where e.status = 'pago' and not e.covers_festa_costs and e.paid_date >= v_start and e.paid_date < v_end
      and (p_unit is null or e.unit_id = p_unit)
  ),
  cx_ent as (
    select o.id, o.received_date data, o.amount valor, o.description descricao from other_incomes o
    where o.received_date >= v_start and o.received_date < v_end and (p_unit is null or o.unit_id = p_unit)
  ),
  -- Custos das festas do caixa: festas não canceladas do mês até o corte
  -- (mesma regra do card "Custos das festas do mês"), lidos direto da tabela.
  cx_cus as (
    select c.amount valor from reservation_costs c join res rs on rs.id = c.reservation_id
    where rs.status <> 'cancelada' and rs.event_date >= v_start and rs.event_date < v_end and rs.event_date <= v_cut
  ),
  tot as (
    select
      (select coalesce(sum(valor), 0) from cx_pag) cx_entradas,
      (select coalesce(sum(valor), 0) from cx_ent) cx_acertos,
      (select coalesce(sum(valor), 0) from cx_desp) cx_contas,
      (select coalesce(sum(valor), 0) from cx_cus) cx_custos,
      (select count(*) from fr)::int n_festas,
      (select coalesce(sum(receita), 0) from fr) receita,
      (select coalesce(sum(custos), 0) from fr) custos,
      (select coalesce(sum(insumos), 0) from fr) insumos,
      (select coalesce(sum(taxa), 0) from fr) taxa,
      (select coalesce(sum(valor), 0) from cx_desp where classe = 'geral') despesas_gerais,
      (select coalesce(sum(valor), 0) from cx_desp where classe = 'compra') compras_estoque,
      (select coalesce(sum(valor), 0) from cx_desp where classe = 'estorno') estornos,
      (select coalesce(sum(valor), 0) from cx_desp where classe = 'acerto') acertos_pagos,
      (select coalesce(sum(multa), 0) from fc) multa,
      (select coalesce(sum(custos + insumos), 0) from fc) custos_canceladas,
      (select coalesce(sum(efeito), 0) from fc) efeito_cancelamentos,
      (select coalesce(sum(valor), 0) from cx_pag where classe = 'anterior') l_anterior,
      (select coalesce(sum(valor), 0) from cx_pag where classe = 'futura') l_futura,
      (select coalesce(sum(valor), 0) from cx_pag where classe = 'cancelada') l_cancelada,
      (select coalesce(sum(pago_antes), 0) from fr) l_antes,
      (select coalesce(sum(pago_depois), 0) from fr) l_depois,
      (select coalesce(sum(receita - pago), 0) from fr) l_receber
  ),
  calc as (
    select t.*,
      t.cx_entradas + t.cx_acertos - t.cx_contas - t.cx_custos saldo_caixa,
      t.receita - t.custos - t.insumos - t.taxa resultado_direto,
      t.receita - t.custos - t.insumos - t.taxa - t.despesas_gerais + t.efeito_cancelamentos resultado
    from tot t
  )
  select jsonb_build_object(
    'mes', to_char(v_start, 'YYYY-MM'),
    'hoje', v_today,
    'corte', v_cut,
    'mes_atual', v_today >= v_start and v_today < v_end,
    'caixa', jsonb_build_object('entradas', c.cx_entradas, 'acertos_recebidos', c.cx_acertos, 'contas_pagas', c.cx_contas,
                                'custos_festas', c.cx_custos, 'saldo', c.saldo_caixa),
    'resultado', jsonb_build_object(
      'festas', c.n_festas, 'receita', c.receita, 'custos_lancados', c.custos, 'insumos', c.insumos, 'taxa', c.taxa,
      'resultado_direto', c.resultado_direto, 'despesas_gerais', c.despesas_gerais,
      'efeito_cancelamentos', c.efeito_cancelamentos, 'resultado', c.resultado,
      'compras_estoque', c.compras_estoque),
    'festas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'data', event_date, 'cliente', cliente, 'unit_id', unit_id, 'valor_firmado', final_value,
        'extras', extras, 'consumo', consumo, 'receita', receita, 'recebido', pago, 'a_receber', receita - pago,
        'custos', custos, 'insumos', insumos, 'itens_sem_custo', sem_custo, 'consumo_finalizado', consumption_finalized,
        'taxa', taxa, 'lucro', lucro, 'status', status_dados) order by event_date, cliente) from fr), '[]'::jsonb),
    'previstas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'data', event_date, 'cliente', cliente, 'unit_id', unit_id, 'receita', receita, 'recebido', pago,
        'a_receber', receita - pago, 'custos', custos, 'insumos_previstos', round(insumos_previstos, 2),
        'sem_media', insumos_previstos is null,
        'lucro_estimado', receita - custos - coalesce(round(insumos_previstos, 2), 0)) order by event_date, cliente) from fp), '[]'::jsonb),
    'cancelamentos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'data', data_ref, 'data_estimada', data_estimada, 'data_festa', event_date, 'cliente', cliente,
        'unit_id', unit_id, 'pago', pago, 'devolvido', refund_amount, 'multa', multa, 'custos', custos + insumos,
        'efeito', efeito) order by data_ref, cliente) from fc), '[]'::jsonb),
    'ponte', jsonb_build_array(
      jsonb_build_object('chave', 'anterior', 'valor', -c.l_anterior,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', data, 'descricao', cliente || ' (festa de ' || to_char(event_date, 'DD/MM/YYYY') || ')', 'valor', valor, 'reservation_id', reservation_id) order by data) from cx_pag where classe = 'anterior'), '[]'::jsonb)),
      jsonb_build_object('chave', 'futura', 'valor', -c.l_futura,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', data, 'descricao', cliente || ' (festa de ' || to_char(event_date, 'DD/MM/YYYY') || ')', 'valor', valor, 'reservation_id', reservation_id) order by data) from cx_pag where classe = 'futura'), '[]'::jsonb)),
      jsonb_build_object('chave', 'cancelada_recebido', 'valor', -c.l_cancelada,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', data, 'descricao', cliente || ' (festa cancelada)', 'valor', valor, 'reservation_id', reservation_id) order by data) from cx_pag where classe = 'cancelada'), '[]'::jsonb)),
      jsonb_build_object('chave', 'antes', 'valor', c.l_antes,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', event_date, 'descricao', cliente, 'valor', pago_antes, 'reservation_id', id) order by event_date) from fr where pago_antes <> 0), '[]'::jsonb)),
      jsonb_build_object('chave', 'depois', 'valor', c.l_depois,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', event_date, 'descricao', cliente, 'valor', pago_depois, 'reservation_id', id) order by event_date) from fr where pago_depois <> 0), '[]'::jsonb)),
      jsonb_build_object('chave', 'a_receber', 'valor', c.l_receber,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', event_date, 'descricao', cliente, 'valor', receita - pago, 'reservation_id', id) order by event_date) from fr where receita - pago <> 0), '[]'::jsonb)),
      jsonb_build_object('chave', 'multa', 'valor', c.multa,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', data_ref, 'descricao', cliente || ' — pago ' || pago || ', devolvido ' || refund_amount, 'valor', multa, 'reservation_id', id) order by data_ref) from fc), '[]'::jsonb)),
      jsonb_build_object('chave', 'custos_canceladas', 'valor', -c.custos_canceladas,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', data_ref, 'descricao', cliente, 'valor', custos + insumos, 'reservation_id', id) order by data_ref) from fc where custos + insumos <> 0), '[]'::jsonb)),
      jsonb_build_object('chave', 'estornos', 'valor', c.estornos,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', data, 'descricao', descricao, 'valor', valor) order by data) from cx_desp where classe = 'estorno'), '[]'::jsonb)),
      jsonb_build_object('chave', 'compras_estoque', 'valor', c.compras_estoque,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', data, 'descricao', descricao, 'valor', valor) order by data) from cx_desp where classe = 'compra'), '[]'::jsonb)),
      jsonb_build_object('chave', 'insumos', 'valor', -c.insumos,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', event_date, 'descricao', cliente, 'valor', insumos, 'reservation_id', id) order by event_date) from fr where insumos <> 0), '[]'::jsonb)),
      jsonb_build_object('chave', 'acertos_recebidos', 'valor', -c.cx_acertos,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', data, 'descricao', descricao, 'valor', valor) order by data) from cx_ent), '[]'::jsonb)),
      jsonb_build_object('chave', 'acertos_pagos', 'valor', c.acertos_pagos,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', data, 'descricao', descricao, 'valor', valor) order by data) from cx_desp where classe = 'acerto'), '[]'::jsonb)),
      jsonb_build_object('chave', 'taxa', 'valor', -c.taxa,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('data', event_date, 'descricao', cliente, 'valor', taxa, 'reservation_id', id) order by event_date) from fr where taxa <> 0), '[]'::jsonb))
    ),
    -- Resíduo: resultado calculado pelas festas menos (caixa + linhas da
    -- ponte). Calculado pelos dois lados de forma independente.
    'diferenca', c.resultado - (c.saldo_caixa - c.l_anterior - c.l_futura - c.l_cancelada + c.l_antes + c.l_depois + c.l_receber
                  + c.multa - c.custos_canceladas + c.estornos + c.compras_estoque - c.insumos - c.cx_acertos + c.acertos_pagos - c.taxa)
  ) into v
  from calc c;

  return v;
end;
$$;

-- ---------- 3. Compromissos com festas futuras ----------
create or replace function finance_commitments(p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := today_brazil();
  v jsonb;
begin
  if auth.uid() is null or not has_permission(auth.uid(), 'page:financeiro') then raise exception 'Sem permissão'; end if;

  with
  med as (select * from consumption_averages(null, 10)),
  fut as (
    select r.id, r.unit_id, r.event_date, coalesce(c.name, '—') cliente, coalesce(r.final_value, 0) contratado,
      coalesce(r.final_value, 0)
        + coalesce((select sum(x.quantity * x.price_snapshot) from reservation_extra_items x where x.reservation_id = r.id), 0)
        + coalesce((select sum(x.quantity * x.unit_price) from reservation_consumption x where x.reservation_id = r.id), 0) devido,
      coalesce((select sum(p.amount) from payments p where p.reservation_id = r.id), 0) recebido,
      coalesce((select sum(x.amount) from reservation_costs x where x.reservation_id = r.id), 0) custos_lancados,
      round((select sum(case when m.consumption_type = 'por_convidado'
                       then coalesce(m.avg_per_guest, 0) * (coalesce(r.guest_count, 0) + coalesce(r.courtesy_guests, 0))
                       else coalesce(m.avg_per_festa, 0) end * coalesce(m.current_unit_cost, 0))
         from med m where m.unit_id = r.unit_id), 2) insumos_estimados
    from reservations r left join clients c on c.id = r.client_id
    where r.status <> 'cancelada' and r.event_date > v_today and (p_unit is null or r.unit_id = p_unit)
  )
  select jsonb_build_object(
    'hoje', v_today,
    'recebido', coalesce(sum(recebido), 0),
    'custos_previstos', coalesce(sum(custos_lancados + coalesce(insumos_estimados, 0)), 0),
    'reserva', coalesce(sum(custos_lancados + coalesce(insumos_estimados, 0)) filter (where recebido > 0), 0),
    'reserva_custos_lancados', coalesce(sum(custos_lancados) filter (where recebido > 0), 0),
    'reserva_insumos_estimados', coalesce(sum(coalesce(insumos_estimados, 0)) filter (where recebido > 0), 0),
    'festas_sem_media', count(*) filter (where insumos_estimados is null),
    'festas', coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'data', event_date, 'cliente', cliente, 'unit_id', unit_id, 'contratado', contratado, 'devido', devido,
      'recebido', recebido, 'a_receber', devido - recebido, 'custos_lancados', custos_lancados,
      'insumos_estimados', insumos_estimados, 'sem_media', insumos_estimados is null,
      'custos_previstos', custos_lancados + coalesce(insumos_estimados, 0)) order by event_date, cliente), '[]'::jsonb)
  ) into v
  from fut;

  return v;
end;
$$;

revoke all on function finance_month_views(date, uuid) from public, anon;
grant execute on function finance_month_views(date, uuid) to authenticated;
revoke all on function finance_commitments(uuid) from public, anon;
grant execute on function finance_commitments(uuid) to authenticated;

-- =========================================================
-- COMISSÃO DA GERENTE POR FESTA FECHADA
--
-- Regras combinadas:
--   • Comissão por festa CADASTRADA (data do cadastro, fuso de Brasília).
--   • Valor fixo (hoje R$ 150), editável pela tela. Cada festa usa o valor
--     que valia no dia em que foi cadastrada; o histórico de valores fica
--     guardado.
--   • Repasse toda segunda-feira: paga as festas cadastradas até o domingo
--     anterior que ainda não foram pagas.
--   • Festa com comissão já paga que é cancelada depois: o valor é abatido
--     no próximo repasse. Se a festa voltar (deixar de estar cancelada), a
--     comissão volta a ser devida.
--   • Festa cadastrada e cancelada antes do repasse: não gera comissão.
--   • Só contam festas cadastradas a partir da data de início configurada
--     (para não cobrar de novo o que já foi pago fora do sistema).
--   • Pagar o repasse cria, em cada unidade, uma conta PAGA no Financeiro
--     (categoria "Comissão"), com a lista das festas. Essa conta só muda
--     pela tela Comissões. Unidade cujo total da semana não fica positivo
--     (só abatimentos) não é paga: os itens ficam para o próximo repasse.
--
-- Nada aqui altera festas, pagamentos ou contas já existentes.
-- Roda dentro de uma transação. Para desfazer: 064_REVERTER_comissao_gerente.sql
-- =========================================================


-- ---------- Tabelas ----------
create table if not exists commission_rates (
  id uuid primary key default gen_random_uuid(),
  amount numeric(10,2) not null check (amount >= 0),
  valid_from date not null,
  created_at timestamptz not null default now()
);

create table if not exists commission_settings (
  id uuid primary key default gen_random_uuid(),
  unica boolean not null default true unique check (unica), -- uma linha só
  start_date date not null,
  beneficiary text not null default 'Gerente'
);

create table if not exists commission_payouts (
  id uuid primary key default gen_random_uuid(),
  until_date date not null,       -- festas cadastradas até esta data
  paid_date date not null,
  payment_method text,
  total numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create table if not exists commission_payout_items (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references commission_payouts(id) on delete cascade,
  reservation_id uuid not null references reservations(id) on delete cascade,
  unit_id uuid not null references units(id),
  kind text not null check (kind in ('comissao', 'abatimento', 'ajuste')),
  amount numeric(10,2) not null
);
create index if not exists idx_commission_items_reservation on commission_payout_items (reservation_id);
create index if not exists idx_commission_items_payout on commission_payout_items (payout_id);

alter table expenses add column if not exists commission_payout_id uuid references commission_payouts(id) on delete set null;

-- Valor inicial e data de início: contam as festas cadastradas a partir de
-- segunda, 19/10/2026 (as anteriores foram lançadas à parte como despesa).
-- Os dois podem ser mudados pela tela.
insert into commission_rates (amount, valid_from)
select 150, date '2000-01-01' where not exists (select 1 from commission_rates);
insert into commission_settings (start_date)
select date '2026-10-19'
where not exists (select 1 from commission_settings);

-- ---------- Acesso: só leitura pela tela; gravação só pelas funções ----------
alter table commission_rates enable row level security;
alter table commission_settings enable row level security;
alter table commission_payouts enable row level security;
alter table commission_payout_items enable row level security;
drop policy if exists "read_comissoes" on commission_rates;
drop policy if exists "read_comissoes" on commission_settings;
drop policy if exists "read_comissoes" on commission_payouts;
drop policy if exists "read_comissoes" on commission_payout_items;
create policy "read_comissoes" on commission_rates for select using (has_permission(auth.uid(), 'page:comissoes'));
create policy "read_comissoes" on commission_settings for select using (has_permission(auth.uid(), 'page:comissoes'));
create policy "read_comissoes" on commission_payouts for select using (has_permission(auth.uid(), 'page:comissoes'));
create policy "read_comissoes" on commission_payout_items for select using (has_permission(auth.uid(), 'page:comissoes'));
grant select on commission_rates, commission_settings, commission_payouts, commission_payout_items to authenticated;

-- Permissões: quem já vê o Financeiro vê, paga e configura comissões.
-- Desfazer um repasse: só Administrador (nenhuma linha criada).
insert into role_permission_items (role_id, permission_key, allowed)
select r.id, k, true
from roles r
cross join unnest(array['page:comissoes', 'action:comissoes.pagar', 'action:comissoes.configurar']) k
where not r.is_admin
  and exists (select 1 from role_permission_items x where x.role_id = r.id and x.permission_key = 'page:financeiro' and x.allowed)
on conflict (role_id, permission_key) do nothing;

-- ---------- Trava da conta de comissão ----------
create or replace function guard_locked_expense() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.expense_fn', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if old.commission_payout_id is not null then
    if tg_op = 'DELETE' then
      raise exception 'Conta de comissão: desfaça o repasse pela tela Comissões.';
    end if;
    if new.amount is distinct from old.amount or new.unit_id is distinct from old.unit_id
       or new.category is distinct from old.category or new.description is distinct from old.description
       or new.status is distinct from old.status or new.commission_payout_id is distinct from old.commission_payout_id then
      raise exception 'Conta de comissão: o valor vem do repasse; para mudar, desfaça o repasse pela tela Comissões.';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.commission_payout_id is not null then
    raise exception 'Só a tela Comissões pode ligar uma conta a um repasse.';
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

create or replace function guard_commission_expense_insert() returns trigger
language plpgsql as $$
begin
  if new.commission_payout_id is not null and coalesce(current_setting('app.expense_fn', true), '') <> '1' then
    raise exception 'Só a tela Comissões pode criar conta de comissão.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_commission_expense_insert on expenses;
create trigger trg_guard_commission_expense_insert before insert on expenses
  for each row execute function guard_commission_expense_insert();

-- ---------- Cálculo ----------
-- Valor da comissão que valia numa data.
create or replace function commission_rate_at(p_date date) returns numeric
language sql stable security definer set search_path = public as $$
  select amount from commission_rates where valid_from <= p_date order by valid_from desc, created_at desc limit 1
$$;

-- Último domingo já encerrado (o repasse de segunda paga até ele).
create or replace function commission_last_sunday() returns date
language sql stable as $$
  select today_brazil() - extract(isodow from today_brazil())::int
$$;

-- O que falta pagar (ou abater) por festa. Devido = valor da comissão do dia
-- do cadastro se a festa não está cancelada, ou zero se está. Já pago = soma
-- dos repasses. A diferença é o que entra no próximo repasse.
-- p_until: comissões de festas cadastradas até esta data (abatimentos entram
-- sempre, qualquer que seja a data do cadastro).
create or replace function commission_pending(p_until date default null)
returns table (reservation_id uuid, unit_id uuid, cliente text, cadastro date, event_date date, status text,
               cancelada_em date, kind text, amount numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_until date := coalesce(p_until, commission_last_sunday());
begin
  if not has_permission(auth.uid(), 'page:comissoes') then raise exception 'Sem permissão'; end if;
  return query
  with base as (
    select r.id, r.unit_id, coalesce(c.name, '—') cli, (r.created_at at time zone 'America/Sao_Paulo')::date cad,
           r.event_date ev, r.status::text st, (r.cancelled_at at time zone 'America/Sao_Paulo')::date canc,
           case when r.status <> 'cancelada' then coalesce(commission_rate_at((r.created_at at time zone 'America/Sao_Paulo')::date), 0) else 0 end devido,
           coalesce((select sum(i.amount) from commission_payout_items i where i.reservation_id = r.id), 0) pago
    from reservations r left join clients c on c.id = r.client_id
    where (r.created_at at time zone 'America/Sao_Paulo')::date >= (select start_date from commission_settings)
  )
  select b.id, b.unit_id, b.cli, b.cad, b.ev, b.st, b.canc,
         case when b.pago = 0 and b.devido > 0 then 'comissao'
              when b.devido = 0 and b.pago > 0 then 'abatimento'
              else 'ajuste' end,
         b.devido - b.pago
  from base b
  where b.devido - b.pago <> 0
    and (b.devido - b.pago < 0 or b.cad <= v_until)
  order by b.cad, b.cli;
end;
$$;

-- ---------- Pagar o repasse ----------
create or replace function pay_commissions(p_until date, p_paid_date date, p_payment_method text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_payout uuid;
  v_total numeric := 0;
  u record;
  v_benef text := (select beneficiary from commission_settings);
begin
  if not has_permission(auth.uid(), 'action:comissoes.pagar') then raise exception 'Sem permissão'; end if;
  if p_until is null or p_until > today_brazil() then raise exception 'Escolha até que dia o repasse paga (não pode ser no futuro).'; end if;
  if p_paid_date is null then raise exception 'Informe a data do pagamento.'; end if;

  -- Unidades com total positivo no período
  create temp table if not exists tmp_comissao (like commission_payout_items including defaults) on commit drop;
  delete from tmp_comissao;
  insert into tmp_comissao (payout_id, reservation_id, unit_id, kind, amount)
  select '00000000-0000-0000-0000-000000000000'::uuid, p.reservation_id, p.unit_id, p.kind, p.amount
  from commission_pending(p_until) p;
  delete from tmp_comissao t where t.unit_id in (select x.unit_id from tmp_comissao x group by x.unit_id having sum(x.amount) <= 0);
  select coalesce(sum(amount), 0) into v_total from tmp_comissao;
  if v_total <= 0 then raise exception 'Não há comissão a pagar até esta data.'; end if;

  insert into commission_payouts (until_date, paid_date, payment_method, total)
  values (p_until, p_paid_date, p_payment_method, v_total) returning id into v_payout;
  insert into commission_payout_items (payout_id, reservation_id, unit_id, kind, amount)
  select v_payout, reservation_id, unit_id, kind, amount from tmp_comissao;

  perform set_config('app.expense_fn', '1', true);
  for u in
    select t.unit_id, sum(t.amount) total,
           count(*) filter (where t.kind = 'comissao') n_com, coalesce(sum(t.amount) filter (where t.kind = 'comissao'), 0) v_com,
           count(*) filter (where t.kind = 'abatimento') n_ab, coalesce(-sum(t.amount) filter (where t.kind = 'abatimento'), 0) v_ab,
           count(*) filter (where t.kind = 'ajuste') n_aj
    from tmp_comissao t group by t.unit_id
  loop
    insert into expenses (unit_id, category, description, supplier, amount, due_date, paid_date, status, payment_method, commission_payout_id)
    values (u.unit_id, 'Comissão',
            'Comissão de ' || v_benef || ' — festas cadastradas até ' || to_char(p_until, 'DD/MM/YYYY') || ': '
              || u.n_com || ' festa(s) (' || fmt_brl(u.v_com) || ')'
              || case when u.n_ab > 0 then ', ' || u.n_ab || ' cancelada(s) abatida(s) (−' || fmt_brl(u.v_ab) || ')' else '' end
              || case when u.n_aj > 0 then ', ' || u.n_aj || ' ajuste(s) de valor' else '' end,
            v_benef, u.total, p_paid_date, p_paid_date, 'pago', p_payment_method, v_payout);
  end loop;
  perform set_config('app.expense_fn', '', true);
  return v_payout;
end;
$$;

-- Desfaz um repasse (só Administrador): apaga as contas e o repasse; as
-- festas voltam a ficar pendentes.
create or replace function undo_commission_payout(p_payout uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:comissoes.desfazer') then raise exception 'Sem permissão'; end if;
  perform set_config('app.expense_fn', '1', true);
  delete from expenses where commission_payout_id = p_payout;
  perform set_config('app.expense_fn', '', true);
  delete from commission_payouts where id = p_payout;
end;
$$;

-- ---------- Configuração ----------
create or replace function set_commission_rate(p_amount numeric, p_valid_from date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:comissoes.configurar') then raise exception 'Sem permissão'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Informe um valor válido.'; end if;
  if p_valid_from is null then raise exception 'Informe a partir de quando vale.'; end if;
  insert into commission_rates (amount, valid_from) values (round(p_amount, 2), p_valid_from);
end;
$$;

create or replace function set_commission_settings(p_start date, p_beneficiary text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:comissoes.configurar') then raise exception 'Sem permissão'; end if;
  if p_start is null then raise exception 'Informe a data de início.'; end if;
  update commission_settings set start_date = p_start, beneficiary = coalesce(nullif(trim(p_beneficiary), ''), 'Gerente') where unica;
end;
$$;

-- ---------- Acessos às funções ----------
revoke all on function commission_rate_at(date) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'commission_last_sunday()', 'commission_pending(date)', 'pay_commissions(date, date, text)',
    'undo_commission_payout(uuid)', 'set_commission_rate(numeric, date)', 'set_commission_settings(date, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Histórico de alterações
drop trigger if exists trg_audit on commission_rates;
create trigger trg_audit after insert or update or delete on commission_rates for each row execute function audit_row_change();
drop trigger if exists trg_audit on commission_settings;
create trigger trg_audit after insert or update or delete on commission_settings for each row execute function audit_row_change();
drop trigger if exists trg_audit on commission_payouts;
create trigger trg_audit after insert or update or delete on commission_payouts for each row execute function audit_row_change();

-- =========================================================
-- NOVOS PLANOS DE SÃO VICENTE: BRAVA CLASSIC E BRAVA GOURMET
--
-- Fonte: Portfólio Brava Park Fest 2026 e 2027.
--
-- 2026 (festas até 31/12/2026): Classic e Gourmet de 40, 50 e 60 pessoas.
-- 2027 (festas a partir de 01/01/2027): Classic e Gourmet de 40 a 80
--   pessoas, com os valores do portfólio 2027.
--
-- O que vem incluso: o mesmo dos planos de São Vicente que já existiam
-- (buffet, decoração, brinquedos, estrutura e equipe da unidade).
--   • Classic = coquetéis, sem pratos quentes.
--   • Gourmet = coquetéis + pratos quentes, na mesma quantidade do Gourmet
--     da Vila Operária para o mesmo número de pessoas (40 → 3, 50 → 4,
--     60 → 5, 70 → 6, 80 → 7).
--
-- Os planos antigos de São Vicente ("Festa Completa ... pessoas" e
-- "Festa Completa ... pessoas (2027)") deixam de aparecer para festas
-- novas. As festas já cadastradas com eles NÃO mudam: continuam com o
-- mesmo plano e o mesmo valor.
--
-- Vila Operária não muda (o portfólio 2027 traz os mesmos valores).
-- Valores e textos podem ser ajustados depois pela tela Pacotes.
-- Roda numa transação; pode rodar mais de uma vez sem duplicar.
-- =========================================================


-- ---------- Planos novos ----------
with sv as (select id from units where name = 'São Vicente'),
base as (
  select
    'Brinquedos: arena de cama elástica, circuito radical, tobogã, piscina de bolinhas, basquete eletrônico, fliperama (mais de 10 mil jogos), ambiente game (PlayStation) e presença do Urso Theo / Raposa Nino. '
    || 'Decoração inclusa (mediante disponibilidade do tema escolhido). Ambiente climatizado e monitorado, TV, som ambiente, Wi-Fi e convite virtual (padrão Brava Park Fest). '
    || 'Equipe: recepcionista, garçom, recreadoras treinadas e equipe de cozinha.' as estrutura
),
planos (nome, tipo, pessoas, semana, fds, de, ate) as (values
  -- 2026
  ('Classic 40 pessoas', 'classic', 40, 4300.00, 4500.00, null::date, date '2026-12-31'),
  ('Classic 50 pessoas', 'classic', 50, 4900.00, 5200.00, null, date '2026-12-31'),
  ('Classic 60 pessoas', 'classic', 60, 5400.00, 5800.00, null, date '2026-12-31'),
  ('Gourmet 40 pessoas', 'gourmet', 40, 4700.00, 4950.00, null, date '2026-12-31'),
  ('Gourmet 50 pessoas', 'gourmet', 50, 5400.00, 5700.00, null, date '2026-12-31'),
  ('Gourmet 60 pessoas', 'gourmet', 60, 5900.00, 6400.00, null, date '2026-12-31'),
  -- 2027
  ('Classic 40 pessoas (2027)', 'classic', 40, 5430.00, 6100.00, date '2027-01-01', null),
  ('Classic 50 pessoas (2027)', 'classic', 50, 5900.00, 6550.00, date '2027-01-01', null),
  ('Classic 60 pessoas (2027)', 'classic', 60, 6470.00, 7100.00, date '2027-01-01', null),
  ('Classic 70 pessoas (2027)', 'classic', 70, 6900.00, 7750.00, date '2027-01-01', null),
  ('Classic 80 pessoas (2027)', 'classic', 80, 7590.00, 8390.00, date '2027-01-01', null),
  ('Gourmet 40 pessoas (2027)', 'gourmet', 40, 6230.00, 6870.00, date '2027-01-01', null),
  ('Gourmet 50 pessoas (2027)', 'gourmet', 50, 6710.00, 7350.00, date '2027-01-01', null),
  ('Gourmet 60 pessoas (2027)', 'gourmet', 60, 7270.00, 7990.00, date '2027-01-01', null),
  ('Gourmet 70 pessoas (2027)', 'gourmet', 70, 7830.00, 8630.00, date '2027-01-01', null),
  ('Gourmet 80 pessoas (2027)', 'gourmet', 80, 8390.00, 9270.00, date '2027-01-01', null)
),
pratos (pessoas, n, extenso) as (values (40, 3, 'três'), (50, 4, 'quatro'), (60, 5, 'cinco'), (70, 6, 'seis'), (80, 7, 'sete'))
insert into packages (name, description, base_price, weekday_price, weekend_price, unit_id, guest_limit, duration_hours,
                      included_items, hot_dish_count, valid_from, valid_until, active)
select
  p.nome,
  case when p.tipo = 'classic' then 'Brava Classic (coquetéis)' else 'Brava Gourmet (coquetéis e pratos quentes)' end
    || ' — São Vicente, tabela ' || case when p.de is null then '2026' else '2027' end,
  p.semana, p.semana, p.fds, sv.id, p.pessoas, 4,
  case when p.tipo = 'classic'
    then 'Coquetéis: salgados fritos e assados sortidos, docinhos sortidos, bolo, refrigerante, suco e água. '
    else 'Coquetéis e pratos quentes: salgados fritos e assados sortidos, docinhos sortidos, bolo, refrigerante, suco, água e até '
         || pr.n || ' (' || pr.extenso || ') opções de pratos quentes, escolhidas pela contratante dentre o cardápio vigente do Brava Park Fest. '
  end || base.estrutura,
  case when p.tipo = 'classic' then 0 else pr.n end,
  p.de, p.ate, true
from planos p
cross join sv
cross join base
join pratos pr on pr.pessoas = p.pessoas
where not exists (select 1 from packages x where x.unit_id = sv.id and x.name = p.nome);

-- ---------- Planos antigos de São Vicente saem de uso ----------
-- (só para festas novas; as festas já cadastradas continuam com eles)
update packages
set active = false
where unit_id = (select id from units where name = 'São Vicente')
  and name like 'Festa Completa %'
  and active;

-- ---------- Vila Operária: tabela 2027 ----------
-- Os planos atuais da Vila Operária passam a valer para festas até
-- 31/12/2026. Para festas a partir de 01/01/2027 entram cópias "(2027)"
-- com os valores do portfólio 2027 — mesmo conteúdo incluso e mesma
-- quantidade de pratos quentes dos planos atuais.
with vo as (select id from units where name = 'Vila Operária'),
precos (tipo, pessoas, semana, fds) as (values
  ('Classic', 40, 6790.00, 7590.00), ('Classic', 50, 7390.00, 8190.00), ('Classic', 60, 8090.00, 8890.00),
  ('Classic', 70, 8790.00, 9690.00), ('Classic', 80, 9490.00, 10490.00), ('Classic', 90, 10190.00, 11290.00),
  ('Classic', 100, 10890.00, 12090.00),
  ('Gourmet', 40, 7790.00, 8590.00), ('Gourmet', 50, 8390.00, 9190.00), ('Gourmet', 60, 9090.00, 9990.00),
  ('Gourmet', 70, 9790.00, 10790.00), ('Gourmet', 80, 10490.00, 11590.00), ('Gourmet', 90, 11190.00, 12390.00),
  ('Gourmet', 100, 11990.00, 13190.00),
  ('Prime', 40, 9290.00, 10190.00), ('Prime', 50, 9990.00, 10990.00), ('Prime', 60, 10790.00, 11890.00),
  ('Prime', 70, 11590.00, 12790.00), ('Prime', 80, 12390.00, 13690.00), ('Prime', 90, 13190.00, 14590.00),
  ('Prime', 100, 13990.00, 15490.00)
),
atuais as (
  select p.* , pr.semana, pr.fds
  from packages p
  cross join vo
  join precos pr on p.name = pr.tipo || ' ' || pr.pessoas || ' pessoas'
  where p.unit_id = vo.id and p.active and p.valid_from is null
)
insert into packages (name, description, base_price, weekday_price, weekend_price, unit_id, guest_limit, duration_hours,
                      included_items, hot_dish_count, valid_from, valid_until, active)
select a.name || ' (2027)', coalesce(a.description, '') || ' — tabela 2027', a.semana, a.semana, a.fds, a.unit_id, a.guest_limit,
       a.duration_hours, a.included_items, a.hot_dish_count, date '2027-01-01', null, true
from atuais a
where not exists (select 1 from packages x where x.unit_id = a.unit_id and x.name = a.name || ' (2027)');

update packages p
set valid_until = date '2026-12-31'
where p.unit_id = (select id from units where name = 'Vila Operária')
  and p.active and p.valid_from is null and p.valid_until is null
  and p.name ~ '^(Classic|Gourmet|Prime) [0-9]+ pessoas$'
  and exists (select 1 from packages x where x.unit_id = p.unit_id and x.name = p.name || ' (2027)');

-- =========================================================
-- QUEM CADASTROU A FESTA + COMISSÃO SÓ DE QUEM RECEBE + HISTÓRICO
--
-- 1) Toda festa passa a guardar quem a cadastrou (`registered_by`). Na tela
--    o campo já vem com quem está logado e pode ser trocado (ex.: a Kamila
--    cadastrou usando o login de outra pessoa). Se a tela não mandar, o
--    banco preenche com quem está logado.
--    Festas antigas: preenchidas com quem as criou, pelo histórico de
--    alterações (quando o histórico tem essa informação).
-- 2) Comissões: a configuração ganha "de quem são as festas que geram
--    comissão" (`commission_settings.beneficiary_user_id`). Só contam as
--    festas cadastradas por essa pessoa. Se a festa trocar de "cadastrada
--    por" depois de a comissão ter sido paga, ela é abatida no próximo
--    repasse (mesma regra do cancelamento).
-- 3) commission_history: todas as festas desde a data de início, com a
--    situação da comissão de cada uma (paga em tal data, a pagar, abatida,
--    não gera e por quê).
--
-- Não altera valores de festas, pagamentos ou contas.
-- Roda dentro de uma transação.
-- =========================================================


-- ---------- 1) Quem cadastrou ----------
alter table reservations add column if not exists registered_by uuid references user_profiles(id) on delete set null;

update reservations r
set registered_by = a.user_id
from (
  select distinct on (entity_id) entity_id, user_id
  from audit_log
  where entity = 'reservations' and action = 'criou' and user_id is not null
  order by entity_id, created_at
) a
where a.entity_id = r.id and r.registered_by is null
  and exists (select 1 from user_profiles up where up.id = a.user_id);

create or replace function set_reservation_registered_by() returns trigger
language plpgsql as $$
begin
  if new.registered_by is null then
    new.registered_by := auth.uid();
    if new.registered_by is not null and not exists (select 1 from user_profiles where id = new.registered_by) then
      new.registered_by := null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_set_reservation_registered_by on reservations;
create trigger trg_set_reservation_registered_by before insert on reservations
  for each row execute function set_reservation_registered_by();

-- ---------- 2) Comissão só das festas de quem recebe ----------
alter table commission_settings add column if not exists beneficiary_user_id uuid references user_profiles(id) on delete set null;

-- Se existir um único usuário ativo chamado Kamila, já fica configurado.
update commission_settings cs
set beneficiary_user_id = k.id, beneficiary = k.name
from (select id, name from user_profiles where active and name ilike 'kamila%') k
where cs.beneficiary_user_id is null
  and (select count(*) from user_profiles where active and name ilike 'kamila%') = 1;

create or replace function commission_pending(p_until date default null)
returns table (reservation_id uuid, unit_id uuid, cliente text, cadastro date, event_date date, status text,
               cancelada_em date, kind text, amount numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_until date := coalesce(p_until, commission_last_sunday());
  v_benef uuid := (select beneficiary_user_id from commission_settings);
begin
  if not has_permission(auth.uid(), 'page:comissoes') then raise exception 'Sem permissão'; end if;
  return query
  with base as (
    select r.id, r.unit_id, coalesce(c.name, '—') cli, (r.created_at at time zone 'America/Sao_Paulo')::date cad,
           r.event_date ev, r.status::text st, (r.cancelled_at at time zone 'America/Sao_Paulo')::date canc,
           case when r.status <> 'cancelada' and (v_benef is null or r.registered_by = v_benef)
                then coalesce(commission_rate_at((r.created_at at time zone 'America/Sao_Paulo')::date), 0) else 0 end devido,
           coalesce((select sum(i.amount) from commission_payout_items i where i.reservation_id = r.id), 0) pago
    from reservations r left join clients c on c.id = r.client_id
    where (r.created_at at time zone 'America/Sao_Paulo')::date >= (select start_date from commission_settings)
  )
  select b.id, b.unit_id, b.cli, b.cad, b.ev, b.st, b.canc,
         case when b.pago = 0 and b.devido > 0 then 'comissao'
              when b.devido = 0 and b.pago > 0 then 'abatimento'
              else 'ajuste' end,
         b.devido - b.pago
  from base b
  where b.devido - b.pago <> 0
    and (b.devido - b.pago < 0 or b.cad <= v_until)
  order by b.cad, b.cli;
end;
$$;

create or replace function set_commission_settings(p_start date, p_beneficiary text, p_beneficiary_user uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:comissoes.configurar') then raise exception 'Sem permissão'; end if;
  if p_start is null then raise exception 'Informe a data de início.'; end if;
  update commission_settings
  set start_date = p_start,
      beneficiary_user_id = p_beneficiary_user,
      beneficiary = coalesce(nullif(trim(p_beneficiary), ''), (select name from user_profiles where id = p_beneficiary_user), 'Gerente')
  where unica;
end;
$$;
drop function if exists set_commission_settings(date, text);

-- ---------- 3) Histórico por festa ----------
create or replace function commission_history(p_from date default null, p_to date default null)
returns table (reservation_id uuid, unit_id uuid, cliente text, cadastro date, event_date date, status text,
               cancelada_em date, cadastrada_por text, conta boolean, devido numeric, pago numeric,
               ultimo_repasse date, situacao text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_benef uuid := (select beneficiary_user_id from commission_settings);
  v_start date := (select start_date from commission_settings);
  v_last date := commission_last_sunday();
begin
  if not has_permission(auth.uid(), 'page:comissoes') then raise exception 'Sem permissão'; end if;
  return query
  with base as (
    select r.id, r.unit_id, coalesce(c.name, '—') cli, (r.created_at at time zone 'America/Sao_Paulo')::date cad,
           r.event_date ev, r.status::text st, (r.cancelled_at at time zone 'America/Sao_Paulo')::date canc,
           up.name quem, (v_benef is null or r.registered_by = v_benef) conta,
           case when r.status <> 'cancelada' and (v_benef is null or r.registered_by = v_benef)
                then coalesce(commission_rate_at((r.created_at at time zone 'America/Sao_Paulo')::date), 0) else 0 end devido,
           coalesce((select sum(i.amount) from commission_payout_items i where i.reservation_id = r.id), 0) pago,
           (select max(p.paid_date) from commission_payout_items i join commission_payouts p on p.id = i.payout_id where i.reservation_id = r.id) ultimo
    from reservations r
    left join clients c on c.id = r.client_id
    left join user_profiles up on up.id = r.registered_by
    where (r.created_at at time zone 'America/Sao_Paulo')::date >= greatest(v_start, coalesce(p_from, v_start))
      and (p_to is null or (r.created_at at time zone 'America/Sao_Paulo')::date <= p_to)
  )
  select b.id, b.unit_id, b.cli, b.cad, b.ev, b.st, b.canc, coalesce(b.quem, '—'), b.conta, b.devido, b.pago, b.ultimo,
         case
           when b.devido > 0 and b.pago = b.devido then 'paga'
           when b.devido > 0 and b.pago = 0 then case when b.cad <= v_last then 'a_pagar' else 'semana_atual' end
           when b.devido > 0 then 'ajuste_pendente'
           when b.devido = 0 and b.pago > 0 then 'abater'
           when b.devido = 0 and b.pago = 0 and exists (select 1 from commission_payout_items i where i.reservation_id = b.id) then 'abatida'
           when not b.conta then 'outra_pessoa'
           else 'cancelada_antes'
         end
  from base b
  order by b.cad desc, b.cli;
end;
$$;

-- ---------- 4) Estoque: avisar ou não na lista de compras ----------
-- Cada item escolhe se entra na Lista de compras quando fica abaixo do
-- mínimo. Itens que já existem continuam avisando (padrão = sim).
alter table inventory_items add column if not exists notify_shopping boolean not null default true;

revoke all on function commission_history(date, date) from public, anon;
grant execute on function commission_history(date, date) to authenticated;
revoke all on function set_commission_settings(date, text, uuid) from public, anon;
grant execute on function set_commission_settings(date, text, uuid) to authenticated;

-- =========================================================
-- AGENDA — compromissos (além das visitas)
--
-- A "Agenda de visitas" vira "Agenda": um calendário com as visitas (que
-- continuam na tabela visits, sem mudança) e os compromissos que a equipe
-- adiciona (reunião, manutenção, pagar algo...).
--
-- Cada compromisso:
--   - pode se repetir (todo dia, toda semana, todo mês, todo ano), com data
--     final opcional; dá para apagar só um dia da repetição;
--   - guarda quem colocou (preenchido pelo banco, não pela tela);
--   - pode "Avisar no Painel" X dias antes. O aviso aparece para todos que
--     entram no Painel, até alguém marcar "Feito" (cada dia da repetição é
--     marcado separado e fica registrado quem marcou).
--
-- Todos que têm acesso à Agenda veem e editam tudo. Não mexe em nenhuma
-- tabela existente além de incluir a nova no histórico de alterações.
-- Roda dentro de uma transação.
-- =========================================================


create table if not exists agenda_items (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  notes text,
  unit_id uuid references units(id), -- null = as duas unidades
  starts_on date not null,
  all_day boolean not null default true,
  start_time time,
  end_time time,
  repeat text not null default 'nao' check (repeat in ('nao', 'diario', 'semanal', 'mensal', 'anual')),
  repeat_until date,
  skipped_dates date[] not null default '{}', -- dias apagados de uma repetição
  notify boolean not null default false,
  notify_days_before int not null default 0 check (notify_days_before between 0 and 60),
  created_by uuid references user_profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  check (all_day or start_time is not null),
  check (repeat_until is null or repeat_until >= starts_on)
);
create index if not exists idx_agenda_items_starts on agenda_items (starts_on);

-- Dias marcados como "Feito" (um registro por dia de cada compromisso).
create table if not exists agenda_done (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references agenda_items(id) on delete cascade,
  occurrence date not null,
  done_by_name text,
  done_at timestamptz not null default now(),
  unique (item_id, occurrence)
);

-- Quem colocou: sempre quem está logado (a tela não consegue trocar).
create or replace function set_agenda_item_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := case when exists (select 1 from user_profiles where id = auth.uid()) then auth.uid() end;
    new.created_by_name := current_actor_name();
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_by_name := old.created_by_name;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_set_agenda_item_author on agenda_items;
create trigger trg_set_agenda_item_author before insert or update on agenda_items
  for each row execute function set_agenda_item_author();

alter table agenda_items enable row level security;
alter table agenda_done enable row level security;

drop policy if exists "read_agenda_items" on agenda_items;
create policy "read_agenda_items" on agenda_items for select using (has_permission(auth.uid(), 'page:visitas'));
drop policy if exists "write_agenda_items" on agenda_items;
create policy "write_agenda_items" on agenda_items for all
  using (has_permission(auth.uid(), 'page:visitas'))
  with check (has_permission(auth.uid(), 'page:visitas'));

drop policy if exists "read_agenda_done" on agenda_done;
create policy "read_agenda_done" on agenda_done for select using (has_permission(auth.uid(), 'page:visitas'));
-- "Feito" só pelas funções abaixo (registram quem marcou).

-- Avisos do Painel: aparecem para todos os usuários logados, mesmo quem não
-- tem acesso à Agenda. Devolve os compromissos com aviso ligado e os dias
-- já marcados como feitos; a tela calcula quais dias estão na janela.
create or replace function agenda_painel()
returns table (id uuid, title text, notes text, unit_id uuid, starts_on date, all_day boolean, start_time time, end_time time,
               repeat text, repeat_until date, skipped_dates date[], notify_days_before int, created_by_name text, done_dates date[])
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from user_profiles where user_profiles.id = auth.uid() and active) then
    raise exception 'Sem permissão';
  end if;
  return query
  select a.id, a.title, a.notes, a.unit_id, a.starts_on, a.all_day, a.start_time, a.end_time,
         a.repeat, a.repeat_until, a.skipped_dates, a.notify_days_before, a.created_by_name,
         coalesce((select array_agg(d.occurrence) from agenda_done d where d.item_id = a.id), '{}')
  from agenda_items a
  where a.notify
    and a.starts_on <= today_brazil() + 60
    and (a.repeat = 'nao' or a.repeat_until is null or a.repeat_until >= today_brazil() - 31);
end;
$$;

create or replace function agenda_marcar_feito(p_item uuid, p_occurrence date, p_feito boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from user_profiles where id = auth.uid() and active) then
    raise exception 'Sem permissão';
  end if;
  if not exists (select 1 from agenda_items where id = p_item) then raise exception 'Compromisso não encontrado.'; end if;
  if p_feito then
    insert into agenda_done (item_id, occurrence, done_by_name) values (p_item, p_occurrence, current_actor_name())
    on conflict (item_id, occurrence) do nothing;
  else
    delete from agenda_done where item_id = p_item and occurrence = p_occurrence;
  end if;
end;
$$;

revoke all on function agenda_painel() from public, anon;
grant execute on function agenda_painel() to authenticated;
revoke all on function agenda_marcar_feito(uuid, date, boolean) from public, anon;
grant execute on function agenda_marcar_feito(uuid, date, boolean) to authenticated;

-- Histórico de alterações (quem criou, mudou ou apagou cada compromisso).
drop trigger if exists trg_audit on agenda_items;
create trigger trg_audit after insert or update or delete on agenda_items for each row execute function audit_row_change();

-- =========================================================
-- EMPRESA E UNIDADES CONFIGURÁVEIS (venda do sistema — Etapa 1)
--
-- 1) companies: nome, logo, frase da marca, WhatsApp da equipe, mascote e tema do portal da
--    empresa. Hoje só existe a Brava; na etapa de várias empresas cada
--    cadastro vai apontar para uma linha desta tabela.
-- 2) units ganha: code (apelido fixo usado pelas telas), color (cor nos
--    gráficos) e sort (ordem). Toda unidade nova já nasce com o seu espaço
--    (toda reserva precisa de um espaço), e trocar o nome da unidade troca
--    o nome do espaço junto.
-- 3) public_company_brand(): nome/logo/WhatsApp/tema para a tela de login e
--    o portal do cliente (que abrem sem login). Nada sigiloso.
-- 4) Arquivo da logo: pasta pública "marca" (só administrador envia).
--
-- Brava: tudo é preenchido com os valores de hoje — nada muda na tela.
-- Não altera festas, pagamentos, clientes ou contas.
-- Roda dentro de uma transação.
-- =========================================================


-- ---------- 1) Empresa ----------
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  logo_url text,
  tagline text, -- frase da marca (tela de login)
  team_whatsapp text,
  mascot_enabled boolean not null default false,
  portal_theme text not null default 'padrao' check (portal_theme in ('padrao', 'mario')),
  created_at timestamptz not null default now()
);

insert into companies (name, logo_url, tagline, team_whatsapp, mascot_enabled, portal_theme)
select 'Brava Park Fest', '/marca/logo-brava-park-fest.png', 'Aqui a diversão é garantida', '47992261550', true, 'mario'
where not exists (select 1 from companies);

alter table companies enable row level security;
drop policy if exists "read_active" on companies;
create policy "read_active" on companies for select using (is_active_user(auth.uid()));
drop policy if exists "update_admin" on companies;
create policy "update_admin" on companies for update using (is_admin_user(auth.uid())) with check (is_admin_user(auth.uid()));
-- (sem insert/delete pela tela: empresa nova só pelo painel do administrador geral, numa etapa futura)

create or replace function public_company_brand()
returns table (name text, logo_url text, tagline text, team_whatsapp text, mascot_enabled boolean, portal_theme text)
language sql stable security definer set search_path = public as $$
  select c.name, c.logo_url, c.tagline, c.team_whatsapp, c.mascot_enabled, c.portal_theme
  from companies c order by c.created_at limit 1;
$$;
revoke all on function public_company_brand() from public;
grant execute on function public_company_brand() to anon, authenticated;

-- ---------- 2) Unidades ----------
alter table units add column if not exists code text;
alter table units add column if not exists color text;
alter table units add column if not exists sort int not null default 0;
create unique index if not exists units_code_key on units (code) where code is not null;

update units set code = 'vila-operaria', color = coalesce(color, '#6D28D9'), sort = 1 where name = 'Vila Operária' and code is null;
update units set code = 'sao-vicente', color = coalesce(color, '#7CB92E'), sort = 2 where name = 'São Vicente' and code is null;

alter table units drop constraint if exists units_color_check;
alter table units add constraint units_color_check check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
alter table units drop constraint if exists units_name_not_blank;
alter table units add constraint units_name_not_blank check (length(trim(name)) > 0);

create or replace function sync_unit_space() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from spaces where unit_id = new.id) then
      insert into spaces (unit_id, name) values (new.id, new.name);
    end if;
  elsif new.name is distinct from old.name then
    -- Unidade com um espaço só (o padrão): o espaço acompanha o nome.
    if (select count(*) from spaces where unit_id = new.id) = 1 then
      update spaces set name = new.name where unit_id = new.id;
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_sync_unit_space on units;
create trigger trg_sync_unit_space after insert or update of name on units
  for each row execute function sync_unit_space();

-- Histórico de alterações (quem mudou CNPJ, Pix, nome...).
drop trigger if exists trg_audit on units;
create trigger trg_audit after insert or update or delete on units for each row execute function audit_row_change();
drop trigger if exists trg_audit on companies;
create trigger trg_audit after insert or update or delete on companies for each row execute function audit_row_change();

-- ---------- 3) Logo: pasta pública "marca" ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marca', 'marca', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'marca_insert') then
    create policy "marca_insert" on storage.objects for insert to authenticated with check (bucket_id = 'marca' and is_admin_user(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'marca_update') then
    create policy "marca_update" on storage.objects for update to authenticated using (bucket_id = 'marca' and is_admin_user(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'marca_delete') then
    create policy "marca_delete" on storage.objects for delete to authenticated using (bucket_id = 'marca' and is_admin_user(auth.uid()));
  end if;
end $$;

-- =========================================================
-- REGRAS DO PORTAL DO CLIENTE POR UNIDADE (venda do sistema — Etapa 2)
--
-- O que era fixo para a Brava vira configuração de cada unidade
-- (Configurações → Unidades → Portal do cliente):
--   - idade a partir da qual conta como convidado;
--   - prazos: cardápio (X dias antes), lista de convidados e saldo;
--   - campo de playlist (Spotify) ligado ou desligado;
--   - roteiro: parabéns X min após o início, pratos quentes e bolo X min
--     após o parabéns;
--   - texto das regras da casa ({{convidados}} e {{idade}} viram os números).
-- O portal também recebe nome, logo, WhatsApp e tema da empresa.
--
-- Brava: preenchido com o que vale hoje — Vila Operária: 5 anos, playlist
-- ligada; São Vicente: 3 anos (como no contrato), sem playlist; prazos 7 e
-- 1 dia; parabéns 1h30 após o início, pratos 10 min e bolo 30 min depois.
-- Continua compatível com a tela atual do portal.
-- Não altera festas, pagamentos, clientes ou contas.
-- Roda dentro de uma transação.
-- =========================================================


alter table units add column if not exists guest_min_age int not null default 5;
alter table units add column if not exists menu_deadline_days int not null default 7;
alter table units add column if not exists guest_deadline_days int not null default 1;
alter table units add column if not exists payment_deadline_days int not null default 1;
alter table units add column if not exists playlist_enabled boolean not null default false;
alter table units add column if not exists parabens_after_min int not null default 90;
alter table units add column if not exists hot_dish_after_parabens_min int not null default 10;
alter table units add column if not exists cake_after_parabens_min int not null default 30;
alter table units add column if not exists portal_rules jsonb not null default '[{"titulo":"Limite de convidados","texto":"Até {{convidados}} pessoas, contando a partir de {{idade}} anos. O excedente depende de aprovação e tem cobrança adicional."},{"titulo":"Horário","texto":"Respeitar início e término. Tempo excedente é cobrado por hora adicional, conforme disponibilidade."},{"titulo":"Itens de fora","texto":"Não é permitida a entrada de bebidas alcoólicas, comidas, decorações ou equipamentos externos sem autorização prévia."},{"titulo":"Bebidas alcoólicas","texto":"Não estão inclusas no pacote; podem ser adquiridas no local."},{"titulo":"Segurança das crianças","texto":"A presença de pais ou responsáveis é obrigatória durante toda a festa. A equipe orienta o uso dos brinquedos, mas a responsabilidade pelas crianças é dos responsáveis."},{"titulo":"Danos","texto":"Danos ao espaço, brinquedos ou equipamentos, causados por convidados ou prestadores externos, são cobrados conforme orçamento."}]'::jsonb;

alter table units drop constraint if exists units_portal_limits_check;
alter table units add constraint units_portal_limits_check check (
  guest_min_age between 0 and 18
  and menu_deadline_days between 0 and 60
  and guest_deadline_days between 0 and 60
  and payment_deadline_days between 0 and 60
  and parabens_after_min between 0 and 720
  and hot_dish_after_parabens_min between 0 and 240
  and cake_after_parabens_min between 0 and 240
  and jsonb_typeof(portal_rules) = 'array'
);

-- Brava: valores de hoje.
update units set playlist_enabled = true, guest_min_age = 5 where code = 'vila-operaria';
update units set playlist_enabled = false, guest_min_age = 3 where code = 'sao-vicente';
update units set portal_rules = '[{"titulo":"Limite de convidados","texto":"Até {{convidados}} pessoas, contando a partir de {{idade}} anos. O excedente depende de aprovação e tem cobrança adicional."},{"titulo":"Horário","texto":"Respeitar início e término. Tempo excedente é cobrado por hora adicional, conforme disponibilidade."},{"titulo":"Itens de fora","texto":"Não é permitida a entrada de bebidas alcoólicas, comidas, decorações ou equipamentos externos sem autorização prévia."},{"titulo":"Bebidas alcoólicas","texto":"Não estão inclusas no pacote; podem ser adquiridas no local."},{"titulo":"Segurança das crianças","texto":"A presença de pais ou responsáveis é obrigatória durante toda a festa. A equipe orienta o uso dos brinquedos, mas a responsabilidade pelas crianças é dos responsáveis."},{"titulo":"Danos","texto":"Danos ao espaço, brinquedos ou equipamentos, causados por convidados ou prestadores externos, são cobrados conforme orçamento."},{"titulo":"Cancelamento e troca de data","texto":"Até 30 dias antes: retenção de 20%. De 15 a 29 dias: 50%. Menos de 15 dias: sem devolução. Troca de data uma única vez, com 15 dias de antecedência."}]'::jsonb
where code in ('vila-operaria', 'sao-vicente');

create or replace function portal_get(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  r record;
  v_limit jsonb;
  v_due numeric;
  v_paid numeric;
begin
  if v_res is null then return null; end if;
  select res.*, c.name cliente, u.name unidade, u.full_address, u.pix_key, u.google_review_link, u.extra_hour_price,
         u.guest_min_age, u.menu_deadline_days, u.guest_deadline_days, u.payment_deadline_days, u.playlist_enabled,
         u.parabens_after_min, u.hot_dish_after_parabens_min, u.cake_after_parabens_min, u.portal_rules,
         p.name pacote, p.included_items, g.playlist_url
  into r
  from reservations res
  join clients c on c.id = res.client_id
  join units u on u.id = res.unit_id
  left join packages p on p.id = res.package_id
  join guest_list_pages g on g.token = p_token
  where res.id = v_res;

  v_limit := festa_hot_dish_limit(v_res);
  select coalesce(sum(amount), 0) into v_paid from payments where reservation_id = v_res;
  v_due := coalesce(r.final_value, 0)
    + coalesce((select sum(price_snapshot * quantity) from reservation_extra_items where reservation_id = v_res), 0)
    + coalesce((select sum(quantity * unit_price) from reservation_consumption where reservation_id = v_res), 0);

  return jsonb_build_object(
    'cliente', split_part(r.cliente, ' ', 1),
    'cliente_nome', r.cliente,
    'crianca', r.child_name, 'idade', r.child_age, 'tema', r.theme,
    'data', r.event_date, 'inicio', to_char(r.start_time, 'HH24:MI'), 'fim', to_char(r.end_time, 'HH24:MI'),
    'status', r.status,
    'unidade', r.unidade, 'vila', r.playlist_enabled, 'playlist_habilitada', r.playlist_enabled, 'endereco', r.full_address,
    'pix', r.pix_key, 'google_review_link', r.google_review_link, 'hora_extra', r.extra_hour_price,
    'pacote', r.pacote, 'itens_inclusos', r.included_items,
    'convidados_limite', coalesce(r.guest_count, 0) + coalesce(r.courtesy_guests, 0),
    'pratos_inclusos', (v_limit ->> 'inclusos')::int, 'pratos_adicionais', (v_limit ->> 'adicionais')::int,
    'pratos', case when coalesce(r.hot_dish_flavors, '') = '' then '[]'::jsonb else to_jsonb(array(select trim(x) from unnest(string_to_array(r.hot_dish_flavors, '/')) x where trim(x) <> '')) end,
    'bolo_sabor', r.cake_flavor, 'bolo_massa', r.cake_dough, 'cardapio_confirmado_em', r.menu_confirmed_at, 'cardapio_apos_prazo', coalesce(r.menu_sent_late, false),
    'musica', r.music_choice, 'playlist', r.playlist_url,
    'prazo_cardapio', r.event_date - r.menu_deadline_days, 'prazo_convidados', r.event_date - r.guest_deadline_days, 'prazo_pagamento', r.event_date - r.payment_deadline_days,
    'idade_minima', r.guest_min_age,
    'roteiro', jsonb_build_object('parabens', r.parabens_after_min, 'pratos', r.hot_dish_after_parabens_min, 'bolo', r.cake_after_parabens_min),
    'regras', coalesce(r.portal_rules, '[]'::jsonb),
    'empresa', (select jsonb_build_object('nome', co.name, 'logo_url', co.logo_url, 'whatsapp', co.team_whatsapp, 'tema', co.portal_theme) from companies co order by co.created_at limit 1),
    'hoje', today_brazil(),
    'festa_terminou', festa_ended(v_res),
    'valor_total', v_due, 'pago', v_paid, 'saldo', greatest(v_due - v_paid, 0),
    'pagamentos', coalesce((select jsonb_agg(jsonb_build_object('data', payment_date, 'valor', amount, 'forma', payment_method, 'obs', notes) order by payment_date, created_at)
                            from payments where reservation_id = v_res), '[]'::jsonb),
    'comprovantes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'valor', amount, 'status', status, 'motivo', reject_reason, 'enviado_em', created_at) order by created_at desc)
                              from portal_receipts where reservation_id = v_res), '[]'::jsonb),
    'contrato', (select jsonb_build_object('gerado_em', generated_at, 'texto', terms_text) from contracts where reservation_id = v_res order by generated_at desc nulls last limit 1),
    'mensagens', coalesce((select jsonb_agg(jsonb_build_object('de_cliente', from_client, 'autor', author_name, 'texto', body, 'em', created_at) order by created_at)
                           from portal_messages where reservation_id = v_res), '[]'::jsonb),
    'historico', coalesce((select jsonb_agg(jsonb_build_object('em', created_at, 'texto', description) order by created_at desc)
                           from (select * from portal_events where reservation_id = v_res order by created_at desc limit 100) e), '[]'::jsonb),
    'avaliou', exists (select 1 from party_reviews pr join review_links rl on rl.token = pr.token where rl.reservation_id = v_res),
    'menu', jsonb_build_object(
      'pratos', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'prato' and active), '[]'::jsonb),
      'massas', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'bolo_massa' and active), '[]'::jsonb),
      'sabores', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'bolo_sabor' and active), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function portal_save_menu(p_token uuid, p_pratos text[], p_massa text, p_sabor text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_date date;
  v_limit jsonb;
  v_max int;
  v_pratos text[];
  v_late boolean;
  v_dias int;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  select r.event_date, u.menu_deadline_days into v_date, v_dias from reservations r join units u on u.id = r.unit_id where r.id = v_res;
  -- Depois do prazo (X dias antes, configurado na unidade) ainda pode enviar,
  -- mas fica marcado como enviado após o prazo. Depois do dia da festa, não.
  if today_brazil() > v_date then
    raise exception 'A festa já aconteceu. Para alterar o cardápio, fale com a equipe.';
  end if;
  v_late := today_brazil() > v_date - v_dias;
  v_limit := festa_hot_dish_limit(v_res);
  v_max := (v_limit ->> 'inclusos')::int + (v_limit ->> 'adicionais')::int;
  select array(select distinct trim(x) from unnest(coalesce(p_pratos, '{}')) x where trim(x) <> '') into v_pratos;
  if coalesce(array_length(v_pratos, 1), 0) <> v_max then
    raise exception 'Escolha % prato(s) quente(s).', v_max;
  end if;
  if exists (select 1 from unnest(v_pratos) x where not exists (select 1 from portal_menu_options where kind = 'prato' and active and name = x)) then
    raise exception 'Prato quente inválido.';
  end if;
  if not exists (select 1 from portal_menu_options where kind = 'bolo_massa' and active and name = p_massa) then
    raise exception 'Escolha a massa do bolo.';
  end if;
  if p_sabor is distinct from 'Outro sabor (combinar com a equipe)' and not exists (select 1 from portal_menu_options where kind = 'bolo_sabor' and active and name = p_sabor) then
    raise exception 'Escolha o recheio do bolo.';
  end if;

  perform set_config('app.audit_actor', 'Cliente (portal)', true);
  update reservations set
    hot_dish_flavors = nullif(array_to_string(v_pratos, ' / '), ''),
    cake_dough = p_massa,
    cake_flavor = p_sabor,
    menu_confirmed_at = now(),
    menu_sent_late = v_late
  where id = v_res;
  perform set_config('app.audit_actor', '', true);
  perform portal_log(v_res, 'cardapio',
    case when v_late then 'Enviou o cardápio APÓS O PRAZO (' || to_char(v_date - v_dias, 'DD/MM') || '): ' else 'Confirmou o cardápio: ' end || coalesce(nullif(array_to_string(v_pratos, ', '), ''), 'sem pratos quentes') || ' · bolo de massa ' || lower(p_massa) || ', recheio ' || p_sabor);
end;
$$;

create or replace function portal_add_guests(p_token uuid, p_names text[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_date date;
  v_count integer;
  v_dias int;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  select r.event_date, u.guest_deadline_days into v_date, v_dias from reservations r join units u on u.id = r.unit_id where r.id = v_res;
  if today_brazil() > v_date - v_dias then
    raise exception 'A lista de convidados fechou em %. Para incluir alguém, fale com a equipe.', to_char(v_date - v_dias, 'DD/MM');
  end if;
  if coalesce(array_length(p_names, 1), 0) > 300 then raise exception 'Muitos nomes de uma vez.'; end if;
  if (select count(*) from guest_list_entries where token = p_token) + coalesce(array_length(p_names, 1), 0) > 1000 then
    raise exception 'Lista cheia.';
  end if;
  insert into guest_list_entries (token, name)
  select p_token, left(trim(n), 120) from unnest(p_names) n where trim(n) <> '';
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform portal_log(v_res, 'convidados',
      case when v_count = 1 then 'Adicionou ' || (select left(trim(n), 120) from unnest(p_names) n where trim(n) <> '' limit 1) || ' à lista de convidados'
           else 'Adicionou ' || v_count || ' convidados à lista' end);
  end if;
  return v_count;
end;
$$;

create or replace function portal_remove_guest(p_token uuid, p_entry_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_date date;
  v_name text;
  v_dias int;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  select r.event_date, u.guest_deadline_days into v_date, v_dias from reservations r join units u on u.id = r.unit_id where r.id = v_res;
  if today_brazil() > v_date - v_dias then
    raise exception 'A lista de convidados fechou. Para alterar, fale com a equipe.';
  end if;
  delete from guest_list_entries where id = p_entry_id and token = p_token and not arrived and not coalesce(flagged, false)
  returning name into v_name;
  if v_name is not null then perform portal_log(v_res, 'convidados', 'Removeu ' || v_name || ' da lista de convidados'); end if;
end;
$$;

create or replace function portal_set_music(p_token uuid, p_choice text, p_url text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_url text := nullif(trim(coalesce(p_url, '')), '');
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  if not coalesce((select u.playlist_enabled from reservations r join units u on u.id = r.unit_id where r.id = v_res), false) then
    raise exception 'A escolha de música não está disponível para esta festa.';
  end if;
  if p_choice not in ('equipe', 'cliente') then raise exception 'Escolha inválida.'; end if;
  if p_choice = 'cliente' and (v_url is null or v_url !~ '^https://(open\.spotify\.com|spotify\.link)/') then
    raise exception 'Envie um link do Spotify (open.spotify.com).';
  end if;
  perform set_config('app.audit_actor', 'Cliente (portal)', true);
  update reservations set music_choice = p_choice where id = v_res;
  update guest_list_pages set playlist_url = case when p_choice = 'cliente' then left(v_url, 500) end where token = p_token;
  perform set_config('app.audit_actor', '', true);
  perform portal_log(v_res, 'musica', case when p_choice = 'equipe' then 'Escolheu: músicas sugeridas pela equipe' else 'Enviou a playlist do Spotify' end);
end;
$$;

create or replace function public_get_guest_list_page(p_token uuid)
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
         u.playlist_enabled as playlist_enabled,
         g.playlist_url
  from guest_list_pages g
  join reservations r on r.id = g.reservation_id
  join units u on u.id = r.unit_id
  where g.token = p_token;
$$;

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
    where g.token = p_token and u.playlist_enabled
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

-- =========================================================
-- ROTEIRO E CARDÁPIO LIVRES (venda do sistema — Etapa 2, parte 2)
--
-- Nem toda casa de festas funciona como a Brava. Duas coisas que eram
-- fixas viram listas que cada empresa monta:
--
-- 1) ROTEIRO (programação sugerida no portal), por unidade:
--    units.schedule_enabled (mostra ou não) e units.schedule_items, uma
--    lista de itens { titulo, detalhe, ref: 'inicio' | 'fim', minutos,
--    secao } — "X min depois do início" ou "X min antes do fim"; `secao`
--    (opcional) = só aparece se a festa tiver escolhas naquela seção do
--    cardápio (ex.: pratos quentes só em pacote com pratos quentes).
--    Início e encerramento continuam automáticos.
--
-- 2) CARDÁPIO, em seções (menu_sections): cada seção tem nome, quantas
--    escolhas ("uma", "várias" = N fixo, ou "pelo pacote" = pratos quentes
--    inclusos + extras), se aceita "outro (combinar com a equipe)", e pode
--    valer para todas as unidades ou só uma. As opções continuam em
--    portal_menu_options, agora ligadas à seção.
--    As escolhas ficam em reservations.menu_choices. Seções ligadas a um
--    campo antigo (prato quente, massa e recheio do bolo) continuam
--    gravando nesse campo, para relatórios, Central da festa e mensagens
--    aos fornecedores funcionarem como hoje.
--
-- Brava: o roteiro de hoje vira 3 itens (parabéns 90 min, pratos quentes
-- 100 min só com pratos, bolo 120 min) e o cardápio de hoje vira 3 seções
-- (Pratos quentes pelo pacote, Massa do bolo, Recheio do bolo com "Outro
-- sabor"). Nada muda para o cliente. Unidade nova nasce com o roteiro
-- desligado; empresa nova começa sem seções de cardápio (portal sem a aba).
--
-- Não altera festas, pagamentos, clientes ou contas já existentes.
-- Roda dentro de uma transação.
-- =========================================================


-- ---------- 1) Roteiro ----------
alter table units add column if not exists schedule_enabled boolean not null default false;
alter table units add column if not exists schedule_items jsonb not null default '[]'::jsonb;
alter table units drop constraint if exists units_schedule_items_check;
alter table units add constraint units_schedule_items_check check (jsonb_typeof(schedule_items) = 'array');

-- ---------- 2) Seções do cardápio ----------
create table if not exists menu_sections (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  help text,
  mode text not null default 'uma' check (mode in ('uma', 'varias', 'pacote')),
  quantity int not null default 1 check (quantity between 1 and 30),
  allow_other boolean not null default false,
  other_label text not null default 'Outro (combinar com a equipe)',
  unit_id uuid references units(id) on delete cascade, -- null = todas as unidades
  legacy_field text unique check (legacy_field in ('hot_dish_flavors', 'cake_dough', 'cake_flavor')),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table menu_sections enable row level security;
drop policy if exists "read_active" on menu_sections;
create policy "read_active" on menu_sections for select using (is_active_user(auth.uid()));
drop policy if exists "write_menu_sections" on menu_sections;
create policy "write_menu_sections" on menu_sections for all
  using (has_permission(auth.uid(), 'action:pacotes.criar_editar'))
  with check (has_permission(auth.uid(), 'action:pacotes.criar_editar'));
drop trigger if exists trg_audit on menu_sections;
create trigger trg_audit after insert or update or delete on menu_sections for each row execute function audit_row_change();

alter table portal_menu_options add column if not exists section_id uuid references menu_sections(id) on delete cascade;
alter table portal_menu_options alter column kind drop not null;
create unique index if not exists portal_menu_options_section_name on portal_menu_options (section_id, name) where section_id is not null;

alter table reservations add column if not exists menu_choices jsonb;

-- Brava: o cardápio de hoje vira 3 seções (só se ainda não há seções e já
-- existem opções do modelo antigo — num banco novo não cria nada).
do $$
declare v_p uuid; v_m uuid; v_s uuid;
begin
  if not exists (select 1 from menu_sections) and exists (select 1 from portal_menu_options where kind is not null) then
    insert into menu_sections (name, mode, legacy_field, sort)
      values ('Pratos quentes', 'pacote', 'hot_dish_flavors', 1) returning id into v_p;
    insert into menu_sections (name, mode, legacy_field, sort)
      values ('Massa do bolo', 'uma', 'cake_dough', 2) returning id into v_m;
    insert into menu_sections (name, mode, allow_other, other_label, legacy_field, sort)
      values ('Recheio do bolo', 'uma', true, 'Outro sabor (combinar com a equipe)', 'cake_flavor', 3) returning id into v_s;
    update portal_menu_options set section_id = case kind when 'prato' then v_p when 'bolo_massa' then v_m when 'bolo_sabor' then v_s end
    where section_id is null and kind is not null;
  end if;
end $$;

-- Brava: roteiro de hoje (parabéns 90 min, pratos +10, bolo +30).
update units u set
  schedule_enabled = true,
  schedule_items = jsonb_build_array(
    jsonb_build_object('titulo', 'Parabéns', 'detalhe', '', 'ref', 'inicio', 'minutos', u.parabens_after_min, 'secao', null),
    jsonb_build_object('titulo', 'Pratos quentes', 'detalhe', 'Servidos logo após o parabéns.', 'ref', 'inicio', 'minutos', u.parabens_after_min + u.hot_dish_after_parabens_min,
                       'secao', (select id from menu_sections where legacy_field = 'hot_dish_flavors')),
    jsonb_build_object('titulo', 'Bolo', 'detalhe', 'Servido 30 minutos após o parabéns.', 'ref', 'inicio', 'minutos', u.parabens_after_min + u.cake_after_parabens_min, 'secao', null)
  )
where u.code in ('vila-operaria', 'sao-vicente') and u.schedule_items = '[]'::jsonb;

-- ---------- Funções do cardápio ----------

-- Quantas escolhas a festa faz numa seção.
create or replace function menu_section_quantity(p_section uuid, p_reservation uuid) returns int
language sql stable security definer set search_path = public as $$
  select case s.mode
    when 'uma' then 1
    when 'varias' then s.quantity
    else (select (l ->> 'inclusos')::int + (l ->> 'adicionais')::int from (select festa_hot_dish_limit(p_reservation) l) x)
  end
  from menu_sections s where s.id = p_section;
$$;

-- Seções que valem para a festa (pela unidade), com opções e quantidade.
create or replace function festa_menu_sections(p_reservation uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'nome', s.name, 'ajuda', s.help, 'modo', s.mode,
      'quantidade', menu_section_quantity(s.id, p_reservation),
      'outro', s.allow_other, 'outro_rotulo', s.other_label, 'campo', s.legacy_field,
      'opcoes', coalesce((select jsonb_agg(o.name order by o.sort, o.name) from portal_menu_options o where o.section_id = s.id and o.active), '[]'::jsonb)
    ) order by s.sort, s.created_at), '[]'::jsonb)
  from menu_sections s
  join reservations r on r.id = p_reservation
  where s.active and (s.unit_id is null or s.unit_id = r.unit_id);
$$;

-- Escolhas da festa por seção. Seções ligadas a campo antigo leem desse
-- campo (a equipe pode ter editado lá); as outras, de menu_choices.
create or replace function festa_menu_choices(p_reservation uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(s.id::text,
      case s.legacy_field
        when 'hot_dish_flavors' then case when coalesce(r.hot_dish_flavors, '') = '' then '[]'::jsonb
             else to_jsonb(array(select trim(x) from unnest(string_to_array(r.hot_dish_flavors, '/')) x where trim(x) <> '')) end
        when 'cake_dough' then case when coalesce(r.cake_dough, '') = '' then '[]'::jsonb else jsonb_build_array(r.cake_dough) end
        when 'cake_flavor' then case when coalesce(r.cake_flavor, '') = '' then '[]'::jsonb else jsonb_build_array(r.cake_flavor) end
        else coalesce(r.menu_choices -> s.id::text, '[]'::jsonb)
      end), '{}'::jsonb)
  from menu_sections s
  join reservations r on r.id = p_reservation
  where s.active and (s.unit_id is null or s.unit_id = r.unit_id);
$$;

-- Resumo em texto (Central da festa, relatórios): "Pratos quentes: A, B · Massa do bolo: X".
create or replace function festas_menu_resumo(p_reservations uuid[]) returns table (reservation_id uuid, resumo text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_active_user(auth.uid()) then raise exception 'Sem permissão'; end if;
  return query
  select r.id, (
    select string_agg(sec ->> 'nome' || ': ' || coalesce(nullif((select string_agg(v, ', ') from jsonb_array_elements_text(festa_menu_choices(r.id) -> (sec ->> 'id')) v), ''), '—'), ' · ')
    from jsonb_array_elements(festa_menu_sections(r.id)) sec
    where (sec ->> 'quantidade')::int > 0
  )
  from reservations r where r.id = any(p_reservations);
end;
$$;

-- Cliente salva o cardápio pelo portal. p_escolhas = { "<id da seção>": ["opção", ...] }.
create or replace function portal_save_menu_choices(p_token uuid, p_escolhas jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_date date;
  v_dias int;
  v_late boolean;
  sec jsonb;
  v_vals text[];
  v_qtd int;
  v_choices jsonb := '{}'::jsonb;
  v_resumo text[] := '{}';
  v_hot text; v_dough text; v_flavor text;
  v_set_hot boolean := false; v_set_dough boolean := false; v_set_flavor boolean := false;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  select r.event_date, u.menu_deadline_days into v_date, v_dias from reservations r join units u on u.id = r.unit_id where r.id = v_res;
  if today_brazil() > v_date then
    raise exception 'A festa já aconteceu. Para alterar o cardápio, fale com a equipe.';
  end if;
  if jsonb_array_length(festa_menu_sections(v_res)) = 0 then raise exception 'Esta festa não tem cardápio para escolher.'; end if;
  v_late := today_brazil() > v_date - v_dias;

  for sec in select * from jsonb_array_elements(festa_menu_sections(v_res)) loop
    v_qtd := (sec ->> 'quantidade')::int;
    select coalesce(array_agg(distinct left(trim(x), 200)), '{}') into v_vals
    from jsonb_array_elements_text(coalesce(p_escolhas -> (sec ->> 'id'), '[]'::jsonb)) x where trim(x) <> '';
    if coalesce(array_length(v_vals, 1), 0) <> v_qtd then
      raise exception '%: escolha %.', sec ->> 'nome', case when v_qtd = 1 then '1 opção' else v_qtd || ' opções' end;
    end if;
    if exists (select 1 from unnest(v_vals) v
               where not (sec -> 'opcoes') ? v
                 and not ((sec ->> 'outro')::boolean and v = sec ->> 'outro_rotulo')) then
      raise exception '%: opção inválida.', sec ->> 'nome';
    end if;
    v_choices := v_choices || jsonb_build_object(sec ->> 'id', to_jsonb(v_vals));
    if v_qtd > 0 then v_resumo := v_resumo || ((sec ->> 'nome') || ': ' || array_to_string(v_vals, ', ')); end if;
    case sec ->> 'campo'
      when 'hot_dish_flavors' then v_hot := nullif(array_to_string(v_vals, ' / '), ''); v_set_hot := true;
      when 'cake_dough' then v_dough := v_vals[1]; v_set_dough := true;
      when 'cake_flavor' then v_flavor := v_vals[1]; v_set_flavor := true;
      else null;
    end case;
  end loop;

  perform set_config('app.audit_actor', 'Cliente (portal)', true);
  update reservations set
    menu_choices = v_choices,
    hot_dish_flavors = case when v_set_hot then v_hot else hot_dish_flavors end,
    cake_dough = case when v_set_dough then v_dough else cake_dough end,
    cake_flavor = case when v_set_flavor then v_flavor else cake_flavor end,
    menu_confirmed_at = now(),
    menu_sent_late = v_late
  where id = v_res;
  perform set_config('app.audit_actor', '', true);
  perform portal_log(v_res, 'cardapio',
    case when v_late then 'Enviou o cardápio APÓS O PRAZO (' || to_char(v_date - v_dias, 'DD/MM') || '): ' else 'Confirmou o cardápio: ' end
    || coalesce(nullif(array_to_string(v_resumo, ' · '), ''), 'sem escolhas'));
end;
$$;

revoke all on function menu_section_quantity(uuid, uuid) from public, anon, authenticated;
revoke all on function festa_menu_sections(uuid) from public, anon, authenticated;
revoke all on function festa_menu_choices(uuid) from public, anon, authenticated;
revoke all on function festas_menu_resumo(uuid[]) from public, anon;
grant execute on function festas_menu_resumo(uuid[]) to authenticated;
revoke all on function portal_save_menu_choices(uuid, jsonb) from public;
grant execute on function portal_save_menu_choices(uuid, jsonb) to anon, authenticated;

-- ---------- portal_get: roteiro e cardápio novos ----------
-- (mantém tudo o que já devolvia, para a tela atual continuar funcionando)
create or replace function portal_get(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  r record;
  v_limit jsonb;
  v_due numeric;
  v_paid numeric;
begin
  if v_res is null then return null; end if;
  select res.*, c.name cliente, u.name unidade, u.full_address, u.pix_key, u.google_review_link, u.extra_hour_price,
         u.guest_min_age, u.menu_deadline_days, u.guest_deadline_days, u.payment_deadline_days, u.playlist_enabled,
         u.parabens_after_min, u.hot_dish_after_parabens_min, u.cake_after_parabens_min, u.portal_rules,
         u.schedule_enabled, u.schedule_items,
         p.name pacote, p.included_items, g.playlist_url
  into r
  from reservations res
  join clients c on c.id = res.client_id
  join units u on u.id = res.unit_id
  left join packages p on p.id = res.package_id
  join guest_list_pages g on g.token = p_token
  where res.id = v_res;

  v_limit := festa_hot_dish_limit(v_res);
  select coalesce(sum(amount), 0) into v_paid from payments where reservation_id = v_res;
  v_due := coalesce(r.final_value, 0)
    + coalesce((select sum(price_snapshot * quantity) from reservation_extra_items where reservation_id = v_res), 0)
    + coalesce((select sum(quantity * unit_price) from reservation_consumption where reservation_id = v_res), 0);

  return jsonb_build_object(
    'cliente', split_part(r.cliente, ' ', 1),
    'cliente_nome', r.cliente,
    'crianca', r.child_name, 'idade', r.child_age, 'tema', r.theme,
    'data', r.event_date, 'inicio', to_char(r.start_time, 'HH24:MI'), 'fim', to_char(r.end_time, 'HH24:MI'),
    'status', r.status,
    'unidade', r.unidade, 'vila', r.playlist_enabled, 'playlist_habilitada', r.playlist_enabled, 'endereco', r.full_address,
    'pix', r.pix_key, 'google_review_link', r.google_review_link, 'hora_extra', r.extra_hour_price,
    'pacote', r.pacote, 'itens_inclusos', r.included_items,
    'convidados_limite', coalesce(r.guest_count, 0) + coalesce(r.courtesy_guests, 0),
    'pratos_inclusos', (v_limit ->> 'inclusos')::int, 'pratos_adicionais', (v_limit ->> 'adicionais')::int,
    'pratos', case when coalesce(r.hot_dish_flavors, '') = '' then '[]'::jsonb else to_jsonb(array(select trim(x) from unnest(string_to_array(r.hot_dish_flavors, '/')) x where trim(x) <> '')) end,
    'bolo_sabor', r.cake_flavor, 'bolo_massa', r.cake_dough, 'cardapio_confirmado_em', r.menu_confirmed_at, 'cardapio_apos_prazo', coalesce(r.menu_sent_late, false),
    'musica', r.music_choice, 'playlist', r.playlist_url,
    'prazo_cardapio', r.event_date - r.menu_deadline_days, 'prazo_convidados', r.event_date - r.guest_deadline_days, 'prazo_pagamento', r.event_date - r.payment_deadline_days,
    'idade_minima', r.guest_min_age,
    'roteiro', jsonb_build_object('parabens', r.parabens_after_min, 'pratos', r.hot_dish_after_parabens_min, 'bolo', r.cake_after_parabens_min),
    'regras', coalesce(r.portal_rules, '[]'::jsonb),
    'roteiro_ligado', r.schedule_enabled, 'roteiro_itens', coalesce(r.schedule_items, '[]'::jsonb),
    'cardapio', jsonb_build_object('secoes', festa_menu_sections(v_res), 'escolhas', festa_menu_choices(v_res)),
    'empresa', (select jsonb_build_object('nome', co.name, 'logo_url', co.logo_url, 'whatsapp', co.team_whatsapp, 'tema', co.portal_theme) from companies co order by co.created_at limit 1),
    'hoje', today_brazil(),
    'festa_terminou', festa_ended(v_res),
    'valor_total', v_due, 'pago', v_paid, 'saldo', greatest(v_due - v_paid, 0),
    'pagamentos', coalesce((select jsonb_agg(jsonb_build_object('data', payment_date, 'valor', amount, 'forma', payment_method, 'obs', notes) order by payment_date, created_at)
                            from payments where reservation_id = v_res), '[]'::jsonb),
    'comprovantes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'valor', amount, 'status', status, 'motivo', reject_reason, 'enviado_em', created_at) order by created_at desc)
                              from portal_receipts where reservation_id = v_res), '[]'::jsonb),
    'contrato', (select jsonb_build_object('gerado_em', generated_at, 'texto', terms_text) from contracts where reservation_id = v_res order by generated_at desc nulls last limit 1),
    'mensagens', coalesce((select jsonb_agg(jsonb_build_object('de_cliente', from_client, 'autor', author_name, 'texto', body, 'em', created_at) order by created_at)
                           from portal_messages where reservation_id = v_res), '[]'::jsonb),
    'historico', coalesce((select jsonb_agg(jsonb_build_object('em', created_at, 'texto', description) order by created_at desc)
                           from (select * from portal_events where reservation_id = v_res order by created_at desc limit 100) e), '[]'::jsonb),
    'avaliou', exists (select 1 from party_reviews pr join review_links rl on rl.token = pr.token where rl.reservation_id = v_res),
    'menu', jsonb_build_object(
      'pratos', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'prato' and active), '[]'::jsonb),
      'massas', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'bolo_massa' and active), '[]'::jsonb),
      'sabores', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'bolo_sabor' and active), '[]'::jsonb)
    )
  );
end;
$$;

-- =========================================================
-- VÁRIAS EMPRESAS NO MESMO BANCO (venda do sistema — Etapa 3)
--
-- Prepara o banco para guardar várias casas de festa, cada uma vendo só os
-- próprios dados. Na Brava (banco próprio, uma empresa só) nada muda na
-- prática: tudo é marcado como da Brava.
--
-- Como funciona:
-- 1) Cada usuário pertence a uma empresa (company_members, preenchida a
--    partir de user_profiles.company_id). current_company_id() = empresa de
--    quem está logado.
-- 2) TODAS as tabelas ganham company_id (obrigatório). Ao gravar, o banco
--    preenche sozinho: empresa de quem está logado; em gravação do portal
--    (sem login), a empresa da festa; num banco com uma empresa só, ela.
--    O banco também recusa ligar um registro a algo de outra empresa (ex.:
--    pagamento numa festa de outra empresa) e trocar a empresa de um registro.
-- 3) Bloqueio no próprio banco: uma regra "restritiva" em todas as tabelas
--    só deixa ver, criar, alterar ou apagar o que é da empresa de quem está
--    logado. Ela soma às permissões que já existem (não substitui).
-- 4) As funções que leem dados "por cima" das permissões (relatórios,
--    financeiro, comissões, portal...) passam a rodar com um papel próprio
--    (app_definer), que também obedece ao bloqueio entre empresas. Ficam de
--    fora só as que respondem "sim/não" sobre o próprio usuário (permissões).
-- 5) Regras de "não pode repetir" passam a valer por empresa (nome de
--    perfil, apelido de unidade, opções do cardápio, modelos de mensagem,
--    taxas por forma de pagamento, configuração de comissão).
-- 6) Arquivos: documentos da festa e comprovantes só abrem para a empresa
--    dona da festa; a logo só é enviada na pasta da própria empresa.
--
-- Não altera valores de festas, pagamentos, clientes ou contas: só marca a
-- empresa em cada registro (sem disparar histórico nem travas).
-- Roda dentro de uma transação.
-- =========================================================


-- ---------- 0) Papel das funções que leem por cima das permissões ----------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_definer') then
    create role app_definer nologin;
  end if;
end $$;
grant app_definer to current_user;
grant authenticated to app_definer;
grant usage on schema public to app_definer;
-- algumas funções (ex.: repasse de comissões) usam tabela temporária
-- (no Supabase todos já podem; se o usuário não puder repassar, segue sem travar)
do $$
begin
  execute format('grant temporary on database %I to app_definer', current_database());
exception when others then
  raise notice 'Permissão de tabela temporária não repassada (já é liberada para todos): %', sqlerrm;
end $$;
grant all on all tables in schema public to app_definer;
grant all on all sequences in schema public to app_definer;
alter default privileges in schema public grant all on tables to app_definer;
alter default privileges in schema public grant all on sequences to app_definer;

-- ---------- 1) Empresa de cada usuário ----------
create table if not exists company_members (
  user_id uuid primary key,
  company_id uuid not null references companies(id) on delete cascade
);
alter table company_members enable row level security; -- sem regras: ninguém lê pela internet
revoke all on company_members from anon, authenticated;

create or replace function current_company_id() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from company_members where user_id = auth.uid();
$$;
revoke all on function current_company_id() from public;
grant execute on function current_company_id() to anon, authenticated, app_definer;

-- Preenche e confere a empresa de cada registro.
create or replace function set_company_id() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j jsonb := to_jsonb(new);
  v uuid := new.company_id;
  m record;
  v_pai uuid;
begin
  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id then
    raise exception 'Não é possível mudar a empresa de um registro.';
  end if;
  if v is null then v := current_company_id(); end if;
  if v is null and j ? 'reservation_id' and j ->> 'reservation_id' is not null then
    select company_id into v from reservations where id = (j ->> 'reservation_id')::uuid;
  end if;
  if v is null and tg_table_name = 'guest_list_entries' then
    select company_id into v from guest_list_pages where token = (j ->> 'token')::uuid;
  end if;
  if v is null and tg_table_name = 'party_reviews' then
    select company_id into v from review_links where token = (j ->> 'token')::uuid;
  end if;
  if v is null and (select count(*) from companies) = 1 then
    select id into v from companies;
  end if;
  if v is null then
    raise exception 'Não foi possível identificar a empresa deste registro (%).', tg_table_name;
  end if;
  new.company_id := v;
  -- Não deixa ligar a algo de outra empresa.
  for m in select * from (values
    ('reservation_id', 'reservations'), ('unit_id', 'units'), ('client_id', 'clients'), ('package_id', 'packages'),
    ('space_id', 'spaces'), ('role_id', 'roles'), ('section_id', 'menu_sections'), ('supplier_id', 'suppliers')
  ) x(col, tab) loop
    if j ? m.col and j ->> m.col is not null and tg_table_name <> m.tab then
      execute format('select company_id from %I where id = $1', m.tab) into v_pai using (j ->> m.col)::uuid;
      if v_pai is not null and v_pai <> v then
        raise exception 'Registro de outra empresa (%).', m.col;
      end if;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function set_company_id() from public, anon, authenticated;

-- ---------- 2) company_id em todas as tabelas ----------
do $$
declare
  v_brava uuid := (select id from companies order by created_at limit 1);
  t text;
begin
  if v_brava is null then raise exception 'Rode antes a migração 068 (empresa).'; end if;
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('companies', 'company_members')
    order by c.relname
  loop
    execute format('alter table %I add column if not exists company_id uuid references companies(id)', t);
    -- marca o que já existe como da Brava sem disparar histórico nem travas
    execute format('alter table %I disable trigger user', t);
    execute format('update %I set company_id = %L where company_id is null', t, v_brava);
    execute format('alter table %I enable trigger user', t);
    execute format('alter table %I alter column company_id set not null', t);
    -- valor padrão também (tabelas de rascunho copiadas com "like" não têm o gatilho)
    execute format('alter table %I alter column company_id set default current_company_id()', t);
    execute format('create index if not exists %I on %I (company_id)', 'idx_' || t || '_company', t);
    execute format('drop trigger if exists trg_set_company_id on %I', t);
    execute format('create trigger trg_set_company_id before insert or update on %I for each row execute function set_company_id()', t);
    execute format('drop policy if exists company_isolation on %I', t);
    execute format('create policy company_isolation on %I as restrictive for all
      using (company_id = current_company_id() or (auth.uid() is null and current_user = %L))
      with check (company_id = current_company_id() or (auth.uid() is null and current_user = %L))', t, 'app_definer', 'app_definer');
    execute format('drop policy if exists app_definer_all on %I', t);
    execute format('create policy app_definer_all on %I for all to app_definer using (true) with check (true)', t);
  end loop;
end $$;


insert into company_members (user_id, company_id)
select id, company_id from user_profiles
on conflict (user_id) do update set company_id = excluded.company_id;

create or replace function sync_company_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into company_members (user_id, company_id) values (new.id, new.company_id)
  on conflict (user_id) do update set company_id = excluded.company_id;
  return null;
end;
$$;
revoke all on function sync_company_member() from public, anon, authenticated;
drop trigger if exists trg_sync_company_member on user_profiles;
create trigger trg_sync_company_member after insert or update of company_id on user_profiles
  for each row execute function sync_company_member();

-- ---------- 3) Empresa: cada uma vê e edita só a sua ----------
drop policy if exists "read_active" on companies;
drop policy if exists "update_admin" on companies;
drop policy if exists "read_own" on companies;
create policy "read_own" on companies for select using (id = current_company_id() and is_active_user(auth.uid()));
drop policy if exists "update_own_admin" on companies;
create policy "update_own_admin" on companies for update
  using (id = current_company_id() and is_admin_user(auth.uid()))
  with check (id = current_company_id() and is_admin_user(auth.uid()));
drop policy if exists app_definer_all on companies;
create policy app_definer_all on companies for select to app_definer
  using (id = current_company_id() or auth.uid() is null);

-- Marca: logado = a própria empresa; sem login (tela de login) = a primeira.
create or replace function public_company_brand()
returns table (name text, logo_url text, tagline text, team_whatsapp text, mascot_enabled boolean, portal_theme text)
language sql stable security definer set search_path = public as $$
  select c.name, c.logo_url, c.tagline, c.team_whatsapp, c.mascot_enabled, c.portal_theme
  from companies c
  where c.id = coalesce(current_company_id(), (select id from companies order by created_at limit 1));
$$;

-- ---------- 4) "Não pode repetir" por empresa ----------
alter table roles drop constraint if exists roles_name_key;
drop index if exists roles_name_key;
alter table roles drop constraint if exists roles_company_name_key;
alter table roles add constraint roles_company_name_key unique (company_id, name);

alter table portal_menu_options drop constraint if exists portal_menu_options_kind_name_key;
drop index if exists portal_menu_options_kind_name_key;
create unique index if not exists portal_menu_options_company_kind_name on portal_menu_options (company_id, kind, name) where kind is not null;

alter table commission_settings drop constraint if exists commission_settings_unica_key;
alter table commission_settings drop constraint if exists commission_settings_company_unica_key;
alter table commission_settings add constraint commission_settings_company_unica_key unique (company_id, unica);

drop index if exists units_code_key;
create unique index if not exists units_company_code_key on units (company_id, code) where code is not null;

alter table menu_sections drop constraint if exists menu_sections_legacy_field_key;
create unique index if not exists menu_sections_company_legacy_key on menu_sections (company_id, legacy_field) where legacy_field is not null;

alter table message_templates drop constraint if exists message_templates_pkey;
alter table message_templates add primary key (company_id, key);

alter table payment_method_fees drop constraint if exists payment_method_fees_pkey;
alter table payment_method_fees add primary key (company_id, payment_method);

-- ---------- 5) Funções do portal e do histórico ----------
create or replace function audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_actor text := nullif(current_setting('app.audit_actor', true), '');
  v_name text;
  v_action text;
  v_row jsonb;
  v_old jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_reservation text;
begin
  if tg_op = 'INSERT' then
    v_action := 'criou';
    v_row := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action := 'alterou';
    v_row := to_jsonb(new);
    v_old := to_jsonb(old);
    for v_key in select jsonb_object_keys(v_row) loop
      if v_key not in ('updated_at', 'created_at') and (v_row -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('de', v_old -> v_key, 'para', v_row -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;
    end if;
  else
    v_action := 'excluiu';
    v_row := to_jsonb(old);
  end if;

  if v_actor is not null then
    v_uid := null;
    v_name := v_actor;
  elsif v_uid is not null then
    select name into v_name from user_profiles where id = v_uid;
  end if;

  v_reservation := case
    when tg_table_name = 'reservations' then v_row ->> 'id'
    else v_row ->> 'reservation_id'
  end;

  insert into audit_log (company_id, user_id, user_name, action, entity, entity_id, details)
  values (
    coalesce(
      case when tg_table_name = 'companies' then (v_row ->> 'id')::uuid else (v_row ->> 'company_id')::uuid end,
      current_company_id()
    ),
    v_uid,
    coalesce(v_name, case when v_uid is null then 'Link público ou sistema' else 'Usuário sem perfil' end),
    v_action,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    jsonb_strip_nulls(jsonb_build_object(
      'reservation_id', v_reservation,
      'changes', case when tg_op = 'UPDATE' then audit_trim(v_changes) end,
      'row', case when tg_op <> 'UPDATE' then audit_trim(v_row) end
    ))
  );
  return null;
end;
$$;

create or replace function portal_get(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  r record;
  v_limit jsonb;
  v_due numeric;
  v_paid numeric;
begin
  if v_res is null then return null; end if;
  select res.*, c.name cliente, u.name unidade, u.full_address, u.pix_key, u.google_review_link, u.extra_hour_price,
         u.guest_min_age, u.menu_deadline_days, u.guest_deadline_days, u.payment_deadline_days, u.playlist_enabled,
         u.parabens_after_min, u.hot_dish_after_parabens_min, u.cake_after_parabens_min, u.portal_rules,
         u.schedule_enabled, u.schedule_items,
         p.name pacote, p.included_items, g.playlist_url
  into r
  from reservations res
  join clients c on c.id = res.client_id
  join units u on u.id = res.unit_id
  left join packages p on p.id = res.package_id
  join guest_list_pages g on g.token = p_token
  where res.id = v_res;

  v_limit := festa_hot_dish_limit(v_res);
  select coalesce(sum(amount), 0) into v_paid from payments where reservation_id = v_res;
  v_due := coalesce(r.final_value, 0)
    + coalesce((select sum(price_snapshot * quantity) from reservation_extra_items where reservation_id = v_res), 0)
    + coalesce((select sum(quantity * unit_price) from reservation_consumption where reservation_id = v_res), 0);

  return jsonb_build_object(
    'cliente', split_part(r.cliente, ' ', 1),
    'cliente_nome', r.cliente,
    'crianca', r.child_name, 'idade', r.child_age, 'tema', r.theme,
    'data', r.event_date, 'inicio', to_char(r.start_time, 'HH24:MI'), 'fim', to_char(r.end_time, 'HH24:MI'),
    'status', r.status,
    'unidade', r.unidade, 'vila', r.playlist_enabled, 'playlist_habilitada', r.playlist_enabled, 'endereco', r.full_address,
    'pix', r.pix_key, 'google_review_link', r.google_review_link, 'hora_extra', r.extra_hour_price,
    'pacote', r.pacote, 'itens_inclusos', r.included_items,
    'convidados_limite', coalesce(r.guest_count, 0) + coalesce(r.courtesy_guests, 0),
    'pratos_inclusos', (v_limit ->> 'inclusos')::int, 'pratos_adicionais', (v_limit ->> 'adicionais')::int,
    'pratos', case when coalesce(r.hot_dish_flavors, '') = '' then '[]'::jsonb else to_jsonb(array(select trim(x) from unnest(string_to_array(r.hot_dish_flavors, '/')) x where trim(x) <> '')) end,
    'bolo_sabor', r.cake_flavor, 'bolo_massa', r.cake_dough, 'cardapio_confirmado_em', r.menu_confirmed_at, 'cardapio_apos_prazo', coalesce(r.menu_sent_late, false),
    'musica', r.music_choice, 'playlist', r.playlist_url,
    'prazo_cardapio', r.event_date - r.menu_deadline_days, 'prazo_convidados', r.event_date - r.guest_deadline_days, 'prazo_pagamento', r.event_date - r.payment_deadline_days,
    'idade_minima', r.guest_min_age,
    'roteiro', jsonb_build_object('parabens', r.parabens_after_min, 'pratos', r.hot_dish_after_parabens_min, 'bolo', r.cake_after_parabens_min),
    'regras', coalesce(r.portal_rules, '[]'::jsonb),
    'roteiro_ligado', r.schedule_enabled, 'roteiro_itens', coalesce(r.schedule_items, '[]'::jsonb),
    'cardapio', jsonb_build_object('secoes', festa_menu_sections(v_res), 'escolhas', festa_menu_choices(v_res)),
    'empresa', (select jsonb_build_object('nome', co.name, 'logo_url', co.logo_url, 'whatsapp', co.team_whatsapp, 'tema', co.portal_theme) from companies co where co.id = r.company_id),
    'hoje', today_brazil(),
    'festa_terminou', festa_ended(v_res),
    'valor_total', v_due, 'pago', v_paid, 'saldo', greatest(v_due - v_paid, 0),
    'pagamentos', coalesce((select jsonb_agg(jsonb_build_object('data', payment_date, 'valor', amount, 'forma', payment_method, 'obs', notes) order by payment_date, created_at)
                            from payments where reservation_id = v_res), '[]'::jsonb),
    'comprovantes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'valor', amount, 'status', status, 'motivo', reject_reason, 'enviado_em', created_at) order by created_at desc)
                              from portal_receipts where reservation_id = v_res), '[]'::jsonb),
    'contrato', (select jsonb_build_object('gerado_em', generated_at, 'texto', terms_text) from contracts where reservation_id = v_res order by generated_at desc nulls last limit 1),
    'mensagens', coalesce((select jsonb_agg(jsonb_build_object('de_cliente', from_client, 'autor', author_name, 'texto', body, 'em', created_at) order by created_at)
                           from portal_messages where reservation_id = v_res), '[]'::jsonb),
    'historico', coalesce((select jsonb_agg(jsonb_build_object('em', created_at, 'texto', description) order by created_at desc)
                           from (select * from portal_events where reservation_id = v_res order by created_at desc limit 100) e), '[]'::jsonb),
    'avaliou', exists (select 1 from party_reviews pr join review_links rl on rl.token = pr.token where rl.reservation_id = v_res),
    'menu', jsonb_build_object(
      'pratos', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'prato' and active and company_id = r.company_id), '[]'::jsonb),
      'massas', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'bolo_massa' and active and company_id = r.company_id), '[]'::jsonb),
      'sabores', coalesce((select jsonb_agg(name order by sort, name) from portal_menu_options where kind = 'bolo_sabor' and active and company_id = r.company_id), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function festa_menu_sections(p_reservation uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'nome', s.name, 'ajuda', s.help, 'modo', s.mode,
      'quantidade', menu_section_quantity(s.id, p_reservation),
      'outro', s.allow_other, 'outro_rotulo', s.other_label, 'campo', s.legacy_field,
      'opcoes', coalesce((select jsonb_agg(o.name order by o.sort, o.name) from portal_menu_options o where o.section_id = s.id and o.active), '[]'::jsonb)
    ) order by s.sort, s.created_at), '[]'::jsonb)
  from menu_sections s
  join reservations r on r.id = p_reservation
  where s.active and s.company_id = r.company_id and (s.unit_id is null or s.unit_id = r.unit_id);
$$;

create or replace function festa_menu_choices(p_reservation uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(s.id::text,
      case s.legacy_field
        when 'hot_dish_flavors' then case when coalesce(r.hot_dish_flavors, '') = '' then '[]'::jsonb
             else to_jsonb(array(select trim(x) from unnest(string_to_array(r.hot_dish_flavors, '/')) x where trim(x) <> '')) end
        when 'cake_dough' then case when coalesce(r.cake_dough, '') = '' then '[]'::jsonb else jsonb_build_array(r.cake_dough) end
        when 'cake_flavor' then case when coalesce(r.cake_flavor, '') = '' then '[]'::jsonb else jsonb_build_array(r.cake_flavor) end
        else coalesce(r.menu_choices -> s.id::text, '[]'::jsonb)
      end), '{}'::jsonb)
  from menu_sections s
  join reservations r on r.id = p_reservation
  where s.active and s.company_id = r.company_id and (s.unit_id is null or s.unit_id = r.unit_id);
$$;

-- Funções antigas, sem uso desde o portal novo (deixavam brecha entre empresas).
drop function if exists portal_save_menu(uuid, text[], text, text);
drop function if exists public_get_guest_list_page(uuid);
drop function if exists public_list_guest_entries(uuid);
drop function if exists public_add_guest_entries(uuid, text[]);
drop function if exists public_remove_guest_entry(uuid, uuid);
drop function if exists public_set_guest_list_playlist(uuid, text);

-- ---------- 6) Arquivos ----------
do $$
begin
  drop policy if exists "festa_documentos_select" on storage.objects;
  create policy "festa_documentos_select" on storage.objects for select to authenticated
    using (bucket_id = 'festa-documentos' and exists (select 1 from reservations r where r.id::text = (storage.foldername(name))[1]));
  drop policy if exists "festa_documentos_insert" on storage.objects;
  create policy "festa_documentos_insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'festa-documentos' and exists (select 1 from reservations r where r.id::text = (storage.foldername(name))[1]));
  drop policy if exists "festa_documentos_delete" on storage.objects;
  create policy "festa_documentos_delete" on storage.objects for delete to authenticated
    using (bucket_id = 'festa-documentos' and exists (select 1 from reservations r where r.id::text = (storage.foldername(name))[1]));
  drop policy if exists "portal_comprovantes_read" on storage.objects;
  create policy "portal_comprovantes_read" on storage.objects for select to authenticated
    using (bucket_id = 'portal-comprovantes'
      and (has_permission(auth.uid(), 'page:portal_avisos') or has_permission(auth.uid(), 'action:festa.pagamentos'))
      and exists (select 1 from portal_receipts pr where pr.storage_path = name));
  drop policy if exists "marca_insert" on storage.objects;
  create policy "marca_insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'marca' and is_admin_user(auth.uid()) and (storage.foldername(name))[1] = current_company_id()::text);
end $$;

-- ---------- 7) Funções passam a rodar com o papel app_definer ----------
-- Ficam com o dono atual só as que respondem sobre o próprio usuário e as
-- que o próprio bloqueio usa (senão o bloqueio chamaria a si mesmo).
create or replace function fix_definer_owners() returns int
language plpgsql set search_path = public as $$
declare f record; n int := 0;
begin
  -- O Postgres só deixa um papel ser dono de função se ele puder "criar" na
  -- área (schema) da função: dá essa permissão só durante a troca.
  execute 'grant create on schema public to app_definer';
  for f in
    select p.oid::regprocedure sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prosecdef and pg_get_userbyid(p.proowner) <> 'app_definer'
      and p.proname not in ('is_active_user', 'is_admin_user', 'has_permission', 'portal_token_valid',
                            'current_company_id', 'current_actor_name', 'set_company_id', 'sync_company_member')
  loop
    execute format('alter function %s owner to app_definer', f.sig);
    n := n + 1;
  end loop;
  execute 'revoke create on schema public from app_definer';
  return n;
end;
$$;
revoke all on function fix_definer_owners() from public, anon, authenticated;
grant execute on all functions in schema public to app_definer;
select fix_definer_owners();

-- =========================================================
-- PAINEL DO ADMINISTRADOR GERAL (venda do sistema — Etapa 4)
--
-- 1) platform_admins: quem administra a plataforma (cadastra empresas). Só é
--    preenchida no banco dos clientes; no banco da Brava fica vazia e o
--    painel nem aparece.
-- 2) companies ganha:
--    - active: empresa suspensa (ex.: sem pagamento) — ninguém dela entra;
--    - disabled_modules: funções desligadas para aquela empresa (comissões,
--      agenda, marketing...). Some do menu e das telas dela.
-- 3) platform_settings: nome/logo do produto, mostrados na tela de login do
--    banco compartilhado (sem login não dá para saber de qual empresa é).
-- 4) Funções do painel (só administrador geral): listar empresas com
--    números, editar nome/funções/suspensão, configurar o produto.
--    platform_create_company: cria empresa + dados iniciais + perfil do
--    primeiro administrador — chamada pela função de servidor
--    "platform-admin", que cria o login (precisa da chave de serviço).
-- 5) is_active_user passa a considerar a empresa suspensa.
-- 6) O histórico de alterações registra também o que o administrador geral
--    faz em outra empresa.
--
-- Na Brava nada muda (ela continua ativa e com todas as funções).
-- Roda dentro de uma transação.
-- =========================================================


-- ---------- 1) Administrador geral ----------
create table if not exists platform_admins (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security; -- sem regras: ninguém lê pela internet
revoke all on platform_admins from anon, authenticated;

create or replace function is_platform_admin(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = p_user);
$$;
revoke all on function is_platform_admin(uuid) from public, anon;
grant execute on function is_platform_admin(uuid) to authenticated;

-- ---------- 2) Empresa: ativa e funções desligadas ----------
alter table companies add column if not exists active boolean not null default true;
alter table companies add column if not exists disabled_modules text[] not null default '{}';

-- Usuário de empresa suspensa deixa de ser "ativo" (todas as permissões caem).
create or replace function is_active_user(check_id uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select coalesce((
    select up.active and coalesce(c.active, true)
    from user_profiles up left join companies c on c.id = up.company_id
    where up.id = check_id
  ), false);
$$;

-- ---------- 3) Produto (tela de login do banco compartilhado) ----------
create table if not exists platform_settings (
  id uuid primary key default gen_random_uuid(),
  unica boolean not null default true unique check (unica),
  name text not null check (length(trim(name)) > 0),
  logo_url text,
  tagline text
);
alter table platform_settings enable row level security;
revoke all on platform_settings from anon, authenticated;

-- Marca: logado = a própria empresa; sem login = o produto (se configurado)
-- ou, num banco de uma empresa só (Brava), a própria empresa.
drop function if exists public_company_brand();
create or replace function public_company_brand()
returns table (name text, logo_url text, tagline text, team_whatsapp text, mascot_enabled boolean, portal_theme text, disabled_modules text[], active boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if current_company_id() is null and exists (select 1 from platform_settings) then
    return query select p.name, p.logo_url, p.tagline, null::text, false, 'padrao'::text, '{}'::text[], true from platform_settings p limit 1;
    return;
  end if;
  return query
  select c.name, c.logo_url, c.tagline, c.team_whatsapp, c.mascot_enabled, c.portal_theme, c.disabled_modules, c.active
  from companies c
  where c.id = coalesce(current_company_id(), (select id from companies order by created_at limit 1));
end;
$$;
revoke all on function public_company_brand() from public;
grant execute on function public_company_brand() to anon, authenticated;

-- ---------- 4) Funções do painel ----------
create or replace function platform_list_companies()
returns table (id uuid, name text, active boolean, created_at timestamptz, disabled_modules text[],
               usuarios int, unidades int, festas int, festas_30d int, ultima_atividade timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query
  select c.id, c.name, c.active, c.created_at, c.disabled_modules,
         (select count(*)::int from user_profiles u where u.company_id = c.id and u.active),
         (select count(*)::int from units un where un.company_id = c.id and un.active),
         (select count(*)::int from reservations r where r.company_id = c.id and r.status <> 'cancelada'),
         (select count(*)::int from reservations r where r.company_id = c.id and r.created_at > now() - interval '30 days'),
         (select max(a.created_at) from audit_log a where a.company_id = c.id)
  from companies c
  order by c.created_at;
end;
$$;

create or replace function platform_update_company(p_company uuid, p_name text, p_active boolean, p_disabled_modules text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Informe o nome da empresa.'; end if;
  update companies set name = trim(p_name), active = coalesce(p_active, active), disabled_modules = coalesce(p_disabled_modules, '{}')
  where id = p_company;
  if not found then raise exception 'Empresa não encontrada.'; end if;
end;
$$;

create or replace function platform_get_settings() returns table (name text, logo_url text, tagline text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query select p.name, p.logo_url, p.tagline from platform_settings p limit 1;
end;
$$;

create or replace function platform_save_settings(p_name text, p_logo_url text, p_tagline text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Informe o nome do produto.'; end if;
  insert into platform_settings (name, logo_url, tagline) values (trim(p_name), nullif(trim(p_logo_url), ''), nullif(trim(p_tagline), ''))
  on conflict (unica) do update set name = excluded.name, logo_url = excluded.logo_url, tagline = excluded.tagline;
end;
$$;

-- Cria a empresa com os dados iniciais e o perfil do primeiro administrador.
-- Chamada só pela função de servidor "platform-admin" (chave de serviço),
-- depois de ela criar o login (p_admin_user) no Supabase Auth.
create or replace function platform_create_company(p_name text, p_admin_user uuid, p_admin_name text, p_admin_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_role uuid;
begin
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Informe o nome da empresa.'; end if;
  if p_admin_user is null or p_admin_name is null or length(trim(p_admin_name)) = 0 then raise exception 'Informe o administrador da empresa.'; end if;
  if exists (select 1 from user_profiles where id = p_admin_user) then raise exception 'Este login já pertence a uma empresa.'; end if;

  insert into companies (name, portal_theme, mascot_enabled) values (trim(p_name), 'padrao', false) returning id into v_company;

  -- dados iniciais
  insert into roles (name, is_admin, company_id) values ('Administrador', true, v_company) returning id into v_role;
  insert into payment_method_fees (company_id, payment_method, fee_percent)
  select v_company, m, 0 from unnest(array['pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'boleto', 'transferencia', 'outro']) m;
  insert into commission_settings (company_id, start_date, beneficiary) values (v_company, today_brazil(), 'Gerente');

  insert into user_profiles (id, name, email, role_id, active, company_id)
  values (p_admin_user, trim(p_admin_name), nullif(trim(p_admin_email), ''), v_role, true, v_company);
  return v_company;
end;
$$;

revoke all on function platform_list_companies() from public, anon;
revoke all on function platform_update_company(uuid, text, boolean, text[]) from public, anon;
revoke all on function platform_get_settings() from public, anon;
revoke all on function platform_save_settings(text, text, text) from public, anon;
grant execute on function platform_list_companies(), platform_update_company(uuid, text, boolean, text[]),
  platform_get_settings(), platform_save_settings(text, text, text) to authenticated;
revoke all on function platform_create_company(text, uuid, text, text) from public, anon, authenticated;
grant execute on function platform_create_company(text, uuid, text, text) to service_role;

-- As funções do painel precisam enxergar todas as empresas: ficam com o dono
-- atual (não passam para app_definer).
create or replace function fix_definer_owners() returns int
language plpgsql set search_path = public as $$
declare f record; n int := 0;
begin
  execute 'grant create on schema public to app_definer';
  for f in
    select p.oid::regprocedure sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prosecdef and pg_get_userbyid(p.proowner) <> 'app_definer'
      and p.proname not in ('is_active_user', 'is_admin_user', 'has_permission', 'portal_token_valid',
                            'current_company_id', 'current_actor_name', 'set_company_id', 'sync_company_member',
                            'is_platform_admin', 'public_company_brand', 'audit_row_change')
      and p.proname not like 'platform\_%'
  loop
    execute format('alter function %s owner to app_definer', f.sig);
    n := n + 1;
  end loop;
  execute 'revoke create on schema public from app_definer';
  return n;
end;
$$;
revoke all on function fix_definer_owners() from public, anon, authenticated;
-- public_company_brand foi recriada acima (dono atual): precisa ver o produto sem login.
-- O histórico de alterações só ESCREVE (na empresa do próprio registro); volta
-- para o dono atual para registrar também o que o administrador geral faz em
-- outra empresa (ex.: suspender), o que o bloqueio entre empresas recusaria.
do $$ begin execute format('alter function audit_row_change() owner to %I', current_user); end $$;
select fix_definer_owners();

-- =========================================================
-- ADMINISTRADOR GERAL FORA DAS EMPRESAS (venda do sistema)
--
-- 1) O administrador geral não é mais funcionário de nenhuma empresa: não
--    aparece em "Usuários e permissões" de ninguém, e nenhum administrador
--    de casa de festas consegue ativar, desativar ou mudar o acesso dele.
--    Ao entrar, ele fica no painel da plataforma; para mexer numa casa de
--    festas, "abre" a empresa (platform_enter_company) e age como
--    administrador dela; "volta" com platform_leave_company.
-- 2) Configurações da empresa e das unidades: num banco com administrador
--    geral (o dos clientes), só ele altera; num banco sem (a Brava), o
--    administrador da empresa continua alterando como hoje.
-- 3) O histórico mostra "Administrador geral" no que ele fizer.
--
-- Na Brava nada muda (não há administrador geral).
-- Roda dentro de uma transação.
-- =========================================================


-- ---------- 1) Administrador geral age como administrador da empresa aberta ----------
create or replace function is_active_user(check_id uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select is_platform_admin(check_id) or coalesce((
    select up.active and coalesce(c.active, true)
    from user_profiles up left join companies c on c.id = up.company_id
    where up.id = check_id
  ), false);
$$;

create or replace function is_admin_user(check_id uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select is_platform_admin(check_id) or exists (
    select 1 from user_profiles up
    join roles r on r.id = up.role_id
    where up.id = check_id and r.is_admin and up.active
  );
$$;

create or replace function current_actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(current_setting('app.audit_actor', true), ''),
                  (select name from user_profiles where id = auth.uid()),
                  case when is_platform_admin(auth.uid()) then 'Administrador geral' end,
                  'Sistema');
$$;

create or replace function audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_actor text := nullif(current_setting('app.audit_actor', true), '');
  v_name text;
  v_action text;
  v_row jsonb;
  v_old jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_reservation text;
begin
  if tg_op = 'INSERT' then
    v_action := 'criou';
    v_row := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action := 'alterou';
    v_row := to_jsonb(new);
    v_old := to_jsonb(old);
    for v_key in select jsonb_object_keys(v_row) loop
      if v_key not in ('updated_at', 'created_at') and (v_row -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('de', v_old -> v_key, 'para', v_row -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;
    end if;
  else
    v_action := 'excluiu';
    v_row := to_jsonb(old);
  end if;

  if v_actor is not null then
    v_uid := null;
    v_name := v_actor;
  elsif v_uid is not null then
    select name into v_name from user_profiles where id = v_uid;
  end if;

  v_reservation := case
    when tg_table_name = 'reservations' then v_row ->> 'id'
    else v_row ->> 'reservation_id'
  end;

  insert into audit_log (company_id, user_id, user_name, action, entity, entity_id, details)
  values (
    coalesce(
      case when tg_table_name = 'companies' then (v_row ->> 'id')::uuid else (v_row ->> 'company_id')::uuid end,
      current_company_id()
    ),
    v_uid,
    coalesce(v_name, case when v_uid is null then 'Link público ou sistema' else case when is_platform_admin(v_uid) then 'Administrador geral' else 'Usuário sem perfil' end end),
    v_action,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    jsonb_strip_nulls(jsonb_build_object(
      'reservation_id', v_reservation,
      'changes', case when tg_op = 'UPDATE' then audit_trim(v_changes) end,
      'row', case when tg_op <> 'UPDATE' then audit_trim(v_row) end
    ))
  );
  return null;
end;
$$;

-- Abre / fecha uma casa de festas para o administrador geral.
create or replace function platform_enter_company(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if not exists (select 1 from companies where id = p_company) then raise exception 'Empresa não encontrada.'; end if;
  insert into company_members (user_id, company_id) values (auth.uid(), p_company)
  on conflict (user_id) do update set company_id = excluded.company_id;
end;
$$;

create or replace function platform_leave_company() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  delete from company_members where user_id = auth.uid();
end;
$$;
revoke all on function platform_enter_company(uuid), platform_leave_company() from public, anon;
grant execute on function platform_enter_company(uuid), platform_leave_company() to authenticated;

-- Empresa pode ser criada sem administrador (ex.: a de demonstração, que o
-- administrador geral abre pelo painel).
create or replace function platform_create_company(p_name text, p_admin_user uuid, p_admin_name text, p_admin_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_role uuid;
begin
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Informe o nome da empresa.'; end if;
  if p_admin_user is not null then
    if p_admin_name is null or length(trim(p_admin_name)) = 0 then raise exception 'Informe o administrador da empresa.'; end if;
    if exists (select 1 from user_profiles where id = p_admin_user) then raise exception 'Este login já pertence a uma empresa.'; end if;
    if is_platform_admin(p_admin_user) then raise exception 'O administrador geral não pode ser funcionário de uma empresa.'; end if;
  end if;

  insert into companies (name, portal_theme, mascot_enabled) values (trim(p_name), 'padrao', false) returning id into v_company;
  insert into roles (name, is_admin, company_id) values ('Administrador', true, v_company) returning id into v_role;
  insert into payment_method_fees (company_id, payment_method, fee_percent)
  select v_company, m, 0 from unnest(array['pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'boleto', 'transferencia', 'outro']) m;
  insert into commission_settings (company_id, start_date, beneficiary) values (v_company, today_brazil(), 'Gerente');

  if p_admin_user is not null then
    insert into user_profiles (id, name, email, role_id, active, company_id)
    values (p_admin_user, trim(p_admin_name), nullif(trim(p_admin_email), ''), v_role, true, v_company);
  end if;
  return v_company;
end;
$$;

-- Quem já é administrador geral sai do cadastro de funcionários (e da
-- empresa aberta): passa a entrar pelo painel.
delete from company_members where user_id in (select user_id from platform_admins);
delete from user_profiles where id in (select user_id from platform_admins);

-- ---------- 2) Configurações da empresa e das unidades ----------
create or replace function can_manage_company_setup(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from platform_admins) then is_platform_admin(p_user) else is_admin_user(p_user) end;
$$;
revoke all on function can_manage_company_setup(uuid) from public, anon;
grant execute on function can_manage_company_setup(uuid) to authenticated, app_definer;

drop policy if exists "insert_admin" on units;
create policy "insert_admin" on units for insert with check (can_manage_company_setup(auth.uid()));
drop policy if exists "update_admin" on units;
create policy "update_admin" on units for update using (can_manage_company_setup(auth.uid())) with check (can_manage_company_setup(auth.uid()));
drop policy if exists "update_own_admin" on companies;
create policy "update_own_admin" on companies for update
  using (id = current_company_id() and can_manage_company_setup(auth.uid()))
  with check (id = current_company_id() and can_manage_company_setup(auth.uid()));
do $$
begin
  drop policy if exists "marca_insert" on storage.objects;
  create policy "marca_insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'marca' and can_manage_company_setup(auth.uid()) and (storage.foldername(name))[1] = current_company_id()::text);
  drop policy if exists "marca_update" on storage.objects;
  create policy "marca_update" on storage.objects for update to authenticated using (bucket_id = 'marca' and can_manage_company_setup(auth.uid()));
  drop policy if exists "marca_delete" on storage.objects;
  create policy "marca_delete" on storage.objects for delete to authenticated using (bucket_id = 'marca' and can_manage_company_setup(auth.uid()));
end $$;

-- Marca também diz qual empresa está aberta e se o banco tem administrador geral.
drop function if exists public_company_brand();
create or replace function public_company_brand()
returns table (name text, logo_url text, tagline text, team_whatsapp text, mascot_enabled boolean, portal_theme text,
               disabled_modules text[], active boolean, company_id uuid, platform_managed boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_plat boolean := exists (select 1 from platform_admins);
begin
  if current_company_id() is null and exists (select 1 from platform_settings) then
    return query select p.name, p.logo_url, p.tagline, null::text, false, 'padrao'::text, '{}'::text[], true, null::uuid, v_plat
    from platform_settings p limit 1;
    return;
  end if;
  return query
  select c.name, c.logo_url, c.tagline, c.team_whatsapp, c.mascot_enabled, c.portal_theme, c.disabled_modules, c.active, c.id, v_plat
  from companies c
  where c.id = coalesce(current_company_id(), (select id from companies order by created_at limit 1));
end;
$$;
revoke all on function public_company_brand() from public;
grant execute on function public_company_brand() to anon, authenticated;

-- ---------- Donos das funções ----------
create or replace function fix_definer_owners() returns int
language plpgsql set search_path = public as $$
declare f record; n int := 0;
begin
  execute 'grant create on schema public to app_definer';
  for f in
    select p.oid::regprocedure sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prosecdef and pg_get_userbyid(p.proowner) <> 'app_definer'
      and p.proname not in ('is_active_user', 'is_admin_user', 'has_permission', 'portal_token_valid',
                            'current_company_id', 'current_actor_name', 'set_company_id', 'sync_company_member',
                            'is_platform_admin', 'public_company_brand', 'audit_row_change', 'can_manage_company_setup')
      and p.proname not like 'platform\_%'
  loop
    execute format('alter function %s owner to app_definer', f.sig);
    n := n + 1;
  end loop;
  execute 'revoke create on schema public from app_definer';
  return n;
end;
$$;
revoke all on function fix_definer_owners() from public, anon, authenticated;
do $$ begin execute format('alter function audit_row_change() owner to %I', current_user); end $$;
select fix_definer_owners();

-- =========================================================
-- COMPROVANTES ACEITOS VÃO PARA OS DOCUMENTOS DA FESTA
--
-- Quando a equipe aceita ("Lançar pagamento") um comprovante enviado pelo
-- cliente no portal, o arquivo passa a aparecer também em Central da festa →
-- Documentos, junto do contrato, com o nome "Comprovante - R$ valor - data".
-- O arquivo não é copiado: o documento aponta para o próprio comprovante
-- (reservation_documents.bucket = 'portal-comprovantes'). Tirar da lista de
-- documentos não apaga o comprovante nem o pagamento.
-- Os comprovantes já aceitos antes desta migração também entram na lista
-- (sem gerar avisos no histórico).
--
-- Vale para o banco da Brava (072) e o dos clientes (073).
-- Não altera pagamentos, festas ou valores. Roda dentro de uma transação.
-- =========================================================


alter table reservation_documents add column if not exists bucket text not null default 'festa-documentos';
alter table reservation_documents drop constraint if exists reservation_documents_bucket_check;
alter table reservation_documents add constraint reservation_documents_bucket_check check (bucket in ('festa-documentos', 'portal-comprovantes'));
alter table reservation_documents add column if not exists receipt_id uuid references portal_receipts(id) on delete cascade;
create unique index if not exists reservation_documents_receipt_key on reservation_documents (receipt_id) where receipt_id is not null;

-- Nome do documento: "Comprovante - R$ 1.500,00 - 30/10/2026.pdf"
create or replace function receipt_document_name(p_amount numeric, p_date date, p_path text) returns text
language sql immutable set search_path = public as $$
  select 'Comprovante - ' || fmt_brl(p_amount) || ' - ' || to_char(p_date, 'DD/MM/YYYY')
         || coalesce('.' || lower(substring(p_path from '\.([A-Za-z0-9]{2,5})$')), '');
$$;

create or replace function launch_portal_receipt(p_receipt uuid, p_amount numeric, p_date date, p_method text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  rc portal_receipts%rowtype;
  v_payment uuid;
begin
  if not has_permission(auth.uid(), 'action:festa.pagamentos') then raise exception 'Sem permissão para registrar pagamentos.'; end if;
  select * into rc from portal_receipts where id = p_receipt for update;
  if not found then raise exception 'Comprovante não encontrado.'; end if;
  if rc.status <> 'em_analise' then raise exception 'Este comprovante já foi analisado.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Informe o valor.'; end if;
  insert into payments (reservation_id, amount, payment_date, payment_method, notes)
  values (rc.reservation_id, round(p_amount, 2), coalesce(p_date, today_brazil()), p_method, 'Comprovante enviado pelo portal do cliente')
  returning id into v_payment;
  update portal_receipts set status = 'lancado', payment_id = v_payment, decided_by_name = current_actor_name(), decided_at = now() where id = p_receipt;
  update portal_events set seen_at = now(), seen_by_name = current_actor_name() where ref_id = p_receipt and seen_at is null;
  -- comprovante aceito entra nos documentos da festa (junto do contrato)
  insert into reservation_documents (reservation_id, file_name, storage_path, bucket, receipt_id)
  values (rc.reservation_id, receipt_document_name(round(p_amount, 2), coalesce(p_date, today_brazil()), rc.storage_path), rc.storage_path, 'portal-comprovantes', rc.id)
  on conflict do nothing;
  return v_payment;
end;
$$;

-- Comprovantes aceitos antes desta migração (sem disparar o histórico).
alter table reservation_documents disable trigger user;
insert into reservation_documents (reservation_id, file_name, storage_path, bucket, receipt_id, uploaded_at, company_id)
select r.reservation_id,
       receipt_document_name(coalesce(p.amount, r.amount), coalesce(p.payment_date, (r.decided_at at time zone 'America/Sao_Paulo')::date, (r.created_at at time zone 'America/Sao_Paulo')::date), r.storage_path),
       r.storage_path, 'portal-comprovantes', r.id, coalesce(r.decided_at, r.created_at), r.company_id
from portal_receipts r
left join payments p on p.id = r.payment_id
where r.status = 'lancado'
  and not exists (select 1 from reservation_documents d where d.receipt_id = r.id);
alter table reservation_documents enable trigger user;

-- Quem vê a festa consegue abrir o comprovante pela lista de documentos.
do $$
begin
  drop policy if exists "portal_comprovantes_read" on storage.objects;
  create policy "portal_comprovantes_read" on storage.objects for select to authenticated
    using (bucket_id = 'portal-comprovantes'
      and (
        -- quem confere comprovantes (avisos do portal / pagamentos)
        ((has_permission(auth.uid(), 'page:portal_avisos') or has_permission(auth.uid(), 'action:festa.pagamentos'))
          and exists (select 1 from portal_receipts pr where pr.storage_path = name))
        -- ou quem vê o comprovante aceito nos documentos da festa
        or exists (select 1 from reservation_documents d where d.bucket = 'portal-comprovantes' and d.storage_path = name)
      ));
end $$;

select fix_definer_owners();


-- =========================================================
-- LIMPEZA: nenhum dado da Brava (nem de ninguém) fica no banco novo.
-- =========================================================
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('truncate table %I cascade', t);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
