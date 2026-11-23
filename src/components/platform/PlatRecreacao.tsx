import { useEffect, useState } from 'react'
import { Timer, Check } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { friendlyDbError } from '../../lib/format'
import { FUNCOES_REC, type FuncoesRec } from '../../lib/recreacao'

// Funções da recreação de uma casa (migração 100). Só o administrador geral
// muda; a casa só vê, em Recreação → Funções ligadas.
export function RecreacaoFuncoes({ companyId, ligada }: { companyId: string; ligada: boolean }) {
  const [f, setF] = useState<FuncoesRec | null>(null)
  const [orig, setOrig] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!ligada) return
    supabase.rpc('platform_rec_funcoes', { p_company: companyId }).then(({ data, error }) => {
      if (error) return setMsg({ ok: false, texto: error.message.includes('platform_rec_funcoes') ? 'Rode a migração 100 para configurar a recreação.' : friendlyDbError(error.message) })
      setF(data as FuncoesRec)
      setOrig(JSON.stringify(data))
    })
  }, [companyId, ligada])

  async function salvar() {
    if (!f) return
    setBusy(true)
    const { error } = await supabase.rpc('platform_rec_funcoes_salvar', { p_company: companyId, p_funcoes: f })
    setBusy(false)
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    setOrig(JSON.stringify(f))
    setMsg({ ok: true, texto: 'Funções da recreação salvas. Valem na hora para a casa.' })
  }

  return (
    <Card title="Funções da recreação">
      {!ligada ? (
        <p className="text-sm text-muted flex items-center gap-2"><Timer className="w-4 h-4" />Ligue a função “Recreação” desta casa para escolher como ela vai funcionar.</p>
      ) : !f ? (
        <p className="text-sm text-muted">{msg?.texto ?? 'Carregando...'}</p>
      ) : (
        <>
          <p className="text-xs text-muted mb-4">Só você muda. A casa vê a lista em Recreação → Funções ligadas, sem poder alterar.</p>
          <div className="grid gap-3 md:grid-cols-2">
            {FUNCOES_REC.map((g) => (
              <div key={g.grupo} className="rounded-lg bg-paper px-3 py-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{g.grupo}</p>
                {g.itens.map((it) => (
                  <div key={it.k}>
                    {it.tipo === 'bool' ? (
                      <label className="flex items-start gap-2 text-sm cursor-pointer">
                        <input type="checkbox" className="mt-0.5" checked={f[it.k] === true} onChange={(e) => setF({ ...f, [it.k]: e.target.checked })} />
                        {it.label}
                      </label>
                    ) : it.tipo === 'opcao' ? (
                      <label className="block text-sm">{it.label}
                        <select className="campo mt-1" value={String(f[it.k])} onChange={(e) => setF({ ...f, [it.k]: e.target.value })}>
                          {it.opcoes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </label>
                    ) : it.tipo === 'hora' ? (
                      <label className="flex items-center justify-between gap-2 text-sm">{it.label}
                        <input type="time" className="campo !w-32" value={String(f[it.k])} onChange={(e) => setF({ ...f, [it.k]: e.target.value })} />
                      </label>
                    ) : (
                      <label className="flex items-center justify-between gap-2 text-sm">{it.label}
                        <span className="flex items-center gap-1.5"><input type="number" min={1} max={999} className="campo !w-20" value={Number(f[it.k])} onChange={(e) => setF({ ...f, [it.k]: Number(e.target.value) })} /><span className="text-xs text-muted">{it.sufixo}</span></span>
                      </label>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <Button onClick={salvar} disabled={busy || JSON.stringify(f) === orig}><Check className="w-4 h-4" />Salvar funções da recreação</Button>
            {msg && <span className={`text-sm ${msg.ok ? 'text-teal' : 'text-danger'}`}>{msg.texto}</span>}
          </div>
        </>
      )}
    </Card>
  )
}
