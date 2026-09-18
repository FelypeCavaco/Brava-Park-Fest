-- =========================================================
-- Brava Park Fest — Adição: Contas a pagar de verdade, forma de
-- pagamento, ficha técnica de custo por pacote, cancelamentos e nota fiscal
-- Rode este arquivo no SQL Editor do Supabase (não precisa mexer
-- no que já foi criado antes).
-- =========================================================

-- ---------- Contas a pagar (upgrade da tabela expenses) ----------
alter table expenses rename column expense_date to due_date;
alter table expenses add column if not exists supplier text;
alter table expenses add column if not exists status text not null default 'a_vencer'; -- 'a_vencer', 'pago', 'atrasado', 'cancelado'
alter table expenses add column if not exists paid_date date;

-- ---------- Forma de pagamento das parcelas recebidas ----------
alter table payments add column if not exists payment_method text; -- 'pix', 'cartao_credito', 'cartao_debito', 'dinheiro', 'boleto'

-- ---------- Ficha técnica: custo estimado por categoria, por pacote ----------
create table if not exists package_costs (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  category text not null, -- 'Alimentos', 'Bebidas', 'Equipe', 'Decoração', 'Outros'
  amount numeric(10,2) not null default 0
);

create index if not exists idx_package_costs_package on package_costs (package_id);

-- ---------- Cancelamento de reserva ----------
alter table reservations add column if not exists cancellation_reason text;
alter table reservations add column if not exists cancellation_fee_percent numeric(5,2);
alter table reservations add column if not exists refund_amount numeric(10,2);
alter table reservations add column if not exists cancelled_at timestamptz;

-- ---------- Nota fiscal do contrato ----------
alter table contracts add column if not exists nfe_number text;
alter table contracts add column if not exists nfe_status text not null default 'nao_emitida'; -- 'nao_emitida', 'emitida', 'cancelada'

-- ---------- RLS da nova tabela ----------
alter table package_costs enable row level security;

create policy "authenticated_full_access" on package_costs
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
