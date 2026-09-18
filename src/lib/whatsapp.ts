// Ações de WhatsApp: por enquanto geram uma mensagem pronta e abrem o
// WhatsApp Web/app para o próprio usuário enviar (sem integração com API
// oficial ainda). Ver README para o plano de automação futura.

export const MESSAGE_TEMPLATES = {
  orcamento: 'Olá, {{cliente}}! Segue o orçamento da sua festa em {{data}} na unidade {{unidade}}, no valor de {{valor}}. Qualquer dúvida estamos à disposição!',
  lembrete_pagamento: 'Olá, {{cliente}}! Passando para lembrar que há um pagamento pendente de {{valor}} referente à sua festa em {{data}}. Qualquer dúvida, estamos à disposição.',
  confirmar_festa: 'Olá, {{cliente}}! Sua festa está confirmada para {{data}} às {{horario}}, na unidade {{unidade}}. Contamos com você!',
  lembrete_festa: 'Olá, {{cliente}}! Passando para lembrar que sua festa é em breve, dia {{data}} às {{horario}}. Nos vemos lá!',
  localizacao: 'Olá, {{cliente}}! Segue a localização da unidade {{unidade}} para a sua festa no dia {{data}}.',
  pedir_avaliacao: 'Olá, {{cliente}}! Esperamos que a festa tenha sido incrível! Pode nos contar como foi sua experiência? Se puder, deixe também uma avaliação no Google, é rapidinho: {{link}}',
  avaliacao_pos_festa: 'Olá, {{cliente}}! Esperamos que a festa de ontem tenha sido inesquecível! 🎉 Poderia nos contar como foi sua experiência? Se puder, deixe também uma avaliação no Google, é rapidinho: {{link}}',
  reativacao: 'Olá, {{cliente}}! Faz um tempinho que vocês fizeram uma festa aqui com a gente. Já pensaram em comemorar o próximo aniversário conosco? Temos condições especiais para quem já é cliente!',
  lista_convidados: 'Olá, {{cliente}}! Para agilizar a organização da sua festa, envie a lista de convidados por este link, quando puder: {{link}}',
  vaga_disponivel: 'Olá, {{cliente}}! Surgiu uma vaga disponível na unidade {{unidade}} pertinho da data que você tinha interesse ({{data}}). Quer aproveitar? É só responder aqui!',
  // Fica editável de verdade pela tela (tabela message_templates) — isto
  // aqui é só o texto de reserva, usado se a migration 035 ainda não rodou.
  confirmar_fornecedores:
    'Olá Pessoal, tudo certo?\n\nPassando para lembrar que a entrega de hoje do BOLO, DOCINHOS, SALGADINHOS E PRATOS QUENTE está programada para as {{horario_entrega}}\n\nTEMA: {{tema}}\n\n{{aniversariante_idade}}\n\nOBS: {{observacao}}',
} as const

// TODO: trocar pelo link real de avaliação do Google Meu Negócio da casa de
// festas (Google Business Profile > Compartilhar perfil > link de avaliação).
export const GOOGLE_REVIEW_LINK = 'https://g.page/r/SEU-LINK-DE-AVALIACAO/review'

export type MessageTemplateKey = keyof typeof MESSAGE_TEMPLATES

export const MESSAGE_TEMPLATE_LABEL: Record<MessageTemplateKey, string> = {
  orcamento: 'Enviar orçamento',
  lembrete_pagamento: 'Lembrete de pagamento',
  confirmar_festa: 'Confirmar festa',
  lembrete_festa: 'Lembrete da festa',
  localizacao: 'Enviar localização',
  pedir_avaliacao: 'Pedir avaliação',
  avaliacao_pos_festa: 'Avaliação pós-festa',
  reativacao: 'Contato de reativação',
  lista_convidados: 'Pedir lista de convidados',
  vaga_disponivel: 'Avisar vaga disponível',
  confirmar_fornecedores: 'Confirmar com fornecedores',
}

export function buildMessage(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '')
}

export function openWhatsApp(phone: string | null, message: string) {
  const digits = (phone ?? '').replace(/\D/g, '')
  const withCountry = digits.length > 0 ? (digits.startsWith('55') ? digits : `55${digits}`) : ''
  const url = withCountry ? `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`
  window.open(url, '_blank')
}

// O WhatsApp não deixa abrir um GRUPO já existente com uma mensagem
// pré-escrita (isso só funciona com número avulso via wa.me) — por isso,
// pra grupos, copia a mensagem pronta pra área de transferência e abre o
// link do grupo junto; só falta colar lá dentro.
export async function copyMessageAndOpenGroup(groupLink: string, message: string) {
  try {
    await navigator.clipboard.writeText(message)
  } catch {
    // navegador sem permissão de clipboard — a pessoa ainda consegue ver a
    // mensagem no histórico de contato e copiar manualmente
  }
  window.open(groupLink, '_blank')
}
