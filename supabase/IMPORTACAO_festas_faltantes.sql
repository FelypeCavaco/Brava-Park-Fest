-- =========================================================
-- IMPORTAÇÃO DE FESTAS FALTANTES (2ª leva) — rodar UMA VEZ, manualmente,
-- no SQL Editor do Supabase (script de dados, não é migration de schema —
-- por isso sem número e fora do schema.sql).
--
-- Fonte: Festas_Faltantes_São_Vicente.pdf (6 festas) e
-- Festas_Faltantes_Vila_Operaria.pdf (5 festas) — relatórios do sistema
-- antigo que não tinham entrado na primeira importação.
--
-- Segue exatamente o mesmo critério da importação anterior
-- (IMPORTACAO_festas_reais.sql):
--   • Pacote vinculado ao pacote real pelo valor cobrado + dia da semana
--     do evento (o texto do relatório antigo não traz o nome certo do
--     pacote atual). Nenhuma das 11 festas ficou sem pacote vinculado.
--   • São Vicente: "FESTA SEGUNDA A"/"FESTA DE SEXTA-" sem número de
--     convidados no texto → considerado 40 convidados (mesmo critério já
--     combinado).
--   • Vila Operária: dessa vez o texto do pacote não trouxe o número de
--     convidados (só "PACOTE GOURMET"/"PACOTE CLASSIC SEX"), então o
--     convidados foi inferido batendo o valor cobrado com a tabela de
--     preços atual (achei batida exata em 4 das 5 — a 5ª, de Ketelin
--     Dandara, ficou em "Classic 40 pessoas" por ser o valor mais
--     próximo, uma diferença de R$300 pra menos, possível desconto
--     negociado). Mantive a suposição de 10 convidados de cortesia em
--     todas as Vila Operária, igual à leva anterior (o relatório não
--     repete isso aqui, mas é o padrão dos planos de lá).
--   • Status pela comparação valor pago x valor total (confirmada / sinal
--     pago / quitada).
--   • Forma de pagamento e data exata do pagamento não vêm no relatório
--     antigo — pagamento registrado na "Data de cadastro" da festa, sem
--     forma de pagamento definida.
--   • Nenhum conflito de data encontrado (nem entre essas 11 festas, nem
--     contra as já importadas antes).
--   • Um nome veio cortado no relatório de origem: "Emanuella Caroline
--     de" (São Vicente, linha 5) — o sobrenome não aparece no PDF
--     original, mantive só o que veio. Ajuste pela tela se souber o nome
--     completo.
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

  create temporary table _import_festas_2 (
    unit_id uuid,
    space_id uuid,
    contratante text,
    telefone text,
    homenageado text,
    data_cadastro date,
    event_date date,
    start_time time,
    end_time time,
    pacote_nome_real text,
    guest_count int,
    courtesy int,
    valor_festa numeric,
    valor_pago numeric
  ) on commit drop;

  insert into _import_festas_2 (unit_id, space_id, contratante, telefone, homenageado, data_cadastro, event_date, start_time, end_time, pacote_nome_real, guest_count, courtesy, valor_festa, valor_pago) values
  -- ---------- São Vicente ----------
  (v_sv_unit, v_sv_space, 'Juliana de Freitas Weber', '(47) 99949-1871', 'Théo Weber Fusieger', '2026-09-14', '2026-10-05', '19:00', '23:00', 'Festa Completa 40 pessoas', 40, null, 4300, 0),
  (v_sv_unit, v_sv_space, 'Larissa da Silva Setti', '(47) 99921-6051', 'Livia', '2026-09-16', '2026-10-16', '19:00', '23:00', 'Festa Completa 40 pessoas', 40, null, 4275, 4275),
  (v_sv_unit, v_sv_space, 'Acioly Andrade Filho', '(47) 99277-9606', 'Bela Leite Andrade', '2026-09-19', '2026-10-24', '16:00', '20:00', 'Festa Completa 40 pessoas', 40, null, 4000, 0),
  (v_sv_unit, v_sv_space, 'Larissa Kruger da Silva', '(47) 98807-2635', 'Helena da Silva', '2026-09-18', '2026-11-14', '14:00', '18:00', 'Festa Completa 40 pessoas', 40, null, 4275, 1000),
  (v_sv_unit, v_sv_space, 'Emanuella Caroline de', '(47) 99220-5262', 'Pedro Noldim', '2026-09-23', '2026-11-15', '15:00', '19:00', 'Festa Completa 40 pessoas', 40, null, 4200, 1200),
  (v_sv_unit, v_sv_space, 'Leandro da Silva', '(47) 99264-6703', 'Valentina Pilonetto', '2026-09-23', '2026-12-06', '16:00', '20:00', 'Festa Completa 40 pessoas', 40, null, 4500, 3500),
  -- ---------- Vila Operária ----------
  (v_vo_unit, v_vo_space, 'Elisandra Pereira Lopes', '(47) 99970-3488', 'Maya Pereira Lopes', '2026-09-18', '2026-11-26', '19:00', '23:00', 'Gourmet 40 pessoas', 40, 10, 7790, 2790),
  (v_vo_unit, v_vo_space, 'Ketelin Dandara da Silva', '(47) 99984-8604', 'Theodoro da Silva', '2026-09-22', '2026-12-13', '15:00', '19:00', 'Classic 40 pessoas', 40, 10, 7290, 2187),
  (v_vo_unit, v_vo_space, 'Aline Vieira', '(47) 99714-2358', 'Isabela Vieira', '2026-09-22', '2027-01-10', '16:00', '20:00', 'Classic 40 pessoas', 40, 10, 7590, 500),
  (v_vo_unit, v_vo_space, 'Karen Heloise de Souza', '(47) 99911-2470', 'Gael Joaquim', '2026-09-25', '2027-03-13', '16:30', '20:30', 'Gourmet 80 pessoas', 80, 10, 11590, 0),
  (v_vo_unit, v_vo_space, 'Camila Thays Constantino', '(47) 99150-9663', 'Isaac', '2026-09-25', '2027-04-24', '18:00', '22:00', 'Gourmet 70 pessoas', 70, 10, 10790, 3237);

  for r in select * from _import_festas_2 order by event_date loop
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
      event_type, guest_count, total_value, final_value, child_name, courtesy_guests, notes, created_at
    ) values (
      r.unit_id, v_client_id, r.space_id, v_package_id, r.event_date, r.start_time, r.end_time, v_status,
      'Aniversário infantil', r.guest_count, r.valor_festa, r.valor_festa, r.homenageado,
      r.courtesy, 'Importado do sistema anterior (2ª leva — festas faltantes)', r.data_cadastro::timestamptz
    );

    if r.valor_pago > 0 then
      insert into payments (reservation_id, amount, payment_date, notes)
      select id, r.valor_pago, r.data_cadastro, 'Importado do sistema anterior — forma de pagamento não informada'
      from reservations
      where client_id = v_client_id and event_date = r.event_date;
    end if;
  end loop;
end $$;
