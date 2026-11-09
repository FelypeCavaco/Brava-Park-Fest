import { FormEvent, useEffect, useState } from 'react'
import { Download, Megaphone, Trash2 } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError } from '../../lib/format'
import { ContractorSettings } from './ContractorSettings'
import { baixarCopia, type CopiaExcluida, type PainelDados } from './platformApi'
import { dataBr } from './platformTypes'

// Configurações do Festou inteiro: aviso para todas as casas, dados da
// contratada (contrato), tela de login e cópias de casas excluídas.

interface AvisoGeral { id: string; texto: string; plano_id: string | null; criado_em: string; expira_em: string }

export function PlatConfig({ d }: { d: PainelDados }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <p className="text-sm text-muted mt-1">O que vale para o Festou inteiro.</p>
      </div>
      {!d.sem094 && <AvisoParaCasas d={d} />}
      <ContractorSettings />
      <Produto />
      <Copias d={d} />
    </div>
  )
}

function AvisoParaCasas({ d }: { d: PainelDados }) {
  const [avisos, setAvisos] = useState<AvisoGeral[]>([])
  const [texto, setTexto] = useState('')
  const [plano, setPlano] = useState('')
  const [dias, setDias] = useState('7')
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)

  async function carregar() {
    const { data } = await supabase.rpc('platform_announcement_list')
    setAvisos((data ?? []) as AvisoGeral[])
  }
  useEffect(() => { carregar() }, [])

  async function enviar(e: FormEvent) {
    e.preventDefault()
    const para = plano ? `as casas do plano ${d.planos.find((p) => p.id === plano)?.nome}` : 'todas as casas'
    if (!window.confirm(`Enviar este aviso para ${para}? Ele aparece no sininho de todos os usuários delas por ${dias} dias.`)) return
    const { error } = await supabase.rpc('platform_announcement_save', { p_texto: texto, p_plano: plano || null, p_dias: Number(dias) || 7 })
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    setTexto('')
    setMsg({ ok: true, texto: `Aviso enviado para ${para}.` })
    await carregar()
  }

  async function apagar(a: AvisoGeral) {
    if (!window.confirm('Tirar este aviso do sininho das casas?')) return
    await supabase.rpc('platform_announcement_delete', { p_id: a.id })
    await carregar()
  }

  const agora = new Date().toISOString()
  return (
    <Card title="Aviso para todas as casas">
      <p className="text-xs text-muted mb-3">Uma mensagem que aparece no sininho de todos os usuários das casas (ou só das casas de um plano). Ex.: manutenção programada, função nova, mudança nos Termos.</p>
      {msg && <p className={`text-sm rounded-lg px-3 py-2 mb-3 ${msg.ok ? 'bg-teal-light text-teal' : 'bg-danger-light text-danger'}`}>{msg.texto}</p>}
      <form onSubmit={enviar} className="space-y-2">
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} maxLength={1000} placeholder="Ex.: Domingo, das 23h à meia-noite, o sistema passa por uma manutenção rápida."
          className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
        <div className="flex flex-wrap items-center gap-2">
          <select value={plano} onChange={(e) => setPlano(e.target.value)} className="border border-line rounded-lg px-3 py-2 text-sm" aria-label="Para quem">
            <option value="">Para todas as casas</option>
            {d.planos.map((p) => <option key={p.id} value={p.id}>Só o plano {p.nome}</option>)}
          </select>
          <select value={dias} onChange={(e) => setDias(e.target.value)} className="border border-line rounded-lg px-3 py-2 text-sm" aria-label="Por quanto tempo">
            {['1', '3', '7', '15', '30'].map((n) => <option key={n} value={n}>Fica {n} {n === '1' ? 'dia' : 'dias'}</option>)}
          </select>
          <Button type="submit" disabled={!texto.trim()}><Megaphone className="w-4 h-4" /> Enviar aviso</Button>
        </div>
      </form>
      {avisos.length > 0 && (
        <div className="mt-4 divide-y divide-line border-t border-line">
          {avisos.map((a) => {
            const ativo = a.expira_em > agora
            return (
              <div key={a.id} className={`flex items-start justify-between gap-3 py-2.5 text-sm ${ativo ? '' : 'opacity-60'}`}>
                <div className="min-w-0">
                  <p className="whitespace-pre-wrap break-words">{a.texto}</p>
                  <p className="text-[11px] text-muted mt-0.5">
                    {a.plano_id ? `Plano ${d.planos.find((p) => p.id === a.plano_id)?.nome ?? a.plano_id}` : 'Todas as casas'} · enviado em {dataBr(a.criado_em)} · {ativo ? `aparece até ${dataBr(a.expira_em)}` : 'encerrado'}
                  </p>
                </div>
                {ativo && <button onClick={() => apagar(a)} className="text-muted hover:text-danger shrink-0" aria-label="Tirar aviso"><Trash2 className="w-4 h-4" /></button>}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function Produto() {
  const [produto, setProduto] = useState({ name: '', tagline: '', logo_url: '' })
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    supabase.rpc('platform_get_settings').then(({ data }) => {
      const c = ((data ?? []) as { name: string; tagline: string | null; logo_url: string | null }[])[0]
      if (c) setProduto({ name: c.name, tagline: c.tagline ?? '', logo_url: c.logo_url ?? '' })
    })
  }, [])

  async function salvar(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.rpc('platform_save_settings', { p_name: produto.name, p_logo_url: produto.logo_url, p_tagline: produto.tagline })
    setMsg(error ? friendlyDbError(error.message) : 'Salvo. A tela de login mostra este nome para quem ainda não entrou.')
  }

  return (
    <Card title="Tela de login">
      <form onSubmit={salvar} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div>
          <label className="block text-xs text-muted mb-1">Nome do sistema *</label>
          <input required value={produto.name} onChange={(e) => setProduto({ ...produto, name: e.target.value })} placeholder="Ex.: Festou" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Frase (opcional)</label>
          <input value={produto.tagline} onChange={(e) => setProduto({ ...produto, tagline: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Endereço da logo (opcional)</label>
          <input value={produto.logo_url} onChange={(e) => setProduto({ ...produto, logo_url: e.target.value })} placeholder="https://..." className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="md:col-span-3 flex items-center gap-3">
          <Button type="submit">Salvar</Button>
          {msg && <span className="text-xs text-muted">{msg}</span>}
        </div>
      </form>
      <p className="text-xs text-muted mt-2">Quem ainda não entrou não sabe de qual casa é, então a tela de login mostra o nome do sistema. Depois de entrar, cada um vê o nome e a logo da própria casa.</p>
    </Card>
  )
}

function Copias({ d }: { d: PainelDados }) {
  async function apagar(c: CopiaExcluida) {
    if (!window.confirm(`Apagar de vez a cópia guardada de "${c.nome}"? Depois disso os dados dela só existem no arquivo que você baixou.`)) return
    const { error } = await supabase.rpc('platform_drop_deleted_copy', { p_id: c.id })
    if (error) return d.setErro(friendlyDbError(error.message))
    await d.recarregar()
  }

  return (
    <Card title="Cópias de casas excluídas">
      <p className="text-xs text-muted mb-3">Os dados de cada casa excluída ficam guardados aqui para você baixar de novo se precisar. Quando não precisar mais, apague a cópia (pela LGPD, não guarde dados de clientes sem necessidade).</p>
      {d.copias.length === 0 ? <p className="text-sm text-muted">Nenhuma cópia guardada.</p> : (
        <div className="divide-y divide-line">
          {d.copias.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
              <div>
                <p className="font-medium">{c.nome}</p>
                <p className="text-xs text-muted">Excluída em {dataBr(c.excluida_em)} · {c.tamanho_kb < 1024 ? `${Math.max(c.tamanho_kb, 1)} KB` : `${(c.tamanho_kb / 1024).toFixed(1).replace('.', ',')} MB`}</p>
              </div>
              <span className="inline-flex gap-2">
                <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={async () => d.setErro(await baixarCopia(c.id, c.nome))}><Download className="w-3.5 h-3.5" /> Baixar cópia</Button>
                <button onClick={() => apagar(c)} className="text-xs text-muted hover:text-danger px-2">Apagar cópia</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
