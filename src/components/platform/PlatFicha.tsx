import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, LogIn, Ban, Trash2, CheckCircle2, X } from 'lucide-react'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { supabase } from '../../lib/supabaseClient'
import { brl, friendlyDbError } from '../../lib/format'
import { MODULOS } from '../../lib/modules'
import { baixarCopia, erroDaFuncao, type PainelDados } from './platformApi'
import { CompanyBilling, chamarServidor, situacaoMensalidade } from './CompanyBilling'
import { CompanySetup } from './CompanySetup'
import { CompanyContract } from './CompanyContract'
import { dataBr, diasSemUso, progressoImplantacao, SEM_USO_ALERTA, type Empresa } from './platformTypes'
import { Numero } from './PlatVisaoGeral'

// Ficha de uma casa: tudo sobre ela num lugar só, em abas.

type Aba = 'resumo' | 'mensalidade' | 'plano' | 'implantacao' | 'contrato' | 'anotacoes' | 'zona'
const ABAS: [Aba, string][] = [
  ['resumo', 'Resumo'], ['mensalidade', 'Mensalidade'], ['plano', 'Plano e funções'], ['implantacao', 'Implantação'],
  ['contrato', 'Contrato e termos'], ['anotacoes', 'Anotações'], ['zona', 'Suspender ou excluir'],
]

export function PlatFicha({ d, empresaId }: { d: PainelDados; empresaId: string }) {
  const navigate = useNavigate()
  const [aba, setAba] = useState<Aba>(() => {
    const a = new URLSearchParams(window.location.search).get('aba') as Aba | null
    return a && ABAS.some(([k]) => k === a) ? a : 'resumo'
  })
  const [excluida, setExcluida] = useState<string | null>(null)

  function irAba(a: Aba) {
    setAba(a)
    window.history.replaceState(null, '', `${window.location.pathname}${a === 'resumo' ? '' : `?aba=${a}`}`)
  }

  if (excluida) {
    return (
      <Card className="border-teal/40">
        <p className="text-sm flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-teal shrink-0 mt-0.5" /> {excluida}</p>
        <Link to="/plataforma/casas" className="inline-block text-sm text-purple font-medium mt-3">← Voltar para as casas</Link>
      </Card>
    )
  }
  if (d.carregando) return <p className="text-sm text-muted">Carregando...</p>
  const c = d.empresas.find((x) => x.id === empresaId)
  if (!c) return <Card><p className="text-sm text-muted">Casa não encontrada.</p><Link to="/plataforma/casas" className="text-sm text-purple font-medium">← Voltar para as casas</Link></Card>

  const m = d.mensalidades[c.id]
  const plano = d.planos.find((p) => p.id === d.planosDaCasa[c.id]?.plano_id)
  const s = situacaoMensalidade(m)

  return (
    <div className="space-y-5">
      <button onClick={() => navigate('/plataforma/casas')} className="text-sm text-purple font-medium inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Todas as casas</button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{c.name}</h1>
          <p className="text-sm text-muted mt-1">
            {plano ? `Plano ${plano.nome}` : m?.plano ? `Plano ${m.plano}` : 'Sem plano'} · cliente desde {dataBr(c.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!c.active ? <Badge tone="danger">Suspensa</Badge> : <Badge tone={s.tom}>{s.texto}</Badge>}
          <Button disabled={d.abrindo !== null} onClick={() => d.abrirEmpresa(c.id)}><LogIn className="w-4 h-4" /> {d.abrindo === c.id ? 'Abrindo...' : 'Abrir a casa'}</Button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-line overflow-x-auto" role="tablist">
        {ABAS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={aba === k} onClick={() => irAba(k)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${aba === k ? 'border-purple text-purple font-semibold' : 'border-transparent text-muted hover:text-ink'}`}>{l}</button>
        ))}
      </div>

      {aba === 'resumo' && <Resumo d={d} c={c} />}
      {aba === 'mensalidade' && (
        <Card>
          <CompanyBilling key={c.id} empresaId={c.id} ativa={c.active} m={m} planos={d.planos} planoId={d.planosDaCasa[c.id]?.plano_id ?? null}
            onChanged={d.recarregar} onSuspender={() => irAba('zona')} />
        </Card>
      )}
      {aba === 'plano' && <PlanoEFuncoes d={d} c={c} />}
      {aba === 'implantacao' && <Card><CompanySetup empresaId={c.id} itens={d.implantacao[c.id]} onChanged={d.recarregar} /></Card>}
      {aba === 'contrato' && <Card><CompanyContract empresaId={c.id} /></Card>}
      {aba === 'anotacoes' && <Anotacoes d={d} empresaId={c.id} />}
      {aba === 'zona' && <Zona d={d} c={c} onExcluida={setExcluida} />}
    </div>
  )
}

function Resumo({ d, c }: { d: PainelDados; c: Empresa }) {
  const m = d.mensalidades[c.id]
  const pr = progressoImplantacao(d.implantacao[c.id])
  const dias = diasSemUso(c.ultima_atividade)
  const [nome, setNome] = useState(c.name)
  const [msg, setMsg] = useState<string | null>(null)

  async function salvarNome(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.rpc('platform_update_company', { p_company: c.id, p_name: nome, p_active: c.active, p_disabled_modules: c.disabled_modules })
    if (error) return setMsg(friendlyDbError(error.message))
    setMsg('Nome salvo.')
    await d.recarregar()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Numero rotulo="Festas novas (30 dias)" valor={String(c.festas_30d)} nota="mostra se a casa está usando" />
        <Numero rotulo="Festas no total" valor={String(c.festas)} />
        <Numero rotulo="Usuários" valor={m?.usuarios_incluidos ? `${c.usuarios} de ${m.usuarios_incluidos}` : String(c.usuarios)} alerta={!!m?.usuarios_incluidos && c.usuarios >= m.usuarios_incluidos} nota={m?.usuarios_incluidos && c.usuarios >= m.usuarios_incluidos ? 'chegou no limite do plano' : undefined} />
        <Numero rotulo="Unidades" valor={m?.cadastrada ? `${c.unidades} de ${m.unidades_incluidas ?? 1}` : String(c.unidades)} />
        <Numero rotulo="Último uso" valor={dias === null ? 'nunca' : dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`} alerta={c.active && (dias === null || dias >= SEM_USO_ALERTA)} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Dados da casa">
          <form onSubmit={salvarNome} className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-muted mb-1">Nome da casa</label>
              <input required value={nome} onChange={(e) => setNome(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
            </div>
            <Button type="submit" variant="secondary" disabled={nome.trim() === c.name}>Salvar nome</Button>
          </form>
          {msg && <p className="text-xs text-muted mt-2">{msg}</p>}
          <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 text-sm mt-4">
            <dt className="text-muted">Cliente desde</dt><dd>{dataBr(c.created_at)}</dd>
            <dt className="text-muted">Mensalidade</dt><dd>{m?.cadastrada ? `${brl(Number(m.mensalidade))} · vence todo dia ${m.dia_vencimento}` : 'não cadastrada'}</dd>
            <dt className="text-muted">Cobrança</dt><dd>{m?.asaas ? 'automática pelo Asaas' : m?.cadastrada ? 'registrada à mão' : '—'}</dd>
            <dt className="text-muted">Implantação</dt><dd>{pr ? `${pr.feitos} de ${pr.total} itens prontos` : '—'}</dd>
          </dl>
        </Card>
        <Card title="O que olhar nesta casa">
          <ul className="text-sm space-y-1.5 list-disc pl-5 text-ink/80">
            {!m?.cadastrada && <li>Cadastre a mensalidade e o plano (abas Mensalidade e Plano e funções).</li>}
            {m?.situacao === 'atrasada' && <li className="text-danger">Mensalidade atrasada há {m.dias_atraso} dias ({brl(Number(m.valor_em_aberto))}).</li>}
            {pr && pr.feitos < pr.total && <li>Implantação incompleta: faltam {pr.total - pr.feitos} itens.</li>}
            {c.active && (dias === null || dias >= SEM_USO_ALERTA) && <li className="text-amber">Sem uso recente. Vale uma ligação.</li>}
            {!!m?.usuarios_incluidos && c.usuarios >= m.usuarios_incluidos && <li>No limite de usuários: oferecer o plano acima.</li>}
            {m?.cadastrada && m.situacao !== 'atrasada' && pr && pr.feitos === pr.total && dias !== null && dias < SEM_USO_ALERTA && <li className="text-teal">Tudo certo com esta casa.</li>}
          </ul>
        </Card>
      </div>
    </div>
  )
}

function PlanoEFuncoes({ d, c }: { d: PainelDados; c: Empresa }) {
  const m = d.mensalidades[c.id]
  const pdc = d.planosDaCasa[c.id]
  const plano = d.planos.find((p) => p.id === pdc?.plano_id)
  const extras = pdc?.modulos_extras ?? []
  const [manual, setManual] = useState<string[]>(c.disabled_modules)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)

  async function trocar(id: string | null) {
    const novo = d.planos.find((p) => p.id === id)
    const texto = novo
      ? `Trocar ${c.name} para o plano ${novo.nome}?\n\nA mensalidade passa a ser ${brl(novo.preco)}${m?.asaas ? ' (e o Asaas é atualizado)' : ''}, os limites passam a ser os do plano e as funções acompanham.\n\nPelo contrato (3.9), subir de plano vale na hora; descer vale a partir do mês seguinte.`
      : `Deixar ${c.name} sem plano da lista? As funções ficam como estão agora e passam a ser escolhidas à mão.`
    if (!window.confirm(texto)) return
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.rpc('platform_set_company_plan', { p_company: c.id, p_plano: id })
    if (error) {
      setBusy(false)
      return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    }
    let aviso = novo ? `Plano ${novo.nome} aplicado.` : 'Casa sem plano: funções à mão.'
    if (novo && m?.asaas) {
      const r = await chamarServidor({ action: 'asaas_sync', company_id: c.id })
      aviso += r.erro ? ` Atenção: o Asaas não atualizou (${r.erro}). Use "Atualizar no Asaas" na aba Mensalidade.` : ' Mensalidade atualizada no Asaas.'
    }
    setBusy(false)
    setMsg({ ok: true, texto: aviso })
    await d.recarregar()
  }

  async function alternarExtra(id: string) {
    setBusy(true)
    const novos = extras.includes(id) ? extras.filter((x) => x !== id) : [...extras, id]
    const { error } = await supabase.rpc('platform_set_company_extras', { p_company: c.id, p_extras: novos })
    setBusy(false)
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    setMsg(null)
    await d.recarregar()
  }

  async function salvarManual() {
    setBusy(true)
    const { error } = await supabase.rpc('platform_update_company', { p_company: c.id, p_name: c.name, p_active: c.active, p_disabled_modules: manual })
    setBusy(false)
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    setMsg({ ok: true, texto: 'Funções salvas.' })
    await d.recarregar()
  }

  return (
    <div className="space-y-4">
      {msg && <div className={`text-sm rounded-lg px-4 py-2.5 ${msg.ok ? 'bg-teal-light text-teal' : 'bg-danger-light text-danger'}`}>{msg.texto}</div>}

      {!d.sem094 && (
        <Card title="Plano">
          {!m?.cadastrada ? (
            <p className="text-sm text-muted">Cadastre antes a mensalidade da casa (aba <b>Mensalidade</b>). Lá você já pode escolher o plano.</p>
          ) : (
            <>
              <p className="text-xs text-muted mb-3">Escolha o plano: mensalidade, limites e funções passam a ser os dele. Os dados da casa nunca são apagados ao trocar.</p>
              <div className="flex flex-wrap gap-2">
                {d.planos.filter((p) => p.ativo || p.id === plano?.id).map((p) => (
                  <button key={p.id} type="button" disabled={busy || p.id === plano?.id} onClick={() => trocar(p.id)}
                    className={`rounded-lg border px-4 py-2.5 text-left text-sm ${p.id === plano?.id ? 'border-purple bg-purple-light text-purple font-semibold' : 'border-line hover:border-purple/50'}`}>
                    {p.nome}<span className="block text-xs font-normal text-muted">{brl(p.preco)}/mês</span>
                  </button>
                ))}
                <button type="button" disabled={busy || !plano} onClick={() => trocar(null)}
                  className={`rounded-lg border px-4 py-2.5 text-left text-sm ${!plano ? 'border-purple bg-purple-light text-purple font-semibold' : 'border-line hover:border-purple/50'}`}>
                  Sem plano<span className="block text-xs font-normal text-muted">funções à mão</span>
                </button>
              </div>
              {plano && Number(m.mensalidade) !== plano.preco && (
                <p className="text-xs bg-amber-light text-amber rounded-lg px-3 py-2 mt-3">A mensalidade desta casa ({brl(Number(m.mensalidade))}) está diferente do preço do plano ({brl(plano.preco)}). Se foi um desconto combinado, está tudo certo.</p>
              )}
            </>
          )}
        </Card>
      )}

      {plano ? (
        <Card title="Funções desta casa">
          <p className="text-xs text-muted mb-3">As funções do plano ligam sozinhas. Para dar uma função a mais só para esta casa (cortesia ou adicional pago), use "liberar à parte".</p>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {MODULOS.map((mod) => {
                const noPlano = plano.modulos.includes(mod.id)
                const extra = extras.includes(mod.id)
                return (
                  <tr key={mod.id}>
                    <td className="py-2 pr-3">{mod.label}<span className="block text-[11px] text-muted">{mod.descricao}</span></td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {noPlano ? <Badge tone="teal">Incluída no plano</Badge> : extra ? (
                        <span className="inline-flex items-center gap-2"><Badge tone="purple">Liberada à parte</Badge><button disabled={busy} onClick={() => alternarExtra(mod.id)} className="text-xs text-muted hover:text-danger">tirar</button></span>
                      ) : (
                        <span className="inline-flex items-center gap-2 text-xs text-muted">Não incluída · <button disabled={busy} onClick={() => alternarExtra(mod.id)} className="font-medium text-purple">liberar à parte</button></span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      ) : (
        <Card title="Funções ligadas (à mão)">
          <p className="text-xs text-muted mb-3">Esta casa não está num plano da lista: marque as funções que ela pode usar. Desligada, a função some do menu e das telas, até para o administrador da casa.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {MODULOS.map((mod) => (
              <label key={mod.id} className="flex items-start gap-2 text-sm bg-paper rounded-lg px-3 py-2 cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={!manual.includes(mod.id)}
                  onChange={(e) => setManual(e.target.checked ? manual.filter((x) => x !== mod.id) : [...manual, mod.id])} />
                <span>{mod.label}<span className="block text-[11px] text-muted">{mod.descricao}</span></span>
              </label>
            ))}
          </div>
          <Button className="mt-3" onClick={salvarManual} disabled={busy}>Salvar funções</Button>
        </Card>
      )}
    </div>
  )
}

interface Nota { id: string; tipo: string; texto: string; autor: string | null; criado_em: string }
const TIPOS_NOTA: [string, string][] = [['anotacao', 'Anotação'], ['ligacao', 'Ligação'], ['whatsapp', 'WhatsApp'], ['email', 'E-mail'], ['reuniao', 'Reunião']]

function Anotacoes({ d, empresaId }: { d: PainelDados; empresaId: string }) {
  const [notas, setNotas] = useState<Nota[] | null>(null)
  const [tipo, setTipo] = useState('anotacao')
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  async function carregar() {
    const { data, error } = await supabase.rpc('platform_notes_list', { p_company: empresaId })
    if (error) return setErro(d.sem094 ? 'As anotações ficam disponíveis depois da migração 094.' : friendlyDbError(error.message))
    setNotas((data ?? []) as Nota[])
  }
  useEffect(() => { carregar() }, [empresaId])

  async function salvar(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.rpc('platform_note_add', { p_company: empresaId, p_tipo: tipo, p_texto: texto })
    if (error) return setErro(friendlyDbError(error.message))
    setTexto('')
    setErro(null)
    await carregar()
  }

  async function apagar(n: Nota) {
    if (!window.confirm('Apagar esta anotação?')) return
    await supabase.rpc('platform_note_delete', { p_id: n.id })
    await carregar()
  }

  return (
    <Card title="Anotações">
      <p className="text-xs text-muted mb-3">Histórico do relacionamento com esta casa: ligações, combinados, pedidos. Só o administrador geral vê.</p>
      {erro && <p className="text-sm text-danger mb-3">{erro}</p>}
      <form onSubmit={salvar} className="space-y-2 mb-4">
        <div className="flex flex-wrap gap-2">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="border border-line rounded-lg px-3 py-2 text-sm" aria-label="Tipo">
            {TIPOS_NOTA.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} maxLength={4000} placeholder="Ex.: Liguei, combinamos o treinamento para quinta às 14h."
          className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
        <Button type="submit" disabled={!texto.trim()}>Salvar anotação</Button>
      </form>
      {notas === null ? <p className="text-sm text-muted">Carregando...</p> : notas.length === 0 ? <p className="text-sm text-muted">Nenhuma anotação ainda.</p> : (
        <div className="space-y-2">
          {notas.map((n) => (
            <div key={n.id} className="border-l-4 border-purple bg-paper rounded-r-lg px-3 py-2 text-sm flex justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] text-muted">{new Date(n.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {TIPOS_NOTA.find(([k]) => k === n.tipo)?.[1] ?? n.tipo}{n.autor ? ` · ${n.autor}` : ''}</p>
                <p className="whitespace-pre-wrap break-words">{n.texto}</p>
              </div>
              <button onClick={() => apagar(n)} className="text-muted hover:text-danger shrink-0" aria-label="Apagar anotação"><X className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function Zona({ d, c, onExcluida }: { d: PainelDados; c: Empresa; onExcluida: (msg: string) => void }) {
  const [confirmaNome, setConfirmaNome] = useState('')
  const [excluindo, setExcluindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function alternarSuspensao() {
    const texto = c.active
      ? `Suspender o acesso de "${c.name}"? Ninguém da casa consegue entrar até você liberar de novo. Os dados ficam guardados.`
      : `Liberar de novo o acesso de "${c.name}"?`
    if (!window.confirm(texto)) return
    const { error } = await supabase.rpc('platform_update_company', { p_company: c.id, p_name: c.name, p_active: !c.active, p_disabled_modules: c.disabled_modules })
    if (error) return setErro(friendlyDbError(error.message))
    await d.recarregar()
  }

  async function excluir() {
    setExcluindo(true)
    const { data, error } = await supabase.functions.invoke('platform-admin', { body: { action: 'delete_company', company_id: c.id, confirm_name: confirmaNome } })
    const msg = await erroDaFuncao(data, error, 'Não foi possível excluir. Confira se a função "platform-admin" está atualizada no Supabase.')
    if (msg) {
      setExcluindo(false)
      return setErro(msg)
    }
    const r = data as { copia_id: string; arquivos_apagados: number; arquivos_falha: number; logins_apagados: number; logins_falha: number }
    const erroCopia = await baixarCopia(r.copia_id, c.name)
    const falhas = r.arquivos_falha + r.logins_falha
    onExcluida(`${c.name} foi excluída: ${r.arquivos_apagados} ${r.arquivos_apagados === 1 ? 'arquivo apagado' : 'arquivos apagados'} e ${r.logins_apagados} ${r.logins_apagados === 1 ? 'login apagado' : 'logins apagados'}.`
      + (erroCopia ? ` ${erroCopia}` : ' A cópia dos dados foi baixada para o seu computador.')
      + (falhas > 0 ? ` Atenção: ${falhas} ${falhas === 1 ? 'item não pôde' : 'itens não puderam'} ser apagado(s); os dados da casa já saíram, então ninguém acessa.` : ''))
    await d.recarregar()
  }

  return (
    <div className="space-y-4">
      {erro && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{erro}</div>}
      <Card title={c.active ? 'Suspender acesso' : 'Acesso suspenso'}>
        <p className="text-sm text-muted mb-3">{c.active ? 'Ninguém da casa consegue entrar (ex.: pagamento atrasado) até você liberar de novo. Os dados ficam guardados.' : 'Ninguém da casa consegue entrar. Os dados continuam guardados.'}</p>
        <Button variant="secondary" onClick={alternarSuspensao}><Ban className="w-4 h-4" /> {c.active ? 'Suspender acesso' : 'Liberar acesso de novo'}</Button>
      </Card>
      <Card>
        <p className="text-sm font-semibold text-danger flex items-center gap-1.5"><Trash2 className="w-4 h-4" /> Excluir casa</p>
        {c.active ? (
          <p className="text-xs text-muted mt-1">Só dá para excluir uma casa suspensa. Suspenda o acesso acima e depois volte aqui.</p>
        ) : (
          <div className="mt-2 space-y-2 max-w-lg">
            <p className="text-xs bg-danger-light text-danger rounded-lg px-3 py-2">
              Apaga <b>de vez</b> todos os dados desta casa (festas, clientes, pagamentos, estoque, histórico), os arquivos (logo, contratos, comprovantes) e os logins dos funcionários dela. Não dá para desfazer. Logo depois, o sistema baixa para o seu computador uma cópia dos dados (os arquivos em si não vão na cópia).
            </p>
            <label className="block text-xs text-muted">Para confirmar, digite o nome da casa: <b className="text-ink">{c.name}</b></label>
            <input value={confirmaNome} onChange={(e) => setConfirmaNome(e.target.value)} autoComplete="off" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
            <button type="button" onClick={excluir} disabled={excluindo || confirmaNome.trim().toLowerCase() !== c.name.trim().toLowerCase()}
              className="w-full rounded-lg bg-danger text-white text-sm font-medium py-2.5 disabled:opacity-40">
              {excluindo ? 'Excluindo...' : 'Excluir casa de vez'}
            </button>
          </div>
        )}
      </Card>
    </div>
  )
}
