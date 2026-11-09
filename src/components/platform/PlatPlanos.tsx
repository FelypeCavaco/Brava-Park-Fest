import { FormEvent, useState } from 'react'
import { Plus, X, Check, Minus, Trash2 } from 'lucide-react'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { supabase } from '../../lib/supabaseClient'
import { brl, friendlyDbError, parseDecimal } from '../../lib/format'
import { MODULOS } from '../../lib/modules'
import type { PainelDados } from './platformApi'
import type { Plano } from './platformTypes'

// Planos e funções: os planos que o Festou vende e o que cada um libera.
// Mudou aqui, muda na hora para todas as casas daquele plano.

const NUCLEO = [
  'Reservas, clientes e festas',
  'Pacotes, contratos e pagamentos',
  'Portal do cliente (cardápio, convidados, Pix)',
  'Financeiro: Visão geral e Lançamentos',
]

const planoParaJson = (p: Plano, mudancas: Partial<Plano> = {}) => {
  const x = { ...p, ...mudancas }
  return { id: x.id, nome: x.nome, preco: x.preco, unidades_incluidas: x.unidades_incluidas, usuarios_incluidos: x.usuarios_incluidos ?? '', unidade_adicional: x.unidade_adicional, modulos: x.modulos, destaque: x.destaque, ordem: x.ordem, ativo: x.ativo }
}

export function PlatPlanos({ d }: { d: PainelDados }) {
  const [editando, setEditando] = useState<{ id: string; nome: string; preco: string; unidades: string; usuarios: string; adicional: string; destaque: boolean; ativo: boolean; ordem: number; modulos: string[] } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState<string | null>(null)
  const planos = d.planos

  async function alternarFuncao(p: Plano, mod: string) {
    const novos = p.modulos.includes(mod) ? p.modulos.filter((x) => x !== mod) : [...p.modulos, mod]
    const nomeFuncao = MODULOS.find((m) => m.id === mod)?.label ?? mod
    if (p.casas > 0 && !window.confirm(`${p.modulos.includes(mod) ? 'Tirar' : 'Incluir'} "${nomeFuncao}" ${p.modulos.includes(mod) ? 'do' : 'no'} plano ${p.nome}?\n\nVale na hora para as ${p.casas} ${p.casas === 1 ? 'casa' : 'casas'} deste plano.${p.modulos.includes(mod) ? ' Os dados delas não são apagados; a função só some do menu.' : ''}`)) return
    setSalvando(`${p.id}:${mod}`)
    const { error } = await supabase.rpc('platform_plan_save', { p_dados: planoParaJson(p, { modulos: novos }) })
    setSalvando(null)
    if (error) return setErro(friendlyDbError(error.message))
    setErro(null)
    await d.recarregar()
  }

  async function salvarPlano(e: FormEvent) {
    e.preventDefault()
    if (!editando) return
    const preco = parseDecimal(editando.preco)
    if (preco === null || preco < 0) return setErro('Informe o preço por mês.')
    const { error } = await supabase.rpc('platform_plan_save', {
      p_dados: {
        id: editando.id, nome: editando.nome, preco, unidades_incluidas: Number(editando.unidades) || 1,
        usuarios_incluidos: editando.usuarios.trim() ? Number(editando.usuarios) : '', unidade_adicional: parseDecimal(editando.adicional) ?? 0,
        destaque: editando.destaque, ativo: editando.ativo, ordem: editando.ordem, modulos: editando.modulos,
      },
    })
    if (error) return setErro(friendlyDbError(error.message))
    setEditando(null)
    setErro(null)
    await d.recarregar()
  }

  async function excluir(p: Plano) {
    if (!window.confirm(`Excluir o plano ${p.nome}?`)) return
    const { error } = await supabase.rpc('platform_plan_delete', { p_id: p.id })
    if (error) return setErro(friendlyDbError(error.message))
    await d.recarregar()
  }

  const novo = () => {
    setErro(null)
    setEditando({ id: '', nome: '', preco: '', unidades: '1', usuarios: '', adicional: '', destaque: false, ativo: true, ordem: planos.length + 1, modulos: ['agenda'] })
  }
  const editar = (p: Plano) => {
    setErro(null)
    setEditando({ id: p.id, nome: p.nome, preco: String(p.preco).replace('.', ','), unidades: String(p.unidades_incluidas), usuarios: p.usuarios_incluidos ? String(p.usuarios_incluidos) : '', adicional: String(p.unidade_adicional).replace('.', ','), destaque: p.destaque, ativo: p.ativo, ordem: p.ordem, modulos: p.modulos })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Planos e funções</h1>
          <p className="text-sm text-muted mt-1">Os planos que você vende e o que cada um libera. Mudou aqui, muda na hora para todas as casas daquele plano.</p>
        </div>
        <Button variant="secondary" onClick={novo}><Plus className="w-4 h-4" /> Novo plano</Button>
      </div>
      {erro && !editando && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{erro}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {planos.map((p) => (
          <div key={p.id} className={`bg-surface rounded-card p-5 space-y-2 ${p.destaque ? 'border-2 border-purple' : 'border border-line'} ${p.ativo ? '' : 'opacity-60'}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-lg">{p.nome}</p>
              {p.destaque && <Badge tone="purple">em destaque</Badge>}
              {!p.ativo && <Badge>fora de venda</Badge>}
            </div>
            <p className="text-3xl font-display font-semibold tabular-nums">{brl(p.preco)} <span className="text-sm text-muted font-sans font-medium">/mês</span></p>
            <ul className="text-sm text-muted list-disc pl-5 space-y-0.5">
              <li>{p.unidades_incluidas} {p.unidades_incluidas === 1 ? 'unidade incluída' : 'unidades incluídas'}</li>
              <li>{p.usuarios_incluidos ? `Até ${p.usuarios_incluidos} usuários` : 'Usuários ilimitados'}</li>
              <li>Unidade a mais: {brl(p.unidade_adicional)}/mês</li>
              <li>{p.modulos.length} de {MODULOS.length} funções opcionais</li>
            </ul>
            <p className="text-sm"><b>{p.casas} {p.casas === 1 ? 'casa' : 'casas'}</b> neste plano</p>
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => editar(p)}>Editar</Button>
              {p.casas === 0 && <button onClick={() => excluir(p)} className="text-xs text-muted hover:text-danger inline-flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Excluir</button>}
            </div>
          </div>
        ))}
      </div>

      <Card title="O que cada plano libera">
        <p className="text-xs text-muted mb-3">Clique no ✓ ou no — para incluir ou tirar uma função do plano. Para uma casa só, use "liberar à parte" na ficha dela.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="pb-2 font-medium">Função</th>
                {planos.map((p) => <th key={p.id} className="pb-2 font-medium text-center">{p.nome}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr><td colSpan={planos.length + 1} className="py-2 px-2 bg-purple-light text-purple text-xs font-semibold">Sempre incluído (núcleo do sistema)</td></tr>
              {NUCLEO.map((n) => (
                <tr key={n}>
                  <td className="py-2">{n}</td>
                  {planos.map((p) => <td key={p.id} className="py-2 text-center"><Check className="w-4 h-4 text-teal inline" /></td>)}
                </tr>
              ))}
              <tr><td colSpan={planos.length + 1} className="py-2 px-2 bg-purple-light text-purple text-xs font-semibold">Funções que mudam por plano</td></tr>
              {MODULOS.map((mod) => (
                <tr key={mod.id}>
                  <td className="py-2 pr-3">{mod.label}<span className="block text-[11px] text-muted">{mod.descricao}</span></td>
                  {planos.map((p) => {
                    const tem = p.modulos.includes(mod.id)
                    return (
                      <td key={p.id} className="py-2 text-center">
                        <button type="button" disabled={salvando !== null} onClick={() => alternarFuncao(p, mod.id)}
                          aria-label={`${mod.label} no plano ${p.nome}: ${tem ? 'incluída' : 'não incluída'}`}
                          className="w-9 h-8 rounded-md hover:bg-paper inline-flex items-center justify-center disabled:opacity-50">
                          {salvando === `${p.id}:${mod.id}` ? <span className="text-xs text-muted">...</span> : tem ? <Check className="w-4 h-4 text-teal" /> : <Minus className="w-4 h-4 text-line" />}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted mt-3">Ao trocar uma casa de plano ou tirar uma função, os dados nunca são apagados: a função só some do menu e volta se ela for liberada de novo (contrato, item 3.9).</p>
      </Card>

      {editando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setEditando(null)} />
          <form onSubmit={salvarPlano} className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-display font-semibold">{editando.id ? `Editar ${editando.nome}` : 'Novo plano'}</h2>
              <button type="button" onClick={() => setEditando(null)} className="text-muted hover:text-ink" aria-label="Fechar"><X className="w-5 h-5" /></button>
            </div>
            {erro && <p className="text-sm bg-danger-light text-danger rounded-lg px-3 py-2">{erro}</p>}
            <div><label className="block text-xs text-muted mb-1">Nome *</label><input required autoFocus value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-muted mb-1">Preço por mês (R$) *</label><input required value={editando.preco} onChange={(e) => setEditando({ ...editando, preco: e.target.value })} inputMode="decimal" className="w-full border border-line rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs text-muted mb-1">Unidade a mais (R$/mês)</label><input value={editando.adicional} onChange={(e) => setEditando({ ...editando, adicional: e.target.value })} inputMode="decimal" className="w-full border border-line rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs text-muted mb-1">Unidades incluídas</label><input type="number" min={1} value={editando.unidades} onChange={(e) => setEditando({ ...editando, unidades: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs text-muted mb-1">Usuários incluídos</label><input type="number" min={1} value={editando.usuarios} onChange={(e) => setEditando({ ...editando, usuarios: e.target.value })} placeholder="Vazio = ilimitados" className="w-full border border-line rounded-lg px-3 py-2 text-sm" /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editando.destaque} onChange={(e) => setEditando({ ...editando, destaque: e.target.checked })} /> Plano em destaque (aparece como "mais vendido")</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!editando.ativo} onChange={(e) => setEditando({ ...editando, ativo: !e.target.checked })} /> Fora de venda (as casas que já têm continuam com ele)</label>
            {editando.id && planos.find((p) => p.id === editando.id)?.casas ? (
              <p className="text-xs bg-amber-light text-amber rounded-lg px-3 py-2">Mudar o preço aqui não muda a mensalidade das casas que já estão neste plano. Para isso, troque o plano na ficha de cada casa ou ajuste a mensalidade dela.</p>
            ) : null}
            <Button type="submit" className="w-full justify-center">Salvar plano</Button>
          </form>
        </div>
      )}
    </div>
  )
}
