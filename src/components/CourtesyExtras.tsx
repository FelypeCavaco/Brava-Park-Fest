import { useEffect, useState } from 'react'
import { Plus, X, Gift } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'

// Convidados de cortesia: liberar um consumo a mais, em quantidade limitada,
// sem custo para o cliente (ex.: +1 prato quente adicional, +2 garrafas de
// refrigerante). Usa os itens extras do catálogo; entram na festa com valor
// zero. Itens marcados como "prato quente adicional" aumentam os pratos que o
// cliente escolhe no portal.

export interface ItemCortesia {
  extraId: string
  nome: string
  qtd: number
}

export function CourtesyExtras({ itens, onChange }: { itens: ItemCortesia[]; onChange: (itens: ItemCortesia[]) => void }) {
  const [catalogo, setCatalogo] = useState<{ id: string; name: string; adds_hot_dishes: number }[]>([])
  const [escolhido, setEscolhido] = useState('')
  const [qtd, setQtd] = useState('1')

  useEffect(() => {
    supabase.from('extra_items').select('id, name, adds_hot_dishes').order('name').then(({ data }) => setCatalogo((data ?? []) as typeof catalogo))
  }, [])

  function adicionar() {
    const item = catalogo.find((c) => c.id === escolhido)
    const n = Math.round(Number(qtd))
    if (!item || !(n > 0)) return
    const existente = itens.find((i) => i.extraId === item.id)
    onChange(existente ? itens.map((i) => (i.extraId === item.id ? { ...i, qtd: i.qtd + n } : i)) : [...itens, { extraId: item.id, nome: item.name, qtd: n }])
    setEscolhido('')
    setQtd('1')
  }

  return (
    <div className="bg-paper rounded-lg px-3 py-3 mt-2 space-y-2">
      <p className="text-xs font-semibold flex items-center gap-1.5"><Gift className="w-3.5 h-3.5 text-purple" /> Liberar consumo a mais para a cortesia (opcional)</p>
      <p className="text-[11px] text-muted">O pacote continua o mesmo. Escolha o que vai a mais e quanto. Sai sem custo para o cliente.</p>
      {itens.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {itens.map((i) => (
            <li key={i.extraId} className="inline-flex items-center gap-1 bg-purple-light text-purple-dark rounded-full pl-2.5 pr-1 py-0.5 text-xs font-medium">
              +{i.qtd} {i.nome}
              <button type="button" onClick={() => onChange(itens.filter((x) => x.extraId !== i.extraId))} aria-label={`Tirar ${i.nome}`} className="p-0.5 hover:text-danger"><X className="w-3 h-3" /></button>
            </li>
          ))}
        </ul>
      )}
      {catalogo.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <select value={escolhido} onChange={(e) => setEscolhido(e.target.value)} aria-label="Item a mais" className="flex-1 min-w-[150px] border border-line rounded-lg px-2 py-1.5 text-sm bg-surface">
            <option value="">Escolha um item...</option>
            {catalogo.map((c) => <option key={c.id} value={c.id}>{c.name}{c.adds_hot_dishes > 0 ? ' (prato quente)' : ''}</option>)}
          </select>
          <input type="number" min={1} value={qtd} onChange={(e) => setQtd(e.target.value)} aria-label="Quantos a mais" className="w-20 border border-line rounded-lg px-2 py-1.5 text-sm" />
          <button type="button" onClick={adicionar} disabled={!escolhido} className="inline-flex items-center gap-1 text-xs font-medium text-purple disabled:opacity-40 px-1"><Plus className="w-3.5 h-3.5" /> Adicionar</button>
        </div>
      ) : (
        <p className="text-[11px] text-muted">Cadastre os itens (ex.: "Prato quente adicional") em Comercial → Pacotes e itens → Itens extras.</p>
      )}
    </div>
  )
}
