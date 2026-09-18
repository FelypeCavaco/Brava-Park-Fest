-- =========================================================
-- IMPORTAÇÃO DE FESTAS REAIS — rodar UMA VEZ, manualmente, no SQL Editor
-- do Supabase (script de dados, não é migration de schema — por isso sem
-- número e fora do schema.sql).
--
-- Fonte: Brava_Park_Fest_Sao_Vicente.csv (22 festas) e
-- Brava_Park_Fest_Vila_Operaria.csv (8 festas, das quais a nº 6 — Acioly/
-- João Rafael — foi propositalmente DEIXADA DE FORA por conflitar de data/
-- horário com a nº 5, conforme combinado).
--
-- O que este script cria, por festa: 1 cliente (contratante + telefone +
-- nome do aniversariante), 1 reserva (unidade, data, horário, pacote,
-- valor, tema, status) e, se já tinha algum valor pago, 1 pagamento.
--
-- VÍNCULO COM OS PACOTES REAIS: cada festa foi ligada a um pacote já
-- cadastrado, usando a quantidade de convidados do texto do pacote antigo
-- (em São Vicente, quando o texto não trazia número — "FESTA DE SEXTA-",
-- "FESTA SEGUNDA A" —, foi considerado 40 convidados, conforme
-- combinado; "PACOTE SALÃO DE..." foi ligado a "Somente o Espaço" pelo
-- valor bater exatamente com essa tabela) e, em Vila Operária, o nome já
-- vinha completo (Classic/Gourmet + número de convidados). O texto
-- original do pacote no sistema antigo fica guardado na observação da
-- festa, só de referência. O script busca o pacote pelo nome+unidade e
-- PARA com erro se algum não for encontrado — assim nenhuma festa fica
-- com plano errado ou vazio por acidente.
--
-- OUTRAS LIMITAÇÕES DOS DADOS DE ORIGEM (o relatório do sistema anterior
-- não deu pra extrair, então ficou assim de propósito — ajuste depois
-- pela tela quando tiver a informação):
--   • Forma de pagamento: o arquivo não informa como foi pago, então todo
--     pagamento importado entra sem forma de pagamento definida.
--   • Data do pagamento: o arquivo só tem "valor pago", não a data em que
--     esse pagamento aconteceu — usei a "Data de cadastro" da festa como
--     aproximação (mais realista que usar a data de hoje). Ajuste pela
--     tela se souber a data real de cada pagamento.
--   • Status da festa: como você confirmou que são festas reais que vão
--     acontecer (não orçamento), toda festa entra pelo menos como
--     "confirmada" — e sobe pra "sinal pago" ou "quitada" conforme o
--     valor já pago informado.
--   • Uma das duas datas da festa nº 22 de São Vicente (Giselle/Cecília)
--     veio com o fim em "23/01/2026" e o início em "23/01/2027" no
--     arquivo original — claramente uma digitação errada no sistema
--     antigo (fim antes do início). Usei 2027 nas duas, por ser a leitura
--     óbvia.
--   • O valor da festa (total/final) é sempre o valor que veio no arquivo
--     antigo, mesmo quando não bate exatamente com a tabela de preço
--     atual do pacote vinculado — o preço pode ter mudado desde que a
--     festa foi fechada, ou ter tido desconto negociado. O vínculo com o
--     pacote é só pra já vir preenchido o "Plano" na ficha da festa; o
--     valor de verdade continua sendo o combinado com o cliente.
-- =========================================================

do $$
declare
  v_sv_unit uuid := (select id from units where name = 'São Vicente');
  v_sv_space uuid := (select id from spaces where unit_id = v_sv_unit limit 1);
  v_vo_unit uuid := (select id from units where name = 'Vila Operária');
  v_vo_space uuid := (select id from spaces where unit_id = v_vo_unit limit 1);
  v_client_id uuid;
  v_package_id uuid;
  v_status reservation_status;
  r record;
begin
  if v_sv_unit is null or v_vo_unit is null then
    raise exception 'Não encontrei as unidades São Vicente/Vila Operária — confira o nome cadastrado em units.';
  end if;

  create temporary table _import_festas (
    unit_id uuid,
    space_id uuid,
    contratante text,
    telefone text,
    homenageado text,
    data_cadastro date,
    event_date date,
    start_time time,
    end_time time,
    pacote_text text,
    pacote_nome_real text,
    tema text,
    guest_count int,
    courtesy int,
    valor_festa numeric,
    valor_pago numeric
  ) on commit drop;

  insert into _import_festas (unit_id, space_id, contratante, telefone, homenageado, data_cadastro, event_date, start_time, end_time, pacote_text, pacote_nome_real, tema, guest_count, courtesy, valor_festa, valor_pago) values
  -- ---------- São Vicente ----------
  (v_sv_unit, v_sv_space, 'Larissa Lisboa da Costa', '(47) 99747-5782', 'Francisco', '2026-05-21', '2026-09-19', '17:00', '21:00', 'FESTA DE SEXTA-', 'Festa Completa 40 pessoas', 'A definir', 40, null, 4500, 1350),
  (v_sv_unit, v_sv_space, 'Leonardo Armando', '(47) 99241-4722', 'Catarina Domingos', '2026-08-03', '2026-09-20', '15:00', '19:00', 'PACOTE 60', 'Festa Completa 60 pessoas', 'Hello Kitty', 60, null, 5500, 3740),
  (v_sv_unit, v_sv_space, 'Thuane de Souza Vicente', '(47) 98480-2860', 'Bernardo Stein Vicente', '2026-08-29', '2026-09-24', '19:00', '23:00', 'FESTA SEGUNDA A', 'Festa Completa 40 pessoas', 'Dinossauro', 40, null, 3990, 1200),
  (v_sv_unit, v_sv_space, 'Elisabet Wentz', '(51) 99664-9816', 'Antônia Wentz', '2026-07-05', '2026-09-25', '19:00', '23:00', 'FESTA DE SEXTA-', 'Festa Completa 40 pessoas', 'Jardim Encantado', 40, null, 4500, 1350),
  (v_sv_unit, v_sv_space, 'Fernando Soares', '(47) 99605-0299', 'Heitor', '2026-06-20', '2026-09-26', '15:00', '19:00', 'FESTA DE SEXTA-', 'Festa Completa 40 pessoas', 'Homem de Ferro', 40, null, 4500, 2250),
  (v_sv_unit, v_sv_space, 'Mariana Luize Paulo', '(47) 99926-8758', 'Henri', '2026-07-06', '2026-09-27', '15:00', '19:00', 'FESTA DE SEXTA-', 'Festa Completa 40 pessoas', 'Monster Truck Hot Wheels', 40, null, 4500, 1350),
  (v_sv_unit, v_sv_space, 'Juliana Marcaneiro', '(47) 99941-1600', 'Miguel', '2026-09-12', '2026-10-02', '19:00', '23:00', 'FESTA DE SEXTA-', 'Festa Completa 40 pessoas', 'Flamengo', 40, null, 4500, 1350),
  (v_sv_unit, v_sv_space, 'Bruna Luisa Teixeira', '(47) 98443-4106', 'Giovana Foster', '2026-05-31', '2026-10-03', '15:00', '19:00', 'PACOTE SALÃO DE', 'Somente o Espaço', 'Hello Kitty Vermelha', 40, null, 2650, 690),
  (v_sv_unit, v_sv_space, 'Vitor Hugo Marques da', '(47) 99120-8999', 'Ana Helena Ferreira', '2026-07-15', '2026-10-04', '15:00', '19:00', 'FESTA 50', 'Festa Completa 50 pessoas', 'Guerreiras do Kpop', 50, null, 5200, 1560),
  (v_sv_unit, v_sv_space, 'Amanda Araujo Ferraz', '(47) 99752-1579', 'Gabriel Estevão', '2026-04-21', '2026-10-10', '15:00', '19:00', 'FESTA DE SEXTA-', 'Festa Completa 40 pessoas', 'A definir', 40, null, 4500, 1350),
  (v_sv_unit, v_sv_space, 'Ana Paula Zucheto', '(48) 99182-1293', 'Henri Zucheto', '2026-07-22', '2026-10-11', '15:00', '19:00', 'FESTA DE SEXTA-', 'Festa Completa 40 pessoas', 'A definir', 40, null, 4500, 1350),
  (v_sv_unit, v_sv_space, 'Aline Cristina Franca', '(47) 99172-8014', 'Agatha Alexia', '2026-08-26', '2026-10-12', '18:00', '22:00', 'FESTA SEGUNDA A', 'Festa Completa 40 pessoas', 'Jardim Encantado', 40, null, 4300, 0),
  (v_sv_unit, v_sv_space, 'Glaucia Soares Silva', '(47) 99997-2352', 'Luiza Soares Silva', '2026-09-12', '2026-10-17', '19:00', '23:00', 'FESTA DE SEXTA-', 'Festa Completa 40 pessoas', 'Festa de 15 Azul', 40, null, 4300, 1290),
  (v_sv_unit, v_sv_space, 'Karoline de Andrade', '(47) 99959-1410', 'Felipe Hayashida', '2026-07-11', '2026-10-18', '15:00', '19:00', 'FESTA DE SEXTA-', 'Festa Completa 40 pessoas', 'Stranger Things', 40, null, 4500, 1350),
  (v_sv_unit, v_sv_space, 'Bianca Jacobsen Pirolli de', '(47) 99792-4549', 'Rian Pirolli de Melo', '2026-07-31', '2026-11-25', '19:00', '23:00', 'FESTA 50', 'Festa Completa 50 pessoas', 'A definir', 50, null, 4600, 0),
  (v_sv_unit, v_sv_space, 'Dayane Cristine Suzena', '(47) 99714-8685', 'Levi Suzena dos', '2026-01-02', '2026-11-28', '16:00', '20:00', 'FESTA DE SEXTA-', 'Festa Completa 40 pessoas', 'Hot Wheels', 40, null, 4500, 1200),
  (v_sv_unit, v_sv_space, 'Bruno Cruz', '(47) 99161-1771', 'Clarice Boch Cruz', '2026-04-21', '2026-12-05', '17:00', '21:00', 'FESTA DE SEXTA-', 'Festa Completa 40 pessoas', 'A definir', 40, null, 4300, 1425),
  (v_sv_unit, v_sv_space, 'Ana Carolina Chaves', '(47) 99904-3057', 'Guilherme Chaves', '2026-08-28', '2026-12-09', '19:00', '23:00', 'FESTA SEGUNDA A', 'Festa Completa 40 pessoas', 'A definir', 40, null, 4300, 0),
  (v_sv_unit, v_sv_space, 'Valdirene Almeida da', '(47) 99122-2610', 'Luna Catarina', '2026-08-06', '2026-12-13', '15:00', '19:00', 'FESTA DE SEXTA-', 'Festa Completa 40 pessoas', 'Borboleta', 40, null, 4200, 4200),
  (v_sv_unit, v_sv_space, 'Paloma Barboza da Silva', '(47) 99264-5715', 'Ísis Barboza', '2026-06-27', '2026-12-19', '16:00', '20:00', 'FESTA DE SEXTA-', 'Festa Completa 40 pessoas', 'Minnie', 40, null, 4500, 1350),
  (v_sv_unit, v_sv_space, 'Maria Antonia Lepre', '(47) 99132-4564', 'Helena Cavalcante', '2026-08-20', '2027-01-02', '16:00', '20:00', 'FESTA DE SEXTA-', 'Festa Completa 40 pessoas', 'A definir', 40, null, 4500, 1122),
  (v_sv_unit, v_sv_space, 'Giseli Cristina de Souza', '(47) 99672-2770', 'Cecilia Eduarda', '2026-08-11', '2027-01-23', '18:00', '22:00', 'FESTA DE SEXTA-', 'Festa Completa 40 pessoas', 'Fundo do Mar', 40, null, 4500, 1440),
  -- ---------- Vila Operária ----------
  (v_vo_unit, v_vo_space, 'Ariane Marilia Bastos', '(47) 99782-4395', 'Théo Bastos', '2026-09-03', '2026-09-18', '19:00', '23:00', 'PACOTE CLASSIC 40 pessoas + 10 de cortesia', 'Classic 40 pessoas', 'Rock''n roll', 40, 10, 6990, 0),
  (v_vo_unit, v_vo_space, 'Thomas Christman da', '(47) 99962-5767', 'Joaquim', '2026-08-22', '2026-10-17', '15:00', '19:00', 'PACOTE GOURMET 50 pessoas + 10 de cortesia', 'Gourmet 50 pessoas', 'Pokemon', 50, 10, 8150, 4075),
  (v_vo_unit, v_vo_space, 'Joyce Cristina Allves', '(47) 98832-0482', 'Nicolas', '2026-08-26', '2026-10-18', '16:00', '20:00', 'PACOTE CLASSIC 50 convidados + 10 de cortesia', 'Classic 50 pessoas', 'Pokemon', 50, 10, 8190, 2500),
  (v_vo_unit, v_vo_space, 'William Oliveira Amarante', '(49) 99941-7856', 'Valentim Lambrecht', '2026-09-10', '2026-10-24', '16:00', '20:00', 'PACOTE GOURMET 40 convidados + 10 de cortesia', 'Gourmet 40 pessoas', 'Pokemon', 40, 10, 8590, 3000),
  (v_vo_unit, v_vo_space, 'Ariane Corre Gama', '(47) 99996-9002', 'Lucas Gamas Palhares', '2026-08-14', '2026-11-14', '16:00', '20:00', 'PACOTE CLASSIC 50 convidados + 10 de cortesia', 'Classic 50 pessoas', 'Hotwheels', 50, 10, 7390, 2217),
  (v_vo_unit, v_vo_space, 'Luana Caroline de Jesus', '(47) 98477-9239', 'Mateus', '2026-09-07', '2027-01-17', '15:00', '19:00', 'PACOTE CLASSIC 40 convidados + 10 de cortesia', 'Classic 40 pessoas', 'A definir', 40, 10, 7590, 1000),
  (v_vo_unit, v_vo_space, 'Eliza Cristina Belarmino', '(47) 99211-1194', 'Matteo Asafe', '2026-08-22', '2027-01-23', '17:00', '21:00', 'PACOTE CLASSIC 50 convidados + 10 de cortesia', 'Classic 50 pessoas', 'Pokemon', 50, 10, 7290, 5842);

  for r in select * from _import_festas order by event_date loop
    v_status := case
      when r.valor_pago <= 0 then 'confirmada'
      when r.valor_pago >= r.valor_festa then 'quitada'
      else 'sinal_pago'
    end;

    select id into v_package_id from packages where unit_id = r.unit_id and name = r.pacote_nome_real;
    if v_package_id is null then
      raise exception 'Pacote "%" não encontrado na unidade % (festa de %) — confira o nome cadastrado em packages.', r.pacote_nome_real, r.unit_id, r.contratante;
    end if;

    insert into clients (name, phone, child_name, created_at)
    values (r.contratante, r.telefone, r.homenageado, r.data_cadastro::timestamptz)
    returning id into v_client_id;

    insert into reservations (
      unit_id, client_id, space_id, package_id, event_date, start_time, end_time, status,
      event_type, guest_count, total_value, final_value, child_name, theme,
      courtesy_guests, notes, created_at
    ) values (
      r.unit_id, v_client_id, r.space_id, v_package_id, r.event_date, r.start_time, r.end_time, v_status,
      'Aniversário infantil', r.guest_count, r.valor_festa, r.valor_festa, r.homenageado, r.tema,
      r.courtesy, 'Importado do sistema anterior — pacote original: ' || r.pacote_text, r.data_cadastro::timestamptz
    );

    if r.valor_pago > 0 then
      insert into payments (reservation_id, amount, payment_date, notes)
      select id, r.valor_pago, r.data_cadastro, 'Importado do sistema anterior — forma de pagamento não informada'
      from reservations
      where client_id = v_client_id and event_date = r.event_date;
    end if;
  end loop;
end $$;
