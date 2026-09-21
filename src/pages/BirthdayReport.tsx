import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { FileDown } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useUnit, UNITS } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import { downloadPdf } from '../lib/pdfExport'

interface BirthdayRow {
  id: string
  unitId: string
  unidadeNome: string
  data: string
  dataIso: string
  horarioFesta: string
  horarioFornecedores: string
  aniversariante: string
  idade: string
  convidados: string
  tema: string
  pratoQuente: string
  bolo: string
}

function formatHour(t: string) {
  const [h, m] = t.split(':')
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}

// Fornecedores sempre entregam 1h antes do início da festa.
function oneHourBefore(t: string) {
  const [h, m] = t.split(':').map(Number)
  const total = (h * 60 + m - 60 + 24 * 60) % (24 * 60)
  const hh = Math.floor(total / 60)
  const mm = total % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function addDaysIso(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function BirthdayReport() {
  const { selectedUnit, unitDbIds } = useUnit()
  const [from, setFrom] = useState(todayIso())
  const [to, setTo] = useState(addDaysIso(30))
  const [rows, setRows] = useState<BirthdayRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadFestas()
  }, [from, to])

  async function loadFestas() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('reservations')
      .select('id, event_date, start_time, unit_id, child_name, child_age, guest_count, courtesy_guests, theme, hot_dish_flavors, cake_flavor, unit:units(name)')
      .neq('status', 'cancelada')
      .gte('event_date', from)
      .lte('event_date', to)
      .order('event_date')
      .order('start_time')

    if (error) {
      setError('Não foi possível carregar as festas do período.')
      setLoading(false)
      return
    }

    setRows(
      (data ?? []).map((r: any) => {
        const startTime = String(r.start_time).slice(0, 5)
        return {
          id: r.id,
          unitId: r.unit_id,
          unidadeNome: r.unit?.name ?? '',
          data: format(parseISO(r.event_date), 'dd/MM/yyyy'),
          dataIso: r.event_date,
          horarioFesta: formatHour(startTime),
          horarioFornecedores: formatHour(oneHourBefore(startTime)),
          aniversariante: r.child_name ?? '—',
          idade: r.child_age != null ? `${r.child_age} anos` : '—',
          convidados: `${r.guest_count ?? 0}${r.courtesy_guests ? ` + ${r.courtesy_guests} cortesia` : ''}`,
          tema: r.theme ?? '—',
          pratoQuente: r.hot_dish_flavors ?? '—',
          bolo: r.cake_flavor ?? '—',
        }
      }),
    )
    setLoading(false)
  }

  const visibleRows = useMemo(() => {
    if (selectedUnit === 'todas') return rows
    const unitId = unitDbIds[selectedUnit]?.unitId
    return rows.filter((r) => r.unitId === unitId)
  }, [rows, selectedUnit, unitDbIds])

  async function handleExport() {
    const body = visibleRows.length
      ? `
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Horário fornecedores</th>
              <th>Horário da festa</th>
              <th>Unidade</th>
              <th>Aniversariante</th>
              <th>Vai fazer</th>
              <th>Convidados</th>
              <th>Tema</th>
              <th>Sabores do prato quente</th>
              <th>Sabor do bolo</th>
            </tr>
          </thead>
          <tbody>
            ${visibleRows
              .map(
                (r) => `
                  <tr>
                    <td>${r.data}</td>
                    <td>${r.horarioFornecedores}</td>
                    <td>${r.horarioFesta}</td>
                    <td>${r.unidadeNome}</td>
                    <td>${r.aniversariante}</td>
                    <td>${r.idade}</td>
                    <td>${r.convidados}</td>
                    <td>${r.tema}</td>
                    <td>${r.pratoQuente}</td>
                    <td>${r.bolo}</td>
                  </tr>`,
              )
              .join('')}
          </tbody>
        </table>`
      : '<p>Nenhuma festa neste período.</p>'

    const styles = `
      .pdf-body { font-family: Arial, Helvetica, sans-serif; color: #241B33; padding: 32px; }
      h1 { color: #6D28D9; font-size: 20px; margin-bottom: 24px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 8px; border-bottom: 1px solid #E2DBEE; font-size: 12px; }
      th { color: #6E6880; font-weight: 600; }
    `
    const bodyHtml = `
      <h1>Relatório de aniversariantes — ${format(parseISO(from), 'dd/MM/yyyy')} a ${format(parseISO(to), 'dd/MM/yyyy')}</h1>
      ${body}
    `
    await downloadPdf(bodyHtml, styles, `aniversariantes-${from}-a-${to}.pdf`, 'landscape')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Relatório de aniversariantes</h1>
          <p className="text-sm text-muted mt-1">
            Data, tema, idade, horário de entrega dos fornecedores e sabores escolhidos — tudo que a cozinha e os
            fornecedores precisam saber, por período
          </p>
        </div>
        <Button onClick={handleExport}>
          <FileDown className="w-4 h-4" /> Exportar período
        </Button>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-muted mb-1">De</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-line rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Até</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-line rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
      </Card>

      <Card title="Festas no período">
        {loading ? (
          <p className="text-sm text-muted py-6 text-center">Carregando...</p>
        ) : visibleRows.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma festa nesse período.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="pb-3 font-medium">Data</th>
                <th className="pb-3 font-medium">Entrega fornecedores</th>
                <th className="pb-3 font-medium">Horário da festa</th>
                {selectedUnit === 'todas' && <th className="pb-3 font-medium">Unidade</th>}
                <th className="pb-3 font-medium">Aniversariante</th>
                <th className="pb-3 font-medium">Vai fazer</th>
                <th className="pb-3 font-medium">Convidados</th>
                <th className="pb-3 font-medium">Tema</th>
                <th className="pb-3 font-medium">Prato quente</th>
                <th className="pb-3 font-medium">Bolo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visibleRows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2.5">{r.data}</td>
                  <td className="py-2.5 text-muted">{r.horarioFornecedores}</td>
                  <td className="py-2.5 text-muted">{r.horarioFesta}</td>
                  {selectedUnit === 'todas' && <td className="py-2.5">{r.unidadeNome}</td>}
                  <td className="py-2.5 font-medium">{r.aniversariante}</td>
                  <td className="py-2.5">{r.idade}</td>
                  <td className="py-2.5">{r.convidados}</td>
                  <td className="py-2.5">{r.tema}</td>
                  <td className="py-2.5">{r.pratoQuente}</td>
                  <td className="py-2.5">{r.bolo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
