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
  // migração 080 (implantação no Asaas)
  implantacao_status?: 'pendente' | 'vencida' | 'paga' | 'cancelada' | 'estornada' | null
  implantacao_link?: string | null
  implantacao_vencimento?: string | null
  implantacao_paga_em?: string | null
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

// ---------- Painel do Festou (migração 094) ----------

export interface Empresa {
  id: string
  name: string
  active: boolean
  created_at: string
  disabled_modules: string[]
  usuarios: number
  unidades: number
  festas: number
  festas_30d: number
  ultima_atividade: string | null
}

export interface Plano {
  id: string
  nome: string
  preco: number
  unidades_incluidas: number
  usuarios_incluidos: number | null
  unidade_adicional: number
  modulos: string[]
  destaque: boolean
  ordem: number
  ativo: boolean
  casas: number
}

export interface PlanoDaCasa {
  plano_id: string | null
  modulos_extras: string[]
  // migração 095: preço do plano + unidades a mais
  mensalidade_calculada?: number | null
  unidades_ativas?: number
}

export const dataBr = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')
export const diasSemUso = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null)
export const SEM_USO_ALERTA = 14
export const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const mesCurto = (iso: string) => `${MESES_CURTOS[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`

// Casa em teste grátis: cobrança cadastrada com início no futuro.
export function emTeste(m: Mensalidade | undefined) {
  if (!m?.cadastrada || !m.inicio) return null
  const hoje = new Date().toISOString().slice(0, 10)
  if (m.inicio <= hoje) return null
  return Math.round((new Date(`${m.inicio}T12:00:00`).getTime() - new Date(`${hoje}T12:00:00`).getTime()) / 86400000)
}

// Casa que paga: ativa, mensalidade maior que zero e fora do teste.
export function pagante(c: Empresa, m: Mensalidade | undefined) {
  return c.active && !!m?.cadastrada && Number(m.mensalidade) > 0 && emTeste(m) === null
}
