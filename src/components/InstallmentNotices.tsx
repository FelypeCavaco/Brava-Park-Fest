import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from './ui/Card'
import { supabase } from '../lib/supabaseClient'
import { useUnit } from '../lib/UnitContext'
import { brl, todayIso } from '../lib/format'
import { buildMessage, MESSAGE_TEMPLATES, openWhatsApp } from '../lib/whatsapp'

// Painel: parcelas atrasadas e as que vencem nos próximos 7 dias (empresas
// no modo "parcelas programadas"). Some sozinho quando não há nada.

interface Linha {
  reservation_id: string
  unit_id: string
  cliente: string
  telefone: string | null
  crianca: string | null
  event_date: string
  token: string | null
  seq: number
  label: string
  vencimento: string
  aberto: number
  status: string
  dias_atraso: number
  multa: number
  juros: number
  total_hoje: number
}

const dm = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7)

export function InstallmentNotices() {
  const navigate = useNavigate()
  const { selectedUnit, unitDbIds } = useUnit()
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [pix, setPix] = useState<Record<string, string | null>>({})
  const hoje = todayIso()

  useEffect(() => {
    ;(async () => {
      const [{ data, error }, { data: us }] = await Promise.all([
        supabase.rpc('installments_attention', { p_days: 7 }),
        supabase.from('units').select('id, pix_key'),
      ])
      if (error) return // sem permissão ou sem a migração 075: não mostra
      setLinhas(((data ?? []) as Linha[]).map((l) => ({ ...l, aberto: Number(l.aberto), multa: Number(l.multa), juros: Number(l.juros), total_hoje: Number(l.total_hoje) })))
      setPix(Object.fromEntries((us ?? []).map((u: any) => [u.id, u.pix_key])))
    })()
  }, [])

  const unitFilter = selectedUnit === 'todas' ? null : unitDbIds[selectedUnit]?.unitId ?? null
  const visiveis = linhas
    .filter((l) => !unitFilter || l.unit_id === unitFilter)
    .sort((a, b) => (a.status === 'atrasada' ? 0 : 1) - (b.status === 'atrasada' ? 0 : 1) || a.vencimento.localeCompare(b.vencimento))
  if (visiveis.length === 0) return null
  const atrasadas = visiveis.filter((l) => l.status === 'atrasada').length

  function lembrar(l: Linha) {
    const encargos = l.multa + l.juros
    const link = l.token ? `${window.location.origin}/portal/${l.token}` : ''
    openWhatsApp(l.telefone, buildMessage(MESSAGE_TEMPLATES.lembrete_parcela, {
      cliente: l.cliente.split(' ')[0],
      parcela: l.label.toLowerCase(),
      festa: l.crianca ? `festa ${/a$/i.test(l.crianca.trim()) ? 'da' : 'do'} ${l.crianca}` : 'festa',
      valor: brl(l.aberto),
      vencimento: l.status === 'atrasada' ? `que venceu em ${dm(l.vencimento)}` : l.vencimento === hoje ? 'que vence hoje' : `que vence em ${dm(l.vencimento)}`,
      encargos: encargos > 0 ? `\nCom a multa e os juros previstos no contrato, o valor para pagamento hoje é ${brl(l.total_hoje)}.` : '',
      pix: pix[l.unit_id] ? `\nPode pagar pelo Pix (chave: ${pix[l.unit_id]})` : '',
      link: link ? ` e enviar o comprovante pelo portal: ${link}` : '',
    }))
  }

  return (
    <Card title={`Parcelas · ${atrasadas ? `${atrasadas} atrasada${atrasadas > 1 ? 's' : ''}, ` : ''}${visiveis.length - atrasadas} vence${visiveis.length - atrasadas === 1 ? '' : 'm'} esta semana`}
      className={atrasadas ? 'border-danger/40' : ''}>
      <ul className="divide-y divide-line">
        {visiveis.map((l) => {
          const pill = l.status === 'atrasada' ? 'bg-danger-light text-danger' : l.vencimento === hoje ? 'bg-amber-light text-amber' : 'bg-line/60 text-muted'
          const quando = l.status === 'atrasada' ? `Atrasada ${l.dias_atraso} ${l.dias_atraso === 1 ? 'dia' : 'dias'}`
            : l.vencimento === hoje ? 'Vence hoje'
            : `Vence ${dm(l.vencimento)}`
          return (
            <li key={`${l.reservation_id}-${l.seq}`} className="py-3 flex flex-wrap gap-3 items-center">
              <span className={`text-[11px] font-semibold rounded-full px-2 py-1 ${pill}`}>{quando}</span>
              <div className="flex-1 min-w-[200px]">
                <p className="text-sm">
                  <strong className="font-semibold">{l.cliente}</strong> — {l.label.toLowerCase()} de {brl(l.aberto)}
                  {l.multa + l.juros > 0 && <span className="text-danger font-semibold"> · hoje {brl(l.total_hoje)} com multa e juros</span>}
                </p>
                <p className="text-xs text-muted">Festa {l.crianca ? `de ${l.crianca} ` : ''}· {dm(l.event_date)}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => navigate(`/reservas/${l.reservation_id}?aba=financeiro`)} className="text-xs border border-line rounded-lg px-2.5 py-1.5">Abrir festa</button>
                {l.telefone && <button onClick={() => lembrar(l)} className="text-xs bg-teal text-white font-semibold rounded-lg px-2.5 py-1.5">Lembrar no WhatsApp</button>}
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
