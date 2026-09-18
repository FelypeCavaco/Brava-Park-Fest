-- =========================================================
-- Link de avaliação do Google, um por unidade (cada casa tem
-- seu próprio perfil no Google). Usado no pedido de avaliação
-- pós-festa (Satisfação / NPS).
-- =========================================================

alter table units add column if not exists google_review_link text;

update units set google_review_link = 'https://share.google/1RLrXeYa0JxYHLvGf' where name = 'São Vicente';
update units set google_review_link = 'https://share.google/o91H4PhuvDhdI8Z48' where name = 'Vila Operária';
