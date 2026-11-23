import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Timer, Ticket, Clock, Layers, Plus, Trash2, ArrowUp, ArrowDown, X, AlertTriangle, Info, Sparkles, ShoppingBag, ScrollText,
  ShieldCheck, Check, Lock, ChevronDown, Calculator, Save, RotateCcw, EyeOff, Eye, Infinity as InfinityIcon, Hourglass, Sun,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { brl, friendlyDbError, parseDecimal } from '../lib/format'
import { useAuth } from '../lib/AuthContext'
import {
  ACAO_LIMITE, ARREDONDAMENTO, FUNCOES_REC, MODELOS, REGRA_BASE, fmtMin, relogio,
  type Faixa, type FuncoesRec, type ItemRec, type PlanoRec, type RegraRec, type Simulacao,
} from '../lib/recreacao'

type Aba = 'planos' | 'regras' | 'itens' | 'funcoes'
type Rascunho = RegraRec & { descricao: string; ativo: boolean }
interface Config { ligada: boolean; funcoes: FuncoesRec; regras: Record<string, string | number>; termo: string }

const copia = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

export function RecreacaoConfig() {
  const { can } = useAuth()
  const [aba, setAba] = useState<Aba>('planos')
  const [cfg, setCfg] = useState<Config | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    supabase.rpc('rec_config_get').then(({ data, error }) => {
      if (error) return setErro(friendlyDbError(error.message))
      setCfg(data as Config)
    })
  }, [])

  const abas: { id: Aba; label: string; icon: typeof Timer }[] = [
    { id: 'planos', label: 'Planos de cobrança', icon: Ticket },
    { id: 'regras', label: 'Regras e termo', icon: ScrollText },
    { id: 'itens', label: 'Itens do balcão', icon: ShoppingBag },
    { id: 'funcoes', label: 'Funções ligadas', icon: ShieldCheck },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple to-purple-dark text-white flex items-center justify-center shadow-lg shadow-purple/30 shrink-0">
          <Timer className="w-6 h-6" strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Recreação</h1>
          <p className="text-sm text-muted">Como a casa cobra o tempo das crianças, as regras do espaço e o que se vende no balcão.</p>
        </div>
      </div>

      {erro && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{erro}</div>}
      {cfg && !cfg.ligada && (
        <Card><p className="text-sm text-muted py-4 text-center">A recreação não está ligada para esta casa. Fale com o Festou para ativar.</p></Card>
      )}

      {cfg?.ligada && (
        <>
          <div className="flex flex-wrap gap-1.5 p-1 bg-surface border border-line rounded-xl w-fit max-w-full" role="tablist" aria-label="Partes da configuração">
            {abas.map((a) => (
              <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)}
                className={`inline-flex items-center gap-2 px-3.5 h-9 rounded-lg text-sm font-semibold transition-all ${aba === a.id ? 'bg-gradient-to-br from-purple to-purple-dark text-white shadow-md shadow-purple/25' : 'text-ink/70 hover:bg-paper'}`}>
                <a.icon className="w-4 h-4" strokeWidth={1.75} />{a.label}
              </button>
            ))}
          </div>
          {aba === 'planos' && <Planos podeEditar={can('page:recreacao_config')} />}
          {aba === 'regras' && <Regras cfg={cfg} onSalvo={(c) => setCfg(c)} />}
          {aba === 'itens' && <Itens />}
          {aba === 'funcoes' && <FuncoesLeitura funcoes={cfg.funcoes} />}
        </>
      )}
    </div>
  )
}

// ======================================================================
// Planos de cobrança
// ======================================================================
function Planos({ podeEditar }: { podeEditar: boolean }) {
  const [planos, setPlanos] = useState<PlanoRec[] | null>(null)
  const [frases, setFrases] = useState<Record<string, string>>({})
  const [editId, setEditId] = useState<string | null>(null) // null + rascunho = plano novo
  const [rascunho, setRascunho] = useState<Rascunho | null>(null)
  const [original, setOriginal] = useState<string>('')
  const [escolhendo, setEscolhendo] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [mostrarInativos, setMostrarInativos] = useState(false)

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('rec_planos').select('id, nome, descricao, ativo, ordem, regra, versao, atualizado_em, atualizado_por').order('ordem')
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    const lista = (data ?? []) as PlanoRec[]
    setPlanos(lista)
    const fr = await Promise.all(lista.map((p) => supabase.rpc('rec_frase', { p: p.regra })))
    setFrases(Object.fromEntries(lista.map((p, i) => [p.id, (fr[i].data as string) ?? ''])))
  }, [])
  useEffect(() => { carregar() }, [carregar])

  function abrir(p: PlanoRec) {
    const r: Rascunho = { ...copia(REGRA_BASE), ...copia(p.regra), nome: p.nome, descricao: p.descricao ?? '', ativo: p.ativo }
    setEditId(p.id); setRascunho(r); setOriginal(JSON.stringify(r)); setEscolhendo(false); setMsg(null)
  }
  function novoDeModelo(regra: RegraRec) {
    const r: Rascunho = { ...copia(regra), descricao: '', ativo: true }
    setEditId(null); setRascunho(r); setOriginal(''); setEscolhendo(false); setMsg(null)
  }
  const alterado = rascunho ? JSON.stringify(rascunho) !== original : false

  async function salvar(sim: Simulacao | null) {
    if (!rascunho || (sim && sim.validacao.erros.length)) return
    setSalvando(true); setMsg(null)
    const { data, error } = await supabase.rpc('rec_plano_salvar', { p_id: editId, p_plano: rascunho })
    setSalvando(false)
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    await carregar()
    const id = data as string
    const { data: p } = await supabase.from('rec_planos').select('id, nome, descricao, ativo, ordem, regra, versao, atualizado_em, atualizado_por').eq('id', id).single()
    if (p) abrir(p as PlanoRec)
    setMsg({ ok: true, texto: editId ? `Plano salvo (versão ${(p as PlanoRec | null)?.versao ?? ''}). Quem já está na recreação continua com o preço da hora em que entrou.` : 'Plano criado. Ele já aparece na entrada das crianças.' })
  }

  async function alternarAtivo(p: PlanoRec) {
    const { error } = await supabase.rpc('rec_plano_ativar', { p_id: p.id, p_ativo: !p.ativo })
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    await carregar()
    if (editId === p.id && rascunho) { const r = { ...rascunho, ativo: !p.ativo }; setRascunho(r); setOriginal(JSON.stringify(r)) }
    setMsg({ ok: true, texto: p.ativo ? `"${p.nome}" desativado: não aparece nas novas entradas, mas continua no histórico.` : `"${p.nome}" ativado.` })
  }

  if (!planos) return <Card><p className="text-sm text-muted py-6 text-center">Carregando...</p></Card>

  const visiveis = planos.filter((p) => mostrarInativos || p.ativo)
  const inativos = planos.length - planos.filter((p) => p.ativo).length

  if (planos.length === 0 && !rascunho) {
    return (
      <Card>
        <div className="text-center max-w-xl mx-auto py-2">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-purple-light text-purple flex items-center justify-center mb-3"><Sparkles className="w-6 h-6" strokeWidth={1.75} /></div>
          <h2 className="text-lg font-semibold">Crie o primeiro plano de cobrança</h2>
          <p className="text-sm text-muted mt-1">Escolha o jeito que a casa cobra. Dá para mudar valores, tempos e tolerâncias depois.</p>
        </div>
        <EscolherModelo onEscolher={novoDeModelo} disabled={!podeEditar} />
      </Card>
    )
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)] items-start">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink/80">Planos da casa</h2>
          {podeEditar && <Button variant="secondary" className="!px-3 !py-1.5" onClick={() => { setEscolhendo((v) => !v); setMsg(null) }}><Plus className="w-4 h-4" />Novo plano</Button>}
        </div>
        {escolhendo && (
          <div className="bg-surface border border-purple/30 rounded-card p-4 animate-card-in">
            <p className="text-sm font-semibold mb-2">Começar de um modelo</p>
            <EscolherModelo onEscolher={novoDeModelo} compacto />
          </div>
        )}
        {visiveis.map((p) => (
          <button key={p.id} type="button" onClick={() => abrir(p)}
            className={`w-full text-left bg-surface border rounded-card p-4 transition-all hover:shadow-md hover:border-purple/40 ${editId === p.id ? 'border-purple ring-2 ring-purple/15' : 'border-line'} ${p.ativo ? '' : 'opacity-60'}`}>
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">{p.nome}</p>
              <div className="flex gap-1 shrink-0">
                {!p.ativo && <Badge>inativo</Badge>}
                <Badge tone={p.regra.cobranca === 'entrada' ? 'purple' : 'teal'}>paga na {p.regra.cobranca}</Badge>
              </div>
            </div>
            <p className="text-xs text-muted mt-1.5 line-clamp-3">{frases[p.id] ?? ''}</p>
            <p className="text-[11px] text-muted/80 mt-2">Versão {p.versao}{p.atualizado_por ? ` · ${p.atualizado_por}` : ''}</p>
          </button>
        ))}
        {inativos > 0 && (
          <button type="button" onClick={() => setMostrarInativos((v) => !v)} className="text-xs font-medium text-purple inline-flex items-center gap-1">
            {mostrarInativos ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}{mostrarInativos ? 'Esconder' : 'Mostrar'} {inativos} {inativos === 1 ? 'plano inativo' : 'planos inativos'}
          </button>
        )}
      </div>

      <div className="space-y-6 min-w-0">
        {msg && <div className={`text-sm rounded-lg px-4 py-2.5 flex justify-between gap-2 ${msg.ok ? 'bg-teal-light text-teal' : 'bg-danger-light text-danger'}`}>{msg.texto}<button onClick={() => setMsg(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button></div>}
        {rascunho ? (
          <Editor key={editId ?? 'novo'} r={rascunho} setR={setRascunho} novo={!editId} alterado={alterado} salvando={salvando} podeEditar={podeEditar}
            onSalvar={salvar} onDesfazer={() => { if (editId) abrir(planos.find((p) => p.id === editId)!); else { setRascunho(null); setOriginal('') } }}
            onAtivo={editId ? () => alternarAtivo(planos.find((p) => p.id === editId)!) : undefined} />
        ) : (
          <Card><div className="py-10 text-center text-sm text-muted"><Ticket className="w-8 h-8 mx-auto mb-2 text-purple/40" strokeWidth={1.5} />Escolha um plano da lista para ver e editar, ou crie um novo.</div></Card>
        )}
      </div>
    </div>
  )
}

function EscolherModelo({ onEscolher, compacto, disabled }: { onEscolher: (r: RegraRec) => void; compacto?: boolean; disabled?: boolean }) {
  const icones: Record<string, typeof Timer> = { hora: Hourglass, faixas: Layers, blocos: Clock, diaria: Sun }
  return (
    <div className={`grid gap-3 ${compacto ? 'grid-cols-1' : 'sm:grid-cols-2 mt-5'}`}>
      {MODELOS.map((m) => {
        const Icone = icones[m.id] ?? Ticket
        return (
          <button key={m.id} type="button" disabled={disabled} onClick={() => onEscolher(copia(m.regra))}
            className="group text-left rounded-xl border border-line bg-paper/60 p-4 hover:border-purple/50 hover:bg-purple-light/40 hover:shadow-md transition-all disabled:opacity-50">
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-xl bg-surface text-purple flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform"><Icone className="w-5 h-5" strokeWidth={1.75} /></span>
              <span className="font-semibold">{m.titulo}</span>
            </div>
            <p className="text-xs text-muted mt-2">{m.resumo}</p>
          </button>
        )
      })}
      {!compacto && (
        <button type="button" disabled={disabled} onClick={() => onEscolher({ ...copia(REGRA_BASE), nome: '' })} className="sm:col-span-2 text-sm font-medium text-purple py-2 hover:underline disabled:opacity-50">
          Prefiro começar do zero
        </button>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------
// Editor de um plano
// ----------------------------------------------------------------------
function Editor({ r, setR, novo, alterado, salvando, podeEditar, onSalvar, onDesfazer, onAtivo }: {
  r: Rascunho; setR: (r: Rascunho) => void; novo: boolean; alterado: boolean; salvando: boolean; podeEditar: boolean
  onSalvar: (sim: Simulacao | null) => void; onDesfazer: () => void; onAtivo?: () => void
}) {
  const up = (patch: Partial<Rascunho>) => setR({ ...r, ...patch })
  const upExc = (patch: Partial<RegraRec['exc']>) => setR({ ...r, exc: { ...r.exc, ...patch } })
  const [seg, setSeg] = useState(71 * 60)
  const sim = useSimulacao(r, seg)
  const [mais, setMais] = useState(false)
  const erros = sim?.validacao.erros ?? []
  const avisos = sim?.validacao.avisos ?? []

  return (
    <>
      <Card>
        <fieldset disabled={!podeEditar} className="space-y-7 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-purple">{novo ? 'Novo plano' : 'Editando'}</p>
              <h2 className="text-xl font-semibold mt-0.5">{r.nome || 'Plano sem nome'}</h2>
            </div>
            {onAtivo && <button type="button" onClick={onAtivo} className="text-xs font-medium text-muted hover:text-purple">{r.ativo ? 'Desativar plano' : 'Ativar plano'}</button>}
          </div>

          <Passo n={1} titulo="Nome do plano" dica="É o nome que aparece para a equipe na hora da entrada.">
            <div className="grid sm:grid-cols-2 gap-3">
              <Campo label="Nome"><input className="campo" value={r.nome} maxLength={60} onChange={(e) => up({ nome: e.target.value })} placeholder="Ex.: 1 hora" /></Campo>
              <Campo label="Descrição (só a equipe vê)"><input className="campo" value={r.descricao} maxLength={200} onChange={(e) => up({ descricao: e.target.value })} placeholder="Ex.: o mais vendido no fim de semana" /></Campo>
            </div>
          </Passo>

          <Passo n={2} titulo="Quando o responsável paga?">
            <div className="grid sm:grid-cols-2 gap-3">
              <Opcao ativo={r.cobranca === 'entrada'} onClick={() => up({ cobranca: 'entrada' })} icone={Ticket} titulo="Na entrada"
                texto="Paga o tempo antes de brincar. Se passar do combinado, o excedente é cobrado na saída." />
              <Opcao ativo={r.cobranca === 'saida'} onClick={() => up({ cobranca: 'saida' })} icone={Clock} titulo="Na saída"
                texto="Paga pelo tempo que a criança ficou, na hora de ir embora." />
            </div>
          </Passo>

          {r.cobranca === 'entrada' ? (
            <>
              <Passo n={3} titulo="O que o valor inclui">
                <div className="grid sm:grid-cols-3 gap-3">
                  <Campo label="Valor do plano"><NumInput value={r.valor} onChange={(v) => up({ valor: v ?? 0 })} prefixo="R$" /></Campo>
                  <Campo label="Tempo incluído">
                    <NumInput value={r.incl} onChange={(v) => up({ incl: v })} sufixo="min" disabled={r.incl == null} />
                    <label className="mt-1.5 flex items-center gap-2 text-xs text-muted cursor-pointer">
                      <input type="checkbox" checked={r.incl == null} onChange={(e) => up({ incl: e.target.checked ? null : 60 })} /> Sem limite de tempo (diária)
                    </label>
                  </Campo>
                  {r.incl != null && <Campo label="Tolerância sem cobrar"><NumInput value={r.tolIncl} onChange={(v) => up({ tolIncl: v ?? 0 })} sufixo="min" /></Campo>}
                </div>
              </Passo>
              {r.incl != null && (
                <Passo n={4} titulo="Passou do tempo e da tolerância. E agora?">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Opcao ativo={r.depois === 'excedente'} onClick={() => up({ depois: 'excedente' })} icone={Plus} titulo="Cobra excedente" texto={`Conta desde ${fmtMin(r.incl)}: quem ficou ${r.incl + 20} min paga 20 min a mais.`} />
                    <Opcao ativo={r.depois === 'trava'} onClick={() => up({ depois: 'trava' })} icone={Lock} titulo="Não cobra mais nada" texto="A criança pode continuar; o valor não muda." />
                  </div>
                  {r.depois === 'excedente' && (
                    <div className="mt-4 space-y-4">
                      <Segmentado valor={r.exc.modelo} onChange={(v) => upExc({ modelo: v })}
                        opcoes={[['faixas', 'Por faixas', 'o valor da faixa substitui o anterior'], ['blocos', 'Por blocos', 'vai somando a cada bloco']]} />
                      {r.exc.modelo === 'faixas' ? (
                        <>
                          <LinhaDoTempo inicio={r.incl} faixas={r.exc.faixas} pago={{ fim: r.incl, valor: r.valor, tol: r.tolIncl }} />
                          <EditorFaixas faixas={r.exc.faixas} onChange={(f) => upExc({ faixas: f })} rotuloTempo="Excedente até" />
                        </>
                      ) : (
                        <div className="grid sm:grid-cols-4 gap-3">
                          <Campo label="Valor de cada bloco"><NumInput value={r.exc.Vb} onChange={(v) => upExc({ Vb: v ?? 0 })} prefixo="R$" /></Campo>
                          <Campo label="Tamanho do bloco"><NumInput value={r.exc.B} onChange={(v) => upExc({ B: v ?? 0 })} sufixo="min" /></Campo>
                          <Campo label="Tolerância em cada bloco"><NumInput value={r.exc.tolCada} onChange={(v) => upExc({ tolCada: v ?? 0 })} sufixo="min" /></Campo>
                          <Campo label="Teto do excedente"><NumInput value={r.exc.teto} onChange={(v) => upExc({ teto: v ?? 0 })} prefixo="R$" placeholder="sem teto" /></Campo>
                        </div>
                      )}
                    </div>
                  )}
                </Passo>
              )}
            </>
          ) : (
            <Passo n={3} titulo="Como o valor é calculado">
              <Segmentado valor={r.modelo} onChange={(v) => up({ modelo: v })}
                opcoes={[['faixas', 'Por faixas', 'o tempo total cai numa faixa, e o valor dela é o total'], ['blocos', 'Valor inicial + blocos', 'vai somando a cada bloco de tempo']]} />
              <div className="mt-4">
                {r.modelo === 'faixas' ? (
                  <>
                    <LinhaDoTempo inicio={0} faixas={r.faixas} />
                    <EditorFaixas faixas={r.faixas} onChange={(f) => up({ faixas: f })} rotuloTempo="Até" />
                  </>
                ) : (
                  <div className="grid sm:grid-cols-3 gap-3">
                    <Campo label="Valor inicial"><NumInput value={r.V0} onChange={(v) => up({ V0: v ?? 0 })} prefixo="R$" /></Campo>
                    <Campo label="Que cobre"><NumInput value={r.M0} onChange={(v) => up({ M0: v ?? 0 })} sufixo="min" /></Campo>
                    <Campo label="Tolerância antes do 1º bloco"><NumInput value={r.tol} onChange={(v) => up({ tol: v ?? 0 })} sufixo="min" /></Campo>
                    <Campo label="Valor de cada bloco"><NumInput value={r.Vb} onChange={(v) => up({ Vb: v ?? 0 })} prefixo="R$" /></Campo>
                    <Campo label="Tamanho do bloco"><NumInput value={r.B} onChange={(v) => up({ B: v ?? 0 })} sufixo="min" /></Campo>
                    <Campo label="Tolerância nos blocos seguintes"><NumInput value={r.tolCada} onChange={(v) => up({ tolCada: v ?? 0 })} sufixo="min" /></Campo>
                    <Campo label="Teto do dia"><NumInput value={r.teto} onChange={(v) => up({ teto: v ?? 0 })} prefixo="R$" placeholder="sem teto" /></Campo>
                  </div>
                )}
              </div>
            </Passo>
          )}

          <div className="border-t border-line pt-4">
            <button type="button" onClick={() => setMais((v) => !v)} className="w-full flex items-center justify-between text-sm font-semibold text-ink/80">
              Mais opções: arredondamento, pausa e limite de permanência
              <ChevronDown className={`w-4 h-4 transition-transform ${mais ? 'rotate-180' : ''}`} />
            </button>
            {mais && (
              <div className="grid sm:grid-cols-2 gap-3 mt-4 animate-card-in">
                <Campo label="Arredondamento do tempo">
                  <select className="campo" value={r.arred} onChange={(e) => up({ arred: e.target.value as RegraRec['arred'] })}>
                    {ARREDONDAMENTO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Campo>
                <Campo label="Pausa">
                  <label className="campo flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={r.pausa} onChange={(e) => up({ pausa: e.target.checked })} />Pode pausar o tempo (com justificativa)</label>
                </Campo>
                <Campo label="Limite de permanência"><NumInput value={r.limite || null} onChange={(v) => up({ limite: v ?? 0 })} sufixo="min" placeholder="sem limite" /></Campo>
                <Campo label="Ao chegar no limite">
                  <select className="campo" value={r.limiteAcao} disabled={!r.limite} onChange={(e) => up({ limiteAcao: e.target.value as RegraRec['limiteAcao'] })}>
                    {ACAO_LIMITE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Campo>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-gradient-to-br from-purple-light to-paper border border-purple/15 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-purple mb-1">Como a equipe vai ver</p>
            <p className="text-sm leading-relaxed">{sim?.frase ?? '...'}</p>
          </div>

          {(erros.length > 0 || avisos.length > 0) && (
            <div className="space-y-2">
              {erros.map((e) => <p key={e} className="text-sm bg-danger-light text-danger rounded-lg px-3 py-2 flex gap-2"><X className="w-4 h-4 mt-0.5 shrink-0" />{e}</p>)}
              {avisos.map((e) => <p key={e} className="text-sm bg-amber-light text-amber rounded-lg px-3 py-2 flex gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{e}</p>)}
            </div>
          )}
        </fieldset>

        {podeEditar && (
          <div className="flex flex-wrap items-center gap-2 mt-6 pt-4 border-t border-line">
            <Button onClick={() => onSalvar(sim)} disabled={salvando || !sim || erros.length > 0 || (!novo && !alterado)}>
              <Save className="w-4 h-4" />{erros.length ? `Corrija ${erros.length === 1 ? 'o problema' : `${erros.length} problemas`} para salvar` : salvando ? 'Salvando...' : novo ? 'Criar plano' : 'Salvar alterações'}
            </Button>
            {(alterado || novo) && <Button variant="ghost" onClick={onDesfazer}><RotateCcw className="w-4 h-4" />{novo ? 'Cancelar' : 'Desfazer'}</Button>}
            {!novo && alterado && <span className="text-xs text-amber">Alterações não salvas</span>}
          </div>
        )}
      </Card>

      <Simulador r={r} seg={seg} setSeg={setSeg} sim={sim} />
    </>
  )
}

// Pede ao banco a conta, a frase e a validação (com uma pequena espera enquanto digita).
function useSimulacao(r: RegraRec, seg: number) {
  const [sim, setSim] = useState<Simulacao | null>(null)
  const pedido = useRef(0)
  const chave = JSON.stringify(r) + '|' + seg
  useEffect(() => {
    const n = ++pedido.current
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('rec_simular', { p_regra: r, p_seg: seg })
      if (n !== pedido.current) return
      if (!error) setSim(data as Simulacao)
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])
  return sim
}

function Simulador({ r, seg, setSeg, sim }: { r: RegraRec; seg: number; setSeg: (s: number) => void; sim: Simulacao | null }) {
  const [limites, setLimites] = useState(false)
  const fx = r.cobranca === 'entrada' ? r.exc.faixas : r.faixas
  const maior = Math.max(r.cobranca === 'entrada' ? (r.incl ?? 120) + (fx.filter((f) => f.ate != null).slice(-1)[0]?.ate ?? 60) : 0, ...fx.map((f) => f.ate ?? 0), r.M0 + 4 * r.B, 120)
  const max = Math.ceil((maior * 1.4) / 30) * 30
  const prontos = [30, 45, 60, 67, 70, 71, 90, 125].filter((m) => m <= max)
  const min = Math.floor(seg / 60), s = seg % 60
  const pagoEntrada = r.cobranca === 'entrada' ? r.valor : 0
  const calc = sim?.calc
  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <span className="w-8 h-8 rounded-lg bg-green-light text-green-dark flex items-center justify-center"><Calculator className="w-4 h-4" /></span>
        <div><h3 className="font-semibold">Teste o plano</h3><p className="text-xs text-muted">Arraste ou digite quanto tempo a criança ficou. A conta é a mesma que o sistema vai fazer na saída.</p></div>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
        <div className="space-y-4 min-w-0">
          <div>
            <div className="flex items-end justify-between gap-3 mb-1">
              <span className="text-xs text-muted">Tempo cobrado</span>
              <span className="font-display text-3xl font-bold tabular-nums text-purple">{relogio(seg)}</span>
            </div>
            <input type="range" min={0} max={max * 60} step={60} value={Math.min(seg, max * 60)} onChange={(e) => setSeg(Number(e.target.value))} className="w-full accent-purple" aria-label="Tempo cobrado" />
            <div className="flex justify-between text-[11px] text-muted"><span>0</span><span>{fmtMin(max)}</span></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm">
              <input className="campo !w-20 text-center" inputMode="numeric" value={min} onChange={(e) => setSeg(Math.max(0, Number(e.target.value.replace(/\D/g, '') || 0)) * 60 + s)} aria-label="Minutos" />min
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input className="campo !w-16 text-center" inputMode="numeric" value={s} onChange={(e) => setSeg(min * 60 + Math.min(59, Number(e.target.value.replace(/\D/g, '') || 0)))} aria-label="Segundos" />s
            </label>
            <span className="w-px h-6 bg-line mx-1" />
            {prontos.map((m) => (
              <button key={m} type="button" onClick={() => setSeg(m * 60)} className={`px-2.5 h-7 rounded-full text-xs font-medium border transition-colors ${seg === m * 60 ? 'bg-purple text-white border-purple' : 'border-line hover:border-purple/40'}`}>{m} min</button>
            ))}
          </div>
          {calc && calc.expl.length > 0 && (
            <ul className="text-sm text-ink/80 space-y-1.5">
              {calc.expl.map((e) => <li key={e} className="flex gap-2"><Info className="w-4 h-4 mt-0.5 text-purple/60 shrink-0" />{e}</li>)}
            </ul>
          )}
        </div>

        {/* recibo */}
        <div className="rounded-xl border border-dashed border-line bg-paper/70 p-4 font-sans">
          {!sim ? <p className="text-sm text-muted">Calculando...</p> : sim.validacao.erros.length > 0 ? (
            <p className="text-sm text-muted">Corrija os problemas do plano para ver a conta.</p>
          ) : calc && (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-2">Conta da visita</p>
              <div className="space-y-1.5 text-sm">
                {calc.linhas.map((l, i) => <div key={i} className="flex justify-between gap-3"><span className="text-ink/80">{l.d}</span><span className="tabular-nums whitespace-nowrap">{brl(Number(l.v))}</span></div>)}
              </div>
              <div className="border-t border-line mt-3 pt-3 space-y-1">
                {pagoEntrada > 0 && (
                  <>
                    <div className="flex justify-between text-sm text-muted"><span>Já pago na entrada</span><span className="tabular-nums">−{brl(pagoEntrada)}</span></div>
                    <div className="flex justify-between text-sm font-semibold"><span>A pagar na saída</span><span className="tabular-nums">{brl(Number(calc.total) - pagoEntrada)}</span></div>
                  </>
                )}
                <div className="flex justify-between items-baseline"><span className="font-semibold">Total da visita</span><span className="font-display text-2xl font-bold tabular-nums">{brl(Number(calc.total))}</span></div>
              </div>
            </>
          )}
        </div>
      </div>

      {sim?.pontos && sim.pontos.length > 0 && (
        <div className="mt-6 border-t border-line pt-4">
          <button type="button" onClick={() => setLimites((v) => !v)} className="w-full flex items-center justify-between text-sm font-semibold text-ink/80">
            <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-green-dark" />Teste dos limites ({sim.pontos.length} pontos conferidos)</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${limites ? 'rotate-180' : ''}`} />
          </button>
          {limites && (
            <div className="mt-3 overflow-x-auto animate-card-in">
              <p className="text-xs text-muted mb-2">Em cada virada de preço: 1 segundo antes, exatamente no limite, durante a tolerância, no fim dela e 1 segundo depois. Toque numa linha para levar ao simulador.</p>
              <table className="w-full text-sm min-w-[620px]">
                <thead><tr className="text-left text-xs text-muted border-b border-line"><th className="py-2 pr-2 font-medium">Situação</th><th className="py-2 px-2 font-medium text-right">Tempo</th><th className="py-2 px-2 font-medium text-right">Conta como</th><th className="py-2 px-2 font-medium">O que aplica</th><th className="py-2 pl-2 font-medium text-right">Total</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {sim.pontos.map((p) => (
                    <tr key={p.s} onClick={() => setSeg(p.s)} className="cursor-pointer hover:bg-paper">
                      <td className="py-2 pr-2">{p.nome}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{relogio(p.s)}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-muted">{relogio(p.conta)}</td>
                      <td className="py-2 px-2 text-xs text-muted">{p.expl}</td>
                      <td className="py-2 pl-2 text-right tabular-nums font-semibold">{brl(Number(p.total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// Linha do tempo colorida com as faixas (e o tempo pago na entrada, quando há).
const CORES = ['bg-purple', 'bg-purple/80', 'bg-purple/60', 'bg-purple/45', 'bg-purple/30', 'bg-purple/20']
function LinhaDoTempo({ inicio, faixas, pago }: { inicio: number; faixas: Faixa[]; pago?: { fim: number; valor: number; tol: number } }) {
  const segs: { de: number; ate: number | null; valor: number; tol: number; rot: string; pago?: boolean }[] = []
  if (pago) segs.push({ de: 0, ate: pago.fim, valor: pago.valor, tol: pago.tol, rot: 'pago na entrada', pago: true })
  let ant = 0
  for (const f of faixas) {
    segs.push({ de: inicio + ant, ate: f.ate == null ? null : inicio + f.ate, valor: f.valor, tol: f.ate == null ? 0 : f.tol, rot: f.ate == null ? `acima de ${ant} min` : `até ${f.ate} min${pago ? ' a mais' : ''}` })
    if (f.ate != null) ant = f.ate
  }
  const finitos = segs.filter((x) => x.ate != null).map((x) => x.ate as number)
  const fim = Math.max(...finitos, inicio + 30)
  const total = fim * 1.18
  const larg = (x: (typeof segs)[number]) => Math.max(8, (((x.ate ?? total) - x.de) / total) * 100)
  return (
    <div className="mb-4" aria-label="Linha do tempo das faixas">
      <div className="flex w-full h-14 rounded-xl overflow-hidden ring-1 ring-line">
        {segs.map((x, i) => (
          <div key={i} style={{ flexGrow: larg(x) }} className={`relative basis-0 min-w-0 px-2 flex flex-col justify-center text-white ${x.pago ? 'bg-green-dark' : CORES[Math.min(i - (pago ? 1 : 0), CORES.length - 1)]} ${i ? 'border-l-2 border-white/70' : ''}`}>
            <span className={`text-sm font-bold truncate ${!x.pago && i - (pago ? 1 : 0) > 2 ? 'text-purple-dark' : ''}`}>{brl(x.valor)}</span>
            <span className={`text-[10px] truncate ${!x.pago && i - (pago ? 1 : 0) > 2 ? 'text-purple-dark/80' : 'text-white/85'}`}>{x.rot}</span>
            {x.ate == null && <InfinityIcon className="absolute right-2 top-2 w-3.5 h-3.5 opacity-70" />}
          </div>
        ))}
      </div>
      <div className="flex w-full mt-1 text-[10px] text-muted">
        {segs.map((x, i) => (
          <div key={i} style={{ flexGrow: larg(x) }} className="basis-0 min-w-0 truncate">{x.de} min{x.tol > 0 ? ` · +${x.tol} de tolerância no fim` : ''}</div>
        ))}
      </div>
    </div>
  )
}

function EditorFaixas({ faixas, onChange, rotuloTempo }: { faixas: Faixa[]; onChange: (f: Faixa[]) => void; rotuloTempo: string }) {
  const set = (i: number, patch: Partial<Faixa>) => onChange(faixas.map((f, k) => (k === i ? { ...f, ...patch } : f)))
  const mover = (i: number, d: number) => { const f = [...faixas]; [f[i], f[i + d]] = [f[i + d], f[i]]; onChange(f) }
  function adicionar() {
    const f = [...faixas]
    const u = f[f.length - 1]
    if (u && u.ate == null) {
      const ant = f[f.length - 2]?.ate ?? 0
      f[f.length - 1] = { ...u, ate: ant + 30 }
      f.push({ ate: null, valor: u.valor, tol: 0, depois: 'avanca' })
    } else f.push({ ate: (u?.ate ?? 0) + 30, valor: u?.valor ?? 0, tol: 0, depois: 'avanca' })
    onChange(f)
  }
  return (
    <div className="space-y-2">
      {faixas.map((f, i) => {
        const ant = i > 0 ? faixas[i - 1].ate : 0
        return (
          <div key={i} className="grid grid-cols-2 md:grid-cols-[32px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] gap-2 items-end rounded-xl border border-line bg-paper/50 p-3">
            <span className="col-span-2 md:col-span-1 w-8 h-8 rounded-lg bg-surface text-purple font-bold text-sm flex items-center justify-center md:self-center">{i + 1}</span>
            <Campo label={f.ate == null ? (i ? `Acima de ${ant ?? '…'} min` : 'Qualquer tempo') : i ? `Acima de ${ant ?? '…'} até` : rotuloTempo}>
              <NumInput value={f.ate} onChange={(v) => set(i, { ate: v })} sufixo="min" disabled={f.ate == null} placeholder="sem limite" />
              <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted cursor-pointer"><input type="checkbox" checked={f.ate == null} onChange={(e) => set(i, { ate: e.target.checked ? null : (ant ?? 0) + 30 })} />sem limite</label>
            </Campo>
            <Campo label="Valor"><NumInput value={f.valor} onChange={(v) => set(i, { valor: v ?? 0 })} prefixo="R$" /></Campo>
            <Campo label="Tolerância"><NumInput value={f.tol} onChange={(v) => set(i, { tol: v ?? 0 })} sufixo="min" disabled={f.ate == null} /></Campo>
            <Campo label="Depois desta faixa">
              <select className="campo" value={f.depois} disabled={f.ate == null} onChange={(e) => set(i, { depois: e.target.value as Faixa['depois'] })}>
                <option value="avanca">Próxima faixa</option>
                <option value="trava">Trava o preço</option>
              </select>
            </Campo>
            <div className="col-span-2 md:col-span-1 flex gap-1 justify-end">
              <IconeBtn label={`Subir faixa ${i + 1}`} disabled={i === 0} onClick={() => mover(i, -1)}><ArrowUp className="w-4 h-4" /></IconeBtn>
              <IconeBtn label={`Descer faixa ${i + 1}`} disabled={i === faixas.length - 1} onClick={() => mover(i, 1)}><ArrowDown className="w-4 h-4" /></IconeBtn>
              <IconeBtn label={`Apagar faixa ${i + 1}`} disabled={faixas.length === 1} onClick={() => onChange(faixas.filter((_, k) => k !== i))}><Trash2 className="w-4 h-4" /></IconeBtn>
            </div>
          </div>
        )
      })}
      <button type="button" onClick={adicionar} className="w-full rounded-xl border-2 border-dashed border-line py-2.5 text-sm font-semibold text-purple hover:border-purple/40 hover:bg-purple-light/30 transition-colors inline-flex items-center justify-center gap-1.5">
        <Plus className="w-4 h-4" />Adicionar faixa
      </button>
    </div>
  )
}

// ======================================================================
// Regras da casa e termo
// ======================================================================
function Regras({ cfg, onSalvo }: { cfg: Config; onSalvo: (c: Config) => void }) {
  const { can } = useAuth()
  const pode = can('page:recreacao_config')
  const [r, setR] = useState(cfg.regras)
  const [termo, setTermo] = useState(cfg.termo)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const n = (k: string) => (r[k] === '' || r[k] == null ? null : Number(r[k]))
  async function salvar() {
    setSalvando(true); setMsg(null)
    const { error } = await supabase.rpc('rec_regras_salvar', { p_regras: r, p_termo: termo })
    setSalvando(false)
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    const { data } = await supabase.rpc('rec_config_get')
    if (data) onSalvo(data as Config)
    setMsg({ ok: true, texto: 'Regras salvas.' })
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2 items-start">
      <Card title="Regras do espaço">
        <fieldset disabled={!pode} className="grid sm:grid-cols-2 gap-4">
          <Campo label="Lotação máxima" dica="Crianças ao mesmo tempo. Cheio, o sistema não deixa dar entrada."><NumInput value={n('lotacao')} onChange={(v) => setR({ ...r, lotacao: v ?? '' })} sufixo="crianças" /></Campo>
          <Campo label="Avisar antes de mudar o valor" dica="O cartão da criança fica amarelo."><NumInput value={n('aviso')} onChange={(v) => setR({ ...r, aviso: v ?? '' })} sufixo="min" /></Campo>
          <Campo label="Idade mínima"><NumInput value={n('idMin')} onChange={(v) => setR({ ...r, idMin: v ?? '' })} sufixo="anos" /></Campo>
          <Campo label="Idade máxima"><NumInput value={n('idMax')} onChange={(v) => setR({ ...r, idMax: v ?? '' })} sufixo="anos" /></Campo>
          <Campo label="Comprovante da entrada">
            <select className="campo" value={String(r.comprovante)} onChange={(e) => setR({ ...r, comprovante: e.target.value })}>
              <option value="perguntar">Perguntar a cada entrada</option><option value="zap">Só WhatsApp</option><option value="imp">Só impressora</option><option value="ambos">WhatsApp e impressora</option>
            </select>
          </Campo>
          <Campo label="Impressora térmica">
            <select className="campo" value={String(r.impressora)} onChange={(e) => setR({ ...r, impressora: e.target.value })}>
              <option value="nao">Não uso impressora</option><option value="58">58 mm (cupom pequeno)</option><option value="80">80 mm (cupom grande)</option>
            </select>
          </Campo>
        </fieldset>
      </Card>
      <Card title="Termo de responsabilidade">
        <p className="text-xs text-muted mb-2">O responsável aceita este texto no cadastro (no balcão ou pelo celular). O aceite fica guardado com data e hora.</p>
        <textarea className="campo min-h-[180px] leading-relaxed" value={termo} disabled={!pode} onChange={(e) => setTermo(e.target.value)} aria-label="Texto do termo" />
      </Card>
      {pode && (
        <div className="lg:col-span-2 flex flex-wrap items-center gap-3">
          <Button onClick={salvar} disabled={salvando}><Save className="w-4 h-4" />{salvando ? 'Salvando...' : 'Salvar regras e termo'}</Button>
          {msg && <span className={`text-sm ${msg.ok ? 'text-teal' : 'text-danger'}`}>{msg.texto}</span>}
        </div>
      )}
    </div>
  )
}

// ======================================================================
// Itens do balcão
// ======================================================================
function Itens() {
  const { can } = useAuth()
  const pode = can('page:recreacao_config')
  const [itens, setItens] = useState<ItemRec[] | null>(null)
  const [novo, setNovo] = useState({ nome: '', preco: null as number | null })
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('rec_itens').select('id, nome, preco, ativo, ordem').order('ordem')
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    setItens((data ?? []) as ItemRec[])
  }, [])
  useEffect(() => { carregar() }, [carregar])
  async function salvar(id: string | null, nome: string, preco: number | null, ativo = true) {
    const { error } = await supabase.rpc('rec_item_salvar', { p_id: id, p_nome: nome, p_preco: preco, p_ativo: ativo })
    if (error) { setMsg({ ok: false, texto: friendlyDbError(error.message) }); return false }
    setMsg(null); await carregar(); return true
  }
  return (
    <Card>
      <div className="flex items-start gap-3 mb-4">
        <span className="w-9 h-9 rounded-xl bg-orange-light text-orange flex items-center justify-center shrink-0"><ShoppingBag className="w-5 h-5" strokeWidth={1.75} /></span>
        <div><h3 className="font-semibold">Itens vendidos no balcão</h3><p className="text-xs text-muted">Meia antiderrapante, água, lanche... Entram na conta da criança na saída ou são vendidos avulsos no caixa.</p></div>
      </div>
      {msg && <p className={`text-sm mb-3 ${msg.ok ? 'text-teal' : 'text-danger'}`}>{msg.texto}</p>}
      {!itens ? <p className="text-sm text-muted">Carregando...</p> : (
        <div className="space-y-2">
          {itens.length === 0 && <p className="text-sm text-muted py-2">Nenhum item ainda.</p>}
          {itens.map((it) => <LinhaItem key={it.id} it={it} pode={pode} onSalvar={salvar} />)}
          {pode && (
            <form className="flex flex-wrap items-end gap-2 pt-3 border-t border-line" onSubmit={async (e) => { e.preventDefault(); if (await salvar(null, novo.nome, novo.preco)) setNovo({ nome: '', preco: null }) }}>
              <Campo label="Novo item"><input className="campo !w-56" value={novo.nome} maxLength={60} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="Ex.: Meia antiderrapante" /></Campo>
              <Campo label="Preço"><div className="w-32"><NumInput value={novo.preco} onChange={(v) => setNovo({ ...novo, preco: v })} prefixo="R$" /></div></Campo>
              <Button type="submit" disabled={!novo.nome.trim() || novo.preco == null}><Plus className="w-4 h-4" />Adicionar</Button>
            </form>
          )}
        </div>
      )}
    </Card>
  )
}

function LinhaItem({ it, pode, onSalvar }: { it: ItemRec; pode: boolean; onSalvar: (id: string, nome: string, preco: number | null, ativo?: boolean) => Promise<boolean> }) {
  const [nome, setNome] = useState(it.nome)
  const [preco, setPreco] = useState<number | null>(Number(it.preco))
  const mudou = nome !== it.nome || preco !== Number(it.preco)
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2 ${it.ativo ? 'bg-surface' : 'bg-paper opacity-60'}`}>
      <input className="campo !w-56 flex-1 min-w-[10rem]" value={nome} disabled={!pode} onChange={(e) => setNome(e.target.value)} aria-label="Nome do item" />
      <div className="w-32"><NumInput value={preco} onChange={setPreco} prefixo="R$" disabled={!pode} /></div>
      {pode && mudou && <Button className="!px-3 !py-1.5" onClick={() => onSalvar(it.id, nome, preco, it.ativo)}><Check className="w-4 h-4" />Salvar</Button>}
      {pode && <button type="button" className="text-xs font-medium text-muted hover:text-purple ml-auto" onClick={() => onSalvar(it.id, it.nome, Number(it.preco), !it.ativo)}>{it.ativo ? 'Parar de vender' : 'Voltar a vender'}</button>}
    </div>
  )
}

// ======================================================================
// Funções ligadas (só leitura: quem muda é o Festou)
// ======================================================================
function FuncoesLeitura({ funcoes }: { funcoes: FuncoesRec }) {
  return (
    <Card>
      <div className="flex items-start gap-3 mb-5">
        <span className="w-9 h-9 rounded-xl bg-teal-light text-teal flex items-center justify-center shrink-0"><ShieldCheck className="w-5 h-5" strokeWidth={1.75} /></span>
        <div><h3 className="font-semibold">Funções da recreação nesta casa</h3><p className="text-xs text-muted">Quem liga e desliga é o Festou, na implantação. Quer mudar alguma? Fale com a gente.</p></div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {FUNCOES_REC.map((g) => (
          <div key={g.grupo} className="rounded-xl bg-paper/60 border border-line p-4">
            <p className="text-sm font-semibold mb-2">{g.grupo}</p>
            <ul className="space-y-1.5">
              {g.itens.map((it) => {
                const v = funcoes[it.k]
                const texto = it.tipo === 'bool' ? null : it.tipo === 'opcao' ? it.opcoes.find((o) => o[0] === v)?.[1] : it.tipo === 'num' ? `${v} ${it.sufixo}` : String(v)
                const ligado = it.tipo === 'bool' ? v === true : it.tipo === 'opcao' ? v !== 'nao' : true
                return (
                  <li key={it.k} className="flex items-start gap-2 text-sm">
                    <span className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${ligado ? 'bg-teal text-white' : 'bg-line text-muted'}`}>{ligado ? <Check className="w-3 h-3" strokeWidth={3} /> : <X className="w-3 h-3" strokeWidth={3} />}</span>
                    <span className={ligado ? '' : 'text-muted'}>{it.label}{texto ? <b className="font-semibold">: {texto}</b> : ''}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ======================================================================
// Pecinhas
// ======================================================================
function Passo({ n, titulo, dica, children }: { n: number; titulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <section className="flex gap-3 sm:gap-4">
      <span className="w-7 h-7 rounded-full bg-gradient-to-br from-purple to-purple-dark text-white text-sm font-bold flex items-center justify-center shrink-0 shadow-sm shadow-purple/30">{n}</span>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold leading-7">{titulo}</h3>
        {dica && <p className="text-xs text-muted -mt-0.5 mb-2">{dica}</p>}
        <div className={dica ? '' : 'mt-2'}>{children}</div>
      </div>
    </section>
  )
}

function Opcao({ ativo, onClick, icone: Icone, titulo, texto }: { ativo: boolean; onClick: () => void; icone: typeof Timer; titulo: string; texto: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo}
      className={`text-left rounded-xl border-2 p-4 transition-all ${ativo ? 'border-purple bg-purple-light/60 shadow-md shadow-purple/10' : 'border-line bg-surface hover:border-purple/40'}`}>
      <div className="flex items-center gap-2.5">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${ativo ? 'bg-purple text-white' : 'bg-paper text-purple'}`}><Icone className="w-4 h-4" /></span>
        <span className="font-semibold">{titulo}</span>
        {ativo && <Check className="w-4 h-4 text-purple ml-auto" strokeWidth={3} />}
      </div>
      <p className="text-xs text-muted mt-2">{texto}</p>
    </button>
  )
}

function Segmentado<T extends string>({ valor, onChange, opcoes }: { valor: T; onChange: (v: T) => void; opcoes: [T, string, string][] }) {
  return (
    <div className="grid sm:grid-cols-2 gap-2 p-1 rounded-xl bg-paper border border-line">
      {opcoes.map(([v, t, d]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={valor === v}
          className={`rounded-lg px-3 py-2 text-left transition-all ${valor === v ? 'bg-surface shadow-sm ring-1 ring-purple/30' : 'hover:bg-surface/60'}`}>
          <span className={`text-sm font-semibold ${valor === v ? 'text-purple' : ''}`}>{t}</span>
          <span className="block text-[11px] text-muted">{d}</span>
        </button>
      ))}
    </div>
  )
}

function Campo({ label, dica, children }: { label: string; dica?: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="block text-xs font-medium text-muted mb-1">{label}</span>
      {children}
      {dica && <span className="block text-[11px] text-muted/80 mt-1">{dica}</span>}
    </label>
  )
}

function IconeBtn({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className="w-8 h-8 rounded-lg border border-line bg-surface text-ink/70 flex items-center justify-center hover:text-purple hover:border-purple/40 disabled:opacity-30 disabled:pointer-events-none">
      {children}
    </button>
  )
}

// Número digitado em português ("12,50"). Guarda o texto enquanto digita.
function NumInput({ value, onChange, prefixo, sufixo, disabled, placeholder }: {
  value: number | null; onChange: (v: number | null) => void; prefixo?: string; sufixo?: string; disabled?: boolean; placeholder?: string
}) {
  const fmt = (v: number | null) => (v == null ? '' : String(v).replace('.', ','))
  const [txt, setTxt] = useState(fmt(value))
  const ultimo = useRef(value)
  useEffect(() => {
    if (value !== ultimo.current) { setTxt(fmt(value)); ultimo.current = value }
  }, [value])
  return (
    <div className={`campo flex items-center gap-1.5 !px-0 ${disabled ? 'opacity-60' : ''}`}>
      {prefixo && <span className="pl-3 text-xs text-muted">{prefixo}</span>}
      <input className={`flex-1 min-w-0 bg-transparent outline-none tabular-nums ${prefixo ? '' : 'pl-3'} ${sufixo ? '' : 'pr-3'}`} inputMode="decimal" value={txt} disabled={disabled} placeholder={placeholder}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d,.]/g, '')
          setTxt(t)
          const v = t === '' ? null : parseDecimal(t)
          if (t === '' || v != null) { ultimo.current = v; onChange(v) }
        }} />
      {sufixo && <span className="pr-3 text-xs text-muted">{sufixo}</span>}
    </div>
  )
}

