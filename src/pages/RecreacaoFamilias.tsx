import { useCallback, useEffect, useState } from 'react'
import { Users, Search, Plus, AlertTriangle, ChevronRight, ArrowLeft, Check, X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { FamiliaEditor } from '../components/recreacao/FamiliaEditor'
import { friendlyDbError } from '../lib/format'
import { idadeTexto, mascaraCpf, mascaraTelefone, type FamiliaRec, type FuncoesRec } from '../lib/recreacao'

interface Config { ligada: boolean; funcoes: FuncoesRec; regras: Record<string, string | number>; termo: string }

export function RecreacaoFamilias() {
  const { can } = useAuth()
  const [cfg, setCfg] = useState<Config | null>(null)
  const [texto, setTexto] = useState('')
  const [lista, setLista] = useState<FamiliaRec[] | null>(null)
  const [aberta, setAberta] = useState<{ id: string | null } | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    supabase.rpc('rec_config_get').then(({ data, error }) => (error ? setErro(friendlyDbError(error.message)) : setCfg(data as Config)))
  }, [])

  const buscar = useCallback(async (t: string) => {
    const { data, error } = await supabase.rpc('rec_familias_buscar', { p_texto: t, p_limite: 30 })
    if (error) return setErro(friendlyDbError(error.message))
    setLista((data ?? []) as FamiliaRec[])
  }, [])
  useEffect(() => {
    const t = setTimeout(() => buscar(texto), texto ? 300 : 0)
    return () => clearTimeout(t)
  }, [texto, buscar])

  if (cfg && !cfg.ligada) return <Card><p className="text-sm text-muted py-4 text-center">A recreação não está ligada para esta casa.</p></Card>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple to-purple-dark text-white flex items-center justify-center shadow-lg shadow-purple/30 shrink-0">
          <Users className="w-6 h-6" strokeWidth={1.75} />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">Famílias</h1>
          <p className="text-sm text-muted">Responsáveis, crianças e quem pode buscar. Pelo CPF a família aparece inteira.</p>
        </div>
      </div>

      {erro && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{erro}</div>}
      {aviso && <div className="bg-teal-light text-teal text-sm rounded-lg px-4 py-2.5 flex justify-between gap-2"><span className="flex items-center gap-2"><Check className="w-4 h-4" />{aviso}</span><button onClick={() => setAviso(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button></div>}

      {aberta && cfg ? (
        <Card>
          <button type="button" onClick={() => setAberta(null)} className="text-sm text-muted hover:text-purple inline-flex items-center gap-1 mb-4"><ArrowLeft className="w-4 h-4" />Voltar para a lista</button>
          <h2 className="text-xl font-semibold mb-5">{aberta.id ? 'Cadastro da família' : 'Nova família'}</h2>
          <FamiliaEditor key={aberta.id ?? 'nova'} familiaId={aberta.id} funcoes={cfg.funcoes} regras={cfg.regras} termo={cfg.termo}
            onFechar={() => setAberta(null)}
            onAbrirOutra={(id) => { setAberta({ id }); buscar(texto) }}
            onSalvo={() => { setAviso(aberta.id ? 'Cadastro salvo.' : 'Família cadastrada. Ela já aparece na entrada das crianças.'); setAberta(null); buscar(texto) }} />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[16rem]">
              <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input className="campo !pl-10 !py-3 !text-base" value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus
                placeholder="CPF, telefone, nome do responsável ou da criança" aria-label="Procurar família" />
            </div>
            {can('action:recreacao.familias_editar') && <Button onClick={() => setAberta({ id: null })} className="!py-3"><Plus className="w-4 h-4" />Nova família</Button>}
          </div>

          <p className="text-xs text-muted -mt-3">{texto.trim() ? `Resultado da busca${lista ? ` (${lista.length})` : ''}` : 'Últimas famílias cadastradas ou alteradas'}</p>

          {!lista ? <Card><p className="text-sm text-muted text-center py-6">Carregando...</p></Card> : lista.length === 0 ? (
            <Card>
              <div className="text-center py-6">
                <p className="text-sm text-muted">{texto.trim() ? 'Ninguém encontrado. Confira os números ou cadastre a família.' : 'Nenhuma família cadastrada ainda.'}</p>
                {can('action:recreacao.familias_editar') && <Button className="mt-3" onClick={() => setAberta({ id: null })}><Plus className="w-4 h-4" />Cadastrar família</Button>}
              </div>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {lista.map((f) => {
                const kids = f.criancas.filter((c) => c.ativo)
                return (
                  <button key={f.id} type="button" onClick={() => setAberta({ id: f.id! })}
                    className="group text-left bg-surface border border-line rounded-card p-4 hover:border-purple/40 hover:shadow-md transition-all">
                    <div className="flex items-start gap-3">
                      <span className="w-10 h-10 rounded-full bg-purple-light text-purple font-bold flex items-center justify-center shrink-0">{f.responsavel.trim().charAt(0).toUpperCase()}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{f.responsavel}</p>
                        <p className="text-xs text-muted">{f.cpf ? `CPF ${mascaraCpf(f.cpf)} · ` : ''}{mascaraTelefone(f.telefone)}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted group-hover:text-purple mt-1" />
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {kids.map((c) => (
                        <span key={c.id} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${c.cuidados ? 'bg-danger-light text-danger' : 'bg-paper text-ink/80'}`} title={c.cuidados ?? undefined}>
                          {c.cuidados && <AlertTriangle className="w-3 h-3" />}{c.nome.split(' ')[0]} · {idadeTexto(c.nascimento)}
                        </span>
                      ))}
                      {f.autorizados.filter((a) => a.ativo).length > 0 && <span className="text-[11px] text-muted self-center">+ {f.autorizados.filter((a) => a.ativo).length} pode(m) buscar</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
