import { FormEvent, useEffect, useState } from 'react'
import { Trash2, Eye, EyeOff, Plus, Pencil, X } from 'lucide-react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Can } from './Can'
import { supabase } from '../lib/supabaseClient'
import { friendlyDbError } from '../lib/format'
import { UNITS, useUnit } from '../lib/UnitContext'

// Cardápio que o cliente escolhe no portal, montado em seções (ex.: "Pratos
// quentes", "Massa do bolo", "Sabores de suco"). Cada seção diz quantas
// escolhas a festa faz e pode valer para todas as unidades ou só uma.
// Ocultar tira do portal sem apagar escolhas já feitas.

type Modo = 'uma' | 'varias' | 'pacote'

interface Secao {
  id: string
  name: string
  help: string | null
  mode: Modo
  quantity: number
  allow_other: boolean
  other_label: string
  unit_id: string | null
  legacy_field: string | null
  sort: number
  active: boolean
}

interface Opcao {
  id: string
  section_id: string
  name: string
  sort: number
  active: boolean
}

interface Rascunho {
  id: string | null
  name: string
  help: string
  mode: Modo
  quantity: string
  allow_other: boolean
  other_label: string
  unit: string // '' = todas
}

const MODO_LABEL: Record<Modo, string> = {
  uma: 'Escolhe 1 opção',
  varias: 'Escolhe várias (quantidade fixa)',
  pacote: 'Quantidade definida pelo pacote',
}

export function PortalMenuEditor() {
  const { unitDbIds } = useUnit()
  const [secoes, setSecoes] = useState<Secao[]>([])
  const [opcoes, setOpcoes] = useState<Opcao[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [form, setForm] = useState<Rascunho | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [semMigracao, setSemMigracao] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const [{ data: s, error: e1 }, { data: o }] = await Promise.all([
      supabase.from('menu_sections').select('*').order('sort').order('created_at'),
      supabase.from('portal_menu_options').select('id, section_id, name, sort, active').not('section_id', 'is', null).order('sort').order('name'),
    ])
    if (e1) return setSemMigracao(true)
    setSecoes((s ?? []) as Secao[])
    setOpcoes((o ?? []) as Opcao[])
  }

  const unitName = (id: string | null) => (id ? UNITS.find((u) => unitDbIds[u.id]?.unitId === id)?.name ?? '—' : 'Todas as unidades')
  const unitSlug = (id: string | null) => (id ? UNITS.find((u) => unitDbIds[u.id]?.unitId === id)?.id ?? '' : '')

  function descricao(sc: Secao) {
    const q = sc.mode === 'uma' ? '1 escolha' : sc.mode === 'varias' ? `${sc.quantity} escolhas` : 'quantidade pelo pacote (pratos quentes inclusos + extras)'
    return [q, sc.allow_other ? `aceita "${sc.other_label}"` : null, unitName(sc.unit_id)].filter(Boolean).join(' · ')
  }

  async function salvarSecao(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    const q = Number.parseInt(form.quantity, 10)
    if (!form.name.trim()) return setError('Dê um nome para a seção.')
    if (form.mode === 'varias' && (!Number.isFinite(q) || q < 2 || q > 30)) return setError('Em "várias", a quantidade precisa ser de 2 a 30.')
    if (form.allow_other && !form.other_label.trim()) return setError('Escreva o texto da opção "outro".')
    // Massa e recheio do bolo alimentam campos de uma escolha só (relatório de
    // aniversariantes, mensagens aos fornecedores).
    const legado = secoes.find((x) => x.id === form.id)?.legacy_field
    if ((legado === 'cake_dough' || legado === 'cake_flavor') && form.mode !== 'uma') return setError('Esta seção alimenta o relatório de aniversariantes e as mensagens aos fornecedores, e precisa continuar com 1 escolha.')
    const payload = {
      name: form.name.trim(),
      help: form.help.trim() || null,
      mode: form.mode,
      quantity: form.mode === 'varias' ? q : 1,
      allow_other: form.allow_other,
      other_label: form.other_label.trim() || 'Outro (combinar com a equipe)',
      unit_id: form.unit ? unitDbIds[form.unit]?.unitId ?? null : null,
    }
    const { error: err } = form.id
      ? await supabase.from('menu_sections').update(payload).eq('id', form.id)
      : await supabase.from('menu_sections').insert({ ...payload, sort: Math.max(0, ...secoes.map((x) => x.sort)) + 1 })
    if (err) return setError(friendlyDbError(err.message))
    setError(null)
    setForm(null)
    await load()
  }

  async function toggleSecao(sc: Secao) {
    const { error: err } = await supabase.from('menu_sections').update({ active: !sc.active }).eq('id', sc.id)
    if (err) return setError(friendlyDbError(err.message))
    setSecoes((prev) => prev.map((x) => (x.id === sc.id ? { ...x, active: !sc.active } : x)))
  }

  async function apagarSecao(sc: Secao) {
    if (!window.confirm(`Apagar a seção "${sc.name}" e as opções dela? As escolhas já feitas pelos clientes nesta seção deixam de aparecer.`)) return
    const { error: err } = await supabase.from('menu_sections').delete().eq('id', sc.id)
    if (err) return setError(friendlyDbError(err.message))
    await load()
  }

  async function addOpcao(e: FormEvent, sc: Secao) {
    e.preventDefault()
    const name = (drafts[sc.id] ?? '').trim()
    if (!name) return
    const sort = Math.max(0, ...opcoes.filter((o) => o.section_id === sc.id).map((o) => o.sort)) + 1
    const { error: err } = await supabase.from('portal_menu_options').insert({ section_id: sc.id, name, sort })
    if (err) return setError(err.code === '23505' ? 'Essa opção já existe nesta seção.' : friendlyDbError(err.message))
    setDrafts((prev) => ({ ...prev, [sc.id]: '' }))
    await load()
  }

  async function toggleOpcao(o: Opcao) {
    const { error: err } = await supabase.from('portal_menu_options').update({ active: !o.active }).eq('id', o.id)
    if (err) return setError(friendlyDbError(err.message))
    setOpcoes((prev) => prev.map((x) => (x.id === o.id ? { ...x, active: !o.active } : x)))
  }

  async function removeOpcao(o: Opcao) {
    const { error: err } = await supabase.from('portal_menu_options').delete().eq('id', o.id)
    if (err) return setError(friendlyDbError(err.message))
    setOpcoes((prev) => prev.filter((x) => x.id !== o.id))
  }

  if (semMigracao) {
    return <Card title="Cardápio do portal do cliente"><p className="text-sm text-muted">Falta rodar a migração 070_roteiro_e_cardapio_livres.sql no banco.</p></Card>
  }

  return (
    <Card
      title="Cardápio do portal do cliente"
      action={
        <Can permission="action:pacotes.criar_editar">
          <Button onClick={() => setForm({ id: null, name: '', help: '', mode: 'uma', quantity: '2', allow_other: false, other_label: 'Outro (combinar com a equipe)', unit: '' })} className="text-xs px-3 py-1.5">
            <Plus className="w-3.5 h-3.5" /> Nova seção
          </Button>
        </Can>
      }
    >
      {error && !form && <p className="text-sm text-danger mb-3">{error}</p>}
      <p className="text-xs text-muted mb-4">
        O cliente escolhe uma opção de cada seção no portal da festa. Sem nenhuma seção, o portal não mostra a aba Cardápio. Em "quantidade definida pelo pacote", vale o campo "Pratos quentes inclusos" do pacote mais os itens extras marcados como prato quente adicional.
      </p>
      {secoes.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma seção ainda. Crie a primeira em "Nova seção" (ex.: "Sabor do bolo").</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {secoes.map((sc) => {
            const lista = opcoes.filter((o) => o.section_id === sc.id)
            return (
              <div key={sc.id} className={sc.active ? '' : 'opacity-60'}>
                <div className="flex items-start gap-2 mb-1">
                  <p className="text-sm font-semibold flex-1">
                    {sc.name} <span className="text-xs font-normal text-muted">({lista.filter((o) => o.active).length})</span>
                    {!sc.active && <span className="ml-1 text-xs font-normal text-muted">· oculta</span>}
                  </p>
                  <Can permission="action:pacotes.criar_editar">
                    <button onClick={() => setForm({ id: sc.id, name: sc.name, help: sc.help ?? '', mode: sc.mode, quantity: String(sc.quantity), allow_other: sc.allow_other, other_label: sc.other_label, unit: unitSlug(sc.unit_id) })} className="text-muted hover:text-purple" aria-label={`Editar seção ${sc.name}`}><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => toggleSecao(sc)} className="text-muted hover:text-purple" aria-label={sc.active ? `Ocultar seção ${sc.name}` : `Mostrar seção ${sc.name}`}>
                      {sc.active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                    {!sc.legacy_field && (
                      <button onClick={() => apagarSecao(sc)} className="text-muted hover:text-danger" aria-label={`Apagar seção ${sc.name}`}><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </Can>
                </div>
                <p className="text-[11px] text-muted mb-2">{descricao(sc)}</p>
                <ul className="divide-y divide-line border border-line rounded-lg max-h-72 overflow-y-auto">
                  {lista.map((o) => (
                    <li key={o.id} className={`flex items-center gap-2 px-3 py-1.5 text-sm ${o.active ? '' : 'text-muted line-through'}`}>
                      <span className="flex-1">{o.name}</span>
                      <Can permission="action:pacotes.criar_editar">
                        <button onClick={() => toggleOpcao(o)} className="text-muted hover:text-purple" aria-label={o.active ? `Ocultar ${o.name} do portal` : `Mostrar ${o.name} no portal`}>
                          {o.active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => removeOpcao(o)} className="text-muted hover:text-danger" aria-label={`Excluir ${o.name}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </Can>
                    </li>
                  ))}
                  {lista.length === 0 && <li className="px-3 py-2 text-xs text-muted">Nenhuma opção ainda.</li>}
                </ul>
                <Can permission="action:pacotes.criar_editar">
                  <form onSubmit={(e) => addOpcao(e, sc)} className="flex gap-2 mt-2">
                    <input value={drafts[sc.id] ?? ''} onChange={(e) => setDrafts((prev) => ({ ...prev, [sc.id]: e.target.value }))} placeholder="Nova opção" aria-label={`Nova opção de ${sc.name}`} className="flex-1 min-w-0 border border-line rounded-lg px-2 py-1.5 text-sm" />
                    <button type="submit" className="text-xs font-medium text-purple px-2">Adicionar</button>
                  </form>
                </Can>
              </div>
            )
          })}
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setForm(null)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl max-h-[90vh] overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-semibold">{form.id ? 'Editar seção' : 'Nova seção do cardápio'}</h2>
              <button onClick={() => setForm(null)} className="text-muted hover:text-ink" aria-label="Fechar"><X className="w-5 h-5" /></button>
            </div>
            {error && <p className="text-sm text-danger mb-3">{error}</p>}
            <form onSubmit={salvarSecao} className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">Nome da seção *</label>
                <input autoFocus required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Sabor do bolo, Salgados, Suco" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Explicação para o cliente (opcional)</label>
                <input value={form.help} onChange={(e) => setForm({ ...form, help: e.target.value })} placeholder="Ex: Servidos depois do parabéns" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Quantas escolhas</label>
                <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as Modo })} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                  {(Object.keys(MODO_LABEL) as Modo[]).map((m) => <option key={m} value={m}>{MODO_LABEL[m]}</option>)}
                </select>
              </div>
              {form.mode === 'varias' && (
                <div>
                  <label className="block text-xs text-muted mb-1">Quantas opções o cliente escolhe</label>
                  <input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} inputMode="numeric" className="w-24 border border-line rounded-lg px-3 py-2 text-sm" />
                </div>
              )}
              {form.mode === 'pacote' && (
                <p className="text-xs text-muted bg-paper rounded-lg px-3 py-2">Cada festa escolhe a quantidade do campo "Pratos quentes inclusos" do pacote, mais os itens extras de prato quente adicional. Pacote com 0 mostra "seu plano não inclui".</p>
              )}
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.allow_other} onChange={(e) => setForm({ ...form, allow_other: e.target.checked })} className="mt-0.5" />
                <span>Aceitar uma opção "outro" (o cliente combina com a equipe)</span>
              </label>
              {form.allow_other && (
                <input value={form.other_label} onChange={(e) => setForm({ ...form, other_label: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm" aria-label='Texto da opção "outro"' />
              )}
              <div>
                <label className="block text-xs text-muted mb-1">Vale para</label>
                <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                  <option value="">Todas as unidades</option>
                  {UNITS.map((u) => <option key={u.id} value={u.id}>Só {u.name}</option>)}
                </select>
              </div>
              <Button type="submit" className="w-full justify-center">Salvar</Button>
            </form>
          </div>
        </div>
      )}
    </Card>
  )
}
