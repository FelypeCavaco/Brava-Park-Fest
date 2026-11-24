import { useCallback, useEffect, useState } from 'react'
import { QrCode, Check, X, AlertTriangle, Copy, Printer, RefreshCcw, UserPlus } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { QrImg, qrParaImpressao } from './QrRec'
import { friendlyDbError } from '../../lib/format'
import { horaMin, idadeTexto, linkCadastro, mascaraCpf, mascaraTelefone } from '../../lib/recreacao'

// Cadastros que o responsável mandou pelo celular: a recepção confere e aprova ou recusa.
export interface PreCadastro {
  id: string
  criado_em: string
  dados: {
    responsavel: string; cpf: string; telefone: string; email: string | null; imagem_autorizada: boolean
    criancas: { nome: string; nascimento: string; cuidados: string | null }[]
    autorizados: { nome: string; parentesco: string | null }[]
  }
  parecidas: { id: string; responsavel: string; cpf: string | null; telefone: string | null; criancas: string[]; motivos: string[]; bloqueia: boolean }[]
}

export function PreCadastros({ onMudou }: { onMudou: () => void }) {
  const [lista, setLista] = useState<PreCadastro[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [recusando, setRecusando] = useState<{ id: string; motivo: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('rec_pre_listar')
    if (error) return setErro(friendlyDbError(error.message))
    setErro(null); setLista((data ?? []) as PreCadastro[])
  }, [])
  useEffect(() => { carregar(); const t = setInterval(carregar, 30000); return () => clearInterval(t) }, [carregar])

  async function aprovar(p: PreCadastro) {
    setOcupado(true)
    const { error } = await supabase.rpc('rec_pre_aprovar', { p_id: p.id })
    setOcupado(false)
    if (error) return setErro(friendlyDbError(error.message))
    setMsg(`${p.dados.responsavel.split(' ')[0]} agora está cadastrada(o). As crianças já aparecem na entrada.`); carregar(); onMudou()
  }
  async function recusar() {
    if (!recusando) return
    setOcupado(true)
    const { error } = await supabase.rpc('rec_pre_recusar', { p_id: recusando.id, p_motivo: recusando.motivo })
    setOcupado(false)
    if (error) return setErro(friendlyDbError(error.message))
    setRecusando(null); setMsg('Cadastro recusado e os dados apagados.'); carregar()
  }

  if (!lista || lista.length === 0) {
    return msg ? <div className="bg-teal-light text-teal text-sm rounded-lg px-4 py-2.5 flex justify-between gap-2"><span className="flex items-center gap-2"><Check className="w-4 h-4" />{msg}</span><button onClick={() => setMsg(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button></div> : null
  }

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <span className="w-8 h-8 rounded-lg bg-amber-light text-amber flex items-center justify-center"><UserPlus className="w-4 h-4" /></span>
        <h2 className="font-semibold flex-1">Cadastros recebidos pelo celular <span className="text-amber">({lista.length})</span></h2>
      </div>
      <p className="text-xs text-muted mb-3">Confira com o documento do responsável antes de aprovar. Só depois da aprovação a família aparece na entrada.</p>
      {erro && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 mb-3 flex justify-between gap-2"><span>{erro}</span><button onClick={() => setErro(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button></div>}
      {msg && <div className="bg-teal-light text-teal text-sm rounded-lg px-4 py-2.5 mb-3 flex justify-between gap-2"><span className="flex items-center gap-2"><Check className="w-4 h-4" />{msg}</span><button onClick={() => setMsg(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button></div>}
      <div className="space-y-3">
        {lista.map((p) => {
          const bloqueia = p.parecidas.find((x) => x.bloqueia)
          return (
            <div key={p.id} className="rounded-xl border border-line p-4 space-y-2.5">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <p className="font-semibold">{p.dados.responsavel}</p>
                <p className="text-xs text-muted">CPF {mascaraCpf(p.dados.cpf)} · {mascaraTelefone(p.dados.telefone)}{p.dados.email ? ` · ${p.dados.email}` : ''}</p>
                <p className="text-[11px] text-muted ml-auto">enviado às {horaMin(p.criado_em)}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {p.dados.criancas.map((c, i) => (
                  <span key={i} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${c.cuidados ? 'bg-danger-light text-danger' : 'bg-paper text-ink/80'}`}>
                    {c.cuidados && <AlertTriangle className="w-3 h-3" />}{c.nome} · {idadeTexto(c.nascimento)}{c.cuidados ? ` · ${c.cuidados}` : ''}
                  </span>
                ))}
              </div>
              {p.dados.autorizados.length > 0 && <p className="text-xs text-muted">Também podem buscar: {p.dados.autorizados.map((a) => `${a.nome}${a.parentesco ? ` (${a.parentesco})` : ''}`).join(', ')}</p>}
              {p.parecidas.length > 0 && (
                <div className={`rounded-lg px-3 py-2 text-xs ${bloqueia ? 'bg-danger-light text-danger' : 'bg-amber-light text-amber'}`}>
                  <p className="font-bold flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{bloqueia ? 'Já existe cadastro com este CPF' : 'Pode ser alguém que já está cadastrado'}</p>
                  {p.parecidas.map((x) => <p key={x.id}>{x.responsavel} ({x.criancas.join(', ') || 'sem crianças'}): {x.motivos.join('; ')}</p>)}
                </div>
              )}
              {recusando?.id === p.id ? (
                <div className="flex flex-wrap gap-2">
                  <input className="campo flex-1 min-w-[12rem]" placeholder="Motivo (opcional)" value={recusando.motivo} onChange={(e) => setRecusando({ id: p.id, motivo: e.target.value })} aria-label="Motivo da recusa" />
                  <Button variant="secondary" onClick={recusar} disabled={ocupado}>Recusar e apagar os dados</Button>
                  <Button variant="ghost" onClick={() => setRecusando(null)}>Voltar</Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => aprovar(p)} disabled={ocupado || !!bloqueia} title={bloqueia ? 'Já existe uma família com este CPF' : undefined}><Check className="w-4 h-4" />Aprovar cadastro</Button>
                  <Button variant="secondary" onClick={() => setRecusando({ id: p.id, motivo: '' })}><X className="w-4 h-4" />Recusar</Button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// QR da casa: o responsável lê e abre o formulário no celular.
export function QrAutocadastro({ nomeCasa, onFechar }: { nomeCasa: string; onFechar: () => void }) {
  const [token, setToken] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  const carregar = useCallback(async (trocar: boolean) => {
    const { data, error } = await supabase.rpc('rec_autocad_token', { p_trocar: trocar })
    if (error) return setErro(friendlyDbError(error.message))
    setErro(null); setToken(data as string)
  }, [])
  useEffect(() => { carregar(false) }, [carregar])

  const link = token ? linkCadastro(token) : ''
  async function imprimir() {
    const w = window.open('', '_blank', 'width=520,height=720')
    if (!w) return setErro('O navegador bloqueou a janela de impressão. Libere as janelas deste site.')
    const qr = await qrParaImpressao(link)
    w.document.write(`<!doctype html><meta charset="utf-8"><title>QR de cadastro</title><style>body{font-family:system-ui,sans-serif;text-align:center;padding:32px}h1{font-size:28px;margin:0 0 8px}p{font-size:18px;margin:6px 0}img{width:320px;height:320px;margin:20px 0}</style><h1>${nomeCasa.replace(/</g, '&lt;')}</h1><p><b>Faça seu cadastro pelo celular</b></p><img src="${qr}"><p>Aponte a câmera para o QR code</p><p style="font-size:14px;color:#555">Depois, fale com a recepção para liberar a entrada.</p><script>window.onload=()=>{window.print();setTimeout(()=>window.close(),400)}<\/script>`)
    w.document.close()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="absolute inset-0 bg-ink/40" onClick={onFechar} />
      <div className="relative w-full max-w-md my-8 bg-surface rounded-card p-6 shadow-xl">
        <button type="button" onClick={onFechar} className="absolute right-3 top-3 text-muted hover:text-ink" aria-label="Fechar"><X className="w-5 h-5" /></button>
        <h2 className="text-lg font-semibold flex items-center gap-2"><QrCode className="w-5 h-5 text-purple" />QR de autocadastro</h2>
        <p className="text-sm text-muted mt-1">Imprima e deixe na recepção. O responsável lê com a câmera do celular e preenche os dados. Você confere e aprova aqui.</p>
        {erro && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 mt-3">{erro}</div>}
        {token && (
          <div className="mt-5 flex flex-col items-center gap-3">
            <QrImg texto={link} tamanho={220} className="rounded-xl border border-line bg-white p-2" />
            <p className="text-[11px] text-muted break-all text-center select-all">{link}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={imprimir}><Printer className="w-4 h-4" />Imprimir</Button>
              <Button variant="secondary" onClick={async () => { await navigator.clipboard?.writeText(link); setCopiado(true); setTimeout(() => setCopiado(false), 1800) }}><Copy className="w-4 h-4" />{copiado ? 'Copiado!' : 'Copiar link'}</Button>
            </div>
            <button type="button" className="text-xs text-muted hover:text-danger inline-flex items-center gap-1 mt-2" onClick={() => { if (window.confirm('Trocar o QR? O QR impresso atual deixa de funcionar e você precisará imprimir de novo. Faça isso só se o QR foi parar em mãos erradas ou se estiver recebendo cadastros indevidos.')) carregar(true) }}>
              <RefreshCcw className="w-3 h-3" />Trocar o QR (o antigo para de funcionar)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
