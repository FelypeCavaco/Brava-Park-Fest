// Leitor do arquivo de extrato OFX (o formato que todo banco exporta).
// Lê só os movimentos: data, valor (positivo = entrada), descrição e o
// código do movimento no banco (FITID), que impede lançar duas vezes.

export interface MovimentoExtrato {
  id: string
  data: string // AAAA-MM-DD
  valor: number
  descricao: string
}

export interface ExtratoLido {
  movimentos: MovimentoExtrato[]
  inicio: string | null
  fim: string | null
}

// Bancos antigos gravam em Windows-1252; os novos, em UTF-8.
export function decodificarExtrato(bytes: ArrayBuffer): string {
  const cabecalho = new TextDecoder('ascii').decode(bytes.slice(0, 600))
  const latin = /CHARSET:\s*(1252|ISO-8859-1|8859-1)/i.test(cabecalho) || /encoding="(windows-1252|iso-8859-1)"/i.test(cabecalho)
  if (latin) return new TextDecoder('windows-1252').decode(bytes)
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  // sem cabeçalho e com caractere inválido em UTF-8: era Windows-1252
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8
}

function campo(bloco: string, tag: string): string {
  // OFX antigo (SGML) não fecha as tags: o valor vai até a próxima "<" ou fim da linha
  const m = bloco.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'))
  return m ? m[1].trim() : ''
}

function dataOfx(v: string): string | null {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

function valorOfx(v: string): number {
  const t = v.replace(/\s/g, '')
  // aceita "1234.56", "-1234,56" e "1.234,56"
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

function textoOfx(v: string): string {
  return v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}

export function lerOfx(texto: string): ExtratoLido {
  if (!/<OFX>/i.test(texto) || !/<STMTTRN>/i.test(texto)) {
    throw new Error('Este arquivo não parece um extrato OFX. No app do banco, exporte o extrato no formato OFX.')
  }
  const blocos = texto.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0])
  // o código do movimento é único por conta: junta o número da conta (quem tem duas contas na mesma unidade)
  const conta = campo(texto, 'ACCTID').replace(/\s/g, '')
  const vistos = new Map<string, number>()
  const movimentos: MovimentoExtrato[] = []
  for (const b of blocos) {
    const data = dataOfx(campo(b, 'DTPOSTED'))
    const valor = valorOfx(campo(b, 'TRNAMT'))
    if (!data || !valor) continue
    const nome = textoOfx(campo(b, 'NAME'))
    const memo = textoOfx(campo(b, 'MEMO'))
    const descricao = nome && memo && !memo.toLowerCase().includes(nome.toLowerCase()) && !nome.toLowerCase().includes(memo.toLowerCase())
      ? `${memo} ${nome}`
      : (memo.length >= nome.length ? memo : nome) || textoOfx(campo(b, 'TRNTYPE'))
    let id = campo(b, 'FITID')
    if (!id) {
      // banco sem código do movimento: usa data + valor + descrição (+ quantas vezes repetiu)
      const base = `${data}|${valor}|${descricao}`
      const n = (vistos.get(base) ?? 0) + 1
      vistos.set(base, n)
      id = `sem-codigo|${base}|${n}`
    }
    movimentos.push({ id: conta ? `${conta}:${id}` : id, data, valor, descricao })
  }
  if (movimentos.length === 0) throw new Error('O arquivo não tem nenhum movimento no período.')
  const datas = movimentos.map((m) => m.data).sort()
  return { movimentos, inicio: datas[0], fim: datas[datas.length - 1] }
}
