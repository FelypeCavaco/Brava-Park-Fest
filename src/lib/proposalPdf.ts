// Gera o PDF da proposta comercial desenhando ele direto como PDF de
// verdade (texto vetorial, formas, imagens), em vez de "tirar uma foto" de
// HTML/CSS como o resto do sistema faz. Esse modelo tem gradiente, emojis e
// elementos sobrepostos — exatamente o tipo de coisa que o conversor de
// HTML-pra-PDF (html2canvas) erra feio (letras grudadas, emoji fora do
// lugar). Desenhando direto, fica confiável em qualquer navegador.
// jsPDF é importada dinamicamente lá embaixo (só na hora de gerar o PDF) —
// é uma biblioteca pesada, e importar ela aqui em cima faria ela entrar no
// pacote principal do site, carregado em toda tela do sistema à toa.
import type { jsPDF } from 'jspdf'
import { currencyToWords } from './numberToWords'
import logoUrl from '../assets/logo-brava-park-fest.png'
import mascotUrl from '../assets/mascote-theo.png'

export interface ProposalPrintData {
  cliente: string
  dataEvento: string
  pacoteNome: string
  pacoteDescricao: string | null
  pacotePreco: number
  extras: { name: string; price: number }[]
  total: number
  unidadeNome: string
  unidadeEndereco: string | null
}

const COLORS = {
  purple: [109, 40, 217] as const,
  purpleDark: [76, 29, 149] as const,
  purpleLight: [244, 238, 251] as const,
  green: [124, 185, 46] as const,
  greenDark: [92, 148, 36] as const,
  greenLight: [237, 246, 221] as const,
  orange: [242, 144, 12] as const,
  ink: [36, 27, 51] as const,
  muted: [110, 104, 128] as const,
  white: [255, 255, 255] as const,
}

function currency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// Desenha o emoji isolado num canvas pequeno e devolve como imagem — bem
// mais confiável que colocar o caractere de emoji direto no texto do PDF
// (as fontes padrão do PDF não têm esses desenhos, ficaria em branco).
const emojiCache = new Map<string, string>()
function emojiImage(emoji: string): string {
  const cached = emojiCache.get(emoji)
  if (cached) return cached
  const px = 128
  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d')!
  ctx.font = `${px * 0.78}px "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(emoji, px / 2, px / 2 + px * 0.05)
  const dataUrl = canvas.toDataURL('image/png')
  emojiCache.set(emoji, dataUrl)
  return dataUrl
}

function drawEmoji(doc: jsPDF, emoji: string, x: number, y: number, size: number) {
  doc.addImage(emojiImage(emoji), 'PNG', x, y, size, size)
}

function drawGradientRect(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  bands = 36,
) {
  const bandH = h / bands
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1)
    const r = from[0] + (to[0] - from[0]) * t
    const g = from[1] + (to[1] - from[1]) * t
    const b = from[2] + (to[2] - from[2]) * t
    doc.setFillColor(r, g, b)
    doc.rect(x, y + i * bandH, w, bandH + 0.3, 'F')
  }
}

function drawStar(doc: jsPDF, cx: number, cy: number, outerR: number, innerR: number, color: readonly [number, number, number]) {
  const pts: [number, number][] = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR
    const angle = (Math.PI / 5) * i - Math.PI / 2
    pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)])
  }
  const deltas: [number, number][] = []
  for (let i = 1; i < pts.length; i++) deltas.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]])
  doc.setFillColor(...color)
  doc.lines(deltas, pts[0][0], pts[0][1], [1, 1], 'F', true)
}

export async function generateProposalPdf(p: ProposalPrintData) {
  const { jsPDF: JsPDF } = await import('jspdf')
  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const pageW = 210
  const marginX = 15
  const contentW = pageW - marginX * 2

  const [logoImg, mascotImg] = await Promise.all([loadImage(logoUrl), loadImage(mascotUrl)])

  // ---------- Header ----------
  const headerH = 56
  drawGradientRect(doc, 0, 0, pageW, headerH, COLORS.purple, COLORS.purpleDark)

  // estrelinhas decorativas
  drawStar(doc, 148, 12, 3.2, 1.4, COLORS.orange)
  drawStar(doc, 160, 8, 2, 0.9, COLORS.orange)
  drawStar(doc, 172, 14, 4, 1.8, COLORS.orange)
  drawStar(doc, 184, 9, 2.2, 1, COLORS.orange)
  drawStar(doc, 194, 15, 2.6, 1.2, COLORS.orange)

  // logo
  const logoSize = 26
  doc.addImage(logoImg, 'PNG', marginX, 10, logoSize, logoSize)

  const textX = marginX + logoSize + 8
  doc.setTextColor(...COLORS.white)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('PROPOSTA DE', textX, 17)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(26)
  doc.setTextColor(163, 230, 53) // verde-limão vibrante sobre o roxo
  doc.text('Orçamento', textX, 27)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...COLORS.white)
  doc.text('Aqui a diversão é garantida!', textX, 34)

  doc.setFontSize(8.5)
  doc.setTextColor(213, 197, 240)
  const unitLine = `${p.unidadeNome || 'Brava Park Fest'}${p.unidadeEndereco ? ' - ' + p.unidadeEndereco : ''}`
  const unitLines = doc.splitTextToSize(unitLine, 105)
  doc.text(unitLines, textX, 41)

  // mascote, sobrepondo a borda de baixo do cabeçalho
  const mascotW = 48
  const mascotH = mascotW * (mascotImg.naturalHeight / mascotImg.naturalWidth)
  doc.addImage(mascotImg, 'PNG', pageW - mascotW - 4, headerH - mascotH + 6, mascotW, mascotH)

  // ---------- Meta pills ----------
  let y = headerH + 16
  const colW = contentW / 3
  const metaCols: [string, string, string][] = [
    ['📋', 'PROPOSTA PARA', p.cliente],
    ['📅', 'DATA DO EVENTO', p.dataEvento || 'A definir'],
    ['🗓️', 'EMITIDA EM', format(new Date())],
  ]
  metaCols.forEach(([emoji, label, value], i) => {
    const cx = marginX + colW * i
    drawEmoji(doc, emoji, cx, y - 4.5, 7)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...COLORS.muted)
    doc.text(label, cx + 9, y - 3)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...COLORS.ink)
    doc.text(doc.splitTextToSize(value, colW - 11), cx + 9, y + 1.5)
  })

  y = headerH + 30

  // ---------- Pacote ----------
  doc.setFillColor(...COLORS.purple)
  doc.roundedRect(marginX, y, contentW, 8, 1.5, 1.5, 'F')
  drawEmoji(doc, '📦', marginX + 3, y + 1.2, 5.6)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...COLORS.white)
  doc.text('PACOTE', marginX + 10, y + 5.5)
  y += 12

  const descLines = p.pacoteDescricao ? doc.splitTextToSize(p.pacoteDescricao, contentW - 60) : []
  const pkgCardH = 12 + descLines.length * 4.2
  doc.setFillColor(...COLORS.purpleLight)
  doc.roundedRect(marginX, y, contentW, pkgCardH, 2, 2, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...COLORS.ink)
  doc.text(p.pacoteNome, marginX + 5, y + 8)
  if (descLines.length) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...COLORS.muted)
    doc.text(descLines, marginX + 5, y + 13.5)
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...COLORS.purple)
  doc.text(currency(p.pacotePreco), marginX + contentW - 5, y + 8, { align: 'right' })
  y += pkgCardH + 10

  // ---------- Itens extras ----------
  doc.setFillColor(...COLORS.green)
  doc.roundedRect(marginX, y, contentW, 8, 1.5, 1.5, 'F')
  drawEmoji(doc, '⭐', marginX + 3, y + 1.2, 5.6)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...COLORS.white)
  doc.text('ITENS EXTRAS', marginX + 10, y + 5.5)
  y += 12

  const extraIcons = ['🎈', '🍿', '💡', '🎵', '🎂', '✨']
  if (p.extras.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...COLORS.muted)
    doc.text('Nenhum item extra', marginX + 5, y + 3)
    y += 8
  } else {
    p.extras.forEach((extra, i) => {
      drawEmoji(doc, extraIcons[i % extraIcons.length], marginX, y - 3, 6)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(...COLORS.ink)
      doc.text(extra.name, marginX + 9, y + 1.2)
      doc.setFont('helvetica', 'bold')
      doc.text(currency(extra.price), marginX + contentW - 2, y + 1.2, { align: 'right' })
      doc.setDrawColor(230, 225, 240)
      doc.line(marginX, y + 4, marginX + contentW, y + 4)
      y += 8
    })
  }
  y += 4

  // ---------- Valor total ----------
  doc.setFillColor(...COLORS.purple)
  doc.roundedRect(marginX, y, contentW, 14, 2, 2, 'F')
  drawEmoji(doc, '🪙', marginX + 4, y + 3, 8)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...COLORS.white)
  doc.text('Valor total', marginX + 14, y + 9)
  doc.setFontSize(15)
  doc.text(currency(p.total), marginX + contentW - 5, y + 9.5, { align: 'right' })
  y += 14

  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.muted)
  doc.text(currencyToWords(p.total), marginX + contentW, y + 5, { align: 'right' })
  y += 14

  // ---------- Selos ----------
  const feats: [string, string][] = [
    ['🛡️', 'Estrutura segura e completa para sua festa'],
    ['👑', 'Equipe preparada para garantir muita diversão'],
    ['💜', 'Momentos especiais para todas as idades'],
  ]
  const featColW = contentW / 3
  feats.forEach(([emoji, text], i) => {
    const cx = marginX + featColW * i + featColW / 2
    doc.setFillColor(...COLORS.purpleLight)
    doc.circle(cx, y + 6, 7, 'F')
    drawEmoji(doc, emoji, cx - 5, y - 0.5, 10)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...COLORS.muted)
    const lines = doc.splitTextToSize(text, featColW - 8)
    doc.text(lines, cx, y + 16, { align: 'center' })
  })
  y += 32

  // validade
  const validText = `Válida até ${format(addDaysFn(7))}`
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  const validW = doc.getTextWidth(validText) + 10
  doc.setFillColor(...COLORS.purpleLight)
  doc.roundedRect(pageW / 2 - validW / 2, y, validW, 7, 3, 3, 'F')
  doc.setTextColor(...COLORS.purple)
  doc.text(validText, pageW / 2, y + 4.8, { align: 'center' })
  y += 16

  // ---------- Rodapé ----------
  // Fundo sólido (sem gradiente) — a listra de banda de cor que aparecia
  // aqui vinha do gradiente desenhado em várias faixas finas.
  const footerH = 38
  doc.setFillColor(...COLORS.purpleLight)
  doc.rect(0, y, pageW, footerH, 'F')
  const footMascotW = 34
  const footMascotH = footMascotW * (mascotImg.naturalHeight / mascotImg.naturalWidth)
  // espelhado (largura negativa = flip horizontal)
  doc.addImage(mascotImg, 'PNG', marginX + footMascotW, y + (footerH - footMascotH) / 2, -footMascotW, footMascotH)

  const footTextX = marginX + footMascotW + 8
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...COLORS.muted)
  doc.text('Obrigado por escolher a', footTextX, y + 13)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...COLORS.purple)
  doc.text('BRAVA PARK', footTextX, y + 20)
  const brandW = doc.getTextWidth('BRAVA PARK ')
  doc.setFont('helvetica', 'bolditalic')
  doc.setTextColor(...COLORS.green)
  doc.text('Fest', footTextX + brandW, y + 20)

  drawEmoji(doc, '🎉', footTextX, y + 23, 5.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.muted)
  const blurbLines = doc.splitTextToSize('Estamos prontos para transformar esse dia em uma experiência inesquecível!', contentW - footMascotW - 20)
  doc.text(blurbLines, footTextX + 7, y + 27)

  doc.save(`proposta-${p.cliente.replace(/\s+/g, '-').toLowerCase()}.pdf`)
}

function format(d: Date) {
  return d.toLocaleDateString('pt-BR')
}

function addDaysFn(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d
}
