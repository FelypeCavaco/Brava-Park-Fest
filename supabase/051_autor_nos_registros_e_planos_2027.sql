-- =========================================================
-- 1) Nome de quem fez, guardado no próprio registro do histórico.
--    O histórico de troca de pacote tentava buscar o nome por um vínculo
--    que o banco não tem (audit_log aponta pro login, não pro perfil) e
--    falhava; e vários históricos gravavam o texto fixo "Você".
--
-- 2) Período de validade dos planos (valid_from / valid_until): ao
--    cadastrar uma festa, só aparecem os planos que valem na data dela.
--
-- 3) Tabela 2027 de São Vicente (provisória — ajustável pela tela de
--    Pacotes): planos de 40, 50 e 60 convidados para festas a partir de
--    01/01/2027. Os planos atuais de São Vicente passam a valer só para
--    festas até 31/12/2026. "Somente o Espaço" não entra em 2027.
--    Festas já cadastradas não mudam de plano nem de valor.
-- =========================================================

alter table audit_log add column if not exists user_name text;

update audit_log a
set user_name = up.name
from user_profiles up
where up.id = a.user_id
  and a.user_name is null;

alter table packages add column if not exists valid_from date;
alter table packages add column if not exists valid_until date;

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
