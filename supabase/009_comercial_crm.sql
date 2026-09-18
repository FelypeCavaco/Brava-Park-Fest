-- =========================================================
-- Brava Park Fest — Adição: CRM de reativação, fidelidade por pontos,
-- indicação, agenda de visitas e histórico de contato (WhatsApp)
-- Rode este arquivo no SQL Editor do Supabase (não precisa mexer
-- no que já foi criado antes).
-- =========================================================

-- ---------- Clientes: fidelidade por pontos, indicação e dados de reativação ----------
alter table clients add column if not exists loyalty_points numeric(10,2) not null default 0;
alter table clients add column if not exists referred_by uuid references clients(id);
alter table clients add column if not exists referral_discount_status text; -- 'pendente', 'aplicado'
alter table clients add column if not exists child_name text;
alter table clients add column if not exists child_birthday date;
alter table clients add column if not exists last_party_date date;
alter table clients add column if not exists total_spent numeric(10,2) not null default 0;
alter table clients add column if not exists last_commercial_contact date;
alter table clients add column if not exists reactivation_status text not null default 'nova_oportunidade';
-- 'nova_oportunidade', 'contatado', 'negociacao', 'nova_reserva', 'sem_interesse'

-- ---------- Agenda de visitas ao espaço ----------
create table if not exists visits (
  id uuid primary key default gen_random_uuid(),
  client_name text not null, -- TODO: trocar por client_id quando os clientes forem reais
  unit_id uuid not null references units(id),
  space_name text,
  scheduled_at timestamptz not null,
  responsible text,
  result text, -- 'virou_orcamento', 'nao_avancou'
  created_at timestamptz not null default now()
);

create index if not exists idx_visits_unit on visits (unit_id);

-- ---------- Histórico de contato (WhatsApp e futuros canais) ----------
create table if not exists contact_history (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  type text not null, -- ex: 'Enviar orçamento', 'Lembrete de pagamento', 'Confirmar festa'...
  channel text not null default 'whatsapp',
  user_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_contact_history_client on contact_history (client_name);

alter table visits enable row level security;
alter table contact_history enable row level security;

create policy "authenticated_full_access" on visits
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated_full_access" on contact_history
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
