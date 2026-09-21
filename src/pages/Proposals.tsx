import { FormEvent, useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { FileDown, Trash2 } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useUnit, UNITS } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import { useUndo } from '../lib/UndoContext'
import { packagePriceForDate } from '../types'
import { generateProposalPdf, type ProposalPrintData } from '../lib/proposalPdf'

interface PackageOption {
  id: string
  name: string
  price: number
  description: string | null
  weekday_price: number | null
  weekend_price: number | null
  unit_id: string | null
}
interface ExtraOption { id: string; name: string; price: number }

interface Proposal {
  id: string
  unidade: string
  unitId: string
  cliente: string
  dataEvento: string
  eventDateIso: string | null
  packageId: string | null
  pacoteNome: string
  extras: { name: string; price: number }[]
  total: number
  status: 'enviada' | 'aceita' | 'recusada'
  declineReason: string | null
}

function currency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

export function Proposals() {
  const { selectedUnit, unitDbIds } = useUnit()
  const { scheduleDelete } = useUndo()
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [packages, setPackages] = useState<PackageOption[]>([])
  const [extras, setExtras] = useState<ExtraOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [cliente, setCliente] = useState('')
  const [formUnidade, setFormUnidade] = useState(selectedUnit === 'todas' ? UNITS[0].id : selectedUnit)
  const [dataEvento, setDataEvento] = useState('')
  const [pacoteId, setPacoteId] = useState('')
  const [extraIds, setExtraIds] = useState<string[]>([])

  const [decliningId, setDecliningId] = useState<string | null>(null)
  const [declineReasonInput, setDeclineReasonInput] = useState('')

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    const dbIdToSlug: Record<string, string> = {}
    for (const slug of Object.keys(unitDbIds)) dbIdToSlug[unitDbIds[slug].unitId] = slug

    const [{ data: pkgs }, { data: extraData }, { data: props, error: propErr }] = await Promise.all([
      supabase.from('packages').select('id, name, base_price, weekday_price, weekend_price, description, unit_id').eq('active', true).order('name'),
      supabase.from('extra_items').select('id, name, price').order('name'),
      supabase.from('proposals').select('*').order('created_at', { ascending: false }),
    ])

    if (propErr) setError('Não foi possível carregar as propostas.')

    const pkgOptions = (pkgs ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      price: Number(p.base_price),
      weekday_price: p.weekday_price != null ? Number(p.weekday_price) : null,
      weekend_price: p.weekend_price != null ? Number(p.weekend_price) : null,
      description: p.description,
      unit_id: p.unit_id,
    }))
    setPackages(pkgOptions)
    setExtras((extraData ?? []).map((e) => ({ id: e.id, name: e.name, price: Number(e.price) })))

    setProposals(
      (props ?? []).map((p) => ({
        id: p.id,
        unidade: dbIdToSlug[p.unit_id] ?? '',
        unitId: p.unit_id,
        cliente: p.client_name,
        dataEvento: p.event_date ? format(parseISO(p.event_date), 'dd/MM/yyyy') : '',
        eventDateIso: p.event_date,
        packageId: p.package_id,
        pacoteNome: pkgOptions.find((pk) => pk.id === p.package_id)?.name ?? '—',
        extras: Array.isArray(p.extra_items) ? p.extra_items.map((e: any) => ({ name: e.name, price: Number(e.price) })) : [],
        total: Number(p.total_value),
        status: p.status,
        declineReason: p.decline_reason,
      })),
    )
    setLoading(false)
  }

  const pacotesDaUnidade = useMemo(() => {
    const dbIds = unitDbIds[formUnidade]
    return packages.filter((p) => !p.unit_id || p.unit_id === dbIds?.unitId)
  }, [packages, unitDbIds, formUnidade])

  useEffect(() => {
    if (pacotesDaUnidade.length > 0 && !pacotesDaUnidade.some((p) => p.id === pacoteId)) {
      setPacoteId(pacotesDaUnidade[0].id)
    } else if (pacotesDaUnidade.length === 0) {
      setPacoteId('')
    }
  }, [pacotesDaUnidade])

  const pacote = packages.find((p) => p.id === pacoteId)
  const pacotePrecoEfetivo = pacote
    ? dataEvento
      ? packagePriceForDate({ base_price: pacote.price, weekday_price: pacote.weekday_price, weekend_price: pacote.weekend_price }, dataEvento)
      : pacote.price
    : 0
  const extrasSelecionados = extras.filter((e) => extraIds.includes(e.id))
  const total = pacotePrecoEfetivo + extrasSelecionados.reduce((s, e) => s + e.price, 0)

  const filtered = useMemo(
    () => (selectedUnit === 'todas' ? proposals : proposals.filter((p) => p.unidade === selectedUnit)),
    [proposals, selectedUnit],
  )

  function toggleExtra(id: string) {
    setExtraIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleGenerate(e: FormEvent) {
    e.preventDefault()
    if (!cliente.trim() || !pacote) return

    const unitSlug = formUnidade
    const dbIds = unitDbIds[unitSlug]
    if (!dbIds) {
      setError('Não encontrei essa unidade no banco de dados ainda.')
      return
    }

    const { data: unitRow } = await supabase.from('units').select('name, full_address').eq('id', dbIds.unitId).maybeSingle()

    const proposalData = {
      cliente: cliente.trim(),
      dataEvento: dataEvento ? format(new Date(dataEvento + 'T00:00:00'), 'dd/MM/yyyy') : '',
      pacoteNome: pacote.name,
      extras: extrasSelecionados.map((e) => ({ name: e.name, price: e.price })),
      total,
    }

    const { data, error } = await supabase
      .from('proposals')
      .insert({
        unit_id: dbIds.unitId,
        client_name: cliente.trim(),
        event_date: dataEvento || null,
        package_id: pacote.id,
        extra_items: extrasSelecionados.map((e) => ({ name: e.name, price: e.price })),
        total_value: total,
        status: 'enviada',
      })
      .select()
      .single()

    if (error) {
      setError('Não foi possível salvar a proposta.')
      return
    }

    setProposals((prev) => [
      { id: data.id, unidade: unitSlug, unitId: dbIds.unitId, eventDateIso: dataEvento || null, packageId: pacote.id, status: 'enviada', declineReason: null, ...proposalData },
      ...prev,
    ])
    await generateProposalPdf({
      ...proposalData,
      pacoteDescricao: pacote.description,
      pacotePreco: pacotePrecoEfetivo,
      unidadeNome: unitRow?.name ?? '',
      unidadeEndereco: unitRow?.full_address ?? null,
    })

    setCliente('')
    setDataEvento('')
    setExtraIds([])
  }

  async function handleRegeneratePdf(p: Proposal) {
    const { data: unitRow } = await supabase.from('units').select('name, full_address').eq('id', p.unitId).maybeSingle()
    const pacote = packages.find((pk) => pk.id === p.packageId)
    const somaExtras = p.extras.reduce((s, e) => s + e.price, 0)
    await generateProposalPdf({
      cliente: p.cliente,
      dataEvento: p.dataEvento,
      pacoteNome: p.pacoteNome,
      pacoteDescricao: pacote?.description ?? null,
      pacotePreco: p.total - somaExtras,
      extras: p.extras,
      total: p.total,
      unidadeNome: unitRow?.name ?? '',
      unidadeEndereco: unitRow?.full_address ?? null,
    })
  }

  async function updateStatus(id: string, status: Proposal['status']) {
    if (status === 'recusada') {
      setDecliningId(id)
      setDeclineReasonInput('')
      return
    }
    setProposals((prev) => prev.map((p) => (p.id === id ? { ...p, status, declineReason: null } : p)))
    await supabase.from('proposals').update({ status, decline_reason: null }).eq('id', id)
  }

  async function handleConfirmDecline(e: FormEvent) {
    e.preventDefault()
    if (!decliningId) return
    const reason = declineReasonInput.trim() || null
    setProposals((prev) => prev.map((p) => (p.id === decliningId ? { ...p, status: 'recusada', declineReason: reason } : p)))
    await supabase.from('proposals').update({ status: 'recusada', decline_reason: reason }).eq('id', decliningId)
    setDecliningId(null)
  }

  function handleRemove(id: string) {
    const proposal = proposals.find((p) => p.id === id)
    if (!proposal) return
    setProposals((prev) => prev.filter((p) => p.id !== id))
    scheduleDelete({
      label: `Proposta de "${proposal.cliente}" removida`,
      commit: async () => {
        await supabase.from('proposals').delete().eq('id', id)
      },
      undo: async () => {
        await supabase.from('proposals').insert({
          id,
          unit_id: proposal.unitId,
          client_name: proposal.cliente,
          event_date: proposal.eventDateIso,
          package_id: proposal.packageId,
          extra_items: proposal.extras,
          total_value: proposal.total,
          status: proposal.status,
          decline_reason: proposal.declineReason,
        })
        setProposals((prev) => [...prev, proposal])
      },
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Propostas comerciais</h1>
        <p className="text-sm text-muted mt-1">Monte uma proposta e gere o PDF para enviar ao cliente</p>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      <Card title="Nova proposta">
        {loading ? (
          <p className="text-sm text-muted py-4 text-center">Carregando...</p>
        ) : packages.length === 0 ? (
          <p className="text-sm text-muted">Cadastre pelo menos um pacote em "Pacotes e itens" antes de montar uma proposta.</p>
        ) : (
          <form onSubmit={handleGenerate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">Cliente</label>
                <input
                  type="text"
                  required
                  value={cliente}
                  onChange={(e) => setCliente(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  placeholder="Nome do cliente"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Data do evento (opcional)</label>
                <input
                  type="date"
                  value={dataEvento}
                  onChange={(e) => setDataEvento(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1">Unidade</label>
              <select value={formUnidade} onChange={(e) => setFormUnidade(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                {UNITS.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1">Pacote</label>
              {pacotesDaUnidade.length === 0 ? (
                <p className="text-xs text-muted">Nenhum pacote cadastrado para esta unidade ainda.</p>
              ) : (
                <>
                  <select value={pacoteId} onChange={(e) => setPacoteId(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                    {pacotesDaUnidade.map((p) => {
                      const preco = dataEvento ? packagePriceForDate({ base_price: p.price, weekday_price: p.weekday_price, weekend_price: p.weekend_price }, dataEvento) : p.price
                      return (
                        <option key={p.id} value={p.id}>
                          {p.name} — {currency(preco)}
                        </option>
                      )
                    })}
                  </select>
                  {pacote?.weekend_price != null && (
                    <p className="text-xs text-muted mt-1">
                      {dataEvento
                        ? 'Preço já ajustado pelo dia da semana da data escolhida.'
                        : 'Esse pacote tem preço diferente por dia da semana — escolha a data do evento para ver o valor certo.'}
                    </p>
                  )}
                </>
              )}
            </div>

            {extras.length > 0 && (
              <div>
                <label className="block text-xs text-muted mb-2">Itens extras</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {extras.map((extra) => (
                    <label key={extra.id} className="flex items-center gap-2 text-sm border border-line rounded-lg px-3 py-2">
                      <input type="checkbox" checked={extraIds.includes(extra.id)} onChange={() => toggleExtra(extra.id)} />
                      {extra.name} — {currency(extra.price)}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-line">
              <p className="text-lg font-display font-semibold">Total: {currency(total)}</p>
              <Button type="submit">
                <FileDown className="w-4 h-4" /> Gerar proposta em PDF
              </Button>
            </div>
            <p className="text-xs text-muted">
              Ao clicar, abre uma janela pronta para impressão — escolha "Salvar como PDF" na tela de impressão do
              navegador.
            </p>
          </form>
        )}
      </Card>

      <Card title="Propostas enviadas">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma proposta gerada ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="pb-3 font-medium">Cliente</th>
                <th className="pb-3 font-medium">Pacote</th>
                <th className="pb-3 font-medium">Valor</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td className="py-3 font-medium">
                    {p.cliente}
                    {p.status === 'recusada' && p.declineReason && (
                      <p className="text-xs text-danger font-normal mt-0.5">Motivo: {p.declineReason}</p>
                    )}
                  </td>
                  <td className="py-3 text-muted">{p.pacoteNome}</td>
                  <td className="py-3">{currency(p.total)}</td>
                  <td className="py-3">
                    <select
                      value={p.status}
                      onChange={(e) => updateStatus(p.id, e.target.value as Proposal['status'])}
                      className="border border-line rounded-lg px-2 py-1 text-xs"
                    >
                      <option value="enviada">Enviada</option>
                      <option value="aceita">Aceita</option>
                      <option value="recusada">Recusada</option>
                    </select>
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={() => handleRegeneratePdf(p)} className="text-purple text-xs font-medium flex items-center gap-1">
                        <FileDown className="w-3.5 h-3.5" /> Gerar PDF
                      </button>
                      <button onClick={() => handleRemove(p.id)} className="text-muted hover:text-danger" aria-label="Remover">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {decliningId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setDecliningId(null)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl">
            <h2 className="text-lg font-display font-semibold mb-1">Motivo da recusa</h2>
            <p className="text-sm text-muted mb-4">Ajuda a entender por que essa proposta não avançou.</p>
            <form onSubmit={handleConfirmDecline} className="space-y-3">
              <textarea
                value={declineReasonInput}
                onChange={(e) => setDeclineReasonInput(e.target.value)}
                rows={3}
                placeholder="Ex: Achou o valor alto, fechou com outro espaço..."
                className="w-full border border-line rounded-lg px-3 py-2 text-sm"
              />
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="secondary" className="flex-1 justify-center" onClick={() => setDecliningId(null)}>
                  Cancelar
                </Button>
                <Button type="submit" className="flex-1 justify-center">
                  Confirmar recusa
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
