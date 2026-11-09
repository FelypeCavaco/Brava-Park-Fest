import { downloadPdf } from './pdfExport'
import { brl } from './format'
import { MODULOS } from './modules'
import { TERMOS_DATA } from './termosUso'

// Contrato do sistema (licença de uso SaaS) entre o dono da plataforma e a
// casa de festas, gerado pelo painel da plataforma. O texto é o rascunho
// aprovado; os campos vêm dos dados da contratada (painel) e da empresa
// (primeira unidade + mensalidade cadastrada). Campo sem dado sai em branco
// para preencher à mão.

export interface DadosContratada {
  contratada_nome?: string | null
  contratada_documento?: string | null
  contratada_endereco?: string | null
  contratada_email?: string | null
  contratada_whatsapp?: string | null
  suporte_horario?: string | null
  foro?: string | null
}

export interface DadosEmpresaContrato {
  empresa: string
  unidade: { razao_social: string | null; cnpj: string | null; endereco: string | null; responsavel: string | null } | null
  unidades: number
  plano: {
    plano: string | null
    mensalidade: number
    dia_vencimento: number
    inicio: string
    implantacao: number
    unidade_adicional: number
    unidades_incluidas: number
    usuarios_incluidos: number | null
    tolerancia_dias?: number | null
  } | null
  desligados: string[] | null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const campo = (v: string | number | null | undefined) =>
  v === null || v === undefined || String(v).trim() === '' ? '<span class="vazio">______________________</span>' : esc(String(v))
const dataBr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

export function faltandoNoContrato(c: DadosContratada, e: DadosEmpresaContrato): string[] {
  const f: string[] = []
  if (!c.contratada_nome) f.push('seu nome ou razão social')
  if (!c.contratada_documento) f.push('seu CPF/CNPJ')
  if (!c.contratada_endereco) f.push('seu endereço')
  if (!e.unidade?.razao_social) f.push('razão social da casa (Configurações → Unidades)')
  if (!e.unidade?.cnpj) f.push('CNPJ da casa')
  if (!e.unidade?.endereco) f.push('endereço da casa')
  if (!e.unidade?.responsavel) f.push('responsável da casa')
  if (!e.plano) f.push('mensalidade (aba Mensalidade)')
  return f
}

export function contratoSaasHtml(c: DadosContratada, e: DadosEmpresaContrato): { corpo: string; estilos: string; nomeArquivo: string } {
  const p = e.plano
  const u = e.unidade
  const desligados = (e.desligados ?? []).map((id) => MODULOS.find((m) => m.id === id)?.label ?? id)
  const suporte = c.suporte_horario || 'segunda a sexta, das 9h às 18h'
  const foro = c.foro || 'Itajaí/SC'
  const contatoSuporte = [c.contratada_whatsapp && `WhatsApp ${c.contratada_whatsapp}`, c.contratada_email && `e-mail ${c.contratada_email}`].filter(Boolean).join(' ou ')
  const hoje = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })

  const corpo = `
<h1>Contrato de Licença de Uso de Software (SaaS) e Prestação de Serviços</h1>
<p class="sub">Sistema Festou</p>

<p><b>CONTRATADA:</b> ${campo(c.contratada_nome)}, inscrita no CPF/CNPJ sob o nº ${campo(c.contratada_documento)}, com endereço em ${campo(c.contratada_endereco)}${c.contratada_email ? `, e-mail ${esc(c.contratada_email)}` : ''}, doravante chamada CONTRATADA.</p>
<p><b>CONTRATANTE:</b> ${campo(u?.razao_social || e.empresa)}, inscrita no CNPJ sob o nº ${campo(u?.cnpj)}, com sede em ${campo(u?.endereco)}, neste ato representada por ${campo(u?.responsavel)}, doravante chamada CONTRATANTE.</p>
<p>As partes acima têm entre si justo e contratado o que segue.</p>

<h2>Cláusula 1 — Objeto</h2>
<p>1.1. Este contrato concede à CONTRATANTE uma licença de uso, temporária, não exclusiva e intransferível, do sistema Festou (o "Sistema"), acessado pela internet, para administrar a sua casa de festas. O Sistema inclui, conforme o plano contratado no Anexo I: agenda, cadastro de clientes e festas, propostas, contratos, financeiro, cobrança em parcelas, estoque, equipe, relatórios e o portal do cliente.</p>
<p>1.2. Este contrato não transfere a propriedade do Sistema nem dá acesso ao seu código. A CONTRATANTE paga pelo direito de uso enquanto o contrato estiver em vigor.</p>
<p>1.3. A CONTRATADA também presta os serviços de implantação, suporte e manutenção descritos nas cláusulas 2 e 5.</p>
<p>1.4. Fazem parte deste contrato os Termos de Uso e a Política de Privacidade do Festou (versão de ${TERMOS_DATA}), que cada pessoa da equipe da CONTRATANTE aceita no seu primeiro acesso e que ficam disponíveis no Sistema. Se houver diferença entre eles e este contrato, vale este contrato.</p>

<h2>Cláusula 2 — Implantação</h2>
<p>2.1. A CONTRATADA fará a configuração inicial do Sistema em até 10 dias úteis após receber as informações necessárias: cadastro da empresa e das unidades, pacotes e preços, modelo de contrato da casa, cardápio, usuários iniciais e regra de cobrança.</p>
<p>2.2. A CONTRATADA oferecerá um treinamento online de até 2 horas para a equipe da CONTRATANTE e manterá, dentro do Sistema, materiais de ajuda com explicações e vídeos sobre o seu uso (o "Guia Festou").</p>
<p>2.3. As informações usadas na implantação são de responsabilidade da CONTRATANTE, que deve conferi-las antes de começar a usar o Sistema com seus clientes.</p>
<p>2.4. Se o Anexo I prever período de teste gratuito, a cobrança da mensalidade começa no fim desse período, na data de início indicada no Anexo I. A CONTRATANTE pode cancelar durante o teste sem pagar mensalidade.</p>

<h2>Cláusula 3 — Preço e pagamento</h2>
<p>3.1. Pela licença e pelos serviços, a CONTRATANTE pagará os valores do Anexo I: uma taxa única de implantação, se houver, e uma mensalidade.</p>
<p>3.2. A mensalidade vence todo dia ${campo(p?.dia_vencimento)} de cada mês e é paga pela fatura enviada pela CONTRATADA (Pix, boleto ou cartão de crédito). A CONTRATANTE recebe a fatura por e-mail e é avisada 5 dias antes e no dia do vencimento.</p>
<p>3.3. Os valores serão reajustados a cada 12 meses pela variação do IPCA (IBGE) do período, ou por outro índice oficial que o substitua, com aviso à CONTRATANTE de pelo menos 30 dias.</p>
<p>3.4. Não há cobrança de multa nem de juros por atraso. O atraso no pagamento leva à suspensão do acesso, conforme o item 3.5.</p>
<p>3.5. Com mais de ${p?.tolerancia_dias ?? 7} dias de atraso, o acesso ao Sistema é suspenso automaticamente. Durante a suspensão, os dados ficam guardados, a tela de acesso mostra o link para pagamento, e o acesso volta sozinho assim que o pagamento é confirmado.</p>
<p>3.6. Se a suspensão por falta de pagamento passar de 60 dias, a CONTRATADA poderá encerrar o contrato, seguindo o que diz a cláusula 8 sobre a devolução e a exclusão dos dados.</p>
<p>3.7. A CONTRATADA emitirá nota fiscal de serviço de cada pagamento recebido. Os valores do Anexo I já incluem os tributos devidos pela CONTRATADA.</p>
<p>3.8. Tarifas cobradas por terceiros que a CONTRATANTE escolher usar, como as taxas do seu banco, da sua maquininha de cartão ou do serviço de pagamento das suas festas, não fazem parte deste contrato.</p>
<p>3.9. A CONTRATANTE pode pedir a troca de plano a qualquer momento. A mudança para um plano maior vale a partir da liberação das novas funções, e a diferença do mês em curso é cobrada de forma proporcional na fatura seguinte. A mudança para um plano menor vale a partir do mês seguinte ao pedido. Ao mudar para um plano menor, as funções que não fazem parte do novo plano deixam de ficar disponíveis, mas os dados registrados nelas continuam guardados e voltam a aparecer se a CONTRATANTE retornar a um plano que as inclua.</p>
<p>3.10. O uso além do que o plano inclui, como unidades ou usuários adicionais, é cobrado conforme os valores do Anexo I, a partir do mês em que for liberado.</p>

<h2>Cláusula 4 — Prazo e cancelamento</h2>
<p>4.1. Este contrato vale por prazo indeterminado a partir da data de liberação do acesso.</p>
<p>4.2. Qualquer das partes pode cancelar o contrato a qualquer momento, sem multa, com aviso por escrito (e-mail ou WhatsApp) de pelo menos 30 dias. A mensalidade do período de aviso é devida.</p>
<p>4.3. O contrato pode ser encerrado imediatamente, por aviso escrito, se uma das partes descumprir uma obrigação importante e não corrigir o problema em até 10 dias após ser avisada.</p>
<p>4.4. A taxa de implantação não é devolvida em caso de cancelamento, já que o serviço foi prestado.</p>

<h2>Cláusula 5 — Obrigações da Contratada</h2>
<p>5.1. Empregar esforços razoáveis para manter o Sistema funcionando e acessível pela internet, buscando disponibilidade de 99% do tempo em cada mês. Não contam as manutenções programadas, avisadas com pelo menos 24 horas, nem as situações descritas no item 9.2.</p>
<p>5.2. Prestar suporte ${contatoSuporte ? `pelo ${esc(contatoSuporte)}` : 'pelos contatos informados neste contrato'}, de ${esc(suporte)}, com primeira resposta em até 1 dia útil. Quando o Sistema estiver fora do ar, o atendimento terá prioridade.</p>
<p>5.3. Corrigir os defeitos do Sistema em até 14 (catorze) dias úteis, contados da comunicação feita pela CONTRATANTE pelos canais de suporte. Defeitos que impeçam o uso do Sistema terão prioridade.</p>
<p>5.4. Incluir, sem custo extra, as atualizações e melhorias que forem liberadas para todos os clientes do Sistema.</p>
<p>5.5. Manter cópias de segurança diárias dos dados.</p>
<p>5.6. Manter os dados de cada casa de festas separados dos dados de outros clientes, de modo que um cliente não tenha acesso aos dados de outro.</p>
<p>5.7. Permitir que a CONTRATANTE exporte os seus dados a qualquer momento, pelo próprio Sistema, em planilha.</p>
<p>5.8. Funções novas que não fazem parte do plano contratado poderão ser oferecidas à parte, com preço próprio, e só serão cobradas se a CONTRATANTE aceitar.</p>

<h2>Cláusula 6 — Obrigações da Contratante</h2>
<p>6.1. Pagar os valores nas datas combinadas.</p>
<p>6.2. Cadastrar informações verdadeiras e manter atualizados os dados da empresa.</p>
<p>6.3. Manter em sigilo as senhas de acesso. Cada pessoa deve ter o seu próprio login. A CONTRATANTE responde pelo que for feito com os logins da sua equipe e deve desativar o acesso de quem sair da empresa.</p>
<p>6.4. Usar o Sistema somente para a administração da sua casa de festas, de forma lícita, sem tentar acessar dados de outros clientes, copiar o Sistema ou repassar o acesso a terceiros.</p>
<p>6.5. Responder pelo conteúdo que cadastra e envia aos seus clientes: contratos, preços, regras da casa, multa e juros de parcelas atrasadas e mensagens de WhatsApp. O Sistema é uma ferramenta, e cabe à CONTRATANTE conferir se esse conteúdo está de acordo com a lei, em especial com o Código de Defesa do Consumidor.</p>
<p>6.6. Cumprir a Lei Geral de Proteção de Dados (LGPD) em relação aos dados dos seus clientes, convidados e funcionários, conforme a cláusula 8.</p>
<p>6.7. Manter corretos no Sistema a chave Pix, as taxas da maquininha e os demais dados usados nas cobranças, e conferir os lançamentos feitos de forma automática ou sugerida pelo Sistema, como o cálculo de parcelas e os lembretes de cobrança. O Sistema não recebe, não guarda e não movimenta dinheiro da CONTRATANTE ou dos seus clientes. Os códigos Pix exibidos aos clientes são gerados com a chave informada pela CONTRATANTE, e o pagamento cai direto na conta dela; por isso o Sistema não confirma os pagamentos por Pix automaticamente, cabendo à CONTRATANTE conferi-los na sua conta e registrá-los.</p>
<p>6.8. Enviar o link do portal de cada festa somente ao responsável pela festa.</p>

<h2>Cláusula 7 — Propriedade</h2>
<p>7.1. O Sistema, a sua marca, o código, as telas e a documentação pertencem à CONTRATADA.</p>
<p>7.2. Os dados cadastrados pela CONTRATANTE (clientes, festas, valores, documentos e demais registros) pertencem à CONTRATANTE.</p>

<h2>Cláusula 8 — Proteção de dados pessoais (LGPD)</h2>
<p>8.1. Para os fins da Lei nº 13.709/2018 (LGPD), a CONTRATANTE é a controladora dos dados pessoais que cadastra no Sistema, e a CONTRATADA é a operadora, tratando esses dados somente para prestar os serviços deste contrato e conforme as instruções da CONTRATANTE.</p>
<p>8.2. A CONTRATANTE é responsável por ter uma base legal para tratar os dados que cadastra. Os dados de crianças, como o nome e a idade do aniversariante, devem ser tratados no melhor interesse da criança e com o consentimento de pelo menos um dos pais ou responsável, conforme o art. 14 da LGPD.</p>
<p>8.3. A CONTRATADA se compromete a: (a) não usar os dados da CONTRATANTE para nenhuma outra finalidade, nem vendê-los ou compartilhá-los, salvo por obrigação legal ou ordem judicial; (b) acessar os dados apenas quando necessário para suporte, manutenção ou correção de problemas; (c) manter medidas de segurança adequadas, como acesso por login e senha, conexão criptografada, separação entre clientes e cópias de segurança; (d) comunicar a CONTRATANTE em até 48 horas depois de saber de qualquer incidente de segurança que envolva os seus dados; (e) ajudar a CONTRATANTE a atender pedidos de titulares (acesso, correção ou exclusão de dados), dentro do que o Sistema permite.</p>
<p>8.4. Para funcionar, o Sistema usa fornecedores de infraestrutura, como hospedagem do banco de dados, dos arquivos e do site (atualmente Supabase e Cloudflare), cobrança da mensalidade (atualmente Asaas) e envio de e-mails do Sistema, que podem guardar dados em servidores fora do Brasil, com garantias de proteção compatíveis com a LGPD. A CONTRATANTE autoriza o uso desses fornecedores. A troca de um fornecedor por outro equivalente será informada à CONTRATANTE.</p>
<p>8.5. Quando o contrato terminar, por qualquer motivo: (a) a CONTRATANTE terá até 30 dias para pedir uma cópia dos seus dados, entregue em arquivo digital; (b) passado esse prazo, ou antes, se a CONTRATANTE pedir, a CONTRATADA excluirá do Sistema de forma definitiva todos os dados, arquivos e logins da CONTRATANTE; (c) a cópia gerada no momento da exclusão poderá ser mantida pela CONTRATADA por até 90 dias, apenas para devolver à CONTRATANTE se ela pedir, e depois será apagada, ressalvados os dados que a lei obrigar a guardar.</p>

<p>8.6. A CONTRATADA guarda os registros de acesso ao Sistema pelo prazo exigido pelo Marco Civil da Internet (Lei nº 12.965/2014), e o registro de alterações feitas nos dados, para segurança e para esclarecer dúvidas da própria CONTRATANTE.</p>
<p>8.7. A CONTRATADA pode usar informações estatísticas e anônimas sobre o uso do Sistema, que não identifiquem a CONTRATANTE nem nenhuma pessoa, para melhorar o Sistema.</p>
<p>8.8. Pedidos e dúvidas sobre dados pessoais podem ser enviados aos contatos de suporte da cláusula 5.2.</p>
<p>8.9. Para não guardar dados pessoais sem necessidade, o portal de cada festa é encerrado automaticamente 7 dias depois da festa, desde que ela esteja quitada (ou cancelada). Nesse momento, o link deixa de funcionar e são apagadas a lista de convidados e as mensagens do portal, ficando guardada apenas a quantidade de convidados. Os demais registros da festa continuam no Sistema.</p>

<h2>Cláusula 9 — Disponibilidade do Sistema e limitação de responsabilidade</h2>
<p>9.1. O Sistema é disponibilizado no estado em que se encontra. Embora a CONTRATADA empregue esforços razoáveis para mantê-lo em funcionamento contínuo, não garante que ele operará de forma ininterrupta, livre de erros, falhas ou lentidão.</p>
<p>9.2. O Sistema poderá ficar indisponível, lento ou apresentar comportamento inesperado, total ou parcialmente, em razão de, entre outros: (a) volume elevado de acessos ou uso simultâneo por muitos usuários; (b) manutenções, atualizações e correções, programadas ou emergenciais; (c) falhas, instabilidades ou interrupções de serviços de terceiros, como provedores de hospedagem, banco de dados, internet, energia, envio de mensagens e meios de pagamento; (d) ataques cibernéticos, acessos indevidos e outras ações maliciosas de terceiros; (e) caso fortuito ou força maior. Nessas hipóteses, a CONTRATADA não será responsável por prejuízos decorrentes da indisponibilidade, lentidão ou falha.</p>
<p>9.3. O Sistema é uma ferramenta de apoio à gestão. Cálculos, totais, relatórios, projeções, sugestões, lembretes, mensagens, códigos Pix e demais informações geradas pelo Sistema dependem dos dados cadastrados pela CONTRATANTE e devem ser conferidos por ela antes de qualquer decisão, cobrança, pagamento ou envio a terceiros. As decisões tomadas com base no Sistema são de responsabilidade exclusiva da CONTRATANTE.</p>
<p>9.4. A CONTRATADA não responde por erros, prejuízos ou perdas decorrentes de: (a) dados incorretos, incompletos ou desatualizados informados pela CONTRATANTE ou por seus clientes, como valores, datas, chave Pix, taxas e dados de contato; (b) uso indevido do Sistema ou em desacordo com este contrato e com os Termos de Uso; (c) compartilhamento de senhas ou acesso por pessoas autorizadas pela CONTRATANTE; (d) falhas em aparelhos, navegadores ou na conexão de internet da CONTRATANTE; (e) serviços de terceiros acessados a partir do Sistema, como WhatsApp, bancos e instituições de pagamento.</p>
<p>9.5. Identificado defeito no funcionamento do Sistema, a obrigação da CONTRATADA é corrigi-lo no prazo do item 5.3.</p>
<p>9.6. Na máxima extensão permitida pela legislação, a CONTRATADA não responderá por danos indiretos, lucros cessantes, perda de receita, perda de chance ou danos à imagem.</p>
<p>9.7. Em qualquer caso, a responsabilidade total da CONTRATADA neste contrato fica limitada ao valor das mensalidades pagas pela CONTRATANTE nos 12 meses anteriores ao fato, exceto em caso de dolo ou de culpa grave.</p>
<p>9.8. Recomenda-se que a CONTRATANTE exporte os seus dados periodicamente, pela função de exportação do Sistema, mantendo cópia própria das informações essenciais ao seu negócio.</p>

<h2>Cláusula 10 — Confidencialidade</h2>
<p>10.1. As partes manterão em sigilo as informações da outra parte a que tiverem acesso por causa deste contrato, como dados de clientes, preços, estratégias e informações técnicas do Sistema. Essa obrigação continua por 2 anos após o fim do contrato.</p>

<h2>Cláusula 11 — Disposições gerais</h2>
<p>11.1. Alterações neste contrato só valem se feitas por escrito e aceitas pelas duas partes. Mudanças de plano e de valores podem ser feitas por atualização do Anexo I.</p>
<p>11.2. As comunicações entre as partes podem ser feitas por e-mail ou WhatsApp, nos contatos informados neste contrato.</p>
<p>11.3. A CONTRATADA pode mudar o funcionamento e as telas do Sistema para melhorá-lo, desde que não retire funções essenciais do plano contratado sem aviso de pelo menos 30 dias.</p>
<p>11.4. Este contrato pode ser assinado eletronicamente, e as partes reconhecem essa assinatura como válida, nos termos da Medida Provisória nº 2.200-2/2001 e da Lei nº 14.063/2020.</p>
<p>11.5. Este contrato não cria vínculo de emprego, sociedade ou representação entre as partes, nem entre uma parte e a equipe da outra.</p>
<p>11.6. A CONTRATADA só usará o nome ou a marca da CONTRATANTE como cliente do Festou (em site, apresentação ou rede social) com autorização da CONTRATANTE.</p>
<p>11.7. A CONTRATADA poderá transferir este contrato a outra empresa que assuma o Sistema, mantidas todas as condições, com aviso à CONTRATANTE. A CONTRATANTE só pode transferi-lo com a concordância da CONTRATADA.</p>
<p>11.8. Se uma parte deixar de exigir um direito em algum momento, isso não significa que abriu mão dele. Se alguma cláusula for considerada inválida, as demais continuam valendo.</p>
<p>11.9. Fica eleito o foro da comarca de ${esc(foro)} para resolver qualquer questão sobre este contrato.</p>

<p class="data">${esc(foro.split('/')[0])}, ${hoje}.</p>
<div class="assinaturas">
  <div><span></span>CONTRATADA<br>${campo(c.contratada_nome)}</div>
  <div><span></span>CONTRATANTE<br>${campo(u?.responsavel)}</div>
</div>

<h2 class="anexo">Anexo I — Plano contratado</h2>
<table>
  <tr><td>Plano</td><td>${campo(p?.plano)}</td></tr>
  <tr><td>Unidades incluídas</td><td>${campo(p?.unidades_incluidas)}</td></tr>
  <tr><td>Usuários incluídos</td><td>${p ? (p.usuarios_incluidos ? String(p.usuarios_incluidos) : 'Ilimitados') : campo(null)}</td></tr>
  <tr><td>Funções liberadas</td><td>${desligados.length ? `Todas, exceto: ${esc(desligados.join(', '))}` : 'Todas'}</td></tr>
  <tr><td>Taxa de implantação (única)</td><td>${p ? (p.implantacao > 0 ? brl(p.implantacao) : 'Sem taxa') : campo(null)}</td></tr>
  <tr><td>Mensalidade</td><td>${p ? brl(p.mensalidade) : campo(null)}</td></tr>
  <tr><td>Unidade adicional</td><td>${p ? (p.unidade_adicional > 0 ? `${brl(p.unidade_adicional)} por mês, por unidade` : '—') : campo(null)}</td></tr>
  <tr><td>Vencimento</td><td>${p ? `Todo dia ${p.dia_vencimento}` : campo(null)}</td></tr>
  <tr><td>Início da cobrança</td><td>${p ? dataBr(p.inicio) : campo(null)}</td></tr>
</table>`

  const estilos = `
    .pdf-body { font-family: Georgia, 'Times New Roman', serif; color: #1F1A2E; padding: 48px 56px; font-size: 12.5px; line-height: 1.6; }
    h1 { font-size: 18px; text-align: center; margin: 0 0 4px; }
    .sub { text-align: center; color: #6D5E8C; font-family: Arial, sans-serif; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; margin: 0 0 24px; }
    h2 { font-size: 12.5px; text-transform: uppercase; color: #59239B; margin: 18px 0 6px; page-break-after: avoid; }
    p { margin: 0 0 8px; text-align: justify; }
    .vazio { color: #8A7FA6; }
    .data { margin-top: 28px; }
    .assinaturas { display: flex; gap: 48px; margin-top: 48px; page-break-inside: avoid; }
    .assinaturas div { flex: 1; text-align: center; font-family: Arial, sans-serif; font-size: 11px; }
    .assinaturas span { display: block; border-top: 1px solid #1F1A2E; margin-bottom: 6px; }
    .anexo { page-break-before: always; }
    table { width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; }
    td { border: 1px solid #D5CCE4; padding: 7px 10px; }
    td:first-child { width: 40%; color: #6D5E8C; }
  `
  const nomeArq = (u?.razao_social || e.empresa).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  return { corpo, estilos, nomeArquivo: `contrato-festou-${nomeArq}.pdf` }
}

export async function baixarContratoSaas(c: DadosContratada, e: DadosEmpresaContrato) {
  const { corpo, estilos, nomeArquivo } = contratoSaasHtml(c, e)
  await downloadPdf(corpo, estilos, nomeArquivo)
}
