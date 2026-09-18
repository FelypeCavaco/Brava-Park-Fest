-- =========================================================
-- Taxa da maquininha (débito/crédito), agora editável pela tela de
-- Pagamentos em vez de fixa no código. Vem semeada com os mesmos valores
-- aproximados que já estavam no código (PAYMENT_METHOD_FEE_PERCENT).
-- =========================================================

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

alter table payment_method_fees enable row level security;

create policy "authenticated_full_access" on payment_method_fees
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
