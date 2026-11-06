// Gera o PDF e o Excel do relatório financeiro a partir de DadosRelatorio.

import { downloadPdf } from './pdfExport'
import {
  brl, dataBr, nomeMesLongo, veredito, explicacaoResultado, explicacaoCaixa, explicacaoPonte,
  somaPorCategoria, PONTE_TEXTO, GLOSSARIO, type DadosRelatorio, type Lancamento,
} from './relatorioFinanceiro'

const LOGO = '/marca/festou.png'

function esc(s: unknown) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
// O que o relatório mostra e o que NÃO entra no lucro, com os valores do período.
function escopo(d: DadosRelatorio) {
  const r = d.resultado
  const fora = d.festas.filter((f) => f.foraDaConta).length
  const mostra = [
    'LUCRO OU PREJUÍZO: o resultado das festas que já aconteceram no período, menos as despesas gerais da casa pagas no período, com o efeito dos cancelamentos. Cada festa conta no mês em que acontece.',
    'CAIXA: o dinheiro que realmente passou pela conta (pagamentos recebidos e contas pagas), no dia em que aconteceu. Não diz, sozinho, se houve lucro.',
    'PONTE: explica linha por linha por que o caixa e o lucro são números diferentes.',
    'COMPROMISSOS: o que já foi recebido de festas que ainda vão acontecer e quanto elas vão custar.',
  ]
  const naoEntra = [
    'Festas que ainda vão acontecer: só aparecem em Compromissos. Contam no lucro no mês em que acontecerem.',
    d.entradasManuais > 0
      ? `Entradas lançadas à mão (ex.: aluguel do espaço): ${brl(d.entradasManuais)} neste período. Entram no caixa, mas NÃO entram no lucro.`
      : 'Entradas lançadas à mão (ex.: aluguel do espaço), acertos entre unidades e multa e juros: entram no caixa, mas NÃO entram no lucro.',
    `Compras de estoque (${brl(r.compras_estoque)} pagos no período): o lucro conta o que as festas consumiram (insumos), não a compra.`,
    d.pagaCustosFesta.length > 0
      ? `Contas marcadas "já nos custos das festas" (${d.pagaCustosFesta.length}, somando ${brl(d.pagaCustosFesta.reduce((t, l) => t + l.valor, 0))}): não entram nos totais para não contar o mesmo gasto duas vezes.`
      : 'Contas marcadas "já nos custos das festas": não entram nos totais para não contar o mesmo gasto duas vezes (nenhuma neste período).',
    'Taxa da maquininha: é uma estimativa feita pelas taxas cadastradas, não um valor cobrado de verdade.',
    fora > 0
      ? `${fora} festa${fora === 1 ? ' está marcada' : 's estão marcadas'} como "fora da conta" no Lucro por festa. Essa marcação vale só para aquela tela: neste relatório ${fora === 1 ? 'ela continua' : 'elas continuam'} contando no lucro (aparecem marcadas na lista de festas).`
      : 'A marcação "fora da conta" do Lucro por festa vale só para aquela tela e não muda este relatório (nenhuma festa marcada neste período).',
  ]
  return { mostra, naoEntra }
}

function nomeArquivo(d: DadosRelatorio, ext: string) {
  const limpar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  const periodo = d.mesIni === d.mesFim ? d.mesIni : `${d.mesIni}_a_${d.mesFim}`
  return `relatorio-financeiro-${limpar(d.casa || 'festou')}-${limpar(d.unidade)}-${periodo}.${ext}`
}

// ======================= PDF =======================

export const ESTILOS_RELATORIO = `
  .pdf-body { font-family: 'Nunito', Arial, sans-serif; color: #241B35; width: 760px; padding: 28px 34px; font-size: 11px; line-height: 1.45; background: #fff; }
  .topo { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #59239B; padding-bottom: 8px; margin-bottom: 14px; }
  .topo img { height: 30px; }
  .topo .info { text-align: right; color: #6D5E8C; font-size: 9.5px; }
  .capa { text-align: center; padding: 70px 0 30px; }
  .capa img { height: 90px; margin-bottom: 26px; }
  .capa h1 { font-size: 26px; color: #301A5B; margin: 0 0 6px; }
  .capa .sub { color: #6D5E8C; font-size: 13px; margin: 0 0 4px; }
  h2 { font-size: 16px; color: #59239B; margin: 4px 0 6px; }
  h3 { font-size: 12.5px; color: #301A5B; margin: 14px 0 6px; }
  p { margin: 0 0 7px; }
  .quebra { page-break-before: always; break-before: page; }
  .veredito { border-radius: 12px; padding: 16px 18px; margin: 10px 0 14px; color: #fff; }
  .veredito.lucro { background: #2E7D57; }
  .veredito.prejuizo { background: #B23A3A; }
  .veredito .rot { font-size: 11px; letter-spacing: 2px; font-weight: 800; opacity: .9; }
  .veredito .val { font-size: 30px; font-weight: 900; margin-top: 2px; }
  .veredito .obs { font-size: 11px; opacity: .95; margin-top: 4px; }
  .cards { display: flex; gap: 8px; margin: 8px 0 12px; }
  .card { flex: 1; border: 1px solid #E2D6F1; border-radius: 10px; padding: 8px 10px; background: #FBF8FE; }
  .card .t { color: #6D5E8C; font-size: 9.5px; }
  .card .v { font-size: 15px; font-weight: 800; margin-top: 2px; }
  .pos { color: #2E7D57; } .neg { color: #B23A3A; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; }
  th { text-align: left; font-size: 9.5px; color: #6D5E8C; font-weight: 700; border-bottom: 1.5px solid #E2D6F1; padding: 5px 6px; }
  td { border-bottom: 1px solid #F0E9F8; padding: 5px 6px; vertical-align: top; }
  td.n, th.n { text-align: right; white-space: nowrap; }
  tr.total td { font-weight: 800; border-top: 1.5px solid #59239B; border-bottom: none; }
  tr.sub td { font-weight: 700; background: #FBF8FE; }
  tr.fora td { color: #9A8FB0; }
  .exp { color: #6D5E8C; font-size: 9.5px; }
  .box { border: 1px solid #E2D6F1; border-radius: 10px; padding: 10px 12px; background: #FBF8FE; margin: 6px 0 10px; }
  .aviso { border-left: 3px solid #E0A100; background: #FFF8E5; padding: 7px 10px; border-radius: 6px; margin: 6px 0; }
  .tag { display: inline-block; font-size: 8.5px; font-weight: 700; border-radius: 4px; padding: 1px 5px; }
  .tag.parcial { background: #FFF1CC; color: #8A6100; } .tag.fora { background: #EEE8F7; color: #6D5E8C; } .tag.atrasada { background: #FBE3E3; color: #B23A3A; }
  .rodape { color: #9A8FB0; font-size: 9px; text-align: center; margin-top: 16px; }
`

function topo(d: DadosRelatorio, titulo: string) {
  return `<div class="topo"><img src="${LOGO}" alt="Festou" /><div class="info"><strong>${esc(titulo)}</strong><br/>${esc(d.casa)} · ${esc(d.unidade)} · ${esc(d.periodoTexto)}</div></div>`
}
const cls = (v: number) => (v >= 0 ? 'pos' : 'neg')

function tabelaLancamentos(lista: Lancamento[], cor: 'pos' | 'neg') {
  if (lista.length === 0) return '<p class="exp">Nenhum lançamento no período.</p>'
  const total = lista.reduce((s, l) => s + l.valor, 0)
  return `<table><thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th class="n">Valor</th></tr></thead><tbody>
    ${lista.map((l) => `<tr><td>${dataBr(l.data)}</td><td>${esc(l.categoria)}</td><td>${esc(l.descricao)}${l.detalhe ? `<div class="exp">${esc(l.detalhe)}</div>` : ''}</td><td class="n ${cor}">${brl(l.valor)}</td></tr>`).join('')}
    <tr class="total"><td colspan="3">Total (${lista.length} lançamento${lista.length === 1 ? '' : 's'})</td><td class="n ${cor}">${brl(total)}</td></tr>
  </tbody></table>`
}

function tabelaCategorias(lista: Lancamento[], cor: 'pos' | 'neg') {
  const cats = somaPorCategoria(lista)
  const total = lista.reduce((s, l) => s + l.valor, 0)
  if (cats.length === 0) return '<p class="exp">Nada no período.</p>'
  return `<table><thead><tr><th>Categoria</th><th class="n">Lançamentos</th><th class="n">Valor</th><th class="n">% do total</th></tr></thead><tbody>
    ${cats.map((c) => `<tr><td>${esc(c.categoria)}</td><td class="n">${c.qtd}</td><td class="n ${cor}">${brl(c.total)}</td><td class="n">${total > 0 ? ((c.total / total) * 100).toFixed(1) : '0'}%</td></tr>`).join('')}
    <tr class="total"><td>Total</td><td class="n">${lista.length}</td><td class="n ${cor}">${brl(total)}</td><td class="n">100%</td></tr>
  </tbody></table>`
}

export function htmlRelatorio(d: DadosRelatorio): string {
  const v = veredito(d)
  const r = d.resultado
  const c = d.caixa
  const entrou = c.entradas + c.acertos_recebidos
  const saiu = c.contas_pagas + c.custos_festas
  const parciais = d.festas.filter((f) => f.status === 'parcial').length
  const comp = d.compromissos

  const capa = `
    <div class="capa">
      <img src="${LOGO}" alt="Festou" />
      <h1>Relatório financeiro</h1>
      <p class="sub"><strong>${esc(d.casa)}</strong> · ${esc(d.unidade)}</p>
      <p class="sub">Período: ${esc(d.periodoTexto)}</p>
      <p class="sub" style="font-size:11px;margin-top:14px">Gerado em ${esc(d.geradoEm)}${d.geradoPor ? ` por ${esc(d.geradoPor)}` : ''}</p>
    </div>
    <div class="veredito ${v.lucro ? 'lucro' : 'prejuizo'}">
      <div class="rot">${v.palavra} NO PERÍODO</div>
      <div class="val">${brl(v.valor)}</div>
      <div class="obs">Resultado das festas e da casa em ${esc(d.periodoTexto)}. Explicação completa na próxima página.</div>
    </div>
    <div class="cards">
      <div class="card"><div class="t">Entrou no caixa</div><div class="v pos">${brl(entrou)}</div></div>
      <div class="card"><div class="t">Saiu do caixa</div><div class="v neg">${brl(saiu)}</div></div>
      <div class="card"><div class="t">Saldo do caixa</div><div class="v ${cls(c.saldo)}">${brl(c.saldo)}</div></div>
      <div class="card"><div class="t">Festas realizadas</div><div class="v">${r.festas}</div></div>
    </div>
    <h3>O que tem neste relatório</h3>
    <p>1. O resultado do período, explicado · 2. Mês a mês · 3. Visão Caixa · 4. Visão Resultado das festas · 5. Visão Ponte e compromissos · 6. Todos os lançamentos · 7. Contas em aberto · 8. Glossário</p>
    <h3>O que este relatório mostra</h3>
    <div class="box">${escopo(d).mostra.map((t) => `<p>${esc(t)}</p>`).join('')}</div>
    <h3>O que NÃO entra no lucro</h3>
    <div class="aviso">${escopo(d).naoEntra.map((t) => `<p>${esc(t)}</p>`).join('')}</div>`

  const secResultado = `
    <div class="quebra"></div>${topo(d, '1. O resultado do período')}
    <h2>1. Teve lucro ou prejuízo?</h2>
    <div class="veredito ${v.lucro ? 'lucro' : 'prejuizo'}"><div class="rot">${v.palavra}</div><div class="val">${brl(v.valor)}</div></div>
    <h3>Como chegamos nesse número</h3>
    <div class="box">${explicacaoResultado(d).map((l) => `<p>${esc(l)}</p>`).join('')}</div>
    <table><tbody>
      <tr><td>Valor das festas realizadas (${r.festas})</td><td class="n pos">${brl(r.receita)}</td></tr>
      <tr><td>(−) Custos lançados nas festas</td><td class="n neg">${brl(-r.custos_lancados)}</td></tr>
      <tr><td>(−) Insumos do estoque consumidos</td><td class="n neg">${brl(-r.insumos)}</td></tr>
      <tr><td>(−) Taxa da maquininha (estimada)</td><td class="n neg">${brl(-r.taxa)}</td></tr>
      <tr class="sub"><td>(=) O que sobrou das festas</td><td class="n ${cls(r.resultado_direto)}">${brl(r.resultado_direto)}</td></tr>
      <tr><td>(−) Despesas gerais da casa pagas</td><td class="n neg">${brl(-r.despesas_gerais)}</td></tr>
      <tr><td>(±) Efeito dos cancelamentos</td><td class="n ${cls(r.efeito_cancelamentos)}">${brl(r.efeito_cancelamentos)}</td></tr>
      <tr class="total"><td>(=) ${v.lucro ? 'Lucro' : 'Prejuízo'} do período</td><td class="n ${cls(r.resultado)}">${brl(r.resultado)}</td></tr>
    </tbody></table>
    <h3>E o caixa?</h3>
    <p>${esc(explicacaoCaixa(d))}</p>
    <p>${esc(explicacaoPonte(d))}</p>`

  const secMeses = `
    <h2 style="margin-top:16px">2. Mês a mês</h2>
    <p class="exp">Como cada mês do período contribuiu. "Saldo do caixa" é o dinheiro; "Resultado" é o lucro ou prejuízo.</p>
    <table><thead><tr><th>Mês</th><th class="n">Festas</th><th class="n">Entrou</th><th class="n">Saiu</th><th class="n">Saldo do caixa</th><th class="n">Resultado</th></tr></thead><tbody>
      ${d.porMes.map((m) => `<tr><td>${esc(nomeMesLongo(m.mes))}</td><td class="n">${m.festas}</td><td class="n pos">${brl(m.entradas)}</td><td class="n neg">${brl(m.saidas)}</td><td class="n ${cls(m.saldo)}">${brl(m.saldo)}</td><td class="n ${cls(m.resultado)}">${brl(m.resultado)} ${m.resultado >= 0 ? '(lucro)' : '(prejuízo)'}</td></tr>`).join('')}
      <tr class="total"><td>Total</td><td class="n">${r.festas}</td><td class="n pos">${brl(entrou)}</td><td class="n neg">${brl(saiu)}</td><td class="n ${cls(c.saldo)}">${brl(c.saldo)}</td><td class="n ${cls(r.resultado)}">${brl(r.resultado)}</td></tr>
    </tbody></table>`

  const secCaixa = `
    <div class="quebra"></div>${topo(d, '3. Visão Caixa')}
    <h2>3. Visão Caixa: o dinheiro que passou pela conta</h2>
    <p class="exp">Pagamentos contam no dia em que o cliente pagou; contas, no dia em que foram pagas; custos das festas, no dia da festa. Por isso um mês com muitas festas pagas antes pode ter saldo baixo sem que isso seja prejuízo.</p>
    <table><thead><tr><th>Linha</th><th>O que é</th><th class="n">Valor</th></tr></thead><tbody>
      <tr><td>Pagamentos de clientes</td><td class="exp">Tudo o que os clientes pagaram no período, de qualquer festa (inclusive de festas futuras).</td><td class="n pos">${brl(c.entradas)}</td></tr>
      <tr><td>Outras entradas</td><td class="exp">Entradas lançadas à mão, acertos entre unidades, multa e juros de parcelas.</td><td class="n pos">${brl(c.acertos_recebidos)}</td></tr>
      <tr class="sub"><td>(=) Total que entrou</td><td></td><td class="n pos">${brl(entrou)}</td></tr>
      <tr><td>Contas pagas</td><td class="exp">Contas e despesas pagas no período (inclui despesas fixas, comissões, compras de estoque e estornos).</td><td class="n neg">${brl(-c.contas_pagas)}</td></tr>
      <tr><td>Custos das festas</td><td class="exp">Custos lançados nas festas que aconteceram no período, pela data da festa.</td><td class="n neg">${brl(-c.custos_festas)}</td></tr>
      <tr class="sub"><td>(=) Total que saiu</td><td></td><td class="n neg">${brl(-saiu)}</td></tr>
      <tr class="total"><td>Saldo do caixa</td><td></td><td class="n ${cls(c.saldo)}">${brl(c.saldo)}</td></tr>
    </tbody></table>
    <h3>Entradas por categoria</h3>${tabelaCategorias(d.entradas, 'pos')}
    <h3>Saídas por categoria</h3>${tabelaCategorias(d.saidas, 'neg')}
    ${d.pagaCustosFesta.length > 0 ? `<div class="aviso">${d.pagaCustosFesta.length} conta${d.pagaCustosFesta.length === 1 ? '' : 's'} paga${d.pagaCustosFesta.length === 1 ? '' : 's'} no período (${brl(d.pagaCustosFesta.reduce((s, l) => s + l.valor, 0))}) ${d.pagaCustosFesta.length === 1 ? 'está marcada' : 'estão marcadas'} como "já nos custos das festas" e não ${d.pagaCustosFesta.length === 1 ? 'entra' : 'entram'} nos totais, para não contar duas vezes. A lista está na parte 6.</div>` : ''}`

  const secResultadoFestas = `
    <div class="quebra"></div>${topo(d, '4. Visão Resultado das festas')}
    <h2>4. Visão Resultado das festas: cada festa deu lucro?</h2>
    <p class="exp">Cada festa conta no mês em que acontece, com o valor dela (firmado + extras + consumo), menos os custos lançados, os insumos consumidos e a taxa da maquininha.${parciais > 0 ? ` <strong>${parciais} festa${parciais === 1 ? '' : 's'} com dados incompletos</strong> (marcadas como "parcial").` : ''}</p>
    ${d.festas.length === 0 ? '<p class="exp">Nenhuma festa realizada no período.</p>' : `
    <table><thead><tr><th>Data</th><th>Cliente</th><th class="n">Valor</th><th class="n">Recebido</th><th class="n">A receber</th><th class="n">Custos</th><th class="n">Insumos</th><th class="n">Taxa</th><th class="n">Lucro</th><th class="n">Margem</th></tr></thead><tbody>
      ${d.festas.map((f) => `<tr class="${f.foraDaConta ? 'fora' : ''}"><td>${dataBr(f.data)}</td><td>${esc(f.cliente)} ${f.status === 'parcial' ? '<span class="tag parcial">parcial</span>' : ''} ${f.foraDaConta ? '<span class="tag fora">fora da conta</span>' : ''}</td><td class="n">${brl(f.receita)}</td><td class="n">${brl(f.recebido)}</td><td class="n">${brl(f.a_receber)}</td><td class="n neg">${brl(f.custos)}</td><td class="n neg">${brl(f.insumos)}</td><td class="n neg">${brl(f.taxa)}</td><td class="n ${cls(f.lucro)}">${brl(f.lucro)}</td><td class="n">${f.receita > 0 ? ((f.lucro / f.receita) * 100).toFixed(0) : '0'}%</td></tr>`).join('')}
      <tr class="total"><td colspan="2">Total (${d.festas.length})</td><td class="n">${brl(r.receita)}</td><td class="n">${brl(d.festas.reduce((s, f) => s + f.recebido, 0))}</td><td class="n">${brl(d.festas.reduce((s, f) => s + f.a_receber, 0))}</td><td class="n neg">${brl(r.custos_lancados)}</td><td class="n neg">${brl(r.insumos)}</td><td class="n neg">${brl(r.taxa)}</td><td class="n ${cls(r.resultado_direto)}">${brl(r.resultado_direto)}</td><td class="n">${r.receita > 0 ? ((r.resultado_direto / r.receita) * 100).toFixed(0) : '0'}%</td></tr>
    </tbody></table>`}
    <h3>Do lucro das festas ao resultado do período</h3>
    <table><tbody>
      <tr><td>Lucro das festas realizadas</td><td class="n ${cls(r.resultado_direto)}">${brl(r.resultado_direto)}</td></tr>
      <tr><td>(−) Despesas gerais pagas (aluguel, contas, salários, comissões, marketing...)</td><td class="n neg">${brl(-r.despesas_gerais)}</td></tr>
      <tr><td>(±) Efeito dos cancelamentos</td><td class="n ${cls(r.efeito_cancelamentos)}">${brl(r.efeito_cancelamentos)}</td></tr>
      <tr class="total"><td>(=) ${v.lucro ? 'Lucro' : 'Prejuízo'} do período</td><td class="n ${cls(r.resultado)}">${brl(r.resultado)}</td></tr>
    </tbody></table>
    <p class="exp">Compras de estoque pagas no período (${brl(r.compras_estoque)}) não entram aqui: o resultado conta o que as festas consumiram (insumos), não a compra.</p>
    ${d.cancelamentos.length > 0 ? `<h3>Cancelamentos do período</h3>
    <table><thead><tr><th>Cancelada em</th><th>Cliente</th><th>Data da festa</th><th class="n">Pago</th><th class="n">Devolvido</th><th class="n">Multa retida</th><th class="n">Custos</th><th class="n">Efeito</th></tr></thead><tbody>
      ${d.cancelamentos.map((x) => `<tr><td>${dataBr(x.data)}${x.data_estimada ? ' *' : ''}</td><td>${esc(x.cliente)}</td><td>${dataBr(x.data_festa)}</td><td class="n">${brl(x.pago)}</td><td class="n">${brl(x.devolvido)}</td><td class="n pos">${brl(x.multa)}</td><td class="n neg">${brl(x.custos)}</td><td class="n ${cls(x.efeito)}">${brl(x.efeito)}</td></tr>`).join('')}
    </tbody></table>` : ''}`

  const linhasPonte = d.ponte.filter((l) => Math.abs(l.valor) > 0.004)
  const secPonte = `
    <div class="quebra"></div>${topo(d, '5. Visão Ponte e compromissos')}
    <h2>5. Visão Ponte: por que o caixa e o resultado são diferentes</h2>
    <p>${esc(explicacaoPonte(d))}</p>
    <table><thead><tr><th>Linha</th><th>Por quê</th><th class="n">Valor</th></tr></thead><tbody>
      <tr class="sub"><td>Saldo do caixa</td><td></td><td class="n ${cls(c.saldo)}">${brl(c.saldo)}</td></tr>
      ${linhasPonte.map((l) => `<tr><td>${esc(PONTE_TEXTO[l.chave]?.titulo ?? l.chave)}</td><td class="exp">${esc(PONTE_TEXTO[l.chave]?.explica(l.valor) ?? '')}</td><td class="n ${cls(l.valor)}">${brl(l.valor)}</td></tr>`).join('')}
      <tr class="total"><td>Resultado do período</td><td></td><td class="n ${cls(r.resultado)}">${brl(r.resultado)}</td></tr>
    </tbody></table>
    ${comp ? `<h2 style="margin-top:14px">Compromissos com festas futuras (hoje, ${dataBr(comp.hoje)})</h2>
    <p class="exp">Dinheiro que já entrou por festas que ainda vão acontecer. Está no caixa, mas já tem destino: pagar os custos dessas festas.</p>
    <div class="cards">
      <div class="card"><div class="t">Já recebido de festas futuras</div><div class="v">${brl(comp.recebido)}</div></div>
      <div class="card"><div class="t">Custos previstos dessas festas</div><div class="v neg">${brl(comp.custos_previstos)}</div></div>
      <div class="card"><div class="t">Reserva sugerida</div><div class="v">${brl(comp.reserva)}</div></div>
    </div>
    ${(comp.festas ?? []).length > 0 ? `<table><thead><tr><th>Data</th><th>Cliente</th><th class="n">Valor</th><th class="n">Recebido</th><th class="n">A receber</th><th class="n">Custos previstos</th></tr></thead><tbody>
      ${comp.festas.map((f) => `<tr><td>${dataBr(f.data)}</td><td>${esc(f.cliente)}</td><td class="n">${brl(f.devido ?? f.contratado)}</td><td class="n">${brl(f.recebido)}</td><td class="n">${brl(f.a_receber)}</td><td class="n neg">${brl(f.custos_previstos)}</td></tr>`).join('')}
    </tbody></table>` : ''}` : ''}`

  const secLanc = `
    <div class="quebra"></div>${topo(d, '6. Todos os lançamentos')}
    <h2>6. Todos os lançamentos do período</h2>
    <h3>Entradas</h3>${tabelaLancamentos(d.entradas, 'pos')}
    <h3>Saídas</h3>${tabelaLancamentos(d.saidas, 'neg')}
    ${d.pagaCustosFesta.length > 0 ? `<h3>Contas pagas que já estão nos custos das festas (não entram nos totais)</h3>${tabelaLancamentos(d.pagaCustosFesta, 'neg')}` : ''}`

  const totalAberto = d.contasAbertas.reduce((s, x) => s + x.valor, 0)
  const atrasadas = d.contasAbertas.filter((x) => x.atrasada)
  const secAbertas = `
    <div class="quebra"></div>${topo(d, '7. Contas em aberto e glossário')}
    <h2>7. Contas em aberto hoje</h2>
    <p class="exp">Contas lançadas que ainda não foram pagas, de qualquer data. ${atrasadas.length > 0 ? `<strong>${atrasadas.length} atrasada${atrasadas.length === 1 ? '' : 's'} (${brl(atrasadas.reduce((s, x) => s + x.valor, 0))}).</strong>` : 'Nenhuma atrasada.'}</p>
    ${d.contasAbertas.length === 0 ? '<p class="exp">Nenhuma conta em aberto.</p>' : `<table><thead><tr><th>Vencimento</th><th>Categoria</th><th>Descrição</th><th class="n">Valor</th></tr></thead><tbody>
      ${d.contasAbertas.map((x) => `<tr><td>${dataBr(x.vencimento)} ${x.atrasada ? '<span class="tag atrasada">atrasada</span>' : ''}</td><td>${esc(x.categoria)}</td><td>${esc(x.descricao)}${x.fornecedor ? `<div class="exp">${esc(x.fornecedor)}</div>` : ''}</td><td class="n neg">${brl(x.valor)}</td></tr>`).join('')}
      <tr class="total"><td colspan="3">Total em aberto</td><td class="n neg">${brl(totalAberto)}</td></tr>
    </tbody></table>`}
    <h2 style="margin-top:14px">8. Glossário</h2>
    <table><tbody>${GLOSSARIO.map(([t, x]) => `<tr><td style="width:140px"><strong>${esc(t)}</strong></td><td>${esc(x)}</td></tr>`).join('')}</tbody></table>
    <p class="rodape">Relatório gerado pelo Festou · ${esc(d.geradoEm)}</p>`

  return capa + secResultado + secMeses + secCaixa + secResultadoFestas + secPonte + secLanc + secAbertas
}

export async function baixarPdfRelatorio(d: DadosRelatorio) {
  await downloadPdf(htmlRelatorio(d), ESTILOS_RELATORIO, nomeArquivo(d, 'pdf'))
}

// ======================= EXCEL =======================

const ROXO = 'FF59239B'
const MOEDA = '"R$" #,##0.00;[Red]-"R$" #,##0.00'

export async function baixarExcelRelatorio(d: DadosRelatorio) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Festou'
  wb.created = new Date()

  let logoId: number | null = null
  try {
    const buf = await (await fetch(LOGO)).arrayBuffer()
    logoId = wb.addImage({ buffer: buf, extension: 'png' })
  } catch {
    logoId = null
  }

  // Cria uma aba com a logo, o título e o período; devolve a próxima linha livre.
  function aba(nome: string, titulo: string, larguras: number[]) {
    const ws = wb.addWorksheet(nome, { views: [{ showGridLines: false }] })
    larguras.forEach((w, i) => (ws.getColumn(i + 1).width = w))
    if (logoId !== null) ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 150, height: 59 } })
    ws.getRow(1).height = 24
    ws.getRow(2).height = 24
    ws.getRow(3).height = 4
    const t = ws.getCell('C1')
    t.value = titulo
    t.font = { bold: true, size: 15, color: { argb: ROXO } }
    const s = ws.getCell('C2')
    s.value = `${d.casa} · ${d.unidade} · ${d.periodoTexto} · gerado em ${d.geradoEm}`
    s.font = { size: 10, color: { argb: 'FF6D5E8C' } }
    return { ws, linha: 5 }
  }
  function cabecalho(ws: any, linha: number, textos: string[]) {
    const row = ws.getRow(linha)
    textos.forEach((t, i) => {
      const c = row.getCell(i + 1)
      c.value = t
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROXO } }
      c.alignment = { vertical: 'middle', wrapText: true }
    })
    row.height = 20
    return linha + 1
  }
  function linhaDados(ws: any, linha: number, valores: (string | number | null)[], op: { moeda?: number[]; negrito?: boolean; quebra?: number[] } = {}) {
    const row = ws.getRow(linha)
    valores.forEach((v, i) => {
      const c = row.getCell(i + 1)
      c.value = v
      if (op.moeda?.includes(i)) c.numFmt = MOEDA
      if (op.negrito) c.font = { bold: true }
      if (op.quebra?.includes(i)) c.alignment = { wrapText: true, vertical: 'top' }
      else c.alignment = { vertical: 'top' }
    })
    return linha + 1
  }
  function paragrafo(ws: any, linha: number, texto: string, colunas: number, op: { negrito?: boolean; cor?: string; tamanho?: number } = {}) {
    ws.mergeCells(linha, 1, linha, colunas)
    const c = ws.getCell(linha, 1)
    c.value = texto
    c.alignment = { wrapText: true, vertical: 'top' }
    c.font = { bold: !!op.negrito, color: op.cor ? { argb: op.cor } : undefined, size: op.tamanho ?? 11 }
    ws.getRow(linha).height = Math.max(18, Math.ceil(texto.length / 105) * 15)
    return linha + 1
  }

  const v = veredito(d)
  const r = d.resultado
  const c = d.caixa

  // ---- Resumo ----
  {
    const { ws, linha: l0 } = aba('Resumo', 'Relatório financeiro', [30, 18, 70])
    let l = l0
    const cel = ws.getCell(l, 1)
    ws.mergeCells(l, 1, l, 3)
    cel.value = `${v.palavra} NO PERÍODO: ${brl(v.valor)}`
    cel.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } }
    cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: v.lucro ? 'FF2E7D57' : 'FFB23A3A' } }
    ws.getRow(l).height = 30
    l += 2
    l = paragrafo(ws, l, 'Como chegamos nesse número', 3, { negrito: true, cor: ROXO })
    for (const p of explicacaoResultado(d)) l = paragrafo(ws, l, p, 3)
    l++
    l = cabecalho(ws, l, ['Linha', 'Valor', 'O que é'])
    const linhas: [string, number, string][] = [
      [`Valor das festas realizadas (${r.festas})`, r.receita, 'Valor firmado + extras + consumo cobrado das festas que aconteceram no período.'],
      ['(−) Custos lançados nas festas', -r.custos_lancados, 'Equipe, fornecedores e despesas fixas de festa lançados em cada festa.'],
      ['(−) Insumos consumidos', -r.insumos, 'Produtos do estoque usados nas festas, pelo custo de compra.'],
      ['(−) Taxa da maquininha', -r.taxa, 'Estimativa da taxa sobre os pagamentos com cartão.'],
      ['(=) O que sobrou das festas', r.resultado_direto, 'Lucro das festas antes das despesas gerais.'],
      ['(−) Despesas gerais pagas', -r.despesas_gerais, 'Aluguel, contas, salários, comissões, marketing e outras contas da casa pagas no período.'],
      ['(±) Efeito dos cancelamentos', r.efeito_cancelamentos, 'Multas retidas menos custos já lançados nas festas canceladas.'],
      [`(=) ${v.lucro ? 'Lucro' : 'Prejuízo'} do período`, r.resultado, 'Resultado final da casa no período.'],
    ]
    linhas.forEach(([a, b, x], i) => (l = linhaDados(ws, l, [a, b, x], { moeda: [1], negrito: i === 4 || i === 7, quebra: [2] })))
    l++
    l = paragrafo(ws, l, 'O que este relatório mostra', 3, { negrito: true, cor: ROXO })
    for (const t of escopo(d).mostra) l = paragrafo(ws, l, t, 3)
    l++
    l = paragrafo(ws, l, 'O que NÃO entra no lucro', 3, { negrito: true, cor: 'FFB23A3A' })
    for (const t of escopo(d).naoEntra) l = paragrafo(ws, l, t, 3)
    l++
    l = paragrafo(ws, l, 'E o caixa?', 3, { negrito: true, cor: ROXO })
    l = paragrafo(ws, l, explicacaoCaixa(d), 3)
    l = paragrafo(ws, l, explicacaoPonte(d), 3)
  }

  // ---- Mês a mês ----
  {
    const { ws, linha: l0 } = aba('Mês a mês', 'Mês a mês', [22, 10, 16, 16, 18, 18, 12])
    let l = cabecalho(ws, l0, ['Mês', 'Festas', 'Entrou', 'Saiu', 'Saldo do caixa', 'Resultado', ''])
    for (const m of d.porMes) l = linhaDados(ws, l, [nomeMesLongo(m.mes), m.festas, m.entradas, m.saidas, m.saldo, m.resultado, m.resultado >= 0 ? 'lucro' : 'prejuízo'], { moeda: [2, 3, 4, 5] })
    linhaDados(ws, l, ['Total', r.festas, c.entradas + c.acertos_recebidos, c.contas_pagas + c.custos_festas, c.saldo, r.resultado, r.resultado >= 0 ? 'lucro' : 'prejuízo'], { moeda: [2, 3, 4, 5], negrito: true })
  }

  // ---- Caixa ----
  {
    const { ws, linha: l0 } = aba('Caixa', 'Visão Caixa', [34, 18, 70])
    let l = paragrafo(ws, l0, 'O dinheiro que passou pela conta. Pagamentos contam no dia do pagamento; contas, no dia em que foram pagas; custos das festas, no dia da festa.', 3)
    l++
    l = cabecalho(ws, l, ['Linha', 'Valor', 'O que é'])
    const linhas: [string, number, string, boolean?][] = [
      ['Pagamentos de clientes', c.entradas, 'Tudo o que os clientes pagaram no período, de qualquer festa.'],
      ['Outras entradas', c.acertos_recebidos, 'Entradas lançadas à mão, acertos entre unidades, multa e juros.'],
      ['(=) Total que entrou', c.entradas + c.acertos_recebidos, '', true],
      ['Contas pagas', -c.contas_pagas, 'Contas e despesas pagas no período.'],
      ['Custos das festas', -c.custos_festas, 'Custos lançados nas festas que aconteceram, pela data da festa.'],
      ['(=) Total que saiu', -(c.contas_pagas + c.custos_festas), '', true],
      ['Saldo do caixa', c.saldo, '', true],
    ]
    for (const [a, b, x, neg] of linhas) l = linhaDados(ws, l, [a, b, x], { moeda: [1], negrito: !!neg, quebra: [2] })
    l++
    l = paragrafo(ws, l, 'Entradas por categoria', 3, { negrito: true, cor: ROXO })
    l = cabecalho(ws, l, ['Categoria', 'Valor', 'Lançamentos'])
    for (const x of somaPorCategoria(d.entradas)) l = linhaDados(ws, l, [x.categoria, x.total, x.qtd], { moeda: [1] })
    l++
    l = paragrafo(ws, l, 'Saídas por categoria', 3, { negrito: true, cor: ROXO })
    l = cabecalho(ws, l, ['Categoria', 'Valor', 'Lançamentos'])
    for (const x of somaPorCategoria(d.saidas)) l = linhaDados(ws, l, [x.categoria, x.total, x.qtd], { moeda: [1] })
  }

  // ---- Resultado das festas ----
  {
    const { ws, linha: l0 } = aba('Resultado das festas', 'Visão Resultado das festas', [12, 30, 15, 15, 15, 15, 15, 13, 15, 10, 12, 14])
    let l = paragrafo(ws, l0, 'Cada festa conta no mês em que acontece: valor da festa menos custos lançados, insumos consumidos e taxa da maquininha.', 12)
    l++
    l = cabecalho(ws, l, ['Data', 'Cliente', 'Valor', 'Recebido', 'A receber', 'Custos', 'Insumos', 'Taxa', 'Lucro', 'Margem', 'Dados', 'Lucro por festa'])
    for (const f of d.festas)
      l = linhaDados(ws, l, [dataBr(f.data), f.cliente, f.receita, f.recebido, f.a_receber, f.custos, f.insumos, f.taxa, f.lucro, f.receita > 0 ? `${((f.lucro / f.receita) * 100).toFixed(0)}%` : '0%', f.status === 'parcial' ? 'parcial' : 'completo', f.foraDaConta ? 'fora da conta' : 'na conta'], { moeda: [2, 3, 4, 5, 6, 7, 8] })
    l = linhaDados(ws, l, ['Total', `${d.festas.length} festas`, r.receita, d.festas.reduce((s, f) => s + f.recebido, 0), d.festas.reduce((s, f) => s + f.a_receber, 0), r.custos_lancados, r.insumos, r.taxa, r.resultado_direto, '', '', ''], { moeda: [2, 3, 4, 5, 6, 7, 8], negrito: true })
    l++
    l = cabecalho(ws, l, ['', 'Do lucro das festas ao resultado', 'Valor'])
    l = linhaDados(ws, l, ['', 'Lucro das festas realizadas', r.resultado_direto], { moeda: [2] })
    l = linhaDados(ws, l, ['', '(−) Despesas gerais pagas', -r.despesas_gerais], { moeda: [2] })
    l = linhaDados(ws, l, ['', '(±) Efeito dos cancelamentos', r.efeito_cancelamentos], { moeda: [2] })
    l = linhaDados(ws, l, ['', `(=) ${v.lucro ? 'Lucro' : 'Prejuízo'} do período`, r.resultado], { moeda: [2], negrito: true })
    if (d.cancelamentos.length > 0) {
      l++
      l = cabecalho(ws, l, ['Cancelada em', 'Cliente', 'Data da festa', 'Pago', 'Devolvido', 'Multa retida', 'Custos', 'Efeito'])
      for (const x of d.cancelamentos) l = linhaDados(ws, l, [dataBr(x.data), x.cliente, dataBr(x.data_festa), x.pago, x.devolvido, x.multa, x.custos, x.efeito], { moeda: [3, 4, 5, 6, 7] })
    }
  }

  // ---- Ponte e compromissos ----
  {
    const { ws, linha: l0 } = aba('Ponte e compromissos', 'Visão Ponte e compromissos', [42, 18, 80])
    let l = paragrafo(ws, l0, explicacaoPonte(d), 3)
    l++
    l = cabecalho(ws, l, ['Linha', 'Valor', 'Por quê'])
    l = linhaDados(ws, l, ['Saldo do caixa', c.saldo, ''], { moeda: [1], negrito: true })
    for (const p of d.ponte.filter((x) => Math.abs(x.valor) > 0.004))
      l = linhaDados(ws, l, [PONTE_TEXTO[p.chave]?.titulo ?? p.chave, p.valor, PONTE_TEXTO[p.chave]?.explica(p.valor) ?? ''], { moeda: [1], quebra: [2] })
    l = linhaDados(ws, l, ['Resultado do período', r.resultado, ''], { moeda: [1], negrito: true })
    const comp = d.compromissos
    if (comp) {
      l++
      l = paragrafo(ws, l, `Compromissos com festas futuras (hoje, ${dataBr(comp.hoje)})`, 3, { negrito: true, cor: ROXO })
      l = linhaDados(ws, l, ['Já recebido de festas futuras', comp.recebido, 'Dinheiro no caixa de festas que ainda vão acontecer.'], { moeda: [1], quebra: [2] })
      l = linhaDados(ws, l, ['Custos previstos dessas festas', comp.custos_previstos, 'Custos lançados + insumos estimados.'], { moeda: [1], quebra: [2] })
      l = linhaDados(ws, l, ['Reserva sugerida', comp.reserva, 'Quanto guardar para realizar essas festas.'], { moeda: [1], negrito: true, quebra: [2] })
    }
  }

  // ---- Lançamentos ----
  function abaLancamentos(nome: string, titulo: string, lista: Lancamento[], explica: string) {
    const { ws, linha: l0 } = aba(nome, titulo, [12, 26, 60, 16, 34])
    let l = paragrafo(ws, l0, explica, 5)
    l++
    l = cabecalho(ws, l, ['Data', 'Categoria', 'Descrição', 'Valor', 'Detalhe'])
    for (const x of lista) l = linhaDados(ws, l, [dataBr(x.data), x.categoria, x.descricao, x.valor, x.detalhe], { moeda: [3] })
    linhaDados(ws, l, ['Total', `${lista.length} lançamentos`, '', lista.reduce((s, x) => s + x.valor, 0), ''], { moeda: [3], negrito: true })
    ws.autoFilter = { from: { row: l0 + 2, column: 1 }, to: { row: l0 + 2, column: 5 } }
  }
  abaLancamentos('Entradas', 'Todas as entradas do período', d.entradas, 'Cada pagamento de cliente e cada outra entrada do período. Use o filtro do cabeçalho para ver uma categoria só.')
  abaLancamentos('Saídas', 'Todas as saídas do período', d.saidas, 'Cada conta paga e cada custo de festa do período. Use o filtro do cabeçalho para ver uma categoria só.')
  if (d.pagaCustosFesta.length > 0)
    abaLancamentos('Já nos custos das festas', 'Contas que já estão nos custos das festas', d.pagaCustosFesta, 'Contas pagas marcadas como "já nos custos das festas". Não entram nos totais, para não contar duas vezes.')

  // ---- Contas em aberto ----
  {
    const { ws, linha: l0 } = aba('Contas em aberto', 'Contas em aberto hoje', [14, 26, 50, 16, 12])
    let l = cabecalho(ws, l0, ['Vencimento', 'Categoria', 'Descrição', 'Valor', 'Situação'])
    for (const x of d.contasAbertas) l = linhaDados(ws, l, [dataBr(x.vencimento), x.categoria, [x.descricao, x.fornecedor].filter(Boolean).join(' — '), x.valor, x.atrasada ? 'atrasada' : 'a vencer'], { moeda: [3] })
    linhaDados(ws, l, ['Total', '', '', d.contasAbertas.reduce((s, x) => s + x.valor, 0), ''], { moeda: [3], negrito: true })
  }

  // ---- Glossário ----
  {
    const { ws, linha: l0 } = aba('Glossário', 'Glossário', [26, 100])
    let l = cabecalho(ws, l0, ['Termo', 'O que significa'])
    for (const [t, x] of GLOSSARIO) l = linhaDados(ws, l, [t, x], { quebra: [1] })
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo(d, 'xlsx')
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10000)
}
