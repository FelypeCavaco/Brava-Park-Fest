-- =========================================================
-- Motor de Contratos — dados da contratada e template da
-- unidade Vila Operária (segunda unidade, contrato real
-- enviado pelo usuário). Os planos/preços em si ainda NÃO são
-- cadastrados aqui — o usuário vai enviar o portfólio completo
-- com valores e itens inclusos de cada plano das duas unidades.
-- =========================================================

-- ---------- Convidados de cortesia (promoção pontual, por reserva) ----------
-- Não é uma característica fixa do pacote (a promoção de inauguração é por
-- tempo limitado) — por isso fica na própria reserva, preenchido só quando
-- aplicável, e não em `packages`.
alter table reservations add column if not exists courtesy_guests int;

-- ---------- Dados da contratada — Vila Operária ----------
update units set
  legal_name = 'Brava Park LIMITADA',
  cnpj = '55.747.730/0001-42',
  full_address = 'Rua Duque de Caxias, Nº 295, Vila Operária, Itajaí - SC, 88303-230',
  responsible_name = 'Evandré Ricardo Cavaco',
  pix_key = '55.747.730/0001-42',
  extra_hour_price = 750.00
where name = 'Vila Operária';

-- ---------- Template do contrato — Vila Operária ----------
-- Igual ao contrato real enviado, com as partes variáveis marcadas. Note que
-- esta unidade não tem a cláusula de "uso de imagem" que existe no contrato
-- de São Vicente — são contratos-base diferentes por unidade, de propósito.
insert into contract_templates (unit_id, body)
select u.id, $body$CONTRATO DE FESTA BRAVA PARK FEST

CONTRATANTE: {{contratante_nome}}, C.P.F. nº {{contratante_cpf}}, TELEFONE {{contratante_telefone}}, ENDEREÇO {{contratante_endereco}}.

CONTRATADA: {{contratada_razao_social}}, com sede a {{contratada_endereco}}, pessoa jurídica inscrita no C.N.P.J. sob o nº {{contratada_cnpj}}.

As partes acima identificadas têm, entre si, justo e acertado o presente Contrato de Prestação de Serviços de locação de salão de festas e espaço de recreação, conforme cláusulas abaixo descritas.

Cláusula 1ª. DO OBJETO DO CONTRATO
O presente contrato tem por objeto a prestação de serviços de organização e realização de festa infantil, modalidade {{plano_nome}}, conforme descrito abaixo.
Em evento que se realizará na data de {{evento_data}}, de {{evento_hora_inicio}} horas as {{evento_hora_fim}} horas, no Brava Park Fest, na {{evento_local}}.

Cláusula 2ª. DO EVENTO E SERVIÇOS INCLUSOS
O evento, para cuja realização são contratados os serviços, é uma festa infantil estando como responsável a CONTRATANTE, e contará com a presença de até {{convidados_limite}} convidados entre adultos e crianças.
{{convidados_cortesia_paragrafo}}
O aniversariante chama-se {{aniversariante_nome}} ({{aniversariante_idade}} ANOS), e o tema da festa será "{{tema}}".
O pacote {{plano_nome}} inclui: {{plano_itens}}
Bebidas alcoólicas NÃO ESTÃO INCLUSAS, podendo ser adquiridas no local com custo adicional.

Cláusula 3ª. DURAÇÃO E HORÁRIO
A duração da festa será de {{evento_duracao_horas}} horas, tendo como início as {{evento_hora_inicio}}.
O tempo excedente será cobrado a parte, no valor de {{valor_hora_extra}} por hora adicional, sendo disponibilizado o espaço completo, equipe e bebidas não alcoólicas mediante disponibilidade de agenda.

Cláusula 4ª. VALORES E CONDIÇÕES DE PAGAMENTO
O valor firmado é de {{valor_total}}, sendo pago {{valor_sinal}} via pix mediante a assinatura do contrato.
Chave pix: {{pix_chave}}

Claúsula 5ª. CANCELAMENTO E ALTERAÇÃO DE DATA
Em caso de cancelamento por parte do contratante:
Até 30 dias antes da data da festa: retenção de 20% do valor total do contrato a título de custos administrativos;
Entre 15 a 29 dias antes: retenção de 50% do valor total;
Com menos de 15 dias de antecedência, não haverá devolução dos valores pagos.
Alterações de data serão permitidas apenas uma vez, mediante disponibilidade de agenda e aviso com mínimo de 15 dias de antecedência.

Claúsula 6ª. RESPONSABILIDADE POR DANOS
O contratante será responsável por quaisquer danos materiais causados as instalações, brinquedos ou equipamentos do Brava Park Fest, por ele, seus convidados ou prestadores de servições externos contratados (fotógrafos, animadores, etc.).
O valor do conserto ou substituição será cobrado mediante orçamento emitido pela contratada.

Claúsula 7ª. REGRAS DE SEGURANÇA
A equipe do Brava Park Fest é treinada para garantir a organização e o bom funcionamento dos brinquedos, contudo, a responsabilidade pela integridade física das crianças é dos pais e/ou responsáveis.
A presença de responsáveis legais durante todo o evento é obrigatória.

Claúsula 8ª. LIMITE DE CONVIDADOS
O limite máximo de convidados é de {{convidados_limite_clausula8}} pessoas incluindo adultos e crianças.
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

Claúsula 11ª. RESCISÃO CONTRATUAL
O presente contrato poderá ser rescindido por qualquer das partes em caso de descumprimento de cláusulas aqui previstas.
Em caso de rescisão por parte do contratante após a confirmação da reserva, aplicam-se as penalidades descritas na cláusula 5 (cancelamento).
A contratada reserva-se o direito de rescindir o contrato, com restituição integral dos valores pagos, em casos de força maior que impeçam a realização do evento (como desastres naturais, problemas estruturais ou determinações legais).

Claúsula 12ª. DO FORO
Para dirimir quaisquer controvérsias oriundas deste contrato, as partes elegem o foro da comarca de Itajaí/SC, com renúncia expressa a qualquer outro, por mais privilegiado que seja.

E por estarem assim justas e contratadas, firmam o presente contrato em duas vias de igual teor.

Itajaí, {{data_geracao}}

{{contratada_responsavel}}
BRAVA PARK FEST — CNPJ {{contratada_cnpj}}

CONTRATANTE: {{contratante_nome}} — CPF {{contratante_cpf}}$body$
from units u
where u.name = 'Vila Operária'
on conflict (unit_id) do nothing;
