import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'
import { periodoPadrao, type Periodo, type TipoGrafico } from '../lib/periodo'

// Seletor de período dos gráficos (o mesmo em todas as telas) e um gráfico
// simples que troca entre barras e linhas.

const OPCOES_MESES = [3, 6, 12, 24]

export function usePeriodo(chave: string, qtdMeses = 6, tipoInicial: TipoGrafico = 'barras') {
  // Lembra a escolha de cada gráfico neste navegador (se der).
  const ler = <T,>(k: string, padrao: T): T => {
    try {
      const v = localStorage.getItem(`grafico:${chave}:${k}`)
      return v ? (JSON.parse(v) as T) : padrao
    } catch {
      return padrao
    }
  }
  const [periodo, setPeriodoState] = useState<Periodo>(() => {
    const p = ler<Periodo | null>('periodo', null)
    // "Só um mês" e "meses" acompanham o mês atual; datas ficam como escolhidas.
    if (!p) return periodoPadrao(qtdMeses)
    const base = periodoPadrao(p.qtdMeses || qtdMeses)
    return p.modo === 'datas' ? { ...base, ...p } : { ...base, modo: p.modo }
  })
  const [tipo, setTipoState] = useState<TipoGrafico>(() => ler('tipo', tipoInicial))
  const salvar = (k: string, v: unknown) => {
    try {
      localStorage.setItem(`grafico:${chave}:${k}`, JSON.stringify(v))
    } catch {
      /* sem armazenamento: só não lembra */
    }
  }
  return {
    periodo,
    setPeriodo: (p: Periodo) => { setPeriodoState(p); salvar('periodo', p) },
    tipo,
    setTipo: (t: TipoGrafico) => { setTipoState(t); salvar('tipo', t) },
  }
}

function Segmento<T extends string>({ valor, opcoes, onChange, rotulo }: { valor: T; opcoes: readonly (readonly [T, string])[]; onChange: (v: T) => void; rotulo: string }) {
  return (
    <div className="inline-flex rounded-lg border border-line p-0.5 bg-surface" role="tablist" aria-label={rotulo}>
      {opcoes.map(([k, l]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={valor === k}
          onClick={() => onChange(k)}
          className={`px-2.5 h-7 rounded-md text-xs font-medium whitespace-nowrap ${valor === k ? 'bg-purple text-white' : 'text-ink/70 hover:bg-paper'}`}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

export function PeriodoGrafico({ periodo, onChange, tipo, onTipo, futuro, mensal, tiposExtras, extra }: {
  periodo: Periodo
  onChange: (p: Periodo) => void
  tipo?: string
  onTipo?: (t: any) => void
  futuro?: boolean
  mensal?: boolean
  tiposExtras?: readonly (readonly [string, string])[] // ex: [['pizza','Pizza']]
  extra?: ReactNode
}) {
  const campo = 'border border-line rounded-lg px-2 h-8 text-xs bg-surface'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmento
        rotulo="Período"
        valor={periodo.modo}
        onChange={(modo) => onChange({ ...periodo, modo })}
        opcoes={[['meses', futuro ? 'Próximos meses' : 'Comparar meses'], ['mes', mensal ? 'Um mês' : 'Só um mês'], ['datas', 'Escolher datas']] as const}
      />
      {periodo.modo === 'meses' && (
        <select aria-label="Quantos meses" value={periodo.qtdMeses} onChange={(e) => onChange({ ...periodo, qtdMeses: Number(e.target.value) })} className={campo}>
          {OPCOES_MESES.map((n) => <option key={n} value={n}>{n} meses</option>)}
        </select>
      )}
      {periodo.modo === 'mes' && (
        <input aria-label="Mês" type="month" value={periodo.mes} onChange={(e) => e.target.value && onChange({ ...periodo, mes: e.target.value })} className={campo} />
      )}
      {periodo.modo === 'datas' && (
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          <input aria-label="De" type="date" value={periodo.de} onChange={(e) => e.target.value && onChange({ ...periodo, de: e.target.value })} className={campo} />
          até
          <input aria-label="Até" type="date" value={periodo.ate} onChange={(e) => e.target.value && onChange({ ...periodo, ate: e.target.value })} className={campo} />
        </span>
      )}
      {onTipo && tipo && (
        <Segmento rotulo="Tipo de gráfico" valor={tipo} onChange={onTipo} opcoes={[...(tiposExtras ?? []), ['barras', 'Barras'], ['linhas', 'Linhas']] as const} />
      )}
      {extra}
    </div>
  )
}

export interface SerieGrafico {
  chave: string
  nome: string
  cor: string
  tracejada?: boolean
  pilha?: string
  onClick?: (linha: any) => void
}

// Gráfico de barras ou linhas para dados em faixas (cada linha tem "rotulo").
export function GraficoSerie({ dados, series, tipo, altura = 240, formatar, inteiro, larguraEixo, onClickLinha, animar = true }: {
  dados: Record<string, any>[]
  series: SerieGrafico[]
  tipo: TipoGrafico
  altura?: number
  formatar?: (v: number) => string
  inteiro?: boolean
  larguraEixo?: number
  onClickLinha?: (linha: any) => void
  animar?: boolean
}) {
  const eixo = { fontSize: 12, fill: '#6E6880' }
  const fmtEixo = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : v.toLocaleString('pt-BR'))
  const tooltip = <Tooltip formatter={(v: number) => (formatar ? formatar(v) : v.toLocaleString('pt-BR'))} contentStyle={{ borderRadius: 8, borderColor: '#E2DBEE', fontSize: 13 }} />
  const clique = onClickLinha ? (e: any) => e?.activePayload?.[0]?.payload && onClickLinha(e.activePayload[0].payload) : undefined
  const comum = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#E2DBEE" vertical={false} />
      <XAxis dataKey="rotulo" tick={eixo} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
      <YAxis tick={eixo} axisLine={false} tickLine={false} width={larguraEixo ?? (formatar ? 64 : 40)} allowDecimals={!inteiro} tickFormatter={formatar ? fmtEixo : undefined} />
      {tooltip}
      <Legend wrapperStyle={{ fontSize: 12 }} />
    </>
  )
  return (
    <ResponsiveContainer width="100%" height={altura}>
      {tipo === 'linhas' ? (
        <LineChart data={dados} onClick={clique} style={clique ? { cursor: 'pointer' } : undefined}>
          {comum}
          {series.map((s) => (
            <Line key={s.chave} type="monotone" dataKey={s.chave} name={s.nome} stroke={s.cor} strokeWidth={2} isAnimationActive={animar} strokeDasharray={s.tracejada ? '5 4' : undefined} dot={dados.length <= 31 ? { r: 2.5 } : false} activeDot={{ r: 4, onClick: s.onClick ? (_: any, p: any) => s.onClick!(p?.payload) : undefined } as any} />
          ))}
        </LineChart>
      ) : (
        <BarChart data={dados} onClick={clique}>
          {comum}
          {series.map((s) => (
            <Bar
              key={s.chave}
              dataKey={s.chave}
              name={s.nome}
              fill={s.cor}
              isAnimationActive={animar}
              stackId={s.pilha}
              radius={s.pilha ? undefined : [4, 4, 0, 0]}
              fillOpacity={s.tracejada ? 0.45 : 1}
              cursor={s.onClick ? 'pointer' : undefined}
              onClick={s.onClick ? (d: any) => s.onClick!(d.payload ?? d) : undefined}
            />
          ))}
        </BarChart>
      )}
    </ResponsiveContainer>
  )
}

// ---------------------------------------------------------------------------
// Filtro de categorias dos gráficos do Financeiro. Cada categoria é guardada
// como "e:Nome" (entrada) ou "s:Nome" (saída); null = todas.

export function useFiltroCategorias(chave: string) {
  const [sel, setSel] = useState<string[] | null>(() => {
    try {
      const v = localStorage.getItem(`grafico:${chave}:categorias`)
      return v ? (JSON.parse(v) as string[] | null) : null
    } catch {
      return null
    }
  })
  return {
    selecionadas: sel,
    setSelecionadas: (v: string[] | null) => {
      setSel(v)
      try {
        localStorage.setItem(`grafico:${chave}:categorias`, JSON.stringify(v))
      } catch {
        /* sem armazenamento: só não lembra */
      }
    },
  }
}

export function FiltroCategorias({ entradas, saidas, selecionadas, onChange }: {
  entradas: string[]
  saidas: string[]
  selecionadas: string[] | null
  onChange: (v: string[] | null) => void
}) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberto])

  const todas = [...entradas.map((c) => `e:${c}`), ...saidas.map((c) => `s:${c}`)]
  const marcada = (k: string) => selecionadas === null || selecionadas.includes(k)
  const qtd = selecionadas === null ? todas.length : todas.filter((k) => selecionadas.includes(k)).length
  const rotulo = selecionadas === null || qtd === todas.length ? 'Todas as categorias' : qtd === 0 ? 'Nenhuma categoria' : `${qtd} de ${todas.length} categorias`

  function alternar(k: string) {
    const atual = selecionadas === null ? todas : selecionadas
    const nova = atual.includes(k) ? atual.filter((x) => x !== k) : [...atual, k]
    onChange(todas.every((x) => nova.includes(x)) ? null : nova)
  }
  function grupo(prefixo: 'e' | 's', lista: string[], so: boolean) {
    const chaves = lista.map((c) => `${prefixo}:${c}`)
    const outras = (selecionadas ?? todas).filter((x) => !x.startsWith(`${prefixo}:`))
    onChange(so ? chaves : [...outras, ...chaves].length === todas.length ? null : [...outras, ...chaves])
  }

  const bloco = (titulo: string, prefixo: 'e' | 's', lista: string[], cor: string) =>
    lista.length > 0 && (
      <div className="mb-2">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className={`text-[11px] font-semibold uppercase tracking-wide ${cor}`}>{titulo}</p>
          <span className="flex gap-2 text-[11px]">
            <button type="button" className="text-purple hover:underline" onClick={() => grupo(prefixo, lista, false)}>marcar todas</button>
            <button type="button" className="text-purple hover:underline" onClick={() => grupo(prefixo, lista, true)}>só estas</button>
          </span>
        </div>
        {lista.map((c) => {
          const k = `${prefixo}:${c}`
          return (
            <label key={k} className="flex items-center gap-2 py-1 text-xs cursor-pointer hover:bg-paper rounded px-1">
              <input type="checkbox" checked={marcada(k)} onChange={() => alternar(k)} />
              <span className="truncate">{c}</span>
            </label>
          )
        })}
      </div>
    )

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className={`h-8 px-2.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 ${selecionadas === null ? 'border-line bg-surface text-ink/80' : 'border-purple bg-purple-light text-purple-dark'}`}
      >
        {rotulo}
        <span aria-hidden className="text-[10px]">▾</span>
      </button>
      {aberto && (
        <div className="absolute z-30 mt-1 left-0 w-72 max-w-[85vw] max-h-80 overflow-y-auto bg-surface border border-line rounded-lg shadow-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <button type="button" className="text-xs font-medium text-purple hover:underline" onClick={() => onChange(null)}>Mostrar todas</button>
            <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => setAberto(false)}>Fechar</button>
          </div>
          {bloco('Entradas', 'e', entradas, 'text-teal')}
          {bloco('Saídas', 's', saidas, 'text-danger')}
          {todas.length === 0 && <p className="text-xs text-muted">Nenhuma categoria com valor neste período.</p>}
        </div>
      )}
    </div>
  )
}
