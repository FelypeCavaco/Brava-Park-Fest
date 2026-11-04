// Lê o extrato do banco em qualquer formato que o banco exporta: OFX,
// planilha (CSV, Excel, ODS) ou PDF. Tudo vira a mesma lista de movimentos
// (data, valor com sinal, descrição e um código para não lançar duas vezes).
//
// OFX traz o código de cada movimento. Nos outros formatos o código é
// montado com data + valor + descrição (+ quantas vezes repetiu no arquivo):
// enviar o mesmo arquivo de novo não duplica, e o mesmo movimento vindo em
// outro formato o sistema avisa como "possível duplicado" (migração 081).

import { decodificarExtrato, lerOfx, type ExtratoLido, type MovimentoExtrato } from './ofx'

export type FormatoExtrato = 'OFX' | 'planilha' | 'PDF'

export interface ExtratoArquivo extends ExtratoLido {
  formato: FormatoExtrato
}

export const ACEITOS = '.ofx,.qfx,.csv,.txt,.xlsx,.xls,.ods,.pdf'

type Celula = string | number | boolean | Date | null | undefined

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const iso = (y: number, m: number, d: number) =>
  y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null

const MESES: Record<string, number> = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 }

// ---------- Datas e valores escritos de vários jeitos ----------
export function lerData(c: Celula, anoPadrao: number): string | null {
  if (c instanceof Date) {
    if (isNaN(c.getTime())) return null
    // meio-dia evita que o fuso horário volte um dia
    const d = new Date(c.getTime() + 12 * 3600 * 1000)
    return iso(d.getFullYear(), d.getMonth() + 1, d.getDate())
  }
  if (typeof c === 'number') {
    if (c > 20000 && c < 80000) { // número de série de data do Excel
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(c) * 86400000)
      return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
    }
    return null
  }
  if (typeof c !== 'string') return null
  const t = sem(c)
  let m = t.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = t.match(/(?:^|\D)(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?!\d)/)
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1])
  m = t.match(/(?:^|\D)(\d{1,2})\s*(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?(?:\s*(?:de\s+)?(\d{4}))?/)
  if (m) return iso(m[3] ? +m[3] : anoPadrao, MESES[m[2]], +m[1])
  m = t.match(/^(\d{1,2})\/(\d{1,2})(?!\/?\d)/)
  if (m) return iso(anoPadrao, +m[2], +m[1])
  return null
}

export function lerValor(c: Celula): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? Math.round(c * 100) / 100 : null
  if (typeof c !== 'string') return null
  let t = c.trim()
  if (!t || !/\d/.test(t)) return null
  let neg = false
  if (/\(.*\)/.test(t)) neg = true
  if (/^-|^\(|-\s*r?\$|\$-|-$/i.test(t.replace(/\s/g, ''))) neg = true
  if (/\bD$/i.test(t)) neg = true
  t = t.replace(/r\$|[()+\s]|[CD]$/gi, '').replace(/-/g, '')
  if (!/^[\d.,]+$/.test(t)) return null
  const ultPonto = t.lastIndexOf('.'), ultVirg = t.lastIndexOf(',')
  let n: number
  if (ultPonto >= 0 && ultVirg >= 0) n = ultVirg > ultPonto ? +t.replace(/\./g, '').replace(',', '.') : +t.replace(/,/g, '')
  else if (ultVirg >= 0) n = /^\d{1,3}(,\d{3})+$/.test(t) ? +t.replace(/,/g, '') : +t.replace(',', '.')
  else if (ultPonto >= 0) n = /^\d{1,3}(\.\d{3})+$/.test(t) ? +t.replace(/\./g, '') : +t
  else n = +t
  if (!Number.isFinite(n)) return null
  return Math.round((neg ? -n : n) * 100) / 100
}

const ehSaldo = (desc: string) => /^saldo\b|saldo (do dia|anterior|final|inicial|disponivel|em conta|bloqueado)|^total\b/.test(sem(desc))

// Linhas de resumo do PDF, que não são movimentos: totais do mês ("Setembro
// 2026 ... Entradas: R$ 10.000,00 • Saídas: R$ 39.006,45"), o período do
// extrato ("01/09/2026 a 30/09/2026") e cabeçalhos com totais.
const MES_ANO = /\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(de\s+)?\d{4}\b/
function ehResumo(linha: string, desc: string): boolean {
  const l = sem(linha)
  const d = sem(desc).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (/\bentradas?\b/.test(l) && /\bsaidas?\b/.test(l)) return true
  if (/^(total|totais|resumo|periodo|extrato|movimentacoes|lancamentos)\b/.test(d)) return true
  // só o rótulo de um total ("Entradas", "Saídas do mês"), sem descrição de movimento
  if (/^(total de )?(entradas?|saidas?|creditos?|debitos?)( (do|no) (mes|periodo|dia))?$/.test(d)) return true
  if (MES_ANO.test(l) && d.replace(MES_ANO, '').replace(/[^a-z]/g, '').length < 6) return true
  // duas datas completas na linha = período ("01/09/2026 a 30/09/2026")
  if ((linha.match(/\d{1,2}\/\d{1,2}\/\d{4}/g) ?? []).length >= 2) return true
  return false
}

function comCodigos(lista: Omit<MovimentoExtrato, 'id'>[]): MovimentoExtrato[] {
  const vistos = new Map<string, number>()
  return lista.map((m) => {
    const base = `${m.data}|${m.valor.toFixed(2)}|${sem(m.descricao).replace(/[^a-z0-9]+/g, ' ').trim()}`
    const n = (vistos.get(base) ?? 0) + 1
    vistos.set(base, n)
    return { ...m, id: `arq|${base}|${n}` }
  })
}

function resumo(movimentos: MovimentoExtrato[], formato: FormatoExtrato): ExtratoArquivo {
  if (movimentos.length === 0) {
    throw new Error(formato === 'PDF'
      ? 'Não encontramos movimentos neste PDF. Se ele for uma foto/imagem do extrato, baixe em OFX ou planilha.'
      : 'Não encontramos movimentos neste arquivo. Confira se é o extrato da conta (com data, descrição e valor).')
  }
  const datas = movimentos.map((m) => m.data).sort()
  return { movimentos, inicio: datas[0], fim: datas[datas.length - 1], formato }
}

// ---------- Planilha (CSV, Excel, ODS) ----------
export function lerTabela(linhas: Celula[][]): MovimentoExtrato[] {
  const ano = new Date().getFullYear()
  const txt = (c: Celula) => (c instanceof Date ? '' : String(c ?? '').trim())
  const cab = (c: Celula) => sem(txt(c))

  // 1) linha de títulos: tem "data" e alguma coluna de valor
  let h = -1
  for (let i = 0; i < Math.min(linhas.length, 40); i++) {
    const r = linhas[i].map(cab)
    if (r.some((c) => /^data|\bdata\b/.test(c) && c.length < 30) && r.some((c) => /valor|credito|debito|entrada|saida|montante|quantia|r\$/.test(c) && !/saldo/.test(c))) { h = i; break }
  }

  let colData = -1, colValor = -1, colCred = -1, colDeb = -1, colTipo = -1
  let colsDesc: number[] = []
  if (h >= 0) {
    const r = linhas[h].map(cab)
    colData = r.findIndex((c) => /^data( (do )?(lancamento|movimento|transacao|operacao))?$/.test(c))
    if (colData < 0) colData = r.findIndex((c) => /^data|\bdata\b/.test(c))
    r.forEach((c, i) => {
      if (i === colData || /saldo/.test(c)) return
      if (/^(tipo|natureza|d\/c|c\/d|operacao|entrada\/saida)$/.test(c)) colTipo = i
      else if (/credito|entrada|recebid/.test(c)) colCred = i
      else if (/debito|saida|pago|enviad/.test(c)) colDeb = i
      else if (/valor|montante|quantia|r\$|importe/.test(c)) { if (colValor < 0) colValor = i }
      else if (/descri|histor|lancamento|detalhe|memo|titulo|nome|favorecido|origem|destino|observ|complemento|estabelecimento|identifica|pagador|recebedor|contraparte/.test(c)) colsDesc.push(i)
    })
  } else {
    // 2) sem títulos: descobre pelas células (coluna de datas, de valores e o texto mais longo)
    const amostra = linhas.slice(0, 200)
    const largura = Math.max(0, ...amostra.map((r) => r.length))
    const conta = (i: number, f: (c: Celula) => boolean) => amostra.filter((r) => f(r[i])).length
    let melhor = 0
    for (let i = 0; i < largura; i++) { const n = conta(i, (c) => !!lerData(c, ano)); if (n > melhor) { melhor = n; colData = i } }
    for (let i = 0; i < largura && colValor < 0; i++) {
      if (i !== colData && conta(i, (c) => lerValor(c) !== null && !lerData(c, ano)) >= melhor * 0.6) colValor = i
    }
    let maior = 0
    for (let i = 0; i < largura; i++) {
      if (i === colData || i === colValor) continue
      const tam = amostra.reduce((s, r) => s + (lerValor(r[i]) === null ? txt(r[i]).length : 0), 0)
      if (tam > maior) { maior = tam; colsDesc = [i] }
    }
  }
  if (colData < 0 || (colValor < 0 && colCred < 0 && colDeb < 0)) {
    throw new Error('Não encontramos as colunas de data e valor nesta planilha. Confira se é o extrato da conta.')
  }
  if (colsDesc.length === 0) {
    const usadas = new Set([colData, colValor, colCred, colDeb, colTipo])
    const largura = Math.max(0, ...linhas.map((r) => r.length))
    for (let i = 0; i < largura; i++) if (!usadas.has(i)) colsDesc.push(i)
  }

  const lista: Omit<MovimentoExtrato, 'id'>[] = []
  for (const r of linhas.slice(h + 1)) {
    const data = lerData(r[colData], ano)
    if (!data) continue
    const descricao = colsDesc.map((i) => txt(r[i])).filter((s) => s && lerValor(s) === null).join(' ').replace(/\s+/g, ' ').trim()
    if (ehSaldo(descricao)) continue
    let valor: number | null = null
    if (colValor >= 0) valor = lerValor(r[colValor])
    if ((valor === null || valor === 0) && (colCred >= 0 || colDeb >= 0)) {
      const cr = colCred >= 0 ? lerValor(r[colCred]) ?? 0 : 0
      const db = colDeb >= 0 ? lerValor(r[colDeb]) ?? 0 : 0
      valor = Math.abs(cr) - Math.abs(db)
    }
    if (valor === null || valor === 0) continue
    if (colTipo >= 0 && valor > 0 && /^(d\b|deb|said|envi|pag)/.test(cab(r[colTipo]))) valor = -valor
    lista.push({ data, valor: Math.round(valor * 100) / 100, descricao })
  }
  return comCodigos(lista)
}

// separador mais usado na primeira linha com conteúdo
function separador(texto: string): string {
  const linha = texto.split(/\r?\n/).find((l) => l.trim()) ?? ''
  const n = (c: string) => linha.split(c).length - 1
  return [';', '\t', ',', '|'].sort((a, b) => n(b) - n(a))[0]
}

async function lerPlanilha(arquivo: File, texto: string | null): Promise<MovimentoExtrato[]> {
  const XLSX = await import('xlsx')
  const wb = texto !== null
    ? XLSX.read(texto, { type: 'string', raw: true, FS: separador(texto) })
    : XLSX.read(await arquivo.arrayBuffer(), { type: 'array', cellDates: true })
  // a aba com mais movimentos (alguns bancos põem um resumo na primeira)
  let melhor: MovimentoExtrato[] = []
  let erro: unknown = null
  for (const nome of wb.SheetNames) {
    const linhas = XLSX.utils.sheet_to_json<Celula[]>(wb.Sheets[nome], { header: 1, raw: true, defval: null, blankrows: false })
    try { const m = lerTabela(linhas); if (m.length > melhor.length) melhor = m } catch (e) { erro = e }
  }
  if (melhor.length === 0 && erro) throw erro
  return melhor
}

// ---------- PDF (lido pelo texto da página) ----------
const DINHEIRO = /\(?[-+−]?\s?(?:R\$\s?)?[-+−]?\s?\d{1,3}(?:\.\d{3})*,\d{2}\)?(?:\s?[CD](?![a-zA-Z]))?/g

export function lerLinhasPdf(linhas: string[]): MovimentoExtrato[] {
  // ano do extrato: o mais comum entre as datas completas do documento
  const anos = new Map<number, number>()
  for (const l of linhas) for (const m of l.matchAll(/\d{1,2}\/\d{1,2}\/(\d{4})/g)) anos.set(+m[1], (anos.get(+m[1]) ?? 0) + 1)
  const ano = [...anos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? new Date().getFullYear()

  const lista: Omit<MovimentoExtrato, 'id'>[] = []
  let dataAtual: string | null = null
  let textoSolto: string[] = []
  for (const bruta of linhas) {
    const l = bruta.replace(/−/g, '-').replace(/\s+/g, ' ').trim()
    if (!l) continue
    const dataLinha = lerData(l.slice(0, 40), ano)
    if (dataLinha) dataAtual = dataLinha
    const valores = [...l.matchAll(DINHEIRO)].map((m) => m[0])
    let desc = l.replace(DINHEIRO, ' ')
      .replace(/\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
      .replace(/\b\d{1,2}\s*(?:de\s+)?(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?(?:\s*(?:de\s+)?\d{4})?/gi, ' ')
      .replace(/R\$/g, ' ').replace(/\s+/g, ' ').trim()
    if (ehSaldo(desc) || /^saldo/i.test(l) || ehResumo(l, desc)) { textoSolto = []; continue }
    if (valores.length === 0) {
      if (dataLinha && !desc) textoSolto = [] // título de um novo dia
      // linha de títulos da tabela ("Data Descrição Valor Saldo") não é descrição
      if (desc && desc.length < 120 && !/descri|histor/.test(sem(desc))) textoSolto.push(desc)
      if (textoSolto.length > 3) textoSolto.shift()
      continue
    }
    if (!dataAtual) { textoSolto = []; continue }
    // com valor e saldo na mesma linha, o valor é o penúltimo
    const bruto = valores.length >= 2 ? valores[valores.length - 2] : valores[0]
    let valor = lerValor(bruto)
    if (valor === null || valor === 0) continue
    // descrição que começou nas linhas de cima (ex.: "Compra no débito" / "MERCADO ABC R$ 89,90")
    // (só quando a linha do valor não tem data própria: com data, a descrição está nela)
    if ((!dataLinha || !desc) && textoSolto.length && textoSolto.length <= 2) desc = [...textoSolto, desc].join(' ').trim()
    textoSolto = []
    // sem descrição de verdade (ex.: só "a"), não é um movimento
    if (!desc || ehSaldo(desc) || sem(desc).replace(/[^a-z]/g, '').length < 3) continue
    // sem sinal no número: decide pelas palavras da linha
    if (valor > 0 && !/^[(+-]|[CD]$/.test(bruto.trim())) {
      const s = sem(desc)
      if (/enviad|pagamento|pagto|pgto|compra|debito|saida|tarifa|saque|transferencia para|pix para/.test(s) && !/recebid|estorno|credito|deposito/.test(s)) valor = -valor
    }
    lista.push({ data: dataAtual, valor, descricao: desc })
  }
  return comCodigos(lista)
}

// PDF protegido por senha (alguns bancos usam o CPF/CNPJ): a tela pede a senha.
export class PdfComSenha extends Error {
  senhaErrada: boolean
  constructor(senhaErrada: boolean) {
    super(senhaErrada ? 'Senha do PDF incorreta. Tente de novo.' : 'Este PDF tem senha. Digite a senha para abrir.')
    this.senhaErrada = senhaErrada
  }
}

async function lerPdf(arquivo: File, senha?: string): Promise<MovimentoExtrato[]> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  let doc
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()), ...(senha ? { password: senha } : {}) }).promise
  } catch (e) {
    if ((e as { name?: string })?.name === 'PasswordException') throw new PdfComSenha(!!senha)
    throw new Error('Não foi possível abrir este PDF. Tente baixar o extrato em OFX ou planilha.')
  }
  const linhas: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const conteudo = await (await doc.getPage(p)).getTextContent()
    // junta os pedaços de texto que estão na mesma altura da página
    const porLinha = new Map<number, { x: number; s: string }[]>()
    for (const it of conteudo.items as { str: string; transform: number[] }[]) {
      if (!it.str?.trim()) continue
      const y = Math.round(it.transform[5] / 3)
      const lista = porLinha.get(y) ?? porLinha.get(y - 1) ?? porLinha.get(y + 1) ?? []
      lista.push({ x: it.transform[4], s: it.str })
      if (!porLinha.has(y) && !porLinha.has(y - 1) && !porLinha.has(y + 1)) porLinha.set(y, lista)
    }
    for (const y of [...porLinha.keys()].sort((a, b) => b - a)) {
      linhas.push(porLinha.get(y)!.sort((a, b) => a.x - b.x).map((i) => i.s).join(' '))
    }
  }
  return lerLinhasPdf(linhas)
}

// ---------- Entrada única ----------
export async function lerExtrato(arquivo: File, senha?: string): Promise<ExtratoArquivo> {
  const nome = arquivo.name.toLowerCase()
  const ext = nome.slice(nome.lastIndexOf('.') + 1)
  if (ext === 'pdf') return resumo(await lerPdf(arquivo, senha), 'PDF')
  if (['xlsx', 'xls', 'ods'].includes(ext)) return resumo(await lerPlanilha(arquivo, null), 'planilha')
  const texto = decodificarExtrato(await arquivo.arrayBuffer())
  if (/<OFX>/i.test(texto)) return { ...lerOfx(texto), formato: 'OFX' }
  if (['ofx', 'qfx'].includes(ext)) return { ...lerOfx(texto), formato: 'OFX' } // mostra o erro de OFX
  return resumo(await lerPlanilha(arquivo, texto), 'planilha')
}
