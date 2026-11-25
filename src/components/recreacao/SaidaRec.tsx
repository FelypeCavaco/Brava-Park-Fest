import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, KeyRound, LogOut, Minus, Plus, ShieldAlert, X } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/AuthContext'
import { Button } from '../ui/Button'
import { brl, friendlyDbError, parseDecimal } from '../../lib/format'
import { imprimirSaida, papelDe } from '../../lib/recImpressao'
import { FORMAS_REC, limparFotosVencidas, cronometro, idadeTexto, nomeForma, type FamiliaRec, type FuncoesRec, type ItemRec, type VisitaRec } from '../../lib/recreacao'

// Saída: confere quem busca (código ou gerente), mostra a conta de cada
// criança (calculada no banco) e registra o pagamento — junto ou separado.

interface Props {
  visitas: string[] // do grupo (irmãos que entraram juntos)
  marcadas: string[] // as que começam marcadas
  codigoLido?: string
  funcoes: FuncoesRec
  regras?: Record<string, string | number>
  nomeCasa?: string
  onFechar: () => void
  onConcluida: (msg: string) => void
}

export function SaidaRec({ visitas, marcadas: marcadasIni, codigoLido, funcoes, regras, nomeCasa, onFechar, onConcluida }: Props) {
  const { can } = useAuth()
  const [vs, setVs] = useState<VisitaRec[] | null>(null)
  const [fam, setFam] = useState<FamiliaRec | null>(null)
  const [itens, setItens] = useState<ItemRec[]>([])
  const [fotos, setFotos] = useState<Record<string, string>>({})
  const [sel, setSel] = useState<string[]>(marcadasIni)
  const [codigo, setCodigo] = useState(codigoLido ?? '')
  const [semCodigo, setSemCodigo] = useState<{ documento: string; motivo: string } | null>(null)
  const [buscou, setBuscou] = useState('')
  const [ciente, setCiente] = useState(false)
  const [extras, setExtras] = useState<Record<string, Record<string, number>>>({}) // visita -> item -> qtd
  const [desc, setDesc] = useState<Record<string, Ajuste>>({})
  const [acr, setAcr] = useState<Record<string, Ajuste>>({})
  const [modo, setModo] = useState<'junto' | 'separado'>('junto')
  const [forma, setForma] = useState('pix')
  const [formas, setFormas] = useState<Record<string, string>>({})
  const [recebido, setRecebido] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('rec_saida_previa', { p_visitas: visitas })
    if (error) return setErro(friendlyDbError(error.message))
    const lista = (data ?? []) as VisitaRec[]
    setVs(lista)
    return lista
  }, [visitas])

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const lista = await carregar()
      if (!vivo || !lista?.length) return
      const [f, it] = await Promise.all([
        supabase.rpc('rec_familia_get', { p_id: lista[0].familia.id }),
        supabase.from('rec_itens').select('id, nome, preco, ativo, ordem').eq('ativo', true).order('ordem'),
      ])
      if (!vivo) return
      if (f.data) { setFam(f.data as FamiliaRec); setBuscou((f.data as FamiliaRec).responsavel) }
      setItens((it.data ?? []) as ItemRec[])
      const comFoto = lista.filter((v) => v.crianca.foto_path)
      if (funcoes.foto !== 'nao' && comFoto.length) {
        const { data: urls } = await supabase.storage.from('recreacao-fotos').createSignedUrls(comFoto.map((v) => v.crianca.foto_path!), 3600)
        if (vivo && urls) setFotos(Object.fromEntries(comFoto.map((v, i) => [v.id, urls[i]?.signedUrl ?? ''])))
      }
    })()
    const t = setInterval(carregar, 30000) // a conta anda com o tempo
    return () => { vivo = false; clearInterval(t) }
  }, [carregar, funcoes.foto])

  if (!vs) return <div className="py-10 text-center text-sm text-muted">{erro ?? 'Carregando...'}</div>
  if (!vs.length) return <div className="py-10 text-center text-sm text-muted">Essas crianças já saíram.</div>

  const escolhidas = vs.filter((v) => sel.includes(v.id))
  const itensTotal = (vid: string) => Object.entries(extras[vid] ?? {}).reduce((s, [iid, q]) => s + q * Number(itens.find((i) => i.id === iid)?.preco ?? 0), 0)
  const baseDe = (v: VisitaRec) => Number(v.conta.total) + itensTotal(v.id)
  const descNum = (v: VisitaRec) => valorAjuste(desc[v.id], baseDe(v), true)
  const acrNum = (v: VisitaRec) => valorAjuste(acr[v.id], baseDe(v), false)
  const totalDe = (v: VisitaRec) => Math.max(0, baseDe(v) - descNum(v) + acrNum(v))
  const aPagar = (v: VisitaRec) => Math.max(0, totalDe(v) - Number(v.pago_entrada))
  const somaPagar = escolhidas.reduce((s, v) => s + aPagar(v), 0)
  const ocorrencias = escolhidas.flatMap((v) => v.ocorrencias.map((o) => ({ ...o, nome: v.crianca.nome })))
  const pessoas = fam ? [{ nome: fam.responsavel, rel: 'responsável' }, ...fam.autorizados.filter((a) => a.ativo).map((a) => ({ nome: a.nome, rel: [a.parentesco, a.documento].filter(Boolean).join(' · ') }))] : []
  const rec = parseDecimal(recebido)
  const precisaCodigo = funcoes.codigo !== false

  const pendencia = !escolhidas.length ? 'Marque quem vai sair.'
    : precisaCodigo && !semCodigo && codigo.length !== 4 ? 'Digite o código de retirada.'
    : semCodigo && (semCodigo.documento.trim().length < 3 || semCodigo.motivo.trim().length < 3) ? 'Informe o documento e o motivo.'
    : funcoes.ocorrCiente !== false && ocorrencias.length && !ciente ? 'Marque que o responsável está ciente da ocorrência.'
    : escolhidas.some((v) => descNum(v) > 0 && (desc[v.id]?.motivo ?? '').trim().length < 3) ? 'Escreva o motivo do desconto.'
    : escolhidas.some((v) => acrNum(v) > 0 && (acr[v.id]?.motivo ?? '').trim().length < 3) ? 'Escreva o motivo do acréscimo.'
    : escolhidas.some((v) => (desc[v.id]?.tipo === 'pct' && (parseDecimal(desc[v.id]?.valor ?? '') ?? 0) > 100)) ? 'O desconto em porcentagem não pode passar de 100%.'
    : somaPagar > 0 && modo === 'separado' && escolhidas.some((v) => aPagar(v) > 0 && !formas[v.id]) ? 'Escolha a forma de pagamento de cada criança.'
    : null

  async function confirmar() {
    if (pendencia) return
    setSalvando(true); setErro(null)
    const porVisita = Object.fromEntries(escolhidas.map((v) => [v.id, {
      forma: modo === 'junto' ? forma : formas[v.id] ?? null,
      itens: Object.entries(extras[v.id] ?? {}).filter(([, q]) => q > 0).map(([item, quantidade]) => ({ item, quantidade })),
      desconto: descNum(v) > 0 ? { tipo: desc[v.id]?.tipo ?? 'valor', valor: parseDecimal(desc[v.id]?.valor ?? '') ?? 0, motivo: desc[v.id]?.motivo } : null,
      acrescimo: acrNum(v) > 0 ? { tipo: acr[v.id]?.tipo ?? 'valor', valor: parseDecimal(acr[v.id]?.valor ?? '') ?? 0, motivo: acr[v.id]?.motivo } : null,
    }]))
    const { data, error } = await supabase.rpc('rec_saida', {
      p_visitas: escolhidas.map((v) => v.id),
      p_dados: { codigo, liberacao: semCodigo, buscou, ciente, visitas: porVisita },
    })
    setSalvando(false)
    if (error) { await carregar(); return setErro(friendlyDbError(error.message)) }
    if (funcoes.fotoGuarda === 'saida') limparFotosVencidas().catch(() => {}) // a casa quer apagar a foto logo na saída
    const resp = data as { pagar: number; saida_em: string; visitas: { id: string; pagou_agora: number; forma: string | null }[] }
    const papel = papelDe(regras?.impressora)
    if (papel && regras?.imprimeSaida !== 'nao') {
      // comprovante de saída: hora, tempo, itens e valor cobrado
      imprimirSaida({
        casa: nomeCasa || 'Recreação', papel, saidaEm: resp.saida_em, responsavel: fam?.responsavel ?? escolhidas[0].familia.responsavel, buscou,
        criancas: escolhidas.map((v) => {
          const r = resp.visitas.find((x) => x.id === v.id)
          return {
            nome: v.crianca.nome, entradaEm: v.entrada_em, tempoSeg: v.seg_cobrado, plano: v.plano.nome, linhas: v.conta.linhas,
            itens: Object.entries(extras[v.id] ?? {}).filter(([, q]) => q > 0).map(([iid, q]) => { const it = itens.find((i) => i.id === iid)!; return { d: `${q}x ${it.nome}`, v: q * Number(it.preco) } }),
            desconto: descNum(v), descontoRotulo: desc[v.id]?.tipo === 'pct' ? `Desconto (${desc[v.id]?.valor}%)` : 'Desconto',
            acrescimo: acrNum(v), acrescimoRotulo: acr[v.id]?.tipo === 'pct' ? `Acréscimo (${acr[v.id]?.valor}%)` : 'Acréscimo',
            total: totalDe(v), pagoEntrada: Number(v.pago_entrada), pagoAgora: Number(r?.pagou_agora ?? 0), forma: r?.forma,
          }
        }),
      })
    }
    const pago = resp.pagar
    onConcluida(`${escolhidas.map((v) => v.crianca.nome.split(' ')[0]).join(' e ')} ${escolhidas.length > 1 ? 'saíram' : 'saiu'}. ${pago > 0 ? `${brl(pago)} recebidos.` : 'Nada a pagar.'}`)
  }

  return (
    <div className="space-y-5">
      {/* quem sai */}
      <div className="grid gap-3 sm:grid-cols-2">
        {vs.map((v) => {
          const on = sel.includes(v.id)
          return (
            <label key={v.id} className={`flex gap-3 rounded-xl border-2 p-3 cursor-pointer ${on ? 'border-purple bg-purple-light/30' : 'border-line bg-surface'}`}>
              <input type="checkbox" className="mt-1 w-5 h-5" checked={on} onChange={(e) => setSel((s) => (e.target.checked ? [...s, v.id] : s.filter((x) => x !== v.id)))} />
              {fotos[v.id] && <img src={fotos[v.id]} alt={`Foto de ${v.crianca.nome}`} className="w-20 h-20 rounded-xl object-cover" />}
              <span className="flex-1 min-w-0">
                <b>{v.crianca.nome}</b>
                <span className="block text-xs text-muted">{idadeTexto(v.crianca.nascimento)}{v.pulseira ? ` · pulseira ${v.pulseira}` : ''} · {cronometro(v.seg_total)} na recreação</span>
                {fotos[v.id] && on && <span className="block text-[11px] text-purple font-semibold mt-1">Confira se é a criança certa.</span>}
              </span>
            </label>
          )
        })}
      </div>

      {ocorrencias.length > 0 && (
        <div className="rounded-xl bg-amber-light text-amber p-4 text-sm space-y-1">
          <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />Conte ao responsável</p>
          {ocorrencias.map((o) => <p key={o.id}>{o.nome.split(' ')[0]} · {new Date(o.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {o.tipo}: {o.descricao}{o.providencia ? ` (feito: ${o.providencia})` : ''}</p>)}
          {funcoes.ocorrCiente !== false && <label className="flex items-center gap-2 font-semibold text-ink pt-1 cursor-pointer"><input type="checkbox" checked={ciente} onChange={(e) => setCiente(e.target.checked)} />O responsável foi informado e está ciente</label>}
        </div>
      )}

      {/* quem busca e código */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-sm font-semibold mb-2">Quem está buscando?</p>
          <div className="space-y-1.5">
            {pessoas.map((p) => (
              <label key={p.nome} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name="buscou" checked={buscou === p.nome} onChange={() => setBuscou(p.nome)} />{p.nome} <span className="text-xs text-muted">{p.rel}</span>
              </label>
            ))}
          </div>
        </div>
        {precisaCodigo && (
          <div>
            {!semCodigo ? (
              <>
                <label className="text-sm font-semibold flex items-center gap-1.5"><KeyRound className="w-4 h-4 text-purple" />Código de retirada</label>
                <input className="campo mt-2 !w-40 !text-2xl font-display font-bold tracking-[0.4em] text-center" inputMode="numeric" maxLength={4} value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="····" aria-label="Código de retirada" />
                {codigoLido && <p className="text-xs text-teal mt-1">Código digitado na busca.</p>}
                {can('action:recreacao.gerente') && <button type="button" onClick={() => setSemCodigo({ documento: '', motivo: '' })} className="block text-xs text-muted underline mt-2">Responsável sem o código</button>}
              </>
            ) : (
              <div className="rounded-xl bg-amber-light/60 p-3 space-y-2">
                <p className="text-sm font-semibold flex items-center gap-1.5 text-amber"><ShieldAlert className="w-4 h-4" />Liberação sem código (gerente)</p>
                <input className="campo" value={semCodigo.documento} onChange={(e) => setSemCodigo({ ...semCodigo, documento: e.target.value })} placeholder="Documento conferido (ex.: RG 1.234.567)" />
                <input className="campo" value={semCodigo.motivo} onChange={(e) => setSemCodigo({ ...semCodigo, motivo: e.target.value })} placeholder="Motivo (ex.: celular sem bateria)" />
                <button type="button" onClick={() => setSemCodigo(null)} className="text-xs text-muted underline">Voltar a pedir o código</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* conta de cada criança */}
      <div className="space-y-3">
        {escolhidas.map((v) => (
          <div key={v.id} className="rounded-xl border border-line bg-paper/60 p-4 space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <b>{v.crianca.nome.split(' ')[0]} · {v.plano.nome}</b>
              <span className="text-xs text-muted">tempo cobrado {cronometro(v.seg_cobrado)}</span>
            </div>
            <div className="text-sm space-y-1">
              {v.conta.linhas.map((l, i) => <div key={i} className="flex justify-between gap-3"><span className="text-ink/80">{l.d}</span><span className="tabular-nums">{brl(Number(l.v))}</span></div>)}
              {Object.entries(extras[v.id] ?? {}).filter(([, q]) => q > 0).map(([iid, q]) => { const it = itens.find((i) => i.id === iid)!; return <div key={iid} className="flex justify-between"><span className="text-ink/80">{q}× {it.nome}</span><span className="tabular-nums">{brl(q * Number(it.preco))}</span></div> })}
              {descNum(v) > 0 && <div className="flex justify-between text-teal"><span>Desconto{desc[v.id]?.tipo === 'pct' ? ` (${desc[v.id]?.valor}%)` : ''}</span><span className="tabular-nums">−{brl(descNum(v))}</span></div>}
              {acrNum(v) > 0 && <div className="flex justify-between text-amber"><span>Acréscimo{acr[v.id]?.tipo === 'pct' ? ` (${acr[v.id]?.valor}%)` : ''}</span><span className="tabular-nums">+{brl(acrNum(v))}</span></div>}
              {Number(v.pago_entrada) > 0 && <div className="flex justify-between text-muted"><span>Já pago na entrada</span><span className="tabular-nums">−{brl(Number(v.pago_entrada))}</span></div>}
              <div className="flex justify-between font-semibold pt-1 border-t border-line"><span>A pagar</span><span className="tabular-nums">{brl(aPagar(v))}</span></div>
            </div>
            {itens.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {itens.map((it) => {
                  const q = extras[v.id]?.[it.id] ?? 0
                  const mudar = (d: number) => setExtras((e) => ({ ...e, [v.id]: { ...(e[v.id] ?? {}), [it.id]: Math.max(0, q + d) } }))
                  return q > 0 ? (
                    <span key={it.id} className="inline-flex items-center gap-1 rounded-full border border-purple bg-surface px-1 h-8 text-xs font-semibold">
                      <button type="button" onClick={() => mudar(-1)} className="w-6 h-6 rounded-full hover:bg-paper flex items-center justify-center" aria-label={`Tirar ${it.nome}`}><Minus className="w-3 h-3" /></button>
                      {q}× {it.nome}
                      <button type="button" onClick={() => mudar(1)} className="w-6 h-6 rounded-full hover:bg-paper flex items-center justify-center" aria-label={`Mais ${it.nome}`}><Plus className="w-3 h-3" /></button>
                    </span>
                  ) : (
                    <button key={it.id} type="button" onClick={() => mudar(1)} className="rounded-full border border-line bg-surface px-3 h-8 text-xs font-semibold hover:border-purple/40">+ {it.nome} {brl(Number(it.preco))}</button>
                  )
                })}
              </div>
            )}
            {can('action:recreacao.desconto') && (
              <div className="space-y-2">
                <CampoAjuste rotulo="Desconto" v={desc[v.id]} onChange={(a) => setDesc((d) => ({ ...d, [v.id]: a }))} />
                <CampoAjuste rotulo="Acréscimo" v={acr[v.id]} onChange={(a) => setAcr((d) => ({ ...d, [v.id]: a }))} />
              </div>
            )}
            {modo === 'separado' && aPagar(v) > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {FORMAS_REC.map(([f, l]) => <button key={f} type="button" onClick={() => setFormas((x) => ({ ...x, [v.id]: f }))} className={`px-3 h-8 rounded-full text-xs font-semibold border ${formas[v.id] === f ? 'bg-purple text-white border-purple' : 'border-line bg-surface'}`}>{l}</button>)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* pagamento */}
      {somaPagar > 0 && (
        <div className="rounded-xl border border-line p-4 space-y-3">
          {escolhidas.filter((v) => aPagar(v) > 0).length > 1 && (
            <div className="flex gap-1 p-1 bg-paper rounded-lg w-fit">
              {(['junto', 'separado'] as const).map((m) => <button key={m} type="button" onClick={() => setModo(m)} className={`px-3 h-8 rounded-md text-sm font-semibold ${modo === m ? 'bg-surface shadow-sm text-purple' : 'text-muted'}`}>{m === 'junto' ? 'Pagar tudo junto' : 'Cada criança separado'}</button>)}
            </div>
          )}
          {modo === 'junto' && (
            <div className="flex flex-wrap items-center gap-1.5">
              {FORMAS_REC.map(([f, l]) => <button key={f} type="button" onClick={() => setForma(f)} className={`px-3 h-9 rounded-full text-sm font-semibold border ${forma === f ? 'bg-purple text-white border-purple' : 'border-line bg-surface'}`}>{l}</button>)}
              {forma === 'dinheiro' && (
                <span className="flex items-center gap-2 ml-2 text-sm">Recebido <input className="campo !w-28" inputMode="decimal" value={recebido} onChange={(e) => setRecebido(e.target.value)} placeholder="R$" aria-label="Valor recebido" />
                  {rec != null && <b className={rec >= somaPagar ? 'text-teal' : 'text-danger'}>{rec >= somaPagar ? `Troco ${brl(rec - somaPagar)}` : `Faltam ${brl(somaPagar - rec)}`}</b>}</span>
              )}
            </div>
          )}
        </div>
      )}

      {erro && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 flex justify-between gap-2">{erro}<button onClick={() => setErro(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button></div>}

      <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-line">
        <div className="flex-1 min-w-[12rem]">
          <p className="font-display text-2xl font-black">{somaPagar > 0 ? `A pagar: ${brl(somaPagar)}` : 'Nada a pagar'}</p>
          {somaPagar > 0 && modo === 'junto' && <p className="text-xs text-muted">no {nomeForma(forma).toLowerCase()} · o valor é conferido de novo na hora de confirmar</p>}
          {pendencia && <p className="text-xs text-amber mt-1">{pendencia}</p>}
        </div>
        <Button variant="ghost" onClick={onFechar}>Voltar</Button>
        <Button onClick={confirmar} disabled={salvando || !!pendencia}>{salvando ? 'Registrando...' : <><LogOut className="w-4 h-4" />Confirmar saída</>}</Button>
      </div>
    </div>
  )
}

// Desconto e acréscimo: em reais ou em porcentagem da conta (tempo + itens).
interface Ajuste { tipo: 'valor' | 'pct'; valor: string; motivo: string }
function valorAjuste(a: Ajuste | undefined, base: number, limita: boolean): number {
  const n = parseDecimal(a?.valor ?? '') ?? 0
  if (!(n > 0)) return 0
  const v = a?.tipo === 'pct' ? Math.round(base * n) / 100 : Math.round(n * 100) / 100
  return limita ? Math.min(v, base) : v
}
function CampoAjuste({ rotulo, v, onChange }: { rotulo: string; v: Ajuste | undefined; onChange: (a: Ajuste) => void }) {
  const a: Ajuste = v ?? { tipo: 'valor', valor: '', motivo: '' }
  const tem = (parseDecimal(a.valor) ?? 0) > 0
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <span className="text-sm font-semibold w-20">{rotulo}</span>
      <div className="flex gap-1 p-1 bg-paper rounded-lg" role="group" aria-label={`${rotulo} em reais ou porcentagem`}>
        {(['valor', 'pct'] as const).map((t) => (
          <button key={t} type="button" onClick={() => onChange({ ...a, tipo: t })} className={`px-2.5 h-7 rounded-md text-xs font-bold ${a.tipo === t ? 'bg-surface shadow-sm text-purple' : 'text-muted'}`}>{t === 'valor' ? 'R$' : '%'}</button>
        ))}
      </div>
      <input className="campo !w-24" inputMode="decimal" placeholder={a.tipo === 'pct' ? '0 %' : 'R$ 0,00'} value={a.valor} onChange={(e) => onChange({ ...a, valor: e.target.value })} aria-label={`${rotulo} ${a.tipo === 'pct' ? 'em porcentagem' : 'em reais'}`} />
      {tem && <input className="campo flex-1 min-w-[12rem]" placeholder={`Motivo do ${rotulo.toLowerCase()} (obrigatório)`} value={a.motivo} onChange={(e) => onChange({ ...a, motivo: e.target.value })} />}
    </div>
  )
}
