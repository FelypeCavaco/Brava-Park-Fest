// Recreação (migração 100): formatos dos planos de cobrança, modelos prontos e
// a lista de funções que o administrador geral liga/desliga por casa.
// O CÁLCULO da cobrança não fica aqui: é feito no banco (rec_simular /
// rec_calcular), para a conta ser sempre a mesma em qualquer tela.

export interface Faixa {
  ate: number | null // null = sem limite (só a última)
  valor: number
  tol: number
  depois: 'avanca' | 'trava'
}

export interface RegraRec {
  nome: string
  cobranca: 'entrada' | 'saida'
  modelo: 'faixas' | 'blocos'
  arred: 'seg' | 'min_ini' | 'min_comp'
  pausa: boolean
  limite: number // 0 = sem limite
  limiteAcao: 'alertar' | 'bloquear' | 'autorizacao'
  // pago na entrada
  valor: number
  incl: number | null // null = sem limite de tempo (diária)
  tolIncl: number
  depois: 'excedente' | 'trava'
  exc: { modelo: 'faixas' | 'blocos'; faixas: Faixa[]; B: number; Vb: number; tolCada: number; teto: number }
  // pago na saída
  faixas: Faixa[]
  V0: number
  M0: number
  tol: number
  Vb: number
  B: number
  tolCada: number
  teto: number
}

export interface PlanoRec {
  id: string
  nome: string
  descricao: string | null
  ativo: boolean
  ordem: number
  regra: RegraRec
  versao: number
  atualizado_em: string
  atualizado_por: string | null
}

export interface ItemRec { id: string; nome: string; preco: number; ativo: boolean; ordem: number }

export interface ResultadoCalc { s: number; total: number; linhas: { d: string; v: number }[]; expl: string[] }
export interface Simulacao {
  regra: RegraRec
  validacao: { erros: string[]; avisos: string[] }
  frase: string
  calc?: ResultadoCalc
  pontos?: { nome: string; s: number; conta: number; total: number; expl: string | null }[]
}

const faixasPadrao: Faixa[] = [
  { ate: 30, valor: 25, tol: 5, depois: 'avanca' },
  { ate: null, valor: 35, tol: 0, depois: 'avanca' },
]

export const REGRA_BASE: RegraRec = {
  nome: '', cobranca: 'saida', modelo: 'faixas', arred: 'min_ini', pausa: true, limite: 0, limiteAcao: 'alertar',
  valor: 35, incl: 60, tolIncl: 10, depois: 'excedente',
  exc: { modelo: 'faixas', faixas: [{ ate: 15, valor: 8, tol: 0, depois: 'avanca' }, { ate: null, valor: 15, tol: 0, depois: 'avanca' }], B: 15, Vb: 8, tolCada: 0, teto: 0 },
  faixas: faixasPadrao, V0: 25, M0: 30, tol: 5, Vb: 8, B: 15, tolCada: 0, teto: 0,
}

const copia = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

// Pontos de partida. Tudo pode ser mudado depois.
export const MODELOS: { id: string; titulo: string; resumo: string; regra: RegraRec }[] = [
  {
    id: 'hora',
    titulo: 'Hora fechada',
    resumo: 'Paga 1 hora na entrada. Passou da tolerância, cobra o excedente na saída.',
    regra: { ...copia(REGRA_BASE), nome: '1 hora', cobranca: 'entrada', valor: 35, incl: 60, tolIncl: 10, depois: 'excedente', limite: 240,
      exc: { modelo: 'faixas', faixas: [{ ate: 15, valor: 8, tol: 0, depois: 'avanca' }, { ate: 30, valor: 14, tol: 0, depois: 'avanca' }, { ate: 45, valor: 20, tol: 0, depois: 'avanca' }, { ate: null, valor: 25, tol: 0, depois: 'avanca' }], B: 15, Vb: 8, tolCada: 0, teto: 0 } },
  },
  {
    id: 'faixas',
    titulo: 'Faixas de tempo',
    resumo: 'Paga na saída. O tempo total escolhe uma faixa, e o valor dela é o total.',
    regra: { ...copia(REGRA_BASE), nome: 'Por faixas', cobranca: 'saida', modelo: 'faixas',
      faixas: [{ ate: 30, valor: 25, tol: 5, depois: 'avanca' }, { ate: 60, valor: 35, tol: 10, depois: 'avanca' }, { ate: 120, valor: 50, tol: 5, depois: 'avanca' }, { ate: null, valor: 60, tol: 0, depois: 'avanca' }] },
  },
  {
    id: 'blocos',
    titulo: 'Meia hora + blocos',
    resumo: 'Paga na saída: um valor pela primeira meia hora e mais um tanto a cada 15 minutos.',
    regra: { ...copia(REGRA_BASE), nome: 'Por tempo', cobranca: 'saida', modelo: 'blocos', V0: 25, M0: 30, tol: 5, Vb: 8, B: 15, tolCada: 0, teto: 70 },
  },
  {
    id: 'diaria',
    titulo: 'Diária',
    resumo: 'Paga na entrada e brinca o dia inteiro, sem contar tempo.',
    regra: { ...copia(REGRA_BASE), nome: 'Diária', cobranca: 'entrada', valor: 70, incl: null, tolIncl: 0, pausa: false },
  },
]

export const ARREDONDAMENTO: [RegraRec['arred'], string][] = [
  ['min_ini', 'Arredonda para o minuto começado (60:01 conta 61 min)'],
  ['min_comp', 'Conta só minutos completos (60:59 conta 60 min)'],
  ['seg', 'Tempo exato, em segundos'],
]

export const ACAO_LIMITE: [RegraRec['limiteAcao'], string][] = [
  ['alertar', 'Só avisa no painel'],
  ['bloquear', 'Não deixa estender além'],
  ['autorizacao', 'Precisa do gerente para passar'],
]

// ---------- Funções da recreação (só o administrador geral muda) ----------
export type FuncoesRec = Record<string, boolean | number | string>

export type CampoFuncao =
  | { k: string; label: string; tipo: 'bool' }
  | { k: string; label: string; tipo: 'num'; sufixo: string }
  | { k: string; label: string; tipo: 'hora' }
  | { k: string; label: string; tipo: 'opcao'; opcoes: [string, string][] }

export const FUNCOES_REC: { grupo: string; itens: CampoFuncao[] }[] = [
  { grupo: 'Cadastro das famílias', itens: [
    { k: 'autocadastro', label: 'Autocadastro por QR (o responsável preenche no celular e a recepção confere)', tipo: 'bool' },
  ] },
  { grupo: 'Segurança na entrega', itens: [
    { k: 'codigo', label: 'Pedir o código de retirada na saída', tipo: 'bool' },
    { k: 'qr', label: 'QR code de retirada (no WhatsApp e no cupom)', tipo: 'bool' },
    { k: 'foto', label: 'Foto da criança', tipo: 'opcao', opcoes: [['nao', 'Não tirar foto'], ['cadastro', 'Tirar uma vez, no cadastro'], ['entrada', 'Tirar a cada entrada']] },
    { k: 'fotoObrig', label: 'Foto obrigatória para dar entrada', tipo: 'bool' },
    { k: 'fotoDias', label: 'Apagar a foto de cada entrada depois de', tipo: 'num', sufixo: 'dias' },
  ] },
  { grupo: 'Página do responsável', itens: [
    { k: 'paginaPais', label: 'Mandar o link da página do responsável', tipo: 'bool' },
    { k: 'pedirTempo', label: 'Botão “Pedir mais tempo”', tipo: 'bool' },
    { k: 'chegando', label: 'Botão “Estou chegando” (avisa a recepção)', tipo: 'bool' },
    { k: 'ocorrPais', label: 'Mostrar as ocorrências na página do responsável', tipo: 'bool' },
  ] },
  { grupo: 'Ocorrências com as crianças', itens: [
    { k: 'ocorr', label: 'Registrar ocorrências (machucado, briga, mal-estar…)', tipo: 'bool' },
    { k: 'ocorrCiente', label: 'O responsável confirma que está ciente na saída', tipo: 'bool' },
  ] },
  { grupo: 'Caixa', itens: [
    { k: 'caixaObrig', label: 'Só dar entrada com o caixa aberto', tipo: 'bool' },
    { k: 'cego', label: 'Fechamento cego (o atendente conta antes de ver o esperado)', tipo: 'bool' },
    { k: 'lembrete', label: 'Lembrete para fechar o caixa', tipo: 'bool' },
    { k: 'horaFecha', label: 'Fim do expediente', tipo: 'hora' },
    { k: 'lembreteMin', label: 'Avisar antes do fim', tipo: 'num', sufixo: 'min' },
    { k: 'troca', label: 'Trocar de atendente sem fechar o caixa', tipo: 'bool' },
    { k: 'trocaConta', label: 'Na troca, contar o dinheiro da gaveta', tipo: 'bool' },
  ] },
  { grupo: 'Internet', itens: [
    { k: 'offline', label: 'Continuar funcionando sem internet (guarda no aparelho e envia depois)', tipo: 'bool' },
  ] },
]

// "1 hora", "2 horas", "1h30", "45 min"
export function fmtMin(m: number | null) {
  if (m == null) return 'sem limite'
  if (m === 60) return '1 hora'
  if (m > 60 && m % 60 === 0) return `${m / 60} horas`
  const h = Math.floor(m / 60), r = Math.round(m % 60)
  return h ? `${h}h${String(r).padStart(2, '0')}` : `${r} min`
}

// 4925 -> "1:22:05"
export function relogio(seg: number) {
  const s = Math.max(0, Math.floor(seg))
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// ---------- Famílias (migração 102) ----------
export interface CriancaRec { id?: string; nome: string; nascimento: string; cuidados: string | null; foto_path?: string | null; ativo: boolean }
export interface AutorizadoRec { id?: string; nome: string; documento: string | null; parentesco: string | null; ativo: boolean }
export interface FamiliaRec {
  id?: string; responsavel: string; cpf: string | null; telefone: string | null; email: string | null
  imagem_autorizada: boolean; termo_aceito_em?: string | null; termo_registrado_por?: string | null; observacoes: string | null
  origem?: string; criado_em?: string; criado_por?: string | null; atualizado_em?: string; atualizado_por?: string | null
  criancas: CriancaRec[]; autorizados: AutorizadoRec[]
}
export interface Parecida { id: string; responsavel: string; cpf: string | null; telefone: string | null; criancas: string[]; motivos: string[]; bloqueia: boolean }

export const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')
export function mascaraCpf(s: string | null | undefined) {
  const d = soDigitos(s).slice(0, 11)
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4')
}
export function mascaraTelefone(s: string | null | undefined) {
  const d = soDigitos(s).slice(0, 11)
  if (d.length <= 2) return d.length ? `(${d}` : ''
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}
export function cpfValido(s: string | null | undefined) {
  const d = soDigitos(s)
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
  for (const k of [9, 10]) {
    let soma = 0
    for (let i = 0; i < k; i++) soma += Number(d[i]) * (k + 1 - i)
    const r = soma % 11
    if ((r < 2 ? 0 : 11 - r) !== Number(d[k])) return false
  }
  return true
}
// idade em anos (ou meses, para bebês)
export function idadeTexto(nasc: string) {
  if (!nasc) return ''
  const [y, m, d] = nasc.split('-').map(Number)
  const h = new Date()
  let anos = h.getFullYear() - y
  if (h.getMonth() + 1 < m || (h.getMonth() + 1 === m && h.getDate() < d)) anos--
  if (anos >= 1) return `${anos} ${anos === 1 ? 'ano' : 'anos'}`
  const meses = Math.max(0, (h.getFullYear() - y) * 12 + h.getMonth() + 1 - m - (h.getDate() < d ? 1 : 0))
  return `${meses} ${meses === 1 ? 'mês' : 'meses'}`
}
export function idadeAnos(nasc: string) {
  const [y, m, d] = nasc.split('-').map(Number)
  const h = new Date()
  let anos = h.getFullYear() - y
  if (h.getMonth() + 1 < m || (h.getMonth() + 1 === m && h.getDate() < d)) anos--
  return anos
}

// ---------- Visitas (migração 103) ----------
export interface ContaRec { s: number; total: number; linhas: { d: string; v: number }[]; expl: string[] }
export interface VisitaRec {
  id: string; grupo: string; unit_id: string; pulseira: string | null; entrada_em: string; entrada_por: string | null
  crianca: { id: string; nome: string; nascimento: string; cuidados: string | null; foto_path: string | null }
  familia: { id: string; responsavel: string; telefone: string | null }
  plano: { nome: string; cobranca: 'entrada' | 'saida'; incl: number | null; tolIncl: number | null; valor: number | null; limite: number | null; limiteAcao: string | null; pausa: boolean }
  extensao_min: number; pago_entrada: number; forma_entrada: string | null; excecao: string | null
  seg_total: number; seg_cobrado: number
  pausa: { inicio: string; motivo: string; por: string | null } | null
  conta: ContaRec; proxima: { em: number; total: number } | null
  ocorrencias: { id: string; tipo: string; descricao: string; providencia: string | null; em: string; por: string | null }[]
  chegando_em: string | null; pedido_min: number | null; pedido_em: string | null
  agora: string
}

// Página do responsável (link no WhatsApp e QR da retirada)
export const linkPais = (token: string) => `${window.location.origin}/r/${token}`
// Autocadastro: o QR da casa leva a esta página
export const linkCadastro = (token: string) => `${window.location.origin}/cadastro/${token}`
// O leitor de QR (ou o leitor de mesa que "digita") entrega o link: aqui sai só o token.
export function tokenDoTexto(t: string): string | null {
  return t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0].toLowerCase() ?? null
}
export const FORMAS_REC: [string, string][] = [['pix', 'Pix'], ['cartao_debito', 'Débito'], ['cartao_credito', 'Crédito'], ['dinheiro', 'Dinheiro']]
export const nomeForma = (f: string | null | undefined) => FORMAS_REC.find((x) => x[0] === f)?.[1] ?? f ?? ''

// "52:13" ou "1:05:22"
export function cronometro(seg: number) {
  const s = Math.max(0, Math.floor(seg)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m).padStart(2, '0')) + ':' + String(x).padStart(2, '0')
}
export const horaMin = (d: Date | number | string) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
// Link do WhatsApp com a mensagem pronta
export function linkWhatsApp(telefone: string | null | undefined, texto: string) {
  let d = soDigitos(telefone)
  if (d.length === 10 || d.length === 11) d = '55' + d
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`
}
