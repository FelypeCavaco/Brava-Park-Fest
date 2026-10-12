import { FormEvent, useEffect, useState } from 'react'
import { Trash2, Eye, EyeOff } from 'lucide-react'
import { Card } from './ui/Card'
import { Can } from './Can'
import { supabase } from '../lib/supabaseClient'
import { friendlyDbError } from '../lib/format'

// Opções que o cliente vê no Cardápio do portal: pratos quentes, massa e
// recheio do bolo. Ocultar tira a opção do portal sem apagar escolhas antigas.

type Kind = 'prato' | 'bolo_massa' | 'bolo_sabor'

interface Option {
  id: string
  kind: Kind
  name: string
  sort: number
  active: boolean
}

const GRUPOS: { kind: Kind; titulo: string; placeholder: string }[] = [
  { kind: 'prato', titulo: 'Pratos quentes', placeholder: 'Ex: Lasanha de frango' },
  { kind: 'bolo_massa', titulo: 'Massa do bolo', placeholder: 'Ex: Chocolate' },
  { kind: 'bolo_sabor', titulo: 'Recheio do bolo', placeholder: 'Ex: Brigadeiro' },
]

export function PortalMenuEditor() {
  const [options, setOptions] = useState<Option[]>([])
  const [drafts, setDrafts] = useState<Record<Kind, string>>({ prato: '', bolo_massa: '', bolo_sabor: '' })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const { data } = await supabase.from('portal_menu_options').select('id, kind, name, sort, active').order('sort').order('name')
    setOptions((data ?? []) as Option[])
  }

  async function add(e: FormEvent, kind: Kind) {
    e.preventDefault()
    const name = drafts[kind].trim()
    if (!name) return
    const sort = Math.max(0, ...options.filter((o) => o.kind === kind).map((o) => o.sort)) + 1
    const { error: err } = await supabase.from('portal_menu_options').insert({ kind, name, sort })
    if (err) return setError(err.code === '23505' ? 'Essa opção já existe.' : friendlyDbError(err.message))
    setDrafts((prev) => ({ ...prev, [kind]: '' }))
    await load()
  }

  async function toggle(o: Option) {
    const { error: err } = await supabase.from('portal_menu_options').update({ active: !o.active }).eq('id', o.id)
    if (err) return setError(friendlyDbError(err.message))
    setOptions((prev) => prev.map((x) => (x.id === o.id ? { ...x, active: !o.active } : x)))
  }

  async function remove(o: Option) {
    const { error: err } = await supabase.from('portal_menu_options').delete().eq('id', o.id)
    if (err) return setError(friendlyDbError(err.message))
    setOptions((prev) => prev.filter((x) => x.id !== o.id))
  }

  return (
    <Card title="Cardápio do portal do cliente" action={<span className="text-xs text-muted">o que o cliente escolhe no portal</span>}>
      {error && <p className="text-sm text-danger mb-3">{error}</p>}
      <p className="text-xs text-muted mb-4">
        Quantos pratos quentes cada festa escolhe = "Pratos quentes inclusos" do pacote + itens extras marcados como prato quente adicional. Ocultar tira a opção do portal sem mexer nas escolhas já feitas.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {GRUPOS.map((g) => {
          const lista = options.filter((o) => o.kind === g.kind)
          return (
            <div key={g.kind}>
              <p className="text-sm font-semibold mb-2">{g.titulo} <span className="text-xs font-normal text-muted">({lista.filter((o) => o.active).length})</span></p>
              <ul className="divide-y divide-line border border-line rounded-lg max-h-72 overflow-y-auto">
                {lista.map((o) => (
                  <li key={o.id} className={`flex items-center gap-2 px-3 py-1.5 text-sm ${o.active ? '' : 'text-muted line-through'}`}>
                    <span className="flex-1">{o.name}</span>
                    <Can permission="action:pacotes.criar_editar">
                      <button onClick={() => toggle(o)} className="text-muted hover:text-purple" aria-label={o.active ? `Ocultar ${o.name} do portal` : `Mostrar ${o.name} no portal`}>
                        {o.active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => remove(o)} className="text-muted hover:text-danger" aria-label={`Excluir ${o.name}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </Can>
                  </li>
                ))}
              </ul>
              <Can permission="action:pacotes.criar_editar">
                <form onSubmit={(e) => add(e, g.kind)} className="flex gap-2 mt-2">
                  <input value={drafts[g.kind]} onChange={(e) => setDrafts((prev) => ({ ...prev, [g.kind]: e.target.value }))} placeholder={g.placeholder} aria-label={`Nova opção de ${g.titulo}`} className="flex-1 min-w-0 border border-line rounded-lg px-2 py-1.5 text-sm" />
                  <button type="submit" className="text-xs font-medium text-purple px-2">Adicionar</button>
                </form>
              </Can>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
