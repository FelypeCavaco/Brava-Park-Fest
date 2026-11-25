import { brl } from './format'
import { cronometro, horaMin, idadeTexto, nomeForma } from './recreacao'

// Impressão da recreação (entrada e saída). Imprime por um quadro escondido, sem abrir
// janela nova (o navegador não bloqueia). Serve para cupom de 58 mm, de 80 mm ou folha A4.

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const dataHora = (d: Date | string) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export type Papel = '58' | '80' | 'a4'
export const papelDe = (impressora: unknown): Papel | null => (impressora === '58' || impressora === '80' || impressora === 'a4' ? impressora : null)

function estilo(p: Papel) {
  const a4 = p === 'a4'
  const largura = p === '58' ? '48mm' : p === '80' ? '72mm' : '180mm'
  const base = a4 ? 14 : 12
  return `<style>
  *{box-sizing:border-box}
  body{font:${base}px/1.45 ${a4 ? 'system-ui,Arial,sans-serif' : 'monospace'};margin:0;padding:${a4 ? '0' : '6px'};width:${largura};color:#000}
  h1{font-size:${a4 ? 22 : 14}px;margin:0 0 2px}
  h2{font-size:${a4 ? 16 : 12}px;margin:${a4 ? 18 : 8}px 0 4px;text-transform:uppercase}
  .sub{font-size:${a4 ? 13 : 11}px;margin:0 0 ${a4 ? 12 : 6}px}
  .pagina{page-break-after:always;padding-bottom:${a4 ? 0 : 6}px}.pagina:last-child{page-break-after:auto}
  .caixa{border-top:1px dashed #000;margin-top:${a4 ? 10 : 6}px;padding-top:${a4 ? 8 : 5}px}
  .linha{display:flex;justify-content:space-between;gap:8px}
  .total{border-top:1px solid #000;margin-top:4px;padding-top:4px;font-weight:bold}
  .cod{font-size:${a4 ? 34 : 22}px;font-weight:bold;letter-spacing:4px}
  .aviso{font-weight:bold}
  .termo{white-space:pre-wrap;text-align:justify;margin:6px 0}
  .assina{margin-top:${a4 ? 48 : 30}px;border-top:1px solid #000;padding-top:3px;text-align:center}
  img.qr{display:block;margin:6px auto 0}
  @media print{@page{margin:${a4 ? '14mm' : '2mm'}}}
  </style>`
}

// Manda o HTML para a impressora por um quadro escondido.
export function imprimirHtml(titulo: string, corpo: string, papel: Papel) {
  const f = document.createElement('iframe')
  f.setAttribute('aria-hidden', 'true')
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(f)
  const w = f.contentWindow!
  w.document.open()
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(titulo)}</title>${estilo(papel)}${corpo}`)
  w.document.close()
  const lancar = () => { try { w.focus(); w.print() } finally { setTimeout(() => f.remove(), 60000) } }
  // espera as imagens (QR) carregarem
  const imgs = Array.from(w.document.images)
  if (!imgs.length || imgs.every((i) => i.complete)) setTimeout(lancar, 100)
  else { let falta = imgs.filter((i) => !i.complete).length; const ok = () => { if (--falta <= 0) lancar() }; imgs.forEach((i) => { if (!i.complete) { i.onload = ok; i.onerror = ok } }) }
}

// ---------- entrada ----------
export interface DadosEntrada {
  casa: string; papel: Papel; imprimeTermo: boolean; termo: string
  responsavel: string; cpf?: string | null; telefone?: string | null
  entradaEm: string; codigo?: string | null; link?: string | null; qr?: string
  criancas: { nome: string; nascimento: string; cuidados: string | null; pulseira: string | null; plano: string; ate: string | null }[]
}

export function imprimirEntrada(d: DadosEntrada) {
  const crianca = (c: DadosEntrada['criancas'][number]) => `<div class="caixa"><b>${esc(c.nome)}</b> (${esc(idadeTexto(c.nascimento))})<br>`
    + `${c.pulseira ? `Pulseira: <b>${esc(c.pulseira)}</b><br>` : ''}Plano: ${esc(c.plano)}`
    + `${c.ate ? `<br>Tempo combinado até: <b>${esc(horaMin(c.ate))}</b>` : ''}`
    + `${c.cuidados ? `<br><span class="aviso">Alergias e cuidados: ${esc(c.cuidados)}</span>` : ''}</div>`

  // via 1: termo de responsabilidade, fica com a CASA
  const termo = d.imprimeTermo ? `<div class="pagina">
    <h1>${esc(d.casa)}</h1><p class="sub">TERMO DE RESPONSABILIDADE · via da casa</p>
    <div>Responsável: <b>${esc(d.responsavel)}</b>${d.cpf ? `<br>CPF: ${esc(d.cpf)}` : ''}${d.telefone ? `<br>Telefone: ${esc(d.telefone)}` : ''}<br>Entrada: ${esc(dataHora(d.entradaEm))}</div>
    <h2>Crianças</h2>${d.criancas.map(crianca).join('')}
    <h2>Termo</h2><div class="termo">${esc(d.termo)}</div>
    <div class="assina">Assinatura do responsável</div>
  </div>` : ''

  // via 2: entrada, fica com o RESPONSÁVEL para a retirada
  const via = `<div class="pagina">
    <h1>${esc(d.casa)}</h1><p class="sub">VIA DE ENTRADA · guarde para a retirada</p>
    <div>Responsável: <b>${esc(d.responsavel)}</b><br>Entrada: <b>${esc(dataHora(d.entradaEm))}</b></div>
    ${d.criancas.map(crianca).join('')}
    ${d.codigo ? `<div class="caixa" style="text-align:center">Código de retirada<br><span class="cod">${esc(d.codigo)}</span><br>A criança só sai com este código.${d.qr ? `<img class="qr" src="${d.qr}" width="${d.papel === 'a4' ? 140 : 110}" height="${d.papel === 'a4' ? 140 : 110}" alt="QR">` : ''}</div>` : ''}
  </div>`
  imprimirHtml('Entrada na recreação', termo + via, d.papel)
}

// ---------- saída ----------
export interface DadosSaida {
  casa: string; papel: Papel; saidaEm: string; responsavel: string; buscou?: string | null
  criancas: {
    nome: string; entradaEm: string; tempoSeg: number; plano: string
    linhas: { d: string; v: number }[]; itens: { d: string; v: number }[]
    desconto: number; descontoRotulo?: string; acrescimo: number; acrescimoRotulo?: string
    total: number; pagoEntrada: number; pagoAgora: number; forma?: string | null
  }[]
}

export function imprimirSaida(d: DadosSaida) {
  const l = (a: string, b: string) => `<div class="linha"><span>${esc(a)}</span><span>${esc(b)}</span></div>`
  const corpo = `<div class="pagina"><h1>${esc(d.casa)}</h1><p class="sub">COMPROVANTE DE SAÍDA · recreação</p>
    <div>Responsável: <b>${esc(d.responsavel)}</b>${d.buscou ? `<br>Retirou: ${esc(d.buscou)}` : ''}<br>Saída: <b>${esc(dataHora(d.saidaEm))}</b></div>`
    + d.criancas.map((c) => `<div class="caixa"><b>${esc(c.nome)}</b><br>Entrada: ${esc(horaMin(c.entradaEm))} · Saída: ${esc(horaMin(d.saidaEm))}<br>Tempo cobrado: ${esc(cronometro(c.tempoSeg))}<br>Plano: ${esc(c.plano)}`
      + c.linhas.map((x) => l(x.d, brl(Number(x.v)))).join('')
      + c.itens.map((x) => l(x.d, brl(Number(x.v)))).join('')
      + (c.desconto > 0 ? l(c.descontoRotulo ?? 'Desconto', `-${brl(c.desconto)}`) : '')
      + (c.acrescimo > 0 ? l(c.acrescimoRotulo ?? 'Acréscimo', `+${brl(c.acrescimo)}`) : '')
      + `<div class="linha total"><span>Total</span><span>${esc(brl(c.total))}</span></div>`
      + (c.pagoEntrada > 0 ? l('Pago na entrada', `-${brl(c.pagoEntrada)}`) : '')
      + l(`Pago agora${c.forma && c.pagoAgora > 0 ? ` (${nomeForma(c.forma)})` : ''}`, brl(c.pagoAgora))
      + `</div>`).join('')
    + (d.criancas.length > 1 ? `<div class="linha total" style="margin-top:8px"><span>Total pago agora</span><span>${esc(brl(d.criancas.reduce((s, c) => s + c.pagoAgora, 0)))}</span></div>` : '')
    + `<p class="sub" style="margin-top:10px">Obrigado pela visita!</p></div>`
  imprimirHtml('Saída da recreação', corpo, d.papel)
}
