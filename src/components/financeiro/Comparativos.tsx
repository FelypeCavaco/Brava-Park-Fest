import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { UNITS } from '../../lib/UnitContext'
import { currentMonthValue, addMonthsToValue } from '../../lib/monthUtils'
import { loadMonthViews, type MonthViews } from '../../pages/FinanceViews'
import { GraficoSerie } from '../PeriodoGrafico'
import type { TipoGrafico } from '../../lib/periodo'

// Aba Comparativos do Financeiro: unidade contra unidade, o mês contra o mesmo
// mês do ano passado e o ano até agora contra o ano passado. Usa a mesma conta
// do Resultado das festas (finance_month_views), para os números baterem.

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}
const n = (v: unknown) => Number(v ?? 0)
const nomeMes = (m: string) => format(parseISO(`${m}-01`), "MMMM 'de' yyyy", { locale: ptBR }).replace(/^./, (c) => c.toUpperCase())
const mesCurto = (m: string) => format(parseISO(`${m}-01`), 'MMM', { locale: ptBR }).replace('.', '').replace(/^./, (c) => c.toUpperCase())

// Números de um mês, já resumidos.
interface Numeros { festas: number; receita: number; custos: number; despesas: number; resultado: number; ticket: number; margem: number }
function resumir(v: MonthViews | null): Numeros | null {
  if (!v) return null
  const r = v.resultado
  const festas = n(r.festas)
  const receita = n(r.receita)
  const resultado = n(r.resultado)
  return {
    festas,
    receita,
    custos: n(r.custos_lancados) + n(r.insumos) + n(r.taxa),
    despesas: n(r.despesas_gerais),
    resultado,
    ticket: festas > 0 ? receita / festas : 0,
    margem: receita > 0 ? (resultado / receita) * 100 : 0,
  }
}

// Cada linha: rótulo, como mostrar e se "maior é melhor".
const LINHAS: { chave: keyof Numeros; rotulo: string; ajuda: string; tipo: 'n' | 'v' | 'p'; maiorMelhor: boolean }[] = [
  { chave: 'festas', rotulo: 'Festas realizadas', ajuda: 'Festas que aconteceram no mês.', tipo: 'n', maiorMelhor: true },
  { chave: 'receita', rotulo: 'Valor das festas', ajuda: 'Valor firmado + extras + consumo das festas realizadas.', tipo: 'v', maiorMelhor: true },
  { chave: 'custos', rotulo: 'Custos das festas', ajuda: 'Custos lançados nas festas + insumos + taxa da maquininha.', tipo: 'v', maiorMelhor: false },
  { chave: 'despesas', rotulo: 'Despesas gerais', ajuda: 'Aluguel, contas, salários, comissões e outras despesas da casa pagas no mês.', tipo: 'v', maiorMelhor: false },
  { chave: 'resultado', rotulo: 'Lucro ou prejuízo', ajuda: 'O resultado do mês, igual ao da aba Resultado.', tipo: 'v', maiorMelhor: true },
  { chave: 'ticket', rotulo: 'Ticket médio', ajuda: 'Valor médio de cada festa realizada.', tipo: 'v', maiorMelhor: true },
  { chave: 'margem', rotulo: 'Margem', ajuda: 'Quanto do valor das festas virou lucro.', tipo: 'p', maiorMelhor: true },
]
function fmt(v: number, tipo: 'n' | 'v' | 'p') {
  return tipo === 'n' ? String(Math.round(v)) : tipo === 'p' ? `${v.toFixed(0)}%` : brl(v)
}

function SeletorMes({ valor, onChange, rotulo }: { valor: string; onChange: (m: string) => void; rotulo: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-muted">{rotulo}</span>
      <input type="month" value={valor} max={currentMonthValue()} onChange={(e) => e.target.value && onChange(e.target.value)} className="border border-line rounded-lg px-2 h-8 text-sm bg-surface" />
    </label>
  )
}

// ======================= Unidades lado a lado =======================

export function ComparaUnidades({ unitDbIds }: { unitDbIds: Record<string, { unitId: string }> }) {
  const [mes, setMes] = useState(() => addMonthsToValue(currentMonthValue(), -1))
  const [dados, setDados] = useState<{ nome: string; num: Numeros | null }[] | null>(null)
  const [total, setTotal] = useState<Numeros | null>(null)
  const unidades = UNITS.filter((u) => unitDbIds[u.id])

  useEffect(() => {
    let vivo = true
    setDados(null)
    Promise.all([
      ...unidades.map((u) => loadMonthViews(mes, unitDbIds[u.id].unitId).catch(() => null)),
      loadMonthViews(mes, null).catch(() => null),
    ]).then((lista) => {
      if (!vivo) return
      setDados(unidades.map((u, i) => ({ nome: u.name, num: resumir(lista[i]) })))
      setTotal(resumir(lista[lista.length - 1]))
    })
    return () => {
      vivo = false
    }
  }, [mes, unitDbIds])

  if (unidades.length < 2) return <Card><p className="text-sm text-muted py-2">Este comparativo aparece quando a casa tem mais de uma unidade.</p></Card>

  return (
    <Card title={`Unidades lado a lado — ${nomeMes(mes)}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-xs text-muted">O ponto verde marca a unidade que foi melhor em cada linha (nos custos e despesas, a que gastou menos).</p>
        <SeletorMes valor={mes} onChange={setMes} rotulo="Mês" />
      </div>
      {!dados ? (
        <p className="text-sm text-muted py-4 text-center">Carregando…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="pb-2 font-medium">Indicador</th>
                {dados.map((d) => <th key={d.nome} className="pb-2 font-medium text-right">{d.nome}</th>)}
                <th className="pb-2 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {LINHAS.map((l) => {
                const valores = dados.map((d) => (d.num ? d.num[l.chave] : null))
                const validos = valores.filter((v): v is number => v !== null)
                const melhor = validos.length > 1 && new Set(validos).size > 1 ? (l.maiorMelhor ? Math.max(...validos) : Math.min(...validos)) : null
                return (
                  <tr key={l.chave}>
                    <td className="py-2.5" title={l.ajuda}>{l.rotulo}</td>
                    {valores.map((v, i) => (
                      <td key={i} className={`py-2.5 text-right ${l.chave === 'resultado' && v !== null ? (v >= 0 ? 'text-teal' : 'text-danger') : ''}`}>
                        {v !== null && v === melhor && <span className="inline-block w-2 h-2 rounded-full bg-teal mr-1.5 align-middle" aria-label="melhor" />}
                        {v === null ? '—' : fmt(v, l.tipo)}
                      </td>
                    ))}
                    <td className={`py-2.5 text-right font-semibold ${l.chave === 'resultado' && total ? (total.resultado >= 0 ? 'text-teal' : 'text-danger') : ''}`}>{total ? fmt(total[l.chave], l.tipo) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

// ======================= Mês × mesmo mês do ano passado =======================

export function ComparaMesAno({ unitId }: { unitId: string | null }) {
  const [mes, setMes] = useState(() => addMonthsToValue(currentMonthValue(), -1))
  const [par, setPar] = useState<{ atual: Numeros | null; antes: Numeros | null } | null>(null)
  const mesAntes = addMonthsToValue(mes, -12)

  useEffect(() => {
    let vivo = true
    setPar(null)
    Promise.all([loadMonthViews(mes, unitId).catch(() => null), loadMonthViews(mesAntes, unitId).catch(() => null)]).then(([a, b]) => {
      if (vivo) setPar({ atual: resumir(a), antes: resumir(b) })
    })
    return () => {
      vivo = false
    }
  }, [mes, unitId])

  const ehMesAtual = mes === currentMonthValue()
  return (
    <Card title={`${nomeMes(mes)} contra ${nomeMes(mesAntes).toLowerCase()}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-xs text-muted">Verde: melhorou. Vermelho: piorou. Nos custos e despesas, subir aparece em amarelo, porque pode ser normal se houve mais festas.</p>
        <SeletorMes valor={mes} onChange={setMes} rotulo="Mês" />
      </div>
      {ehMesAtual && <p className="text-xs bg-amber-light text-amber rounded-lg px-3 py-2 mb-3">O mês atual ainda não terminou: a comparação com o mês inteiro do ano passado fica desigual.</p>}
      {!par ? (
        <p className="text-sm text-muted py-4 text-center">Carregando…</p>
      ) : !par.antes || (par.antes.festas === 0 && par.antes.despesas === 0) ? (
        <p className="text-sm text-muted">Não há dados de {nomeMes(mesAntes).toLowerCase()} no sistema para comparar.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="pb-2 font-medium">Indicador</th>
                <th className="pb-2 font-medium text-right">{mesCurto(mes)}/{mes.slice(2, 4)}</th>
                <th className="pb-2 font-medium text-right">{mesCurto(mesAntes)}/{mesAntes.slice(2, 4)}</th>
                <th className="pb-2 font-medium text-right">Diferença</th>
                <th className="pb-2 font-medium text-right">Variação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {LINHAS.map((l) => {
                const a = par.atual ? par.atual[l.chave] : 0
                const b = par.antes![l.chave]
                const dif = a - b
                const subiu = dif > 0.004
                const igual = Math.abs(dif) <= 0.004
                const bom = l.maiorMelhor ? subiu : !subiu
                const tom = igual ? 'neutral' : bom ? 'teal' : l.maiorMelhor ? 'danger' : 'amber'
                const variacao = l.tipo === 'p' ? `${dif >= 0 ? '+' : '−'}${Math.abs(dif).toFixed(0)} pontos` : b !== 0 ? `${dif >= 0 ? '▲' : '▼'} ${Math.abs(Math.round((dif / Math.abs(b)) * 100))}%` : '—'
                return (
                  <tr key={l.chave}>
                    <td className="py-2.5" title={l.ajuda}>{l.rotulo}</td>
                    <td className="py-2.5 text-right font-medium">{fmt(a, l.tipo)}</td>
                    <td className="py-2.5 text-right text-muted">{fmt(b, l.tipo)}</td>
                    <td className="py-2.5 text-right">{igual ? '—' : `${dif > 0 ? '+' : '−'}${fmt(Math.abs(dif), l.tipo === 'p' ? 'n' : l.tipo)}${l.tipo === 'p' ? ' p.p.' : ''}`}</td>
                    <td className="py-2.5 text-right"><Badge tone={tom as any}>{igual ? 'igual' : variacao}</Badge></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

// ======================= Ano até agora × ano passado =======================

export function ComparaAnos({ unitId }: { unitId: string | null }) {
  const atual = currentMonthValue()
  const ano = Number(atual.slice(0, 4))
  const [tipo, setTipo] = useState<TipoGrafico>('barras')
  const [dados, setDados] = useState<{ esteAno: (Numeros | null)[]; anoPassado: (Numeros | null)[] } | null>(null)

  useEffect(() => {
    let vivo = true
    setDados(null)
    const mesesEste = Array.from({ length: Number(atual.slice(5, 7)) }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`)
    const mesesPassado = Array.from({ length: 12 }, (_, i) => `${ano - 1}-${String(i + 1).padStart(2, '0')}`)
    Promise.all([
      Promise.all(mesesEste.map((m) => loadMonthViews(m, unitId).catch(() => null))),
      Promise.all(mesesPassado.map((m) => loadMonthViews(m, unitId).catch(() => null))),
    ]).then(([a, b]) => {
      if (vivo) setDados({ esteAno: a.map(resumir), anoPassado: b.map(resumir) })
    })
    return () => {
      vivo = false
    }
  }, [unitId, atual])

  const rotulos = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const linhas = rotulos.map((r, i) => ({
    rotulo: r,
    este: dados?.esteAno[i]?.resultado ?? null,
    passado: dados?.anoPassado[i]?.resultado ?? null,
  }))
  // Até o mês anterior ao atual, para comparar meses fechados com meses fechados.
  const fechados = Math.max(0, Number(atual.slice(5, 7)) - 1)
  const soma = (lista: (Numeros | null)[] | undefined, chave: keyof Numeros, ate: number) => (lista ?? []).slice(0, ate).reduce((s, x) => s + (x ? x[chave] : 0), 0)
  const lucroEste = soma(dados?.esteAno, 'resultado', fechados)
  const lucroPassado = soma(dados?.anoPassado, 'resultado', fechados)
  const festasEste = soma(dados?.esteAno, 'festas', fechados)
  const festasPassado = soma(dados?.anoPassado, 'festas', fechados)
  const dif = lucroEste - lucroPassado
  const restoAnoPassado = (dados?.anoPassado ?? []).slice(fechados).map((x, i) => ({ mes: rotulos[fechados + i], resultado: x?.resultado ?? 0 }))
  const melhorResto = restoAnoPassado.length ? restoAnoPassado.reduce((a, b) => (b.resultado > a.resultado ? b : a)) : null

  return (
    <Card title={`Lucro mês a mês: ${ano} contra ${ano - 1}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-xs text-muted">Lucro ou prejuízo de cada mês, igual ao da aba Resultado. Os meses de {ano} que ainda não aconteceram ficam vazios.</p>
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 gap-0.5" role="tablist" aria-label="Tipo de gráfico">
          {([['barras', 'Barras'], ['linhas', 'Linhas']] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tipo === k} onClick={() => setTipo(k)} className={`px-2.5 h-7 rounded-md text-xs font-medium ${tipo === k ? 'bg-purple text-white' : 'text-ink/70 hover:bg-paper'}`}>{l}</button>
          ))}
        </div>
      </div>
      {!dados ? (
        <p className="text-sm text-muted py-6 text-center">Carregando os 2 anos…</p>
      ) : (
        <>
          <GraficoSerie
            dados={linhas}
            tipo={tipo}
            formatar={brl}
            altura={260}
            series={[
              { chave: 'este', nome: String(ano), cor: '#59239B', ajuda: `Lucro ou prejuízo de cada mês de ${ano}, calculado como na aba Resultado.` },
              { chave: 'passado', nome: String(ano - 1), cor: '#B8A4D6', ajuda: `O mesmo mês em ${ano - 1}, para ver se melhorou e quais meses costumam ser mais fortes.` },
            ]}
          />
          {fechados > 0 && (
            <div className="bg-purple-light/60 rounded-lg px-3 py-2.5 text-sm mt-3">
              De janeiro a {rotulos[fechados - 1].toLowerCase()} (meses fechados), o lucro somado é <strong>{brl(lucroEste)}</strong> em {ano} contra <strong>{brl(lucroPassado)}</strong> em {ano - 1}:{' '}
              <strong className={dif >= 0 ? 'text-teal' : 'text-danger'}>{brl(Math.abs(dif))} {dif >= 0 ? 'a mais' : 'a menos'}{lucroPassado !== 0 ? ` (${Math.abs(Math.round((dif / Math.abs(lucroPassado)) * 100))}%)` : ''}</strong>.
              {' '}Foram {festasEste} festas contra {festasPassado}.
              {melhorResto && melhorResto.resultado > 0 && ` No ano passado, o melhor mês do restante do ano foi ${melhorResto.mes.toLowerCase()} (${brl(melhorResto.resultado)}).`}
            </div>
          )}
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="pb-2 font-medium">Mês</th>
                  <th className="pb-2 font-medium text-right">Festas {ano}</th>
                  <th className="pb-2 font-medium text-right">Lucro {ano}</th>
                  <th className="pb-2 font-medium text-right">Festas {ano - 1}</th>
                  <th className="pb-2 font-medium text-right">Lucro {ano - 1}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rotulos.map((r, i) => {
                  const a = dados.esteAno[i]
                  const b = dados.anoPassado[i]
                  return (
                    <tr key={r} className={i >= fechados && i !== fechados ? 'text-muted' : ''}>
                      <td className="py-2">{r}{i === fechados ? ' (em andamento)' : ''}</td>
                      <td className="py-2 text-right">{a ? a.festas : '—'}</td>
                      <td className={`py-2 text-right ${a ? (a.resultado >= 0 ? 'text-teal' : 'text-danger') : ''}`}>{a ? brl(a.resultado) : '—'}</td>
                      <td className="py-2 text-right">{b ? b.festas : '—'}</td>
                      <td className={`py-2 text-right ${b ? (b.resultado >= 0 ? 'text-teal' : 'text-danger') : ''}`}>{b ? brl(b.resultado) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}
