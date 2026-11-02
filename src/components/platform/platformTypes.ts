// Painel da plataforma (migração 077): mensalidades e implantação.

export interface Mensalidade {
  company_id: string
  cadastrada: boolean
  plano: string | null
  mensalidade: number | null
  dia_vencimento: number | null
  inicio: string | null
  implantacao: number | null
  unidade_adicional: number | null
  unidades_incluidas: number | null
  usuarios_incluidos: number | null
  observacao: string | null
  proximo_vencimento: string | null
  meses_em_aberto: number
  valor_em_aberto: number
  dias_atraso: number
  situacao: 'sem_cadastro' | 'sem_cobranca' | 'atrasada' | 'vence_hoje' | 'vence_logo' | 'em_dia'
  ultimo_pagamento: string | null
  // migração 079 (Asaas)
  tolerancia_dias?: number | null
  asaas?: boolean | null
  link_pagamento?: string | null
  bloqueada?: boolean | null
}

export type ItensImplantacao = Record<string, boolean | Record<string, boolean>>

export const ITENS_AUTOMATICOS: { id: string; label: string; onde: string }[] = [
  { id: 'unidades', label: 'Unidade cadastrada', onde: 'Configurações → Unidades' },
  { id: 'dados_unidades', label: 'Dados das unidades completos', onde: 'Razão social, CNPJ, endereço e Pix de cada unidade' },
  { id: 'pacotes', label: 'Pacotes e preços', onde: 'Comercial → Pacotes e itens' },
  { id: 'contrato_base', label: 'Contrato-base das festas', onde: 'Comercial → Contratos' },
  { id: 'cardapio', label: 'Cardápio do portal', onde: 'Configurações → Unidades → Cardápio' },
  { id: 'logo', label: 'Logo da empresa', onde: 'Configurações → Empresa' },
  { id: 'whatsapp', label: 'WhatsApp da equipe', onde: 'Configurações → Empresa' },
  { id: 'avaliacao_google', label: 'Link de avaliação do Google', onde: 'Configurações → Unidades' },
  { id: 'equipe', label: 'Equipe cadastrada (além do administrador)', onde: 'Configurações → Usuários e permissões' },
  { id: 'primeira_festa', label: 'Primeira festa cadastrada', onde: 'O cliente começou a usar' },
]

export const ITENS_MANUAIS: { id: string; label: string }[] = [
  { id: 'treinamento', label: 'Treinamento da equipe feito' },
  { id: 'login_entregue', label: 'Login entregue ao cliente' },
  { id: 'contrato_assinado', label: 'Contrato do sistema assinado' },
]

export function progressoImplantacao(itens: ItensImplantacao | undefined) {
  if (!itens) return null
  const manual = (itens.manual ?? {}) as Record<string, boolean>
  const feitos = ITENS_AUTOMATICOS.filter((i) => itens[i.id] === true).length + ITENS_MANUAIS.filter((i) => manual[i.id]).length
  return { feitos, total: ITENS_AUTOMATICOS.length + ITENS_MANUAIS.length }
}
