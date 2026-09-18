-- =========================================================
-- Formulário de avaliação pós-festa, por link público (sem login), no
-- mesmo molde da lista de convidados: um token por festa, dados mínimos
-- visíveis (nome do cliente, unidade) e um formulário simples com nota de
-- 1 a 5 pra pratos quentes, bolo, docinhos, salgadinhos e atendimento,
-- além de um campo livre pro que a pessoa quiser escrever.
-- =========================================================

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

alter table review_links enable row level security;
alter table party_reviews enable row level security;

create policy "authenticated_full_access" on review_links
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_full_access" on party_reviews
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Acesso público (o contratante, sem login) — só o necessário pra abrir a
-- página do link e mandar a resposta uma vez.
create policy "public_read_review_link" on review_links for select to anon using (true);
create policy "public_insert_party_review" on party_reviews for insert to anon with check (true);
