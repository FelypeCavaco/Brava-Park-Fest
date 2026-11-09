import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, X, MessageCircle, Building2, Pencil } from 'lucide-react'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError } from '../../lib/format'
import { linkWhatsApp, type PainelDados } from './platformApi'
import { dataBr } from './platformTypes'
import { Numero } from './PlatVisaoGeral'

// Interessados: quem pediu contato ou teste grátis (pela página de vendas ou
// cadastrado à mão), acompanhado até virar cliente.

type Status = 'novo' | 'conversa' | 'teste' | 'cliente' | 'perdido'
interface Lead {
  id: string; nome: string; casa: string | null; cidade: string | null; whatsapp: string | null; email: string | null
  plano_interesse: string | null; origem: string | null; status: Status; motivo: string | null; observacao: string | null
  company_id: string | null; criado_em: string; atualizado_em: string
}
const STATUS: Record<Status, { rotulo: string; tom: 'purple' | 'amber' | 'teal' | 'danger' | 'neutral' }> = {
  novo: { rotulo: 'Novo', tom: 'purple' },
  conversa: { rotulo: 'Em conversa', tom: 'amber' },
  teste: { rotulo: 'Testando grátis', tom: 'teal' },
  cliente: { rotulo: 'Virou cliente', tom: 'teal' },
  perdido: { rotulo: 'Perdido', tom: 'danger' },
}
type Form = { id: string; nome: string; casa: string; cidade: string; whatsapp: string; email: string; plano_interesse: string; origem: string; status: Status; motivo: string; observacao: string }

export function PlatInteressados({ d }: { d: PainelDados }) {
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [filtro, setFiltro] = useState<'todos' | Status>('todos')
  const [f, setF] = useState<Form | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function carregar() {
    const { data, error } = await supabase.rpc('platform_leads_list')
    if (error) return setErro(friendlyDbError(error.message))
    setLeads((data ?? []) as Lead[])
  }
  useEffect(() => { carregar() }, [])

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!f) return
    const { error } = await supabase.rpc('platform_lead_save', { p_dados: f })
    if (error) return setErro(friendlyDbError(error.message))
    setF(null)
    setErro(null)
    await carregar()
  }

  async function mudarStatus(l: Lead, status: Status) {
    const motivo = status === 'perdido' ? window.prompt('Por que não fechou? (ex.: achou caro, já usa outro sistema)', l.motivo ?? '') : l.motivo
    if (status === 'perdido' && motivo === null) return
    const { error } = await supabase.rpc('platform_lead_save', { p_dados: { ...l, status, motivo: motivo ?? '' } })
    if (error) return setErro(friendlyDbError(error.message))
    await carregar()
  }

  async function apagar(l: Lead) {
    if (!window.confirm(`Apagar ${l.nome} da lista de interessados?`)) return
    await supabase.rpc('platform_lead_delete', { p_id: l.id })
    setF(null)
    await carregar()
  }

  function criarCasa(l: Lead) {
    d.novaCasa({ empresa: l.casa ?? '', admin_nome: l.nome, email: l.email ?? '' }, () => {
      supabase.rpc('platform_lead_save', { p_dados: { ...l, status: 'cliente' } }).then(() => carregar())
    })
  }

  const conta = (s: Status) => (leads ?? []).filter((l) => l.status === s).length
  const noventa = (leads ?? []).filter((l) => Date.now() - new Date(l.criado_em).getTime() < 90 * 86400000)
  const viraram = noventa.filter((l) => l.status === 'cliente').length
  const lista = (leads ?? []).filter((l) => filtro === 'todos' || l.status === filtro)
  const vazio: Form = { id: '', nome: '', casa: '', cidade: '', whatsapp: '', email: '', plano_interesse: '', origem: 'Indicação', status: 'novo', motivo: '', observacao: '' }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Interessados</h1>
          <p className="text-sm text-muted mt-1">Quem pediu contato ou teste grátis. Quando a página de vendas estiver no ar, os pedidos chegam aqui sozinhos; por enquanto, cadastre à mão quem chegar por indicação, Instagram ou WhatsApp.</p>
        </div>
        <Button onClick={() => { setErro(null); setF(vazio) }}><Plus className="w-4 h-4" /> Cadastrar interessado</Button>
      </div>
      {erro && !f && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{erro}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Numero rotulo="Novos sem resposta" valor={String(conta('novo'))} nota="responda no mesmo dia" alerta={conta('novo') > 0} />
        <Numero rotulo="Em conversa" valor={String(conta('conversa'))} />
        <Numero rotulo="Testando grátis" valor={String(conta('teste'))} />
        <Numero rotulo="Viraram cliente (90 dias)" valor={`${viraram} de ${noventa.length}`} nota={noventa.length ? `${Math.round((viraram / noventa.length) * 100)}% de conversão` : undefined} />
      </div>

      <Card>
        <div className="inline-flex flex-wrap rounded-lg border border-line bg-surface p-0.5 gap-0.5 mb-4" role="group" aria-label="Filtrar">
          {(['todos', 'novo', 'conversa', 'teste', 'cliente', 'perdido'] as const).map((k) => (
            <button key={k} aria-pressed={filtro === k} onClick={() => setFiltro(k)} className={`px-3 h-8 rounded-md text-xs font-medium ${filtro === k ? 'bg-purple text-white' : 'text-ink/70 hover:bg-paper'}`}>
              {k === 'todos' ? 'Todos' : STATUS[k].rotulo}
            </button>
          ))}
        </div>
        {leads === null ? <p className="text-sm text-muted">Carregando...</p> : lista.length === 0 ? (
          <p className="text-sm text-muted">{leads.length === 0 ? 'Nenhum interessado ainda.' : 'Ninguém com esse filtro.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="pb-2 font-medium">Pessoa e casa</th><th className="pb-2 font-medium">Cidade</th><th className="pb-2 font-medium">Plano de interesse</th><th className="pb-2 font-medium">Veio de</th><th className="pb-2 font-medium">Situação</th><th className="pb-2 font-medium">Desde</th><th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lista.map((l) => {
                  const wa = linkWhatsApp(l.whatsapp, `Olá, ${l.nome.split(' ')[0]}! Aqui é do Festou, sistema de gestão para casas de festa. Vi que você se interessou${l.casa ? ` para a ${l.casa}` : ''}. Posso te mostrar como funciona?`)
                  return (
                    <tr key={l.id}>
                      <td className="py-2.5 pr-2"><span className="font-medium">{l.nome}</span>{l.casa && <span className="block text-[11px] text-muted">{l.casa}</span>}</td>
                      <td className="py-2.5 pr-2">{l.cidade || '—'}</td>
                      <td className="py-2.5 pr-2">{l.plano_interesse || '—'}</td>
                      <td className="py-2.5 pr-2">{l.origem || '—'}</td>
                      <td className="py-2.5 pr-2">
                        <select value={l.status} onChange={(e) => mudarStatus(l, e.target.value as Status)} aria-label={`Situação de ${l.nome}`}
                          className="text-xs border border-line rounded-md px-2 py-1 bg-surface">
                          {(Object.keys(STATUS) as Status[]).map((s) => <option key={s} value={s}>{STATUS[s].rotulo}</option>)}
                        </select>
                        {l.status === 'perdido' && l.motivo && <span className="block text-[11px] text-muted mt-0.5">{l.motivo}</span>}
                        {l.status === 'cliente' && l.company_id && <Link to={`/plataforma/casas/${l.company_id}`} className="block text-[11px] text-purple mt-0.5">ver a casa</Link>}
                      </td>
                      <td className="py-2.5 pr-2 text-muted whitespace-nowrap">{dataBr(l.criado_em)}</td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          {wa && <a href={wa} target="_blank" rel="noreferrer" className="text-xs font-medium border border-line rounded-lg px-2.5 py-1.5 hover:bg-paper inline-flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" /> WhatsApp</a>}
                          {l.status !== 'cliente' && l.status !== 'perdido' && <Button className="text-xs px-2.5 py-1.5" onClick={() => criarCasa(l)}><Building2 className="w-3.5 h-3.5" /> Criar casa</Button>}
                          <button onClick={() => { setErro(null); setF({ id: l.id, nome: l.nome, casa: l.casa ?? '', cidade: l.cidade ?? '', whatsapp: l.whatsapp ?? '', email: l.email ?? '', plano_interesse: l.plano_interesse ?? '', origem: l.origem ?? '', status: l.status, motivo: l.motivo ?? '', observacao: l.observacao ?? '' }) }} className="text-muted hover:text-purple" aria-label="Editar"><Pencil className="w-4 h-4" /></button>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {f && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setF(null)} />
          <form onSubmit={salvar} className="relative w-full max-w-lg bg-surface rounded-card p-6 shadow-xl space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-display font-semibold">{f.id ? f.nome : 'Novo interessado'}</h2>
              <button type="button" onClick={() => setF(null)} className="text-muted hover:text-ink" aria-label="Fechar"><X className="w-5 h-5" /></button>
            </div>
            {erro && <p className="text-sm bg-danger-light text-danger rounded-lg px-3 py-2">{erro}</p>}
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Nome *" valor={f.nome} onChange={(v) => setF({ ...f, nome: v })} required autoFocus />
              <Campo rotulo="Casa de festas" valor={f.casa} onChange={(v) => setF({ ...f, casa: v })} />
              <Campo rotulo="Cidade" valor={f.cidade} onChange={(v) => setF({ ...f, cidade: v })} />
              <Campo rotulo="WhatsApp" valor={f.whatsapp} onChange={(v) => setF({ ...f, whatsapp: v })} placeholder="(47) 99999-9999" />
              <Campo rotulo="E-mail" valor={f.email} onChange={(v) => setF({ ...f, email: v })} tipo="email" />
              <div>
                <label className="block text-xs text-muted mb-1">Plano de interesse</label>
                <select value={f.plano_interesse} onChange={(e) => setF({ ...f, plano_interesse: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                  <option value="">Não sabe ainda</option>
                  {d.planos.filter((p) => p.ativo).map((p) => <option key={p.id} value={p.nome}>{p.nome}</option>)}
                </select>
              </div>
              <Campo rotulo="Veio de" valor={f.origem} onChange={(v) => setF({ ...f, origem: v })} placeholder="Indicação, Instagram, Google..." />
              <div>
                <label className="block text-xs text-muted mb-1">Situação</label>
                <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Status })} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                  {(Object.keys(STATUS) as Status[]).map((s) => <option key={s} value={s}>{STATUS[s].rotulo}</option>)}
                </select>
              </div>
            </div>
            {f.status === 'perdido' && <Campo rotulo="Por que não fechou?" valor={f.motivo} onChange={(v) => setF({ ...f, motivo: v })} />}
            <div>
              <label className="block text-xs text-muted mb-1">Observação</label>
              <textarea value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} rows={2} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" className="flex-1 justify-center">Salvar</Button>
              {f.id && <button type="button" onClick={() => { const l = leads?.find((x) => x.id === f.id); if (l) apagar(l) }} className="text-xs text-muted hover:text-danger">Apagar</button>}
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function Campo({ rotulo, valor, onChange, placeholder, required, autoFocus, tipo = 'text' }: { rotulo: string; valor: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; autoFocus?: boolean; tipo?: string }) {
  return (
    <div>
      <label className="block text-xs text-muted mb-1">{rotulo}</label>
      <input type={tipo} required={required} autoFocus={autoFocus} value={valor} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
    </div>
  )
}
