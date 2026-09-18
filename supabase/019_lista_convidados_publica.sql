-- =========================================================
-- Lista de convidados enviada pelo próprio contratante, por um
-- link público (sem precisar de login). Fica em tabelas
-- separadas das reservas, de propósito: a página pública só
-- pode enxergar os dados mínimos necessários (data, tema, nome
-- do aniversariante, unidade) — nunca telefone, CPF ou valores.
-- =========================================================

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
  created_at timestamptz not null default now()
);

create index if not exists idx_guest_list_entries_token on guest_list_entries (token);

alter table guest_list_pages enable row level security;
alter table guest_list_entries enable row level security;

-- Equipe (logada) tem acesso total, igual às outras tabelas do sistema.
create policy "authenticated_full_access" on guest_list_pages
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_full_access" on guest_list_entries
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Acesso público (o contratante, sem login) — só o necessário pra essa
-- página funcionar: ver os dados da festa daquele link, ver/enviar/corrigir
-- a lista de nomes. Quem não tem o link (o token, que é um código longo e
-- aleatório) não tem como adivinhar ou listar as festas de outras pessoas
-- pelo aplicativo — mas vale saber que, tecnicamente, qualquer um com a
-- chave pública do projeto poderia consultar essas duas tabelas direto pela
-- API. Por isso elas guardam só informação leve (nome, data, tema), nunca
-- telefone, CPF ou valores.
create policy "public_read_guest_page" on guest_list_pages for select to anon using (true);
create policy "public_read_guest_entries" on guest_list_entries for select to anon using (true);
create policy "public_insert_guest_entries" on guest_list_entries for insert to anon with check (true);
create policy "public_delete_guest_entries" on guest_list_entries for delete to anon using (true);
