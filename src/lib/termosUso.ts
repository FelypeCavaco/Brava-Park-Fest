// Termos de Uso e Política de Privacidade do Festou. Cada pessoa das casas
// clientes aceita a versão atual antes de usar o sistema (migração 083).
// Mudou o texto de forma importante? Troque TERMOS_VERSAO: todos aceitam de novo.

export const TERMOS_VERSAO = '2026-11-09'
export const TERMOS_DATA = '9 de novembro de 2026'

export interface Fornecedor {
  nome?: string | null
  documento?: string | null
  endereco?: string | null
  email?: string | null
  whatsapp?: string | null
  foro?: string | null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function termosHtml(f: Fornecedor): string {
  const quem = f.nome
    ? `${esc(f.nome)}${f.documento ? `, CPF/CNPJ ${esc(f.documento)}` : ''}${f.endereco ? `, com endereço em ${esc(f.endereco)}` : ''}`
    : 'o responsável pelo Festou indicado no contrato'
  const contato = [f.email && `e-mail ${esc(f.email)}`, f.whatsapp && `WhatsApp ${esc(f.whatsapp)}`].filter(Boolean).join(' ou ') || 'os contatos informados no contrato'
  const foro = esc(f.foro || 'Itajaí/SC')

  return `
<h1>Termos de Uso e Política de Privacidade do Festou</h1>
<p class="sub">Versão de ${TERMOS_DATA}</p>

<p>Estes Termos explicam as regras para usar o Festou, um sistema de gestão para casas de festas, e como cuidamos dos dados. O Festou é oferecido por ${quem} ("Festou", "nós"). Ao clicar em "Li e aceito", você concorda com estes Termos. Se não concordar, não use o sistema.</p>

<h2>1. Quem usa o Festou</h2>
<p>1.1. O Festou é contratado por uma casa de festas (a "Casa"), por meio de um contrato próprio. Estes Termos valem para todas as pessoas que entram no sistema pela Casa: donos, gerentes e funcionários ("Usuários").</p>
<p>1.2. Se algo nestes Termos for diferente do contrato assinado com a Casa, vale o contrato.</p>

<h2>2. O que o Festou faz</h2>
<p>2.1. O Festou ajuda a Casa a organizar agenda, clientes, festas, propostas, contratos, pagamentos, financeiro, estoque, equipe, relatórios e o portal das famílias.</p>
<p>2.2. Algumas funções fazem sugestões ou lançamentos automáticos, como gerar um QR code de Pix, calcular parcelas ou preparar lembretes de cobrança. Elas facilitam o trabalho, mas a Casa deve conferir o que é lançado. O Festou não é banco, não recebe nem guarda dinheiro da Casa ou das famílias.</p>

<h2>3. Sua conta</h2>
<p>3.1. Cada pessoa tem o seu próprio login. Não compartilhe a sua senha. Tudo o que for feito com o seu login é responsabilidade sua e da Casa.</p>
<p>3.2. Quem administra a Casa no sistema cria e desativa os logins da equipe, e define o que cada perfil pode ver e fazer. Quando alguém sair da equipe, o acesso deve ser desativado.</p>
<p>3.3. Se perceber uso estranho da sua conta, troque a senha e avise o administrador da Casa e o Festou.</p>

<h2>4. O que é permitido e o que não é</h2>
<p>4.1. Use o Festou só para administrar a Casa, de forma lícita.</p>
<p>4.2. Não é permitido: (a) tentar acessar dados de outras casas ou partes do sistema sem permissão; (b) copiar, revender ou repassar o acesso ao sistema; (c) usar o sistema para enviar mensagens abusivas, spam ou conteúdo ilegal; (d) cadastrar dados de pessoas sem uma razão legítima; (e) tentar derrubar, invadir ou sobrecarregar o sistema.</p>
<p>4.3. Se houver uso proibido, o Festou pode suspender o acesso do Usuário ou da Casa, avisando o motivo.</p>

<h2>5. Responsabilidade pelo conteúdo</h2>
<p>5.1. A Casa responde pelo que cadastra e envia: contratos, preços, regras, cobranças, multas e juros, mensagens às famílias, chave Pix e taxas da maquininha. Cabe à Casa conferir se isso está correto e de acordo com a lei, em especial com o Código de Defesa do Consumidor.</p>

<h2>6. Pagamento, suspensão e cancelamento</h2>
<p>6.1. Mensalidade, prazos, suspensão por atraso e cancelamento seguem o contrato da Casa. Durante uma suspensão, os dados continuam guardados.</p>

<h2>7. Funcionamento e suporte</h2>
<p>7.1. Buscamos manter o Festou funcionando o tempo todo, mas podem acontecer paradas para manutenção ou falhas de internet e de fornecedores. Manutenções planejadas são avisadas com antecedência sempre que possível.</p>
<p>7.2. O suporte é feito por ${contato}, nos horários do contrato.</p>
<p>7.3. O sistema pode mudar para melhorar. Não retiraremos funções essenciais do plano da Casa sem aviso de pelo menos 30 dias.</p>

<h2>8. Propriedade</h2>
<p>8.1. O Festou, a marca, as telas e o código são nossos. A Casa recebe uma licença de uso enquanto o contrato estiver em vigor.</p>
<p>8.2. Os dados cadastrados pela Casa são da Casa. Ela pode exportá-los a qualquer momento pelo próprio sistema.</p>

<h2>9. Privacidade e proteção de dados (LGPD)</h2>
<p><b>9.1. Quem é responsável pelos dados.</b> Os dados que a Casa cadastra sobre seus clientes, convidados, crianças e funcionários são controlados pela Casa, que decide como usá-los. O Festou é operador: trata esses dados só para fazer o sistema funcionar e conforme as instruções da Casa. Para os dados da sua própria conta (nome, e-mail, registros de acesso), o Festou é o controlador.</p>
<p><b>9.2. Quais dados tratamos.</b> (a) Da sua conta: nome, e-mail, perfil de acesso e a data em que aceitou estes Termos. (b) Cadastrados pela Casa: dados de clientes e famílias (nome, telefone, e-mail, CPF, endereço, data de nascimento), das crianças aniversariantes (nome e idade), listas de convidados, festas, pagamentos, comprovantes, contratos, documentos, avaliações e dados da equipe. (c) Técnicos: endereço IP, navegador, data e hora de acesso e registros de alterações feitas no sistema.</p>
<p><b>9.3. Para que usamos.</b> Para oferecer o sistema e o suporte, manter a segurança, separar os dados de cada Casa, fazer cópias de segurança, cobrar a mensalidade da Casa e cumprir obrigações legais. Não vendemos dados, não usamos os dados da Casa para publicidade e não entramos em contato com os clientes da Casa.</p>
<p><b>9.4. Com quem compartilhamos.</b> Só com os fornecedores necessários para o sistema funcionar: hospedagem do banco de dados e dos arquivos (Supabase), hospedagem do site (Cloudflare), cobrança da mensalidade da Casa (Asaas) e envio de e-mails do sistema. Esses fornecedores podem guardar dados em servidores fora do Brasil, com proteções compatíveis com a LGPD. Também podemos fornecer dados quando a lei ou uma ordem judicial exigir.</p>
<p><b>9.5. Segurança.</b> Usamos login e senha, conexão criptografada, separação entre as casas, permissões por perfil, registro de alterações e cópias de segurança. Se houver um incidente de segurança que possa trazer risco, a Casa será avisada em até 48 horas depois que soubermos, para que ela possa avisar quem for preciso.</p>
<p><b>9.6. Por quanto tempo guardamos.</b> Enquanto o contrato da Casa estiver em vigor. Quando terminar, seguimos o contrato: a Casa pode pedir a cópia dos dados e depois eles são excluídos. Os registros de acesso são guardados por pelo menos 6 meses, como exige o Marco Civil da Internet (Lei nº 12.965/2014).</p>
<p><b>9.7. Crianças.</b> O sistema guarda o nome e a idade da criança aniversariante para organizar a festa. A Casa deve tratar esses dados no melhor interesse da criança e com a autorização de um dos pais ou responsável (art. 14 da LGPD).</p>
<p><b>9.8. Portal das famílias.</b> Cada festa tem um link privado do portal, que a Casa envia à família. Quem tiver o link vê os dados daquela festa, por isso ele deve ser enviado só ao responsável. Se um link for parar com a pessoa errada, a Casa deve falar com o suporte para trocá-lo.</p>
<p><b>9.9. Seus direitos.</b> Você pode pedir acesso, correção ou exclusão dos dados da sua conta pelos nossos contatos. Os clientes e convidados da Casa devem fazer os pedidos à própria Casa, que é a responsável pelos dados deles. Nós ajudamos a Casa a atender esses pedidos.</p>
<p><b>9.10. Armazenamento no navegador.</b> O Festou guarda no seu navegador só o necessário para funcionar, como manter você conectado e lembrar preferências de tela. Não usamos cookies de propaganda.</p>
<p><b>9.11. Contato sobre dados pessoais.</b> Dúvidas e pedidos sobre privacidade: ${contato}.</p>

<h2>10. Disponibilidade do sistema e limitação de responsabilidade</h2>
<p>10.1. O Festou é disponibilizado "no estado em que se encontra" e conforme sua disponibilidade. Embora empregue esforços razoáveis para mantê-lo em funcionamento contínuo, o Festou não garante que o sistema operará de forma ininterrupta, livre de erros, falhas ou lentidão.</p>
<p>10.2. O sistema poderá ficar indisponível, lento ou apresentar comportamento inesperado, total ou parcialmente, em razão de, entre outros: (a) volume elevado de acessos ou uso simultâneo por muitos usuários; (b) manutenções, atualizações e correções, programadas ou emergenciais; (c) falhas, instabilidades ou interrupções de serviços de terceiros, como provedores de hospedagem, banco de dados, internet, energia, envio de mensagens e meios de pagamento; (d) ataques cibernéticos, acessos indevidos e outras ações maliciosas de terceiros; (e) caso fortuito ou força maior. Nessas hipóteses, o Festou não será responsável por prejuízos decorrentes da indisponibilidade, lentidão ou falha.</p>
<p>10.3. O Festou é uma ferramenta de apoio à gestão. Cálculos, totais, relatórios, projeções, sugestões, lembretes, mensagens, códigos Pix e demais informações geradas pelo sistema dependem dos dados cadastrados pela Casa e devem ser conferidos por ela antes de qualquer decisão, cobrança, pagamento ou envio a terceiros. As decisões tomadas com base no sistema são de responsabilidade exclusiva da Casa.</p>
<p>10.4. O Festou não se responsabiliza por erros, prejuízos ou perdas decorrentes de: (a) dados incorretos, incompletos ou desatualizados informados pela Casa ou por seus clientes, como valores, datas, chave Pix, taxas e dados de contato; (b) uso indevido do sistema ou em desacordo com estes Termos; (c) compartilhamento de senhas ou acesso por pessoas autorizadas pela Casa; (d) falhas em aparelhos, navegadores ou na conexão de internet do Usuário; (e) serviços de terceiros acessados a partir do sistema, como WhatsApp, bancos e instituições de pagamento.</p>
<p>10.5. Identificado erro no funcionamento do sistema, o Festou se compromete a corrigi-lo em até 14 (catorze) dias úteis, contados da comunicação feita pela Casa pelos canais de suporte. A correção do erro é a única obrigação do Festou nessa hipótese.</p>
<p>10.6. Na máxima extensão permitida pela legislação, o Festou não responderá por danos indiretos, lucros cessantes, perda de receita, perda de chance ou danos à imagem.</p>
<p>10.7. Recomenda-se que a Casa exporte seus dados periodicamente, pela função de exportação disponível no sistema, mantendo cópia própria das informações essenciais ao seu negócio.</p>

<h2>11. Mudanças nestes Termos</h2>
<p>11.1. Podemos atualizar estes Termos. Quando a mudança for importante, mostraremos a nova versão no sistema e será preciso aceitar de novo para continuar usando. A versão em vigor fica sempre disponível no sistema.</p>

<h2>12. Lei e foro</h2>
<p>12.1. Estes Termos seguem as leis do Brasil. Fica eleito o foro da comarca de ${foro}, salvo quando a lei garantir outro foro.</p>
`
}

export const termosEstilos = `
  .pdf-body { font-family: Georgia, 'Times New Roman', serif; color: #1F1A2E; padding: 48px 56px; font-size: 12px; line-height: 1.6; }
  h1 { font-size: 18px; text-align: center; margin: 0 0 4px; }
  .sub { text-align: center; color: #6D5E8C; font-family: Arial, sans-serif; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; margin: 0 0 20px; }
  h2 { font-size: 12.5px; text-transform: uppercase; color: #59239B; margin: 16px 0 6px; page-break-after: avoid; }
  p { margin: 0 0 8px; text-align: justify; }
`
