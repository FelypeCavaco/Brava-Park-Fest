// Gráficos do relatório financeiro, desenhados em canvas e entregues como imagem PNG
// (o Excel recebe a imagem; não precisa de nenhum serviço de fora).

export interface FatiaPizza { nome: string; valor: number }
export interface SerieLinha { nome: string; cor: string; valores: number[] }
export interface Grafico { buffer: ArrayBuffer; largura: number; altura: number }

const CORES = ['#59239B', '#2E7D57', '#E0A100', '#B23A3A', '#2F6FB5', '#C2185B', '#00897B', '#8D6E63', '#9E9E9E']
const TINTA = '#2B2140'
const SUAVE = '#6D5E8C'
const GRADE = '#E5E0EF'
const FONTE = 'Arial, Helvetica, sans-serif'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brlCurto = (v: number) => (Math.abs(v) >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`)

function novoCanvas(largura: number, altura: number) {
  const escala = 2 // desenha em dobro para ficar nítido no Excel
  const canvas = document.createElement('canvas')
  canvas.width = largura * escala
  canvas.height = altura * escala
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Não foi possível desenhar o gráfico.')
  ctx.scale(escala, escala)
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, largura, altura)
  return { canvas, ctx }
}

function paraPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? b.arrayBuffer().then(resolve, reject) : reject(new Error('Sem imagem'))), 'image/png')
  })
}

function cortar(ctx: CanvasRenderingContext2D, texto: string, maxLargura: number) {
  if (ctx.measureText(texto).width <= maxLargura) return texto
  let t = texto
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxLargura) t = t.slice(0, -1)
  return `${t}…`
}

// Pizza por categoria: as maiores aparecem separadas e o resto vira "Outras".
export async function graficoPizza(titulo: string, itens: FatiaPizza[], largura = 760, altura = 340): Promise<Grafico | null> {
  const positivos = itens.filter((i) => i.valor > 0).sort((a, b) => b.valor - a.valor)
  const total = positivos.reduce((s, i) => s + i.valor, 0)
  if (positivos.length === 0 || total <= 0) return null
  const fatias = positivos.length > 8 ? [...positivos.slice(0, 7), { nome: 'Outras', valor: positivos.slice(7).reduce((s, i) => s + i.valor, 0) }] : positivos

  const { canvas, ctx } = novoCanvas(largura, altura)
  ctx.fillStyle = TINTA
  ctx.font = `bold 16px ${FONTE}`
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(titulo, 20, 28)
  ctx.fillStyle = SUAVE
  ctx.font = `12px ${FONTE}`
  ctx.fillText(`Total: ${brl(total)}`, 20, 48)

  const cx = 160
  const cy = 60 + (altura - 60) / 2
  const raio = Math.min(130, (altura - 80) / 2)
  let ang = -Math.PI / 2
  fatias.forEach((f, i) => {
    const arco = (f.valor / total) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, raio, ang, ang + arco)
    ctx.closePath()
    ctx.fillStyle = CORES[i % CORES.length]
    ctx.fill()
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 2
    ctx.stroke()
    if (f.valor / total >= 0.06) {
      const meio = ang + arco / 2
      ctx.fillStyle = '#FFFFFF'
      ctx.font = `bold 12px ${FONTE}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(`${Math.round((f.valor / total) * 100)}%`, cx + Math.cos(meio) * raio * 0.62, cy + Math.sin(meio) * raio * 0.62)
    }
    ang += arco
  })

  // legenda: cor, categoria, valor e porcentagem
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const x0 = cx + raio + 40
  const linha = Math.min(26, (altura - 70) / fatias.length)
  const y0 = 66
  fatias.forEach((f, i) => {
    const y = y0 + i * linha + linha / 2
    ctx.fillStyle = CORES[i % CORES.length]
    ctx.fillRect(x0, y - 6, 12, 12)
    ctx.fillStyle = TINTA
    ctx.font = `13px ${FONTE}`
    const pct = `${((f.valor / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
    const direita = `${brl(f.valor)}  ·  ${pct}`
    const larguraDireita = ctx.measureText(direita).width
    ctx.fillText(cortar(ctx, f.nome, largura - x0 - 30 - larguraDireita - 16), x0 + 20, y)
    ctx.textAlign = 'right'
    ctx.fillStyle = SUAVE
    ctx.fillText(direita, largura - 16, y)
    ctx.textAlign = 'left'
  })
  return { buffer: await paraPng(canvas), largura, altura }
}

// Linhas (uma por série) ao longo de datas ou meses.
export async function graficoLinhas(titulo: string, rotulos: string[], series: SerieLinha[], largura = 900, altura = 360): Promise<Grafico | null> {
  const todos = series.flatMap((s) => s.valores)
  if (rotulos.length === 0 || todos.every((v) => v === 0)) return null
  const { canvas, ctx } = novoCanvas(largura, altura)
  ctx.fillStyle = TINTA
  ctx.font = `bold 16px ${FONTE}`
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(titulo, 20, 28)

  // legenda no canto direito do título
  let xl = largura - 20
  ctx.font = `13px ${FONTE}`
  ctx.textBaseline = 'middle'
  for (const s of [...series].reverse()) {
    const w = ctx.measureText(s.nome).width
    xl -= w
    ctx.fillStyle = TINTA
    ctx.textAlign = 'left'
    ctx.fillText(s.nome, xl, 24)
    xl -= 22
    ctx.fillStyle = s.cor
    ctx.fillRect(xl, 18, 16, 4)
    xl -= 22
  }

  const esq = 84
  const dir = 24
  const topo = 54
  const base = altura - 52
  const maxV = Math.max(...todos, 1)
  const passo = (() => {
    const bruto = maxV / 5
    const pot = Math.pow(10, Math.floor(Math.log10(bruto)))
    const n = bruto / pot
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pot
  })()
  const topoV = Math.ceil(maxV / passo) * passo
  const x = (i: number) => esq + (rotulos.length === 1 ? (largura - esq - dir) / 2 : (i / (rotulos.length - 1)) * (largura - esq - dir))
  const y = (v: number) => base - (v / topoV) * (base - topo)

  ctx.textAlign = 'right'
  ctx.font = `11px ${FONTE}`
  for (let v = 0; v <= topoV + passo / 2; v += passo) {
    ctx.strokeStyle = GRADE
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(esq, y(v))
    ctx.lineTo(largura - dir, y(v))
    ctx.stroke()
    ctx.fillStyle = SUAVE
    ctx.fillText(brlCurto(v), esq - 8, y(v))
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const cada = Math.max(1, Math.ceil(rotulos.length / 12))
  rotulos.forEach((r, i) => {
    if (i % cada === 0) {
      ctx.fillStyle = SUAVE
      ctx.fillText(r, x(i), base + 8)
    }
  })

  for (const s of series) {
    ctx.strokeStyle = s.cor
    ctx.lineWidth = 2.5
    ctx.lineJoin = 'round'
    ctx.beginPath()
    s.valores.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))))
    ctx.stroke()
    if (rotulos.length <= 45) {
      ctx.fillStyle = s.cor
      s.valores.forEach((v, i) => {
        ctx.beginPath()
        ctx.arc(x(i), y(v), 3, 0, Math.PI * 2)
        ctx.fill()
      })
    }
  }
  return { buffer: await paraPng(canvas), largura, altura }
}
