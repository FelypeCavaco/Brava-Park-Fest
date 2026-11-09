import { supabase } from '../../lib/supabaseClient'
import type { Empresa, ItensImplantacao, Mensalidade, Plano, PlanoDaCasa } from './platformTypes'

// Tudo o que as páginas do painel do Festou usam em comum.

export interface CopiaExcluida {
  id: string
  nome: string
  excluida_em: string
  arquivos: number
  logins: number
  tamanho_kb: number
}

export interface PainelDados {
  carregando: boolean
  empresas: Empresa[]
  mensalidades: Record<string, Mensalidade>
  implantacao: Record<string, ItensImplantacao>
  planos: Plano[]
  planosDaCasa: Record<string, PlanoDaCasa>
  copias: CopiaExcluida[]
  // a migração 094 ainda não rodou: planos, financeiro, interessados e avisos ficam indisponíveis
  sem094: boolean
  recarregar: () => Promise<void>
  abrirEmpresa: (id: string) => Promise<void>
  abrindo: string | null
  novaCasa: (dados?: { empresa?: string; admin_nome?: string; email?: string }, depois?: () => void) => void
  setErro: (msg: string | null) => void
}

// Erro de regra da função de servidor volta no corpo da resposta (status 400).
export async function erroDaFuncao(data: unknown, err: unknown, padrao: string): Promise<string | null> {
  let msg: string | null = (data as { error?: string } | null)?.error ?? null
  if (err && !msg) {
    try {
      const corpo = await (err as { context?: Response }).context?.json()
      msg = corpo?.error ?? null
    } catch {
      // sem corpo legível
    }
    msg = msg ?? padrao
  }
  return msg
}

// Baixa a cópia guardada de uma empresa excluída (arquivo .json com todos os dados).
export async function baixarCopia(id: string, nome: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('platform_deleted_company_copy', { p_id: id })
  if (error || !data) return 'Não foi possível baixar a cópia. Tente de novo em Configurações → Cópias de casas excluídas.'
  const slug = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `copia-${slug}-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
  return null
}

// Senha provisória fácil de ditar (o cliente troca depois).
export function senhaProvisoria() {
  const letras = 'abcdefghjkmnpqrstuvwxyz'
  const r = (n: number) => Array.from({ length: n }, () => letras[Math.floor(Math.random() * letras.length)]).join('')
  return `${r(4)}-${Math.floor(1000 + Math.random() * 9000)}-${r(4)}`
}

// Link do WhatsApp com mensagem pronta (número só com dígitos; sem DDI, usa o do Brasil).
export function linkWhatsApp(numero: string | null | undefined, texto: string) {
  let d = (numero ?? '').replace(/\D/g, '')
  if (!d) return null
  if (d.length <= 11) d = `55${d}`
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`
}

export const normalizarPlano = (p: Record<string, unknown>): Plano => ({
  ...(p as unknown as Plano),
  preco: Number(p.preco),
  unidade_adicional: Number(p.unidade_adicional),
  modulos: (p.modulos as string[] | null) ?? [],
  casas: Number(p.casas ?? 0),
})
