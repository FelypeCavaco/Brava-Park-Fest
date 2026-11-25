import { supabase } from './supabaseClient'
import type { FamiliaRec, PlanoRec } from './recreacao'

// Entrada sem internet (versão segura): a entrada fica numa fila neste aparelho,
// com a hora real e o código de retirada, e é enviada quando o sinal volta.
// A saída continua exigindo internet (a conta é sempre a do servidor).
// Só guardamos o necessário para dar entrada: nada de CPF, e-mail ou endereço.

export interface ItemFila {
  local: string
  unit: string
  familia: string
  criancas: { crianca: string; plano: string; pulseira: string; forma: string | null; pagamentos?: { forma: string; valor: number }[]; excecao: string | null }[]
  entrada_em: string
  codigo: string
  token: string
  responsavel: string
  nomes: string[]
  criado: number
  erro?: string
}

const chaveFila = (emp: string) => `rec_fila_${emp}`
const chaveCache = (emp: string) => `rec_cache_${emp}`
const VALIDADE_CACHE = 24 * 3600 * 1000

function ler<T>(k: string, padrao: T): T {
  try { const t = localStorage.getItem(k); return t ? (JSON.parse(t) as T) : padrao } catch { return padrao }
}
function gravar(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* sem espaço ou bloqueado */ } }

export const filaLer = (emp: string) => ler<ItemFila[]>(chaveFila(emp), [])
export function filaSalvar(emp: string, f: ItemFila[]) { gravar(chaveFila(emp), f); window.dispatchEvent(new Event('rec-fila')) }
export function filaAdd(emp: string, item: ItemFila) { filaSalvar(emp, [...filaLer(emp), item]) }

// ---------- cópia mínima para dar entrada sem sinal ----------
interface Cache { em: number; familias: FamiliaRec[]; planos: PlanoRec[] }
const lerCache = (emp: string): Cache => {
  const c = ler<Cache>(chaveCache(emp), { em: 0, familias: [], planos: [] })
  return Date.now() - c.em > VALIDADE_CACHE ? { em: 0, familias: [], planos: [] } : c
}
export function cacheFamilias(emp: string, fs: FamiliaRec[]) {
  const c = lerCache(emp)
  const limpa = (f: FamiliaRec): FamiliaRec => ({
    id: f.id, responsavel: f.responsavel, cpf: null, telefone: f.telefone, email: null, imagem_autorizada: false, observacoes: null,
    termo_aceito_em: f.termo_aceito_em,
    criancas: f.criancas.map((x) => ({ id: x.id, nome: x.nome, nascimento: x.nascimento, cuidados: x.cuidados, foto_path: x.foto_path, ativo: x.ativo })),
    autorizados: [],
  })
  const mapa = new Map(c.familias.map((f) => [f.id, f]))
  for (const f of fs) if (f.id) mapa.set(f.id, limpa(f))
  gravar(chaveCache(emp), { ...c, em: Date.now(), familias: [...mapa.values()].slice(-200) })
}
export function cachePlanos(emp: string, planos: PlanoRec[]) { gravar(chaveCache(emp), { ...lerCache(emp), em: Date.now(), planos }) }
export const cachePlanosLer = (emp: string) => lerCache(emp).planos
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export function cacheBuscar(emp: string, texto: string): FamiliaRec[] {
  const t = norm(texto.trim()), d = texto.replace(/\D/g, '')
  const todas = lerCache(emp).familias
  if (!t) return todas.slice(-8).reverse()
  return todas.filter((f) =>
    norm(f.responsavel).includes(t) || f.criancas.some((c) => norm(c.nome).includes(t)) || (d.length >= 3 && (f.telefone ?? '').includes(d))).slice(0, 8)
}

// ---------- ajudantes ----------
export const ehErroDeRede = (msg: string | undefined | null) => /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout/i.test(msg ?? '')

export function codigoLocal(usados: string[]) {
  for (let i = 0; i < 50; i++) {
    const c = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
    if (!usados.includes(c)) return c
  }
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0')
}

let enviando = false
// Manda a fila. Para quando a rede cai; entradas recusadas pelo servidor ficam marcadas com o motivo.
export async function filaEnviar(emp: string): Promise<{ enviadas: number; comProblema: number; semRede: boolean }> {
  if (enviando) return { enviadas: 0, comProblema: 0, semRede: false }
  enviando = true
  let enviadas = 0, semRede = false
  try {
    for (const item of filaLer(emp)) {
      const { error } = await supabase.rpc('rec_entrada_offline', {
        p_local: item.local, p_unit: item.unit, p_familia: item.familia, p_criancas: item.criancas,
        p_entrada_em: item.entrada_em, p_codigo: item.codigo, p_token: item.token,
      })
      if (error && ehErroDeRede(error.message)) { semRede = true; break }
      const atual = filaLer(emp)
      if (!error) { enviadas++; filaSalvar(emp, atual.filter((x) => x.local !== item.local)) }
      else filaSalvar(emp, atual.map((x) => (x.local === item.local ? { ...x, erro: error.message } : x)))
    }
  } finally { enviando = false }
  return { enviadas, comProblema: filaLer(emp).filter((x) => x.erro).length, semRede }
}
