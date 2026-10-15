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

begin;

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
  ('Classic 70 pessoas (2027)', 'classic', 70, 7900.00, 7750.00, date '2027-01-01', null),
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

commit;
