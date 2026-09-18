import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { FileDown } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useUnit } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'

interface StaffRow { name: string; role: string }
interface FestaEscala {
  id: string
  unitId: string
  data: string
  dataIso: string
  horario: string
  cliente: string
  tipoEvento: string
  unidadeNome: string
  staff: StaffRow[]
}

function formatHour(t: string) {
  const [h, m] = t.split(':')
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function addDaysIso(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function Schedules() {
  const navigate = useNavigate()
  const { selectedUnit, unitDbIds } = useUnit()
  const [from, setFrom] = useState(todayIso())
  const [to, setTo] = useState(addDaysIso(14))
  const [festas, setFestas] = useState<FestaEscala[]>([])
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
      .select('id, event_date, start_time, end_time, event_type, unit_id, client:clients(name), unit:units(name), staff_assignments(staff_name, role)')
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

    setFestas(
      (data ?? []).map((r: any) => ({
        id: r.id,
        unitId: r.unit_id,
        data: format(parseISO(r.event_date), 'dd/MM/yyyy'),
        dataIso: r.event_date,
        horario: `${formatHour(String(r.start_time).slice(0, 5))}–${formatHour(String(r.end_time).slice(0, 5))}`,
        cliente: r.client?.name ?? '—',
        tipoEvento: r.event_type ?? 'Outro',
        unidadeNome: r.unit?.name ?? '',
        staff: (r.staff_assignments ?? []).map((s: any) => ({ name: s.staff_name, role: s.role ?? 'Equipe' })),
      })),
    )
    setLoading(false)
  }

  const visibleFestas = useMemo(() => {
    if (selectedUnit === 'todas') return festas
    const unitId = unitDbIds[selectedUnit]?.unitId
    return festas.filter((f) => f.unitId === unitId)
  }, [festas, selectedUnit, unitDbIds])

  function handleExport() {
    const win = window.open('', '_blank', 'width=800,height=900')
    if (!win) return
    const blocks = visibleFestas.length
      ? visibleFestas
          .map(
            (f) => `
              <div class="festa">
                <h3>${f.data} · ${f.horario} — ${f.unidadeNome}</h3>
                <p class="subtitle">${f.tipoEvento} de ${f.cliente}</p>
                <table>
                  <thead><tr><th>Nome</th><th>Função</th></tr></thead>
                  <tbody>
                    ${
                      f.staff.length
                        ? f.staff.map((s) => `<tr><td>${s.name}</td><td>${s.role}</td></tr>`).join('')
                        : '<tr><td colspan="2">Sem equipe escalada ainda</td></tr>'
                    }
                  </tbody>
                </table>
              </div>`,
          )
          .join('')
      : '<p>Nenhuma festa neste período.</p>'

    win.document.write(`
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <title>Escala — ${format(parseISO(from), 'dd/MM')} a ${format(parseISO(to), 'dd/MM')}</title>
          <style>
            body { font-family: Arial, Helvetica, sans-serif; color: #241B33; padding: 32px; }
            h1 { color: #6D28D9; font-size: 20px; margin-bottom: 24px; }
            .festa { margin-bottom: 24px; page-break-inside: avoid; }
            .festa h3 { margin-bottom: 2px; font-size: 15px; }
            .festa .subtitle { margin: 0 0 8px; color: #6E6880; font-size: 13px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { text-align: left; padding: 6px; border-bottom: 1px solid #E2DBEE; font-size: 13px; }
          </style>
        </head>
        <body>
          <h1>Escala de festas — ${format(parseISO(from), 'dd/MM/yyyy')} a ${format(parseISO(to), 'dd/MM/yyyy')}</h1>
          ${blocks}
        </body>
      </html>
    `)
    win.document.close()
    win.focus()
    // Pequeno atraso pra dar tempo do navegador terminar de desenhar a página
    // antes de abrir a caixa de impressão — senão alguns navegadores abrem a
    // caixa com a página ainda em branco, o que impede de "Salvar como PDF".
    setTimeout(() => win.print(), 300)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Escalas</h1>
          <p className="text-sm text-muted mt-1">Equipe escalada em cada festa do período, pronta pra exportar</p>
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
        ) : visibleFestas.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma festa nesse período.</p>
        ) : (
          <ul className="divide-y divide-line">
            {visibleFestas.map((f) => (
              <li key={f.id} className="py-3">
                <button onClick={() => navigate(`/reservas/${f.id}`)} className="flex items-center justify-between w-full text-left hover:bg-paper/60 -mx-2 px-2 py-1 rounded-lg transition-colors">
                  <div>
                    <p className="text-sm font-medium">{f.data} · {f.horario} — {f.tipoEvento} de {f.cliente}</p>
                    <p className="text-xs text-muted mt-0.5">{f.unidadeNome}</p>
                  </div>
                  <span className="text-xs text-muted">
                    {f.staff.length > 0 ? `${f.staff.length} escalado(s)` : 'Sem equipe ainda'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
