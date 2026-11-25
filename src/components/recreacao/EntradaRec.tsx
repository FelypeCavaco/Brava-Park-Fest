import { useEffect, useMemo, useState } from 'react'
import { WifiOff, Camera, Search, Plus, UserRound, Pencil, AlertTriangle, Check, X, MessageCircle, Printer, LogIn, ArrowLeft } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/AuthContext'
import { Button } from '../ui/Button'
import { FamiliaEditor, reduzir } from './FamiliaEditor'
import { FotoBotao } from './FotoCamera'
import { PagamentoDividido, partesIniciais, partesBatem, partesNum, type Parte } from './PagamentoDividido'
import { imprimirEntrada, papelDe } from '../../lib/recImpressao'
import { useCompany } from '../../lib/CompanyContext'
import { cacheBuscar, cacheFamilias, cachePlanos, cachePlanosLer, codigoLocal, ehErroDeRede, filaAdd, filaLer } from '../../lib/recOffline'
import { QrImg, qrParaImpressao } from './QrRec'
import { brl, friendlyDbError } from '../../lib/format'
import {
  FORMAS_REC, fmtMin, horaMin, idadeAnos, idadeTexto, linkPais, linkWhatsApp, mascaraCpf, mascaraTelefone, nomeForma,
  type FamiliaRec, type FuncoesRec, type PlanoRec,
} from '../../lib/recreacao'

// Entrada das crianças: acha a família, marca quem entra, plano e pagamento
// de cada uma. O código de retirada e a mensagem saem no fim.

interface Props {
  unidades: { id: string; nome: string }[]
  unidadeInicial: string | null
  funcoes: FuncoesRec
  regras: Record<string, string | number>
  termo: string
  dentro: string[] // crianças que já estão dentro
  nomeCasa: string
  onFechar: () => void
  onConcluida: () => void
}
interface Escolha { plano: string; pulseira: string; forma: string; excecao: string; usarExcecao: boolean; dividir?: boolean; partes?: Parte[] }
interface Resultado { codigo: string; grupo: string; token: string; entrada_em: string; responsavel: string; telefone: string; visitas: { id: string; nome: string; pulseira: string | null; plano: string; pago: number; cuidados: string | null; nascimento: string; ate: string | null }[] }

export function EntradaRec({ unidades, unidadeInicial, funcoes, regras, termo, dentro, nomeCasa, onFechar, onConcluida }: Props) {
  const { can } = useAuth()
  const gerente = can('action:recreacao.gerente')
  const { brand } = useCompany()
  const [fotosEnt, setFotosEnt] = useState<Record<string, { blob: Blob; url: string }>>({}) // criança -> foto desta entrada
  // com mais de uma unidade e o sistema em 'todas', a recepção escolhe (não vem nenhuma marcada)
  const [unidade, setUnidade] = useState(unidadeInicial ?? (unidades.length === 1 ? unidades[0].id : ''))
  const [busca, setBusca] = useState('')
  const [achadas, setAchadas] = useState<FamiliaRec[]>([])
  const [familia, setFamilia] = useState<FamiliaRec | null>(null)
  const [editando, setEditando] = useState<{ id: string | null } | null>(null)
  const [planos, setPlanos] = useState<PlanoRec[]>([])
  const [marcadas, setMarcadas] = useState<Record<string, Escolha>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [res, setRes] = useState<(Resultado & { offline?: boolean; codigoMudou?: boolean }) | null>(null)
  const emp = brand.companyId ?? ''
  const usaOffline = funcoes.offline === true && !!emp
  const [semNet, setSemNet] = useState(!navigator.onLine)
  useEffect(() => {
    const on = () => setSemNet(false), off = () => setSemNet(true)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  const naFila = usaOffline ? filaLer(emp).flatMap((i) => i.criancas.map((c) => c.crianca)) : []

  useEffect(() => {
    supabase.from('rec_planos').select('id, nome, descricao, ativo, ordem, regra, versao, atualizado_em, atualizado_por').eq('ativo', true).order('ordem')
      .then(({ data, error }) => {
        if (error || !data) { if (usaOffline) { const c = cachePlanosLer(emp); if (c.length) setPlanos(c) } return }
        setPlanos(data as PlanoRec[]); if (usaOffline) cachePlanos(emp, data as PlanoRec[])
      })
  }, [])
  // planos chegaram depois de marcar: põe o primeiro como padrão
  useEffect(() => {
    if (!planos.length) return
    setMarcadas((m) => Object.fromEntries(Object.entries(m).map(([k, e]) => [k, e.plano ? e : { ...e, plano: planos[0].id }])))
  }, [planos])
  useEffect(() => {
    if (familia || editando) return
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('rec_familias_buscar', { p_texto: busca, p_limite: 8 })
      if (error) {
        if (usaOffline && ehErroDeRede(error.message)) { setSemNet(true); setAchadas(cacheBuscar(emp, busca)); return }
        return setErro(friendlyDbError(error.message))
      }
      if (usaOffline) cacheFamilias(emp, (data ?? []) as FamiliaRec[])
      setAchadas((data ?? []) as FamiliaRec[])
      // CPF completo e uma família só: abre direto
      if (busca.replace(/\D/g, '').length === 11 && (data ?? []).length === 1) abrir((data as FamiliaRec[])[0])
    }, busca ? 280 : 0)
    return () => clearTimeout(t)
  }, [busca, familia, editando]) // eslint-disable-line react-hooks/exhaustive-deps

  function abrir(f: FamiliaRec) {
    setFamilia(f); setErro(null)
    if (usaOffline) cacheFamilias(emp, [f])
    const podem = f.criancas.filter((c) => c.ativo && !dentro.includes(c.id!) && !naFila.includes(c.id!))
    const padrao = planos[0]?.id ?? ''
    // uma criança só: já vem marcada; mais de uma: a recepção marca quem entra
    setMarcadas(podem.length === 1 ? { [podem[0].id!]: { plano: padrao, pulseira: '', forma: '', excecao: '', usarExcecao: false } } : {})
  }
  async function recarregar(id: string) {
    const { data } = await supabase.rpc('rec_familia_get', { p_id: id })
    setEditando(null)
    if (data) abrir(data as FamiliaRec)
  }

  const idMin = Number(regras.idMin ?? 0), idMax = Number(regras.idMax ?? 17)
  const planoDe = (id: string) => planos.find((p) => p.id === id)
  const linhas = Object.entries(marcadas)
  const cobrarAgora = linhas.reduce((s, [, e]) => { const p = planoDe(e.plano); return s + (p && p.regra.cobranca === 'entrada' && !e.usarExcecao ? Number(p.regra.valor) : 0) }, 0)
  const pendencias = useMemo(() => {
    const out: string[] = []
    if (!unidade) out.push('Escolha a unidade.')
    if (!linhas.length) out.push('Marque quem vai entrar.')
    for (const [cid, e] of linhas) {
      const c = familia?.criancas.find((x) => x.id === cid)
      const p = planoDe(e.plano)
      if (!p) out.push(`Escolha o plano de ${c?.nome.split(' ')[0]}.`)
      else if (p.regra.cobranca === 'entrada' && Number(p.regra.valor) > 0 && !e.usarExcecao && e.dividir && !partesBatem(e.partes ?? [], Number(p.regra.valor))) out.push(`Confira a divisão do pagamento de ${c?.nome.split(' ')[0]}: a soma precisa fechar ${brl(Number(p.regra.valor))}.`)
      else if (p.regra.cobranca === 'entrada' && Number(p.regra.valor) > 0 && !e.usarExcecao && !e.dividir && !e.forma) out.push(`Escolha como ${c?.nome.split(' ')[0]} paga.`)
      if (e.usarExcecao && e.excecao.trim().length < 3) out.push('Escreva o motivo da exceção.')
      if (funcoes.fotoObrig && funcoes.foto === 'cadastro' && !c?.foto_path) out.push(`Tire a foto de ${c?.nome.split(' ')[0]} (no cadastro).`)
      if (funcoes.fotoObrig && funcoes.foto === 'entrada' && !fotosEnt[cid]) out.push(semNet ? 'Sem internet: a foto obrigatória precisa de sinal.' : `Tire a foto de ${c?.nome.split(' ')[0]}.`)
    }
    return out
  }, [linhas, unidade, familia, planos, funcoes, fotosEnt, semNet]) // eslint-disable-line react-hooks/exhaustive-deps

  // sem sinal: guarda no aparelho com a hora real e o código; o envio é automático quando a internet volta
  function guardarSemInternet() {
    const cods = filaLer(emp).map((i) => i.codigo)
    const codigo = codigoLocal(cods), token = crypto.randomUUID(), agora = new Date()
    const item = {
      local: crypto.randomUUID(), unit: unidade, familia: familia!.id!, entrada_em: agora.toISOString(), codigo, token, responsavel: familia!.responsavel, criado: Date.now(),
      nomes: linhas.map(([cid]) => familia!.criancas.find((x) => x.id === cid)?.nome ?? ''),
      criancas: linhas.map(([cid, e]) => ({ crianca: cid, plano: e.plano, pulseira: e.pulseira, forma: e.usarExcecao || e.dividir ? null : e.forma || null, ...(e.dividir && !e.usarExcecao ? { pagamentos: partesNum(e.partes ?? []) } : {}), excecao: e.usarExcecao ? e.excecao : null })),
    }
    filaAdd(emp, item)
    setRes({
      codigo, grupo: item.local, token, entrada_em: item.entrada_em, responsavel: familia!.responsavel, telefone: familia!.telefone ?? '', offline: true,
      visitas: linhas.map(([cid, e]) => {
        const c = familia!.criancas.find((x) => x.id === cid)!, p = planoDe(e.plano)
        const pago = p && p.regra.cobranca === 'entrada' && !e.usarExcecao ? Number(p.regra.valor) : 0
        return { id: cid, nome: c.nome, pulseira: e.pulseira || null, plano: p?.nome ?? '', pago, cuidados: c.cuidados, nascimento: c.nascimento,
          ate: p && p.regra.cobranca === 'entrada' && p.regra.incl ? new Date(agora.getTime() + Number(p.regra.incl) * 60000).toISOString() : null }
      }),
    })
    setFotosEnt({})
    onConcluida()
  }

  async function confirmar() {
    if (!familia || pendencias.length) return
    if (usaOffline && semNet) return guardarSemInternet()
    setSalvando(true); setErro(null)
    // foto tirada nesta entrada: sobe antes, e o caminho vai junto com a entrada
    const caminhos: Record<string, string> = {}
    if (funcoes.foto === 'entrada' && brand.companyId) {
      for (const [cid] of linhas) {
        const f = fotosEnt[cid]
        if (!f) continue
        const path = `${brand.companyId}/entrada/${crypto.randomUUID()}.jpg`
        const up = await supabase.storage.from('recreacao-fotos').upload(path, f.blob, { contentType: 'image/jpeg' })
        if (up.error) {
          if (funcoes.fotoObrig) { setSalvando(false); return setErro('A foto não subiu. Confira a internet e tente de novo.') }
          continue
        }
        caminhos[cid] = path
      }
    }
    const { data, error } = await supabase.rpc('rec_entrada', {
      p_unit: unidade, p_familia: familia.id,
      p_criancas: linhas.map(([cid, e]) => ({ crianca: cid, plano: e.plano, pulseira: e.pulseira, forma: e.usarExcecao || e.dividir ? null : e.forma || null, ...(e.dividir && !e.usarExcecao ? { pagamentos: partesNum(e.partes ?? []) } : {}), excecao: e.usarExcecao ? e.excecao : null, foto: caminhos[cid] ?? null })),
    })
    setSalvando(false)
    if (error && usaOffline && ehErroDeRede(error.message)) {
      setSemNet(true)
      if (funcoes.fotoObrig && funcoes.foto === 'entrada') return setErro('A internet caiu e a foto obrigatória precisa de sinal. Tente de novo quando voltar.')
      return guardarSemInternet()
    }
    if (error) {
      const feitos = Object.values(caminhos)
      if (feitos.length) supabase.storage.from('recreacao-fotos').remove(feitos)
      return setErro(friendlyDbError(error.message))
    }
    setFotosEnt({})
    setRes(data as Resultado)
    onConcluida()
  }

  // ---------- depois de confirmar ----------
  if (res) {
    const nomes = res.visitas.map((v) => v.nome.split(' ')[0])
    const ate = res.visitas.find((v) => v.ate)?.ate
    const link = linkPais(res.token)
    const msg = `Oi, ${res.responsavel.split(' ')[0]}! ${nomes.join(' e ')} ${nomes.length > 1 ? 'entraram' : 'entrou'} na recreação às ${horaMin(res.entrada_em)}`
      + `${res.visitas.some((v) => v.pulseira) ? ` (pulseira${res.visitas.length > 1 ? 's' : ''} ${res.visitas.map((v) => v.pulseira ?? '—').join(' e ')})` : ''}.`
      + `${ate ? ` Tempo combinado até ${horaMin(ate)}.` : ''}`
      + `${funcoes.codigo ? `\n\nCódigo de retirada: ${res.codigo}\nSó entregamos a criança com esse código.` : ''}`
      + `${funcoes.paginaPais !== false ? `\n\nAcompanhe o tempo, o valor e o QR da retirada por aqui:\n${link}` : ''}`
    async function imprimir() {
      const papel = papelDe(regras.impressora)
      if (!papel) return
      const qr = funcoes.qr !== false && funcoes.paginaPais !== false ? await qrParaImpressao(link).catch(() => '') : ''
      imprimirEntrada({
        casa: nomeCasa, papel, imprimeTermo: regras.imprimeTermo === 'sim', termo,
        responsavel: res!.responsavel, cpf: familia?.cpf ? mascaraCpf(familia.cpf) : null, telefone: res!.telefone ? mascaraTelefone(res!.telefone) : null,
        entradaEm: res!.entrada_em, codigo: funcoes.codigo ? res!.codigo : null, link, qr,
        criancas: res!.visitas.map((v) => ({ nome: v.nome, nascimento: v.nascimento, cuidados: v.cuidados, pulseira: v.pulseira, plano: v.plano, ate: v.ate })),
      })
    }
    return (
      <div className="space-y-5">
        <div className="rounded-2xl bg-teal-light p-5 flex flex-wrap items-center gap-5">
          <span className="w-12 h-12 rounded-full bg-teal text-white flex items-center justify-center"><Check className="w-6 h-6" /></span>
          <div className="flex-1 min-w-[12rem]">
            <p className="font-semibold text-teal">Entrada registrada às {horaMin(res.entrada_em)}</p>
            <p className="text-sm">{res.offline ? `${nomes.join(' e ')} ${nomes.length > 1 ? 'aparecem' : 'aparece'} no painel quando o sinal voltar.` : `${nomes.join(' e ')} já ${nomes.length > 1 ? 'aparecem' : 'aparece'} no painel. O preço de cada um ficou guardado como estava agora.`}</p>
          </div>
          {funcoes.codigo && (
            <div className="text-center">
              <p className="text-xs text-muted">Código de retirada</p>
              <p className="font-display text-4xl font-black tracking-[0.3em] text-ink">{res.codigo}</p>
            </div>
          )}
          {funcoes.qr !== false && (
            <div className="text-center">
              <QrImg texto={link} tamanho={96} className="rounded-lg bg-white p-1" />
              <p className="text-[11px] text-muted mt-0.5">QR da retirada</p>
            </div>
          )}
        </div>
        {res.offline && (
          <div className="rounded-xl bg-amber-light text-amber px-4 py-3 text-sm font-semibold flex gap-2">
            <WifiOff className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Sem internet: a entrada ficou guardada neste aparelho, com a hora certa, e será enviada sozinha quando o sinal voltar. Não limpe os dados do navegador até lá. O link do WhatsApp só abre depois do envio.</span>
          </div>
        )}
        <ul className="divide-y divide-line rounded-xl border border-line">
          {res.visitas.map((v) => (
            <li key={v.id} className="px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm items-center">
              <b className="flex-1 min-w-[10rem]">{v.nome}</b>
              {v.pulseira && <span className="text-muted">pulseira {v.pulseira}</span>}
              <span>{v.plano}{v.ate ? ` · até ${horaMin(v.ate)}` : ''}</span>
              <span className="font-semibold">{v.pago > 0 ? `pago ${brl(v.pago)}` : 'paga na saída'}</span>
            </li>
          ))}
        </ul>
        <div className="rounded-xl bg-[#e7f6ec] text-[#1b3a28] p-4 text-sm whitespace-pre-line max-w-lg">{msg}</div>
        <div className="flex flex-wrap gap-2">
          <a href={linkWhatsApp(res.telefone, msg)} target="_blank" rel="noreferrer"><Button><MessageCircle className="w-4 h-4" />Mandar no WhatsApp</Button></a>
          {String(regras.impressora ?? 'nao') !== 'nao' && <Button variant="secondary" onClick={imprimir}><Printer className="w-4 h-4" />{regras.imprimeTermo === 'sim' ? 'Imprimir termo e via de entrada' : 'Imprimir via de entrada'}</Button>}
          <Button variant="secondary" onClick={() => { setRes(null); setFamilia(null); setBusca(''); setMarcadas({}) }}><Plus className="w-4 h-4" />Outra entrada</Button>
          <Button variant="ghost" onClick={onFechar}>Fechar</Button>
        </div>
      </div>
    )
  }

  // ---------- cadastro / edição no meio da entrada ----------
  if (editando) {
    return (
      <div>
        <button type="button" onClick={() => setEditando(null)} className="text-sm text-muted hover:text-purple inline-flex items-center gap-1 mb-4"><ArrowLeft className="w-4 h-4" />Voltar para a entrada</button>
        <FamiliaEditor familiaId={editando.id} funcoes={funcoes} regras={regras} termo={termo}
          onFechar={() => setEditando(null)} onAbrirOutra={(id) => recarregar(id)} onSalvo={(id) => recarregar(id)} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {unidades.length > 1 && (
        <label className="block max-w-xs text-xs font-medium text-muted">Unidade
          <select className="campo mt-1" value={unidade} onChange={(e) => setUnidade(e.target.value)}>
            {!unidade && <option value="">Escolha a unidade</option>}
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </label>
      )}

      {!familia ? (
        <>
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[16rem]">
              <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input className="campo !pl-10 !py-3 !text-base" autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="CPF do responsável, telefone ou nome" aria-label="Procurar família" />
            </div>
            {can('action:recreacao.familias_editar') && <Button variant="secondary" onClick={() => setEditando({ id: null })} className="!py-3"><Plus className="w-4 h-4" />Família nova</Button>}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {achadas.map((f) => (
              <button key={f.id} type="button" onClick={() => abrir(f)} className="text-left rounded-xl border border-line bg-surface px-4 py-3 hover:border-purple/40 hover:shadow-sm">
                <p className="font-semibold">{f.responsavel}</p>
                <p className="text-xs text-muted">{f.cpf ? `CPF ${mascaraCpf(f.cpf)} · ` : ''}{mascaraTelefone(f.telefone)}</p>
                <p className="text-xs mt-1">{f.criancas.filter((c) => c.ativo).map((c) => c.nome.split(' ')[0]).join(', ')}</p>
              </button>
            ))}
            {busca.trim() && achadas.length === 0 && <p className="text-sm text-muted">Ninguém encontrado. Confira os números ou cadastre a família.</p>}
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-3 rounded-xl bg-paper px-4 py-3">
            <span className="w-10 h-10 rounded-full bg-purple-light text-purple flex items-center justify-center"><UserRound className="w-5 h-5" /></span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{familia.responsavel}</p>
              <p className="text-xs text-muted">{familia.cpf ? `CPF ${mascaraCpf(familia.cpf)} · ` : ''}{mascaraTelefone(familia.telefone)}</p>
              {familia.autorizados.some((a) => a.ativo) && <p className="text-xs text-muted">Também podem buscar: {familia.autorizados.filter((a) => a.ativo).map((a) => `${a.nome}${a.parentesco ? ` (${a.parentesco})` : ''}`).join(', ')}</p>}
              {!familia.termo_aceito_em && <p className="text-xs text-danger font-semibold mt-1">Falta o aceite do termo: abra "Editar dados" e marque.</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {can('action:recreacao.familias_editar') && <Button variant="secondary" className="!px-3 !py-1.5" onClick={() => setEditando({ id: familia.id! })}><Pencil className="w-3.5 h-3.5" />Editar dados</Button>}
              {can('action:recreacao.familias_editar') && <Button variant="secondary" className="!px-3 !py-1.5" onClick={() => setEditando({ id: familia.id! })}><Plus className="w-3.5 h-3.5" />Adicionar criança</Button>}
              <Button variant="ghost" className="!px-3 !py-1.5" onClick={() => { setFamilia(null); setMarcadas({}) }}>Trocar família</Button>
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold mb-2">Quem vai entrar?</p>
            <div className="space-y-2">
              {familia.criancas.filter((c) => c.ativo).map((c) => {
                const ja = dentro.includes(c.id!)
                const anos = idadeAnos(c.nascimento)
                const fora = anos < idMin || anos > idMax
                const e = marcadas[c.id!]
                const p = e ? planoDe(e.plano) : null
                const set = (patch: Partial<Escolha>) => setMarcadas((m) => ({ ...m, [c.id!]: { ...m[c.id!], ...patch } }))
                return (
                  <div key={c.id} className={`rounded-xl border-2 p-3 transition-colors ${e ? 'border-purple bg-purple-light/30' : 'border-line bg-surface'} ${ja ? 'opacity-60' : ''}`}>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" className="mt-1 w-5 h-5 accent-[rgb(var(--c-purple))]" disabled={ja} checked={!!e}
                        onChange={(ev) => setMarcadas((m) => { const n = { ...m }; if (ev.target.checked) n[c.id!] = { plano: planos[0]?.id ?? '', pulseira: '', forma: '', excecao: '', usarExcecao: false }; else delete n[c.id!]; return n })} />
                      <span className="flex-1">
                        <b>{c.nome}</b> <span className="text-sm text-muted">· {idadeTexto(c.nascimento)}</span>
                        {ja && <span className="ml-2 text-xs font-semibold text-muted">já está dentro</span>}
                        {fora && !ja && <span className="ml-2 text-xs font-semibold text-amber">fora da idade da casa ({idMin} a {idMax})</span>}
                        {c.cuidados && <span className="block mt-1 text-xs font-bold text-danger"><AlertTriangle className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />{c.cuidados}</span>}
                      </span>
                    </label>
                    {e && (
                      <div className="mt-3 ml-8 grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_120px] animate-card-in">
                        <label className="text-xs font-medium text-muted">Plano
                          <select className="campo mt-1" value={e.plano} onChange={(ev) => set({ plano: ev.target.value })}>
                            {planos.map((pl) => <option key={pl.id} value={pl.id}>{pl.nome} · {pl.regra.cobranca === 'entrada' ? `${brl(Number(pl.regra.valor))} na entrada${pl.regra.incl ? ` (${fmtMin(pl.regra.incl)})` : ''}` : 'paga na saída'}</option>)}
                          </select>
                        </label>
                        <label className="text-xs font-medium text-muted">Pulseira nº<input className="campo mt-1" value={e.pulseira} onChange={(ev) => set({ pulseira: ev.target.value })} /></label>
                        {funcoes.foto === 'entrada' && (
                          <FotoBotao titulo={`Foto de ${c.nome.split(" ")[0]}`} className="sm:col-span-2 flex items-center gap-3 text-left text-xs font-medium text-muted" onFoto={async (arq) => {
                            try { const blob = arq instanceof File ? await reduzir(arq) : arq; setFotosEnt((m) => ({ ...m, [c.id!]: { blob, url: URL.createObjectURL(blob) } })) } catch { setErro("Não consegui ler a foto. Tente de novo.") }
                          }}>
                            <span className={`relative w-16 h-16 rounded-xl overflow-hidden flex items-center justify-center border-2 border-dashed shrink-0 ${fotosEnt[c.id!] ? "border-transparent" : "border-line bg-surface"}`}>
                              {fotosEnt[c.id!] ? <img src={fotosEnt[c.id!].url} alt={`Foto de ${c.nome}`} className="w-full h-full object-cover" /> : <Camera className="w-5 h-5" />}
                            </span>
                            <span>{fotosEnt[c.id!] ? "Tirar outra foto de hoje" : `Tirar a foto de hoje${funcoes.fotoObrig ? " (obrigatória)" : ""}`}</span>
                          </FotoBotao>
                        )}
                        {p && p.regra.cobranca === 'entrada' && Number(p.regra.valor) > 0 && (
                          <div className="sm:col-span-2 space-y-2">
                            {!e.usarExcecao && !e.dividir && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs text-muted mr-1">Paga agora {brl(Number(p.regra.valor))} no:</span>
                                {FORMAS_REC.map(([v, l]) => (
                                  <button key={v} type="button" onClick={() => set({ forma: v })} className={`px-3 h-8 rounded-full text-xs font-semibold border ${e.forma === v ? 'bg-purple text-white border-purple' : 'border-line bg-surface'}`}>{l}</button>
                                ))}
                                <button type="button" onClick={() => set({ dividir: true, partes: partesIniciais() })} className="px-3 h-8 rounded-full text-xs font-semibold border border-dashed border-purple/50 text-purple">Dividir em 2 formas</button>
                              </div>
                            )}
                            {!e.usarExcecao && e.dividir && (
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-2 text-xs text-muted">Pagamento dividido de {brl(Number(p.regra.valor))}<button type="button" onClick={() => set({ dividir: false })} className="font-semibold text-purple underline">Pagar numa forma só</button></div>
                                <PagamentoDividido total={Number(p.regra.valor)} partes={e.partes ?? partesIniciais()} onChange={(partes) => set({ partes })} />
                              </div>
                            )}
                            {gerente && (
                              <label className="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" checked={e.usarExcecao} onChange={(ev) => set({ usarExcecao: ev.target.checked })} />Exceção: cobrar tudo na saída</label>
                            )}
                            {e.usarExcecao && <input className="campo" value={e.excecao} onChange={(ev) => set({ excecao: ev.target.value })} placeholder="Motivo (ex.: maquininha sem sinal)" />}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-line">
            <div className="flex-1 min-w-[12rem] text-sm">
              {cobrarAgora > 0 ? <p>Cobrar agora: <b className="font-display text-lg">{brl(cobrarAgora)}</b> {linhas.length > 1 && <span className="text-muted">({linhas.filter(([, e]) => e.forma).map(([, e]) => nomeForma(e.forma)).join(' + ')})</span>}</p>
                : linhas.length ? <p className="text-muted">Nada a pagar agora: a conta é feita na saída.</p> : null}
              {pendencias.length > 0 && linhas.length > 0 && <p className="text-xs text-amber mt-1">{pendencias[0]}</p>}
            </div>
            <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
            <Button onClick={confirmar} disabled={salvando || pendencias.length > 0 || !familia.termo_aceito_em}><LogIn className="w-4 h-4" />{salvando ? 'Registrando...' : `Dar entrada${linhas.length > 1 ? ` (${linhas.length})` : ''}`}</Button>
          </div>
        </>
      )}
      {erro && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 flex justify-between gap-2">{erro}<button onClick={() => setErro(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button></div>}
    </div>
  )
}
