import { FormEvent, useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { FileDown, FileText, Pencil, Trash2 } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { supabase } from '../lib/supabaseClient'
import { buildContractVariables, renderContractTemplate } from '../lib/contractEngine'
import { useUndo } from '../lib/UndoContext'
import { downloadPdf } from '../lib/pdfExport'
import type { Client, ContractTemplate, Package, Reservation, Unit } from '../types'

interface ContractRow {
  reservationId: string
  cliente: string
  evento: string
  unitId: string
  unitName: string
  contractId: string | null
  termsText: string | null
  reservation: Reservation
  client: Client
  unit: Unit
  pkg: Package | null
  firstPaymentAmount: number | null
}

async function openContractPrintWindow(cliente: string, text: string) {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const styles = `
    .pdf-body { font-family: Arial, Helvetica, sans-serif; color: #241B33; padding: 40px; white-space: pre-wrap; line-height: 1.6; }
    h1 { color: #6D28D9; font-size: 18px; }
  `
  await downloadPdf(escaped, styles, `contrato-${cliente.replace(/\s+/g, '-').toLowerCase()}.pdf`)
}

export function Contracts() {
  const { scheduleDelete } = useUndo()
  const [contracts, setContracts] = useState<ContractRow[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [templates, setTemplates] = useState<Record<string, ContractTemplate>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editingUnitId, setEditingUnitId] = useState<string | null>(null)
  const [templateDraft, setTemplateDraft] = useState('')

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: units }, { data: templatesData }, { data: reservations, error: resError }] = await Promise.all([
      supabase.from('units').select('*').order('name'),
      supabase.from('contract_templates').select('*'),
      supabase
        .from('reservations')
        .select(
          '*, client:clients(*), unit:units(*), package:packages(*), contracts(id, terms_text), payments(amount, payment_date)',
        )
        .neq('status', 'cancelada')
        .order('event_date', { ascending: false }),
    ])

    if (resError) {
      setError('Não foi possível carregar os contratos.')
      setLoading(false)
      return
    }

    setUnits((units ?? []) as Unit[])
    const templateMap: Record<string, ContractTemplate> = {}
    for (const t of (templatesData ?? []) as ContractTemplate[]) templateMap[t.unit_id] = t
    setTemplates(templateMap)

    setContracts(
      (reservations ?? []).map((r: any) => {
        const pagamentos = (r.payments ?? []) as { amount: string | number; payment_date: string }[]
        const primeiro = pagamentos.sort((a, b) => (a.payment_date < b.payment_date ? -1 : 1))[0]
        return {
          reservationId: r.id,
          cliente: r.client?.name ?? '—',
          evento: format(parseISO(r.event_date), 'dd/MM/yyyy'),
          unitId: r.unit_id,
          unitName: r.unit?.name ?? '—',
          contractId: r.contracts?.[0]?.id ?? null,
          termsText: r.contracts?.[0]?.terms_text ?? null,
          reservation: r as Reservation,
          client: r.client as Client,
          unit: r.unit as Unit,
          pkg: (r.package as Package) ?? null,
          firstPaymentAmount: primeiro ? Number(primeiro.amount) : null,
        }
      }),
    )
    setLoading(false)
  }

  async function handleGenerate(row: ContractRow) {
    const template = templates[row.unitId]
    if (!template) {
      setError(`Cadastre o template de contrato da unidade "${row.unitName}" antes de gerar.`)
      return
    }

    const variables = buildContractVariables({
      reservation: row.reservation,
      client: row.client,
      unit: row.unit,
      pkg: row.pkg,
      firstPaymentAmount: row.firstPaymentAmount,
    })
    const text = renderContractTemplate(template.body, variables)
    openContractPrintWindow(row.cliente, text)

    if (row.contractId) {
      await supabase.from('contracts').update({ terms_text: text, generated_at: new Date().toISOString() }).eq('id', row.contractId)
    } else {
      const { data } = await supabase
        .from('contracts')
        .insert({ reservation_id: row.reservationId, terms_text: text, generated_at: new Date().toISOString() })
        .select('id')
        .single()
      if (data) {
        setContracts((prev) => prev.map((c) => (c.reservationId === row.reservationId ? { ...c, contractId: data.id, termsText: text } : c)))
      }
    }
  }

  function handleView(row: ContractRow) {
    if (row.termsText) openContractPrintWindow(row.cliente, row.termsText)
  }

  function handleDeleteContract(row: ContractRow) {
    if (!row.contractId) return
    const contractId = row.contractId
    const previousTermsText = row.termsText
    setContracts((prev) => prev.map((c) => (c.reservationId === row.reservationId ? { ...c, contractId: null, termsText: null } : c)))
    scheduleDelete({
      label: `Contrato de "${row.cliente}" removido`,
      commit: async () => {
        await supabase.from('contracts').delete().eq('id', contractId)
      },
      undo: async () => {
        await supabase.from('contracts').insert({ id: contractId, reservation_id: row.reservationId, terms_text: previousTermsText, generated_at: new Date().toISOString() })
        setContracts((prev) =>
          prev.map((c) => (c.reservationId === row.reservationId ? { ...c, contractId, termsText: previousTermsText } : c)),
        )
      },
    })
  }

  function openTemplateEditor(unitId: string) {
    setEditingUnitId(unitId)
    setTemplateDraft(templates[unitId]?.body ?? '')
  }

  async function handleSaveTemplate(e: FormEvent) {
    e.preventDefault()
    if (!editingUnitId) return
    const { data, error } = await supabase
      .from('contract_templates')
      .upsert({ unit_id: editingUnitId, body: templateDraft, updated_at: new Date().toISOString() }, { onConflict: 'unit_id' })
      .select()
      .single()
    if (error) {
      setError('Não foi possível salvar o template.')
      return
    }
    setTemplates((prev) => ({ ...prev, [editingUnitId]: data as ContractTemplate }))
    setEditingUnitId(null)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Contratos</h1>
        <p className="text-sm text-muted mt-1">Gerados automaticamente a partir dos dados de cada reserva</p>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      <Card title="Template do contrato por unidade">
        <p className="text-sm text-muted mb-4">
          Cada unidade tem seu próprio texto-base, já que os dados da contratada e os planos mudam entre elas. Use
          variáveis como <code className="bg-paper px-1.5 py-0.5 rounded text-xs">{'{{contratante_nome}}'}</code>,{' '}
          <code className="bg-paper px-1.5 py-0.5 rounded text-xs">{'{{evento_data}}'}</code> e{' '}
          <code className="bg-paper px-1.5 py-0.5 rounded text-xs">{'{{valor_total}}'}</code> — elas são substituídas
          automaticamente ao gerar.
        </p>
        <div className="space-y-2">
          {units.map((u) => (
            <div key={u.id} className="flex items-center justify-between border border-line rounded-lg px-4 py-2.5">
              <div>
                <p className="text-sm font-medium">{u.name}</p>
                <p className="text-xs text-muted">{templates[u.id] ? 'Template cadastrado' : 'Nenhum template cadastrado ainda'}</p>
              </div>
              <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => openTemplateEditor(u.id)}>
                <Pencil className="w-3.5 h-3.5" /> {templates[u.id] ? 'Editar' : 'Cadastrar'}
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Contratos por reserva">
        {loading ? (
          <p className="text-sm text-muted py-4 text-center">Carregando...</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="pb-3 font-medium">Cliente</th>
                <th className="pb-3 font-medium">Evento</th>
                <th className="pb-3 font-medium">Unidade</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {contracts.map((c) => (
                <tr key={c.reservationId}>
                  <td className="py-3 font-medium">{c.cliente}</td>
                  <td className="py-3 text-muted">{c.evento}</td>
                  <td className="py-3 text-muted">{c.unitName}</td>
                  <td className="py-3">
                    {c.contractId ? (
                      <span className="inline-flex items-center gap-1 text-teal text-xs">
                        <FileText className="w-3.5 h-3.5" /> Gerado
                      </span>
                    ) : (
                      <span className="text-xs text-muted">Não gerado</span>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => (c.contractId ? handleView(c) : handleGenerate(c))}>
                        <FileDown className="w-3.5 h-3.5" />
                        {c.contractId ? 'Ver / Reimprimir' : 'Gerar PDF'}
                      </Button>
                      {c.contractId && (
                        <button onClick={() => handleDeleteContract(c)} className="text-muted hover:text-danger" aria-label="Excluir contrato">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {contracts.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-muted">Nenhuma reserva encontrada.</td></tr>
              )}
            </tbody>
          </table>
        )}
        <p className="text-xs text-muted mt-3">
          "Gerar PDF" abre uma janela pronta para impressão — escolha "Salvar como PDF" na tela de impressão do
          navegador. O texto gerado fica guardado com a reserva mesmo que o template mude depois.
        </p>
      </Card>

      {editingUnitId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setEditingUnitId(null)} />
          <div className="relative w-full max-w-2xl bg-surface rounded-card p-6 shadow-xl">
            <h2 className="text-lg font-display font-semibold mb-4">
              Template — {units.find((u) => u.id === editingUnitId)?.name}
            </h2>
            <form onSubmit={handleSaveTemplate} className="space-y-3">
              <textarea
                value={templateDraft}
                onChange={(e) => setTemplateDraft(e.target.value)}
                rows={16}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm font-mono"
              />
              <Button type="submit" className="w-full justify-center">Salvar template</Button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
