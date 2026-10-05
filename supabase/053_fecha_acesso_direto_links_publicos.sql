-- =========================================================
-- Links públicos — ETAPA 2/2. Rodar SÓ DEPOIS que o site novo (que usa as
-- funções da 052) estiver no ar.
--
-- Fecha o acesso direto, sem login, às tabelas da lista de convidados e da
-- avaliação. A partir daqui, quem não está logado só consegue ver/mexer na
-- lista ou avaliação do link que recebeu, pelas funções da 052. O acesso da
-- equipe (logada) não muda.
-- =========================================================

drop policy if exists "public_read_guest_page" on guest_list_pages;
drop policy if exists "public_read_guest_entries" on guest_list_entries;
drop policy if exists "public_insert_guest_entries" on guest_list_entries;
drop policy if exists "public_delete_guest_entries" on guest_list_entries;
drop policy if exists "public_read_review_link" on review_links;
drop policy if exists "public_insert_party_review" on party_reviews;
