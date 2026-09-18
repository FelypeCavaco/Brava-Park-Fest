-- =========================================================
-- Motor de Contratos e Pagamentos Flexíveis
-- Escopo: dados de contrato/planos preenchidos apenas para a
-- unidade São Vicente. Vila Operária recebe as mesmas colunas
-- novas (estrutura compartilhada), mas fica com os campos de
-- "dados da contratada" em branco até seu contrato ser definido.
-- O pagamento flexível (2.5) e o desconto (2.4) valem para as
-- duas unidades, pois descrevem o fluxo real do negócio.
-- =========================================================

-- ---------- 2.1 Clientes — dados estruturados para o contrato ----------
alter table clients add column if not exists cpf text;
alter table clients add column if not exists cep text;
alter table clients add column if not exists street text;
alter table clients add column if not exists address_number text;
alter table clients add column if not exists neighborhood text;
alter table clients add column if not exists city text;
alter table clients add column if not exists state text;

-- ---------- 2.2 Unidades — dados da empresa (contratada) por unidade ----------
alter table units add column if not exists legal_name text;
alter table units add column if not exists cnpj text;
alter table units add column if not exists full_address text;
alter table units add column if not exists responsible_name text;
alter table units add column if not exists pix_key text;
alter table units add column if not exists extra_hour_price numeric(10,2);
alter table units add column if not exists default_deposit_percent numeric(5,2);

update units set
  legal_name = 'Brava Park LIMITADA',
  cnpj = '55.747.730/0002-23',
  full_address = 'Avenida Arquiteto Nilson Edson dos Santos, Nº 991, Itajaí - SC, 88309-401',
  responsible_name = 'Evandré Ricardo Cavaco',
  pix_key = '55.747.730/0002-23',
  extra_hour_price = 500.00,
  default_deposit_percent = 30
where name = 'São Vicente';

-- ---------- 2.3 Pacotes — passam a poder pertencer a uma unidade específica ----------
alter table packages add column if not exists unit_id uuid references units(id);
alter table packages add column if not exists guest_limit int;
alter table packages add column if not exists duration_hours numeric(4,1);
alter table packages add column if not exists included_items text;

create index if not exists idx_packages_unit on packages (unit_id);

-- Seed — planos exclusivos da unidade São Vicente (preço fica em aberto,
-- a cargo do usuário preencher em "Pacotes e itens").
insert into packages (name, description, base_price, unit_id, guest_limit, duration_hours, included_items)
select
  v.nome,
  'Plano exclusivo da unidade São Vicente',
  0,
  u.id,
  v.limite,
  4,
  'Docinhos, salgados, salgadinhos, refrigerante, bolo, suco e água. Decoração temática (mediante disponibilidade do tema). Serviço de garçom e copeira. Monitoras treinadas. Brinquedos: arena de cama elástica, circuito radical, tobogã, piscina de bolinha, basquete eletrônico, fliperama e arena games.'
from units u
cross join (values
  ('Festa Completa 40 pessoas', 40),
  ('Festa Completa 50 pessoas', 50),
  ('Festa Completa 60 pessoas', 60)
) as v(nome, limite)
where u.name = 'São Vicente'
  and not exists (
    select 1 from packages p where p.unit_id = u.id and p.name = v.nome
  );

-- ---------- 2.4 Reservas — dados do evento e desconto ----------
alter table reservations add column if not exists child_name text;
alter table reservations add column if not exists child_age int;
alter table reservations add column if not exists theme text;
alter table reservations add column if not exists discount_type text check (discount_type in ('percentual', 'valor_fixo'));
alter table reservations add column if not exists discount_value numeric(10,2);
alter table reservations add column if not exists final_value numeric(10,2);

-- total_value já existente passa a representar o valor cheio (antes do
-- desconto); final_value é o que efetivamente vale como "valor firmado".
-- Reservas já existentes não tinham desconto, então final_value = total_value.
update reservations set final_value = total_value where final_value is null;
alter table reservations alter column final_value set not null;
alter table reservations alter column final_value set default 0;

-- ---------- 2.5 Pagamentos — de "parcelas programadas" para "recebidos" ----------
alter table payments add column if not exists payment_date date;
alter table payments add column if not exists notes text;

update payments set payment_date = coalesce(paid_date, due_date) where payment_date is null;
alter table payments alter column payment_date set not null;
alter table payments alter column payment_date set default current_date;

drop index if exists idx_payments_due_date;
alter table payments drop column if exists type;
alter table payments drop column if exists due_date;
alter table payments drop column if exists status;
alter table payments drop column if exists paid_date;

drop type if exists payment_type;
drop type if exists payment_status;

create index if not exists idx_payments_reservation on payments (reservation_id);

-- ---------- 3.1 Templates de contrato, um por unidade ----------
create table if not exists contract_templates (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null unique references units(id) on delete cascade,
  body text not null,
  updated_at timestamptz not null default now()
);

alter table contract_templates enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'contract_templates' and policyname = 'authenticated_full_access'
  ) then
    create policy "authenticated_full_access" on contract_templates
      for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;

-- Template-base da unidade São Vicente (mesmo contrato real em uso).
-- Cláusulas 5ª a 13ª ficam com texto fixo — são iguais para qualquer
-- reserva desta unidade. Vila Operária cadastra o próprio texto depois.
insert into contract_templates (unit_id, body)
select u.id, $body$CONTRATO DE FESTA BRAVA PARK FEST

CONTRATANTE: {{contratante_nome}}, C.P.F. nº {{contratante_cpf}}, TELEFONE {{contratante_telefone}}, ENDEREÇO {{contratante_endereco}}.

CONTRATADA: {{contratada_razao_social}}, com sede a {{contratada_endereco}}, pessoa jurídica inscrita no C.N.P.J. sob o nº {{contratada_cnpj}}.

As partes acima identificadas têm, entre si, justo e acertado o presente Contrato de Prestação de Serviços de locação de salão de festas e espaço de recreação, conforme cláusulas abaixo descritas.

Cláusula 1ª. DO OBJETO DO CONTRATO
O presente contrato tem por objeto a prestação de serviços de organização e realização de festa infantil, modalidade {{plano_nome}}, conforme descrito abaixo.
Em evento que se realizará na data de {{evento_data}}, de {{evento_hora_inicio}} horas as {{evento_hora_fim}} horas, no Brava Park Fest, na {{evento_local}}.

Cláusula 2ª. DO EVENTO E SERVIÇOS INCLUSOS
O evento, para cuja realização são contratados os serviços, é uma festa infantil estando como responsável a CONTRATANTE, e contará com a presença de até {{convidados_limite}} convidados entre adultos e crianças acima de 3 (três) anos. Crianças de 0 (zero) a 2 (dois) anos e 11 (onze) meses não serão contabilizadas.
O aniversariante chama-se {{aniversariante_nome}} ({{aniversariante_idade}} ANOS), e o tema da festa será "{{tema}}".
O pacote {{plano_nome}} inclui: {{plano_itens}}
Bebidas alcoólicas NÃO ESTÃO INCLUSAS, podendo ser adquiridas no local com custo adicional.

Cláusula 3ª. DURAÇÃO E HORÁRIO
A duração da festa será de {{evento_duracao_horas}} horas, tendo como início as {{evento_hora_inicio}}.
O tempo excedente será cobrado a parte, no valor de {{valor_hora_extra}} por hora adicional, mediante disponibilidade de agenda.

Cláusula 4ª. VALORES E CONDIÇÕES DE PAGAMENTO
O valor firmado é de {{valor_total}}, sendo pago {{valor_sinal}} via pix mediante a assinatura do contrato e o restante até a data que antecede a festa.
Chave pix: {{pix_chave}}.

Claúsula 5ª. CANCELAMENTO E ALTERAÇÃO DE DATA
Em caso de cancelamento por parte do contratante:
Até 30 dias antes da data da festa: retenção de 20% do valor total do contrato a título de custos administrativos;
Entre 15 a 29 dias antes: retenção de 50% do valor total;
Com menos de 15 dias de antecedência, não haverá devolução dos valores pagos.
Alterações de data serão permitidas apenas uma vez, mediante disponibilidade de agenda e aviso com mínimo de 15 dias de antecedência.

Claúsula 6ª. RESPONSABILIDADE POR DANOS
O contratante será responsável por quaisquer danos materiais causados as instalações, brinquedos ou equipamentos do Brava Park Fest, por ele, seus convidados ou prestadores de serviços externos contratados (fotógrafos, animadores, etc.).
O valor do conserto ou substituição será cobrado mediante orçamento emitido pela contratada.

Claúsula 7ª. REGRAS DE SEGURANÇA
A equipe do Brava Park Fest é treinada para garantir a organização e o bom funcionamento dos brinquedos, contudo, a responsabilidade pela integridade física das crianças é dos pais e/ou responsáveis.
A presença de responsáveis legais durante todo o evento é obrigatória.

Claúsula 8ª. LIMITE DE CONVIDADOS
O limite máximo de convidados é de {{convidados_limite}} pessoas, incluindo adultos e crianças.
O excedente está sujeito a cobrança adicional e a aprovação prévia da contratada.

Claúsula 9ª. OBRIGAÇÕES DA CONTRATADA (BRAVA PARK FEST)
A CONTRATADA se compromete a:
Disponibilizar o espaço em perfeitas condições de uso, limpeza e segurança na data e horário contratados;
Fornecer todos os itens descritos no pacote {{plano_nome}}, conforme a cláusula 2;
Garantir a presença de monitoras treinadas, durante todo o evento, zelando pela boa utilização dos brinquedos;
Assegurar que os equipamentos e brinquedos estejam em conformidade com as normas de segurança aplicáveis;
Cumprir rigorosamente o horário acordado e prestar suporte durante o evento;
Realizar a montagem da decoração conforme o tema escolhido e disponível.

Claúsula 10ª. OBRIGAÇÕES DA CONTRATANTE
O CONTRATANTE se compromete a:
Efetuar os pagamentos conforme as condições estabelecidas na cláusula 4;
Comparecer ou garantir o acesso ao espaço na data e horários agendados;
Respeitar os horários de início e término da festa, bem como as regras internas do Brava Park Fest;
Zelar pela boa conservação do espaço e equipamentos, responsabilizando-se por danos causados por si, seus convidados ou prestadores externos;
Garantir a presença de pais ou responsáveis legais pelas crianças durante todo o evento;
Não realizar a entrada de bebidas alcoólicas, comidas, decorações ou equipamentos externos sem prévia autorização da contratada.
Respeitar o limite máximo de {{convidados_limite}} pessoas no evento.

Claúsula 11ª. RESCISÃO CONTRATUAL
O presente contrato poderá ser rescindido por qualquer das partes em caso de descumprimento de cláusulas aqui previstas.
Em caso de rescisão por parte do contratante após a confirmação da reserva, aplicam-se as penalidades descritas na cláusula 5 (cancelamento).
A contratada reserva-se o direito de rescindir o contrato, com restituição integral dos valores pagos, em casos de força maior que impeçam a realização do evento (como desastres naturais, problemas estruturais ou determinações legais).

Clausula 12ª. AUTORIZAÇÃO DO USO DE IMAGEM
O CONTRATANTE autoriza, de forma gratuita, por prazo indeterminado, a captação, utilização, reprodução e divulgação de fotografias, vídeos e demais registros audiovisuais realizados durante o evento pela CONTRATADA.
A presente autorização destina-se exclusivamente a divulgação institucional e comercial da CONTRATADA, podendo as imagens ser utilizadas em redes sociais, website, materiais publicitários, campanhas promocionais, portfólio, apresentações comerciais e demais meios de comunicação, impressos ou digitais.
Caso o CONTRATANTE não concorde com a utilização das imagens para os fins acima descritos, deverá manifestar sua oposição por escrito a CONTRATADA antes da realização do evento, ficando a CONTRATADA obrigada a respeitar tal decisão.

Claúsula 13ª. DO FORO
Para dirimir quaisquer controvérsias oriundas deste contrato, as partes elegem o foro da comarca de Itajaí/SC, com renúncia expressa a qualquer outro, por mais privilegiado que seja.

E por estarem assim justas e contratadas, firmam o presente contrato em duas vias de igual teor.

Itajaí, {{data_geracao}}

{{contratada_responsavel}}
BRAVA PARK FEST — CNPJ {{contratada_cnpj}}

CONTRATANTE: {{contratante_nome}} — CPF {{contratante_cpf}}$body$
from units u
where u.name = 'São Vicente'
on conflict (unit_id) do nothing;
