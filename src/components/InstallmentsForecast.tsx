import { useEffect, useState } from 'react'
import { Card } from './ui/Card'
import { supabase } from '../lib/supabaseClient'
import { brl } from '../lib/format'

// Financeiro (Caixa): previsão do que entra por mês pelas parcelas em aberto,
// o que já atrasou e a multa/juros. Só aparece quando há parcelas.

interface Previsao {
  atrasado: number
  encargos_hoje: number
  encargos_recebidos_mes: number
  meses: { mes: string; valor: number }[]
}

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export function InstallmentsForecast({ unitId }: { unitId: string | null }) {
  const [prev, setPrev] = useState<Previsao | null>(null)

  useEffect(() => {
    supabase.rpc('installments_forecast', { p_unit: unitId, p_months: 6 }).then(({ data, error }) => {
      if (error || !data) return setPrev(null)
      const d = data as Previsao
      setPrev({ ...d, atrasado: Number(d.atrasado), encargos_hoje: Number(d.encargos_hoje), encargos_recebidos_mes: Number(d.encargos_recebidos_mes), meses: d.meses.map((m) => ({ ...m, valor: Number(m.valor) })) })
    })
  }, [unitId])

  if (!prev) return null
  const total6 = prev.meses.reduce((t, m) => t + m.valor, 0)
  if (prev.atrasado === 0 && total6 === 0 && prev.encargos_recebidos_mes === 0) return null
  const colunas = [{ rotulo: 'Atrasado', valor: prev.atrasado, atraso: true }, ...prev.meses.map((m) => ({ rotulo: MESES[Number(m.mes.slice(5, 7)) - 1], valor: m.valor, atraso: false }))]
  const max = Math.max(...colunas.map((c) => c.valor), 1)

  return (
    <Card title="Parcelas a receber">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <div className="bg-paper rounded-lg px-3 py-2">
          <p className="text-[11px] text-muted">Atrasado (todas as festas)</p>
          <p className={`font-display font-semibold tabular-nums ${prev.atrasado > 0 ? 'text-danger' : ''}`}>{brl(prev.atrasado)}</p>
          {prev.encargos_hoje > 0 && <p className="text-[11px] text-muted">+ {brl(prev.encargos_hoje)} de multa e juros até hoje</p>}
        </div>
        <div className="bg-paper rounded-lg px-3 py-2">
          <p className="text-[11px] text-muted">A receber este mês</p>
          <p className="font-display font-semibold tabular-nums">{brl(prev.meses[0]?.valor ?? 0)}</p>
        </div>
        <div className="bg-paper rounded-lg px-3 py-2">
          <p className="text-[11px] text-muted">A receber em 6 meses</p>
          <p className="font-display font-semibold tabular-nums">{brl(total6)}</p>
        </div>
        <div className="bg-paper rounded-lg px-3 py-2">
          <p className="text-[11px] text-muted">Multa e juros recebidos este mês</p>
          <p className="font-display font-semibold tabular-nums text-teal">{brl(prev.encargos_recebidos_mes)}</p>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-2 items-end h-44" role="img" aria-label={colunas.map((c) => `${c.rotulo}: ${brl(c.valor)}`).join('; ')}>
        {colunas.map((c) => (
          <div key={c.rotulo} className="flex flex-col items-center justify-end gap-1 h-full">
            <span className="text-[10px] font-semibold tabular-nums">{c.valor > 0 ? brl(c.valor).replace('R$', '').trim() : ''}</span>
            <div className={`w-full max-w-[48px] rounded-t ${c.atraso ? 'bg-danger' : 'bg-purple'}`} style={{ height: `${Math.max((c.valor / max) * 120, c.valor > 0 ? 3 : 0)}px` }} />
            <span className="text-[11px] text-muted">{c.rotulo}</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted mt-2">Parcelas em aberto pelo vencimento. Em vermelho, o que já venceu e não foi pago.</p>
    </Card>
  )
}
