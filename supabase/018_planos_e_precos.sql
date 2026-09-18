-- =========================================================
-- Planos e preços reais das duas unidades (portfólio enviado
-- pelo usuário). Os preços mudam conforme o dia da semana da
-- festa (segunda a quinta / sexta a domingo), então os pacotes
-- ganham dois preços novos — o preço "padrão" (base_price)
-- continua existindo como referência/fallback.
-- =========================================================

alter table packages add column if not exists weekday_price numeric(10,2);
alter table packages add column if not exists weekend_price numeric(10,2);

-- ---------- São Vicente — atualiza os 3 planos já cadastrados (seed
-- anterior tinha preço em branco) e adiciona o 4º: "Somente o Espaço" ----------
update packages set
  base_price = 4300.00, weekday_price = 4300.00, weekend_price = 4500.00,
  included_items = 'Buffet completo (salgados fritos e assados, docinhos sortidos, bolo, refrigerante, suco e água). Decoração temática (mediante disponibilidade do tema escolhido). Serviço de garçom e copeira. Monitoras/recreadora treinadas. Brinquedos: arena de cama elástica, circuito radical, tobogã, piscina de bolinha, basquete eletrônico, fliperama e arena games.'
where name = 'Festa Completa 40 pessoas' and unit_id = (select id from units where name = 'São Vicente');

update packages set
  base_price = 4900.00, weekday_price = 4900.00, weekend_price = 5200.00,
  included_items = 'Buffet completo, com até 4 (quatro) opções de pratos assados à escolha da contratante (salgados fritos e assados, docinhos sortidos, bolo, refrigerante, suco e água). Decoração temática (mediante disponibilidade do tema escolhido). Serviço de garçom e copeira. Monitoras/recreadora treinadas. Brinquedos: arena de cama elástica, circuito radical, tobogã, piscina de bolinha, basquete eletrônico, fliperama e arena games.'
where name = 'Festa Completa 50 pessoas' and unit_id = (select id from units where name = 'São Vicente');

update packages set
  base_price = 5400.00, weekday_price = 5400.00, weekend_price = 5800.00,
  included_items = 'Buffet completo, com até 4 (quatro) opções de pratos assados à escolha da contratante (salgados fritos e assados, docinhos sortidos, bolo, refrigerante, suco e água). Decoração temática (mediante disponibilidade do tema escolhido). Serviço de garçom e copeira. Monitoras/recreadora treinadas. Brinquedos: arena de cama elástica, circuito radical, tobogã, piscina de bolinha, basquete eletrônico, fliperama e arena games.'
where name = 'Festa Completa 60 pessoas' and unit_id = (select id from units where name = 'São Vicente');

insert into packages (name, description, base_price, weekday_price, weekend_price, unit_id, guest_limit, duration_hours, included_items)
select
  'Somente o Espaço', 'Locação do espaço, sem buffet — garçom e copeira são opcionais (ver item extra).',
  2350.00, 2350.00, 2650.00, u.id, 40, 4,
  'Locação do espaço com decoração temática (mediante disponibilidade do tema) e brinquedos inclusos: arena de cama elástica, circuito radical, tobogã, piscina de bolinha, basquete eletrônico, fliperama e arena games. Recreadora inclusa. Buffet não incluso. Serviço de garçom e copeira disponível como item adicional. Valor já inclui a taxa de limpeza.'
from units u
where u.name = 'São Vicente'
  and not exists (select 1 from packages p where p.unit_id = u.id and p.name = 'Somente o Espaço');

-- ---------- Vila Operária — 3 linhas (Classic / Gourmet / Prime) x 6 faixas
-- de convidados (40 a 90), cada uma com preço de seg-qui e sex-dom ----------
insert into packages (name, description, base_price, weekday_price, weekend_price, unit_id, guest_limit, duration_hours, included_items)
select v.nome, v.descricao, v.preco_semana, v.preco_semana, v.preco_fds, u.id, v.limite, 4, v.itens
from units u
cross join (values
  ('Classic 40 pessoas', 'Plano Classic da Vila Operária', 6790.00, 7590.00, 40,
    'Coquetéis (docinhos, salgados fritos e assados, bolo, refrigerante, suco e água). Decoração temática (mediante disponibilidade do tema escolhido). Camarim, telão e pista de led. Serviço de segurança, recepcionista, garçom e copeira. Monitoras treinadas. Brinquedos: brinquedão com casinha aérea, arena de cama elástica, circuito radical, tobogã, piscina de bolinha, parede de escalada, área baby, arena play tematizada, basquete eletrônico, fliperama, simulador de corrida e PlayStation.'),
  ('Classic 50 pessoas', 'Plano Classic da Vila Operária', 7390.00, 8190.00, 50,
    'Coquetéis (docinhos, salgados fritos e assados, bolo, refrigerante, suco e água). Decoração temática (mediante disponibilidade do tema escolhido). Camarim, telão e pista de led. Serviço de segurança, recepcionista, garçom e copeira. Monitoras treinadas. Brinquedos: brinquedão com casinha aérea, arena de cama elástica, circuito radical, tobogã, piscina de bolinha, parede de escalada, área baby, arena play tematizada, basquete eletrônico, fliperama, simulador de corrida e PlayStation.'),
  ('Classic 60 pessoas', 'Plano Classic da Vila Operária', 8090.00, 8890.00, 60,
    'Coquetéis (docinhos, salgados fritos e assados, bolo, refrigerante, suco e água). Decoração temática (mediante disponibilidade do tema escolhido). Camarim, telão e pista de led. Serviço de segurança, recepcionista, garçom e copeira. Monitoras treinadas. Brinquedos: brinquedão com casinha aérea, arena de cama elástica, circuito radical, tobogã, piscina de bolinha, parede de escalada, área baby, arena play tematizada, basquete eletrônico, fliperama, simulador de corrida e PlayStation.'),
  ('Classic 70 pessoas', 'Plano Classic da Vila Operária', 8790.00, 9690.00, 70,
    'Coquetéis (docinhos, salgados fritos e assados, bolo, refrigerante, suco e água). Decoração temática (mediante disponibilidade do tema escolhido). Camarim, telão e pista de led. Serviço de segurança, recepcionista, garçom e copeira. Monitoras treinadas. Brinquedos: brinquedão com casinha aérea, arena de cama elástica, circuito radical, tobogã, piscina de bolinha, parede de escalada, área baby, arena play tematizada, basquete eletrônico, fliperama, simulador de corrida e PlayStation.'),
  ('Classic 80 pessoas', 'Plano Classic da Vila Operária', 9490.00, 10490.00, 80,
    'Coquetéis (docinhos, salgados fritos e assados, bolo, refrigerante, suco e água). Decoração temática (mediante disponibilidade do tema escolhido). Camarim, telão e pista de led. Serviço de segurança, recepcionista, garçom e copeira. Monitoras treinadas. Brinquedos: brinquedão com casinha aérea, arena de cama elástica, circuito radical, tobogã, piscina de bolinha, parede de escalada, área baby, arena play tematizada, basquete eletrônico, fliperama, simulador de corrida e PlayStation.'),
  ('Classic 90 pessoas', 'Plano Classic da Vila Operária', 10190.00, 11290.00, 90,
    'Coquetéis (docinhos, salgados fritos e assados, bolo, refrigerante, suco e água). Decoração temática (mediante disponibilidade do tema escolhido). Camarim, telão e pista de led. Serviço de segurança, recepcionista, garçom e copeira. Monitoras treinadas. Brinquedos: brinquedão com casinha aérea, arena de cama elástica, circuito radical, tobogã, piscina de bolinha, parede de escalada, área baby, arena play tematizada, basquete eletrônico, fliperama, simulador de corrida e PlayStation.'),

  ('Gourmet 40 pessoas', 'Plano Gourmet da Vila Operária', 7790.00, 8590.00, 40,
    'Coquetéis e pratos quentes: docinhos, salgados fritos e assados, bolo, refrigerante, suco, água e até 3 (três) opções de pratos quentes, escolhidas pela contratante dentre o cardápio vigente do Brava Park Fest. Decoração temática (mediante disponibilidade do tema escolhido). Camarim, telão e pista de led. Serviço de segurança, recepcionista, garçom e copeira. Monitoras treinadas. Brinquedos: brinquedão com casinha aérea, arena de cama elástica, circuito radical, tobogã, piscina de bolinha, parede de escalada, área baby, arena play tematizada, basquete eletrônico, fliperama, simulador de corrida e PlayStation.'),
  ('Gourmet 50 pessoas', 'Plano Gourmet da Vila Operária', 8390.00, 9190.00, 50,
    'Coquetéis e pratos quentes: docinhos, salgados fritos e assados, bolo, refrigerante, suco, água e até 3 (três) opções de pratos quentes, escolhidas pela contratante dentre o cardápio vigente do Brava Park Fest. Decoração temática (mediante disponibilidade do tema escolhido). Camarim, telão e pista de led. Serviço de segurança, recepcionista, garçom e copeira. Monitoras treinadas. Brinquedos: brinquedão com casinha aérea, arena de cama elástica, circuito radical, tobogã, piscina de bolinha, parede de escalada, área baby, arena play tematizada, basquete eletrônico, fliperama, simulador de corrida e PlayStation.'),
  ('Gourmet 60 pessoas', 'Plano Gourmet da Vila Operária', 9090.00, 9990.00, 60,
    'Coquetéis e pratos quentes: docinhos, salgados fritos e assados, bolo, refrigerante, suco, água e até 3 (três) opções de pratos quentes, escolhidas pela contratante dentre o cardápio vigente do Brava Park Fest. Decoração temática (mediante disponibilidade do tema escolhido). Camarim, telão e pista de led. Serviço de segurança, recepcionista, garçom e copeira. Monitoras treinadas. Brinquedos: brinquedão com casinha aérea, arena de cama elástica, circuito radical, tobogã, piscina de bolinha, parede de escalada, área baby, arena play tematizada, basquete eletrônico, fliperama, simulador de corrida e PlayStation.'),
  ('Gourmet 70 pessoas', 'Plano Gourmet da Vila Operária', 9790.00, 10790.00, 70,
    'Coquetéis e pratos quentes: docinhos, salgados fritos e assados, bolo, refrigerante, suco, água e até 3 (três) opções de pratos quentes, escolhidas pela contratante dentre o cardápio vigente do Brava Park Fest. Decoração temática (mediante disponibilidade do tema escolhido). Camarim, telão e pista de led. Serviço de segurança, recepcionista, garçom e copeira. Monitoras treinadas. Brinquedos: brinquedão com casinha aérea, arena de cama elástica, circuito radical, tobogã, piscina de bolinha, parede de escalada, área baby, arena play tematizada, basquete eletrônico, fliperama, simulador de corrida e PlayStation.'),
  ('Gourmet 80 pessoas', 'Plano Gourmet da Vila Operária', 10490.00, 11590.00, 80,
    'Coquetéis e pratos quentes: docinhos, salgados fritos e assados, bolo, refrigerante, suco, água e até 3 (três) opções de pratos quentes, escolhidas pela contratante dentre o cardápio vigente do Brava Park Fest. Decoração temática (mediante disponibilidade do tema escolhido). Camarim, telão e pista de led. Serviço de segurança, recepcionista, garçom e copeira. Monitoras treinadas. Brinquedos: brinquedão com casinha aérea, arena de cama elástica, circuito radical, tobogã, piscina de bolinha, parede de escalada, área baby, arena play tematizada, basquete eletrônico, fliperama, simulador de corrida e PlayStation.'),
  ('Gourmet 90 pessoas', 'Plano Gourmet da Vila Operária', 11190.00, 12390.00, 90,
    'Coquetéis e pratos quentes: docinhos, salgados fritos e assados, bolo, refrigerante, suco, água e até 3 (três) opções de pratos quentes, escolhidas pela contratante dentre o cardápio vigente do Brava Park Fest. Decoração temática (mediante disponibilidade do tema escolhido). Camarim, telão e pista de led. Serviço de segurança, recepcionista, garçom e copeira. Monitoras treinadas. Brinquedos: brinquedão com casinha aérea, arena de cama elástica, circuito radical, tobogã, piscina de bolinha, parede de escalada, área baby, arena play tematizada, basquete eletrônico, fliperama, simulador de corrida e PlayStation.'),

  ('Prime 40 pessoas', 'Plano Prime da Vila Operária', 9290.00, 10190.00, 40,
    'Coquetéis, pratos quentes, massas, risotos e demais opções conforme cardápio vigente do Brava Park Fest (docinhos, salgados fritos e assados, bolo, refrigerante, suco, água, pratos quentes, massas e risotos, com sabores escolhidos pela contratante). Decoração temática (mediante disponibilidade do tema escolhido). Camarim, telão e pista de led. Serviço de segurança, recepcionista, garçom e copeira. Monitoras treinadas. Brinquedos: brinquedão com casinha aérea, arena de cama elástica, circuito radical, tobogã, piscina de bolinha, parede de escalada, área baby, arena play tematizada, basquete eletrônico, fliperama, simulador de corrida e PlayStation.'),
  ('Prime 50 pessoas', 'Plano Prime da Vila Operária', 9990.00, 10990.00, 50,
    'Coquetéis, pratos quentes, massas, risotos e demais opções conforme cardápio vigente do Brava Park Fest (docinhos, salgados fritos e assados, bolo, refrigerante, suco, água, pratos quentes, massas e risotos, com sabores escolhidos pela contratante). Decoração temática (mediante disponibilidade do tema escolhido). Camarim, telão e pista de led. Serviço de segurança, recepcionista, garçom e copeira. Monitoras treinadas. Brinquedos: brinquedão com casinha aérea, arena de cama elástica, circuito radical, tobogã, piscina de bolinha, parede de escalada, área baby, arena play tematizada, basquete eletrônico, fliperama, simulador de corrida e PlayStation.'),
  ('Prime 60 pessoas', 'Plano Prime da Vila Operária', 10790.00, 11890.00, 60,
    'Coquetéis, pratos quentes, massas, risotos e demais opções conforme cardápio vigente do Brava Park Fest (docinhos, salgados fritos e assados, bolo, refrigerante, suco, água, pratos quentes, massas e risotos, com sabores escolhidos pela contratante). Decoração temática (mediante disponibilidade do tema escolhido). Camarim, telão e pista de led. Serviço de segurança, recepcionista, garçom e copeira. Monitoras treinadas. Brinquedos: brinquedão com casinha aérea, arena de cama elástica, circuito radical, tobogã, piscina de bolinha, parede de escalada, área baby, arena play tematizada, basquete eletrônico, fliperama, simulador de corrida e PlayStation.'),
  ('Prime 70 pessoas', 'Plano Prime da Vila Operária', 11590.00, 12790.00, 70,
    'Coquetéis, pratos quentes, massas, risotos e demais opções conforme cardápio vigente do Brava Park Fest (docinhos, salgados fritos e assados, bolo, refrigerante, suco, água, pratos quentes, massas e risotos, com sabores escolhidos pela contratante). Decoração temática (mediante disponibilidade do tema escolhido). Camarim, telão e pista de led. Serviço de segurança, recepcionista, garçom e copeira. Monitoras treinadas. Brinquedos: brinquedão com casinha aérea, arena de cama elástica, circuito radical, tobogã, piscina de bolinha, parede de escalada, área baby, arena play tematizada, basquete eletrônico, fliperama, simulador de corrida e PlayStation.'),
  ('Prime 80 pessoas', 'Plano Prime da Vila Operária', 12390.00, 13690.00, 80,
    'Coquetéis, pratos quentes, massas, risotos e demais opções conforme cardápio vigente do Brava Park Fest (docinhos, salgados fritos e assados, bolo, refrigerante, suco, água, pratos quentes, massas e risotos, com sabores escolhidos pela contratante). Decoração temática (mediante disponibilidade do tema escolhido). Camarim, telão e pista de led. Serviço de segurança, recepcionista, garçom e copeira. Monitoras treinadas. Brinquedos: brinquedão com casinha aérea, arena de cama elástica, circuito radical, tobogã, piscina de bolinha, parede de escalada, área baby, arena play tematizada, basquete eletrônico, fliperama, simulador de corrida e PlayStation.'),
  ('Prime 90 pessoas', 'Plano Prime da Vila Operária', 13190.00, 14590.00, 90,
    'Coquetéis, pratos quentes, massas, risotos e demais opções conforme cardápio vigente do Brava Park Fest (docinhos, salgados fritos e assados, bolo, refrigerante, suco, água, pratos quentes, massas e risotos, com sabores escolhidos pela contratante). Decoração temática (mediante disponibilidade do tema escolhido). Camarim, telão e pista de led. Serviço de segurança, recepcionista, garçom e copeira. Monitoras treinadas. Brinquedos: brinquedão com casinha aérea, arena de cama elástica, circuito radical, tobogã, piscina de bolinha, parede de escalada, área baby, arena play tematizada, basquete eletrônico, fliperama, simulador de corrida e PlayStation.')
) as v(nome, descricao, preco_semana, preco_fds, limite, itens)
where u.name = 'Vila Operária'
  and not exists (select 1 from packages p where p.unit_id = u.id and p.name = v.nome);

-- ---------- Itens extras (catálogo compartilhado pelas duas unidades) ----------
insert into extra_items (name, price)
select v.nome, v.preco
from (values
  ('Fotógrafo profissional', 600.00),
  ('Número em LED', 150.00),
  ('Rolha Bartender', 450.00),
  ('Rolha', 250.00),
  ('Arco de balão', 350.00),
  ('Garçom + Copeira (pacote Somente Espaço)', 300.00)
) as v(nome, preco)
where not exists (select 1 from extra_items e where e.name = v.nome);
