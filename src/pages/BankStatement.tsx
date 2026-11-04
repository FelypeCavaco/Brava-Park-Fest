import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Check, CreditCard, FileUp, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import { format, parseISO, subDays } from 'date-fns'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { useUnit } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import { brl, friendlyDbError } from '../lib/format'
import { ACEITOS, PdfComSenha, lerExtrato, type ExtratoArquivo } from '../lib/extratoArquivo'
import { ExtratoConferencia, CategoriaCampo, categoriaFinal, useCategoriasDespesa } from '../components/ExtratoConferencia'

// Extrato do banco: a pessoa envia o arquivo OFX e o sistema lança sozinho
// o que reconhece (migração 081). Aqui ficam o que precisa de decisão
// (a classificar e possíveis duplicados), o que já foi feito (com desfazer)
// e as regras que o sistema aprendeu.

type Status = 'a_classificar' | 'possivel_duplicado' | 'cartao' | 'lancado' | 'conciliado' | 'ignorado'

interface Linha {
  id: string
  unit_id: string
  posted_date: string
  amount: number
  description: string
  status: Status
  how: string | null
  auto: boolean
  dup_payment_id: string | null
  dup_expense_id: string | null
  dup_income_id: string | null
  dup_line_id: string | null
  suggestions: { reservation_id?: string; expense_id?: string; payment_id?: string; bate?: boolean; label: string }[]
  decided_by_name: string | null
}

interface Regra {
  id: string
  unit_id: string | null
  direction: 'entrada' | 'saida'
  match_text: string
  action: 'despesa' | 'receita' | 'ignorar'
  category: string | null
  supplier: string | null
}

type Filtro = 'pendentes' | 'feitos' | 'ignorados' | 'todos'

const dia = (iso: string) => format(parseISO(iso), 'dd/MM/yyyy')

export function BankStatement() {
  const { selectedUnit, unitDbIds, units } = useUnit()
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [regras, setRegras] = useState<Regra[]>([])
  const [duplicados, setDuplicados] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('pendentes')
  const [aberto, setAberto] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [unidadeEnvio, setUnidadeEnvio] = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [previa, setPrevia] = useState<{ arquivo: string; extrato: ExtratoArquivo } | null>(null)
  const [pedeSenha, setPedeSenha] = useState<{ file: File; erro: boolean } | null>(null)
  const [senhaPdf, setSenhaPdf] = useState('')

  const unitIdBySlug = useMemo(() => Object.fromEntries(Object.entries(unitDbIds).map(([slug, v]) => [slug, v.unitId])), [unitDbIds])
  const unitNameById = useMemo(() => Object.fromEntries(units.map((u) => [unitIdBySlug[u.id], u.name])), [units, unitIdBySlug])
  const filtroUnidade = selectedUnit === 'todas' ? null : unitIdBySlug[selectedUnit] ?? null

  useEffect(() => {
    if (!unidadeEnvio && units.length) setUnidadeEnvio(selectedUnit !== 'todas' ? selectedUnit : units[0].id)
  }, [units, selectedUnit, unidadeEnvio])

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('bank_statement_lines')
      .select('id, unit_id, posted_date, amount, description, status, how, auto, dup_payment_id, dup_expense_id, dup_income_id, dup_line_id, suggestions, decided_by_name')
      .gte('posted_date', format(subDays(new Date(), 180), 'yyyy-MM-dd'))
      .order('posted_date', { ascending: false }).order('created_at', { ascending: true }).limit(1000)
    if (filtroUnidade) q = q.eq('unit_id', filtroUnidade)
    const [{ data, error: e1 }, { data: rg }] = await Promise.all([
      q,
      supabase.from('bank_rules').select('id, unit_id, direction, match_text, action, category, supplier').order('created_at', { ascending: false }),
    ])
    if (e1) { setError(friendlyDbError(e1.message)); setLoading(false); return }
    const ls = (data ?? []) as Linha[]
    setLinhas(ls)
    setRegras((rg ?? []) as Regra[])

    // o lançamento que pode ser o mesmo, descrito para a pessoa comparar
    const pays = ls.map((l) => l.dup_payment_id).filter(Boolean) as string[]
    const exps = ls.map((l) => l.dup_expense_id).filter(Boolean) as string[]
    const incs = ls.map((l) => l.dup_income_id).filter(Boolean) as string[]
    const movs = ls.map((l) => l.dup_line_id).filter(Boolean) as string[]
    const desc: Record<string, string> = {}
    await Promise.all([
      pays.length && supabase.from('payments').select('id, amount, payment_date, payment_method, notes, reservation:reservations(event_date, child_name, client:clients(name))').in('id', pays)
        .then(({ data: d }) => (d ?? []).forEach((p: any) => {
          desc[p.id] = `Pagamento de ${brl(Number(p.amount))} em ${dia(p.payment_date)} na festa de ${p.reservation ? format(parseISO(p.reservation.event_date), 'dd/MM') : '—'}`
            + `${p.reservation?.child_name ? ' · ' + p.reservation.child_name : ''} (${p.reservation?.client?.name ?? '—'})${p.notes ? ' — ' + p.notes : ''}`
        })),
      exps.length && supabase.from('expenses').select('id, amount, paid_date, due_date, category, description, supplier').in('id', exps)
        .then(({ data: d }) => (d ?? []).forEach((e: any) => {
          desc[e.id] = `Despesa paga de ${brl(Number(e.amount))} em ${dia(e.paid_date ?? e.due_date)} · ${e.category}${e.supplier || e.description ? ' · ' + (e.supplier || e.description) : ''}`
        })),
      incs.length && supabase.from('other_incomes').select('id, amount, received_date, description').in('id', incs)
        .then(({ data: d }) => (d ?? []).forEach((o: any) => {
          desc[o.id] = `Receita de ${brl(Number(o.amount))} em ${dia(o.received_date)} · ${o.description}`
        })),
      movs.length && supabase.from('bank_statement_lines').select('id, description, import:bank_statement_imports(file_name, created_at)').in('id', movs)
        .then(({ data: d }) => (d ?? []).forEach((b: any) => {
          desc[b.id] = `Movimento “${b.description}” do extrato ${b.import?.file_name ? '“' + b.import.file_name + '” ' : ''}enviado em ${b.import ? format(new Date(b.import.created_at), 'dd/MM/yyyy') : '—'}`
        })),
    ])
    setDuplicados(desc)
    setLoading(false)
  }, [filtroUnidade])

  useEffect(() => { load() }, [load])

  // 1) lê o arquivo e mostra o que encontrou, para a pessoa conferir antes de lançar
  async function ler(file: File, senha?: string) {
    setError(null); setNotice(null); setPrevia(null)
    setBusy(true)
    try {
      setPrevia({ arquivo: file.name, extrato: await lerExtrato(file, senha) })
      setPedeSenha(null); setSenhaPdf('')
    } catch (e) {
      if (e instanceof PdfComSenha) { setPedeSenha({ file, erro: e.senhaErrada }); setSenhaPdf('') }
      else { setPedeSenha(null); setError(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.') }
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // 2) confirmado: envia e o sistema lança
  // 2) conferido e lançado na conferência (ExtratoConferencia): mostra o resumo
  async function lancado(r: { total: number; novas: number; lancadas: number; duplicados: number; cartao?: number; a_classificar: number; ignoradas: number }) {
    if (!previa) return
    const { extrato } = previa
    setPrevia(null)
    const repetidos = r.total - r.novas
    setNotice(
      r.novas === 0
        ? `Nenhum movimento novo: os ${r.total} deste arquivo já tinham sido enviados.`
        : `${r.novas} movimentos novos (${dia(extrato.inicio!)} a ${dia(extrato.fim!)}): ${r.lancadas} lançados sozinhos, `
          + `${r.duplicados} possíveis duplicados${r.cartao ? `, ${r.cartao} vendas no cartão para conferir` : ''} e ${r.a_classificar} para classificar${r.ignoradas ? `, ${r.ignoradas} não lançados ou ignorados` : ''}.`
          + (repetidos ? ` ${repetidos} já tinham sido enviados antes e não entraram de novo.` : ''),
    )
    setFiltro('pendentes')
    await load()
  }

  async function resolver(l: Linha, action: string, dados: Record<string, unknown> = {}) {
    setBusy(true); setError(null)
    const { error: err } = await supabase.rpc('bank_resolve', { p_line: l.id, p_action: action, p_data: dados })
    setBusy(false)
    if (err) return setError(friendlyDbError(err.message))
    setAberto(null)
    await load()
  }

  async function desfazer(l: Linha) {
    setBusy(true); setError(null)
    const { error: err } = await supabase.rpc('bank_undo', { p_line: l.id })
    setBusy(false)
    if (err) return setError(friendlyDbError(err.message))
    setAberto(l.id)
    await load()
  }

  async function apagarRegra(r: Regra) {
    if (!window.confirm(`Esquecer a regra "${r.match_text}"? Os lançamentos já feitos continuam.`)) return
    const { error: err } = await supabase.rpc('bank_rule_delete', { p_rule: r.id })
    if (err) return setError(friendlyDbError(err.message))
    await load()
  }

  const pendentes = linhas.filter((l) => l.status === 'a_classificar' || l.status === 'possivel_duplicado' || l.status === 'cartao')
  const visiveis = linhas.filter((l) =>
    filtro === 'todos' ? true
      : filtro === 'pendentes' ? l.status === 'a_classificar' || l.status === 'possivel_duplicado' || l.status === 'cartao'
      : filtro === 'feitos' ? l.status === 'lancado' || l.status === 'conciliado'
      : l.status === 'ignorado')
  const contagem = {
    pendentes: pendentes.length,
    feitos: linhas.filter((l) => l.status === 'lancado' || l.status === 'conciliado').length,
    ignorados: linhas.filter((l) => l.status === 'ignorado').length,
    todos: linhas.length,
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Extrato do banco</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Envie o extrato e o sistema lança cada entrada e saída no financeiro: Pix das festas, contas a pagar e despesas que
          ele já conhece. O que ele não reconhecer fica aqui para você classificar. Quando algo pode já ter sido lançado, ele
          avisa e mostra com qual lançamento parece.
        </p>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}
      {notice && (
        <div className="bg-teal-light text-teal text-sm rounded-lg px-4 py-2.5 flex items-center justify-between gap-3">
          {notice}
          <button onClick={() => setNotice(null)} className="font-medium shrink-0">Ok</button>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          {units.length > 1 && (
            <label className="text-sm">
              <span className="block text-xs text-muted mb-1">Conta de qual unidade?</span>
              <select value={unidadeEnvio} onChange={(e) => { setUnidadeEnvio(e.target.value); setPrevia(null) }} className="h-10 rounded-lg border border-line bg-surface px-3 text-sm">
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          )}
          <input ref={fileRef} type="file" accept={ACEITOS} className="sr-only" id="arquivo-extrato"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) ler(f) }} />
          <Button onClick={() => fileRef.current?.click()} disabled={busy}>
            <FileUp className="w-4 h-4" /> {busy && !previa ? 'Lendo o extrato...' : 'Enviar extrato'}
          </Button>
          <p className="text-xs text-muted basis-full">
            Aceita o extrato em <b>OFX</b>, <b>planilha</b> (Excel ou CSV) ou <b>PDF</b>. O OFX é o mais certeiro; no PDF, confira os
            valores antes de lançar. Pode enviar períodos que se repetem: o que já entrou não entra de novo.
          </p>
        </div>
      </Card>

      {pedeSenha && (
        <Card>
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (senhaPdf) ler(pedeSenha.file, senhaPdf) }}>
            <p className="text-sm"><b>{pedeSenha.file.name}</b> tem senha. {pedeSenha.erro ? <span className="text-danger">Senha incorreta, tente de novo.</span> : 'Digite a senha do PDF para abrir.'}</p>
            <p className="text-xs text-muted">Costuma ser parte do CPF ou do CNPJ do titular (veja no app do banco). A senha não fica guardada. Se preferir, baixe o extrato em OFX ou planilha, que não têm senha.</p>
            <div className="flex flex-wrap gap-2">
              <input type="password" value={senhaPdf} onChange={(e) => setSenhaPdf(e.target.value)} autoFocus aria-label="Senha do PDF"
                className="h-10 rounded-lg border border-line bg-surface px-3 text-sm w-56" />
              <Button type="submit" disabled={busy || !senhaPdf}>{busy ? 'Abrindo...' : 'Abrir'}</Button>
              <Button type="button" variant="ghost" onClick={() => { setPedeSenha(null); setSenhaPdf('') }}>Cancelar</Button>
            </div>
          </form>
        </Card>
      )}

      {previa && unitIdBySlug[unidadeEnvio] && (
        <ExtratoConferencia key={previa.arquivo + previa.extrato.movimentos.length} unitId={unitIdBySlug[unidadeEnvio]} arquivo={previa.arquivo} extrato={previa.extrato}
          unidade={units.length > 1 ? units.find((u) => u.id === unidadeEnvio)?.name : undefined}
          onLancado={lancado} onCancelar={() => setPrevia(null)} />
      )}

      <div className="flex flex-wrap gap-2" role="tablist">
        {([['pendentes', 'Para resolver'], ['feitos', 'Lançados'], ['ignorados', 'Ignorados'], ['todos', 'Todos']] as [Filtro, string][]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={filtro === k} onClick={() => setFiltro(k)}
            className={`h-9 px-3.5 rounded-full text-sm font-medium border transition-colors ${filtro === k ? 'bg-purple text-white border-purple' : 'bg-surface border-line text-ink hover:border-purple/40'}`}>
            {label} <span className={`ml-1 tabular-nums ${filtro === k ? 'text-white/80' : 'text-muted'}`}>{contagem[k]}</span>
          </button>
        ))}
      </div>

      <Card>
        {loading ? (
          <p className="text-sm text-muted">Carregando...</p>
        ) : visiveis.length === 0 ? (
          <p className="text-sm text-muted py-2">
            {filtro === 'pendentes'
              ? linhas.length ? 'Tudo resolvido. Nada esperando por você.' : 'Nenhum extrato enviado ainda.'
              : 'Nada por aqui.'}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {visiveis.map((l) => (
              <LinhaExtrato key={l.id} l={l} aberto={aberto === l.id} onAbrir={() => setAberto(aberto === l.id ? null : l.id)}
                unidade={units.length > 1 ? unitNameById[l.unit_id] : undefined}
                duplicado={duplicados[l.dup_line_id ?? l.dup_payment_id ?? l.dup_expense_id ?? l.dup_income_id ?? ''] ?? null}
                busy={busy} onResolver={resolver} onDesfazer={desfazer} />
            ))}
          </ul>
        )}
      </Card>

      {regras.length > 0 && (
        <Card title="O que o sistema aprendeu">
          <p className="text-xs text-muted mb-3">Quando a descrição do extrato tem estas palavras, o sistema faz sozinho:</p>
          <ul className="divide-y divide-line text-sm">
            {regras.map((r) => (
              <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <b className="font-medium">“{r.match_text}”</b>
                  <span className="text-muted"> ({r.direction === 'entrada' ? 'entrada' : 'saída'}{r.unit_id && units.length > 1 ? ` · ${unitNameById[r.unit_id]}` : ''}) → </span>
                  {r.action === 'despesa' ? `despesa em ${r.category}${r.supplier ? ` · ${r.supplier}` : ''}` : r.action === 'receita' ? 'outra receita' : 'ignorar'}
                </span>
                <button onClick={() => apagarRegra(r)} className="text-muted hover:text-danger shrink-0" aria-label={`Esquecer a regra ${r.match_text}`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function LinhaExtrato({ l, aberto, onAbrir, unidade, duplicado, busy, onResolver, onDesfazer }: {
  l: Linha
  aberto: boolean
  onAbrir: () => void
  unidade?: string
  duplicado: string | null
  busy: boolean
  onResolver: (l: Linha, action: string, dados?: Record<string, unknown>) => void
  onDesfazer: (l: Linha) => void
}) {
  const entrada = l.amount > 0
  const pendente = l.status === 'a_classificar' || l.status === 'possivel_duplicado' || l.status === 'cartao'
  const badge = {
    a_classificar: <Badge tone="amber">A classificar</Badge>,
    cartao: <Badge tone="orange"><CreditCard className="w-3 h-3" /> Venda no cartão: confira</Badge>,
    possivel_duplicado: <Badge tone="orange"><AlertTriangle className="w-3 h-3" /> Possível duplicado</Badge>,
    lancado: <Badge tone="teal">{l.auto ? <Sparkles className="w-3 h-3" /> : <Check className="w-3 h-3" />} Lançado</Badge>,
    conciliado: <Badge tone="teal">{l.auto ? <Sparkles className="w-3 h-3" /> : <Check className="w-3 h-3" />} Conferido</Badge>,
    ignorado: <Badge>Ignorado</Badge>,
  }[l.status]

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${entrada ? 'bg-teal-light text-teal' : 'bg-danger-light text-danger'}`}>
          {entrada ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium break-words">{l.description || (entrada ? 'Entrada' : 'Saída')}</p>
              <p className="text-xs text-muted">{dia(l.posted_date)}{unidade ? ` · ${unidade}` : ''}</p>
            </div>
            <span className={`text-sm font-semibold tabular-nums shrink-0 ${entrada ? 'text-teal' : 'text-danger'}`}>
              {entrada ? '+' : '−'} {brl(Math.abs(l.amount))}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {badge}
            {l.how && l.status !== 'possivel_duplicado' && l.status !== 'cartao' && <span className="text-xs text-muted">{l.how}{l.auto ? ' (pelo sistema)' : l.decided_by_name ? ` (${l.decided_by_name})` : ''}</span>}
            {pendente && l.status === 'a_classificar' && !aberto && (
              <button onClick={onAbrir} className="text-xs text-purple font-medium">Classificar</button>
            )}
            {!pendente && (
              <button onClick={() => onDesfazer(l)} disabled={busy} className="text-xs text-muted hover:text-purple font-medium inline-flex items-center gap-1">
                <RotateCcw className="w-3 h-3" /> Desfazer
              </button>
            )}
          </div>

          {l.status === 'possivel_duplicado' && (
            <div className="mt-2 rounded-lg border border-orange/40 bg-orange-light/40 p-3 text-sm space-y-2">
              <p><b>Pode ser o mesmo que:</b> {duplicado ?? 'um lançamento que já existe'}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => onResolver(l, 'mesmo')}>
                  <Check className="w-4 h-4" /> É o mesmo (não lançar de novo)
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => onResolver(l, 'diferente')}>
                  <X className="w-4 h-4" /> São diferentes (lançar)
                </Button>
              </div>
            </div>
          )}

          {l.status === 'cartao' && <ConferirCartao l={l} busy={busy} onResolver={onResolver} />}

          {l.status === 'a_classificar' && aberto && (
            entrada
              ? <ClassificarEntrada l={l} busy={busy} onResolver={onResolver} onFechar={onAbrir} />
              : <ClassificarSaida l={l} busy={busy} onResolver={onResolver} onFechar={onAbrir} />
          )}
        </div>
      </div>
    </li>
  )
}

function Lembrar({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      Fazer igual da próxima vez que aparecer esta descrição
    </label>
  )
}

const campo = 'h-10 rounded-lg border border-line bg-surface px-3 text-sm w-full'

function ClassificarEntrada({ l, busy, onResolver, onFechar }: {
  l: Linha; busy: boolean; onResolver: (l: Linha, action: string, dados?: Record<string, unknown>) => void; onFechar: () => void
}) {
  const [modo, setModo] = useState<'festa' | 'receita' | 'ignorar'>('festa')
  const [festas, setFestas] = useState<{ id: string; label: string }[]>([])
  const [festa, setFesta] = useState(l.suggestions[0]?.reservation_id ?? '')
  const [descricao, setDescricao] = useState('')
  const [lembrar, setLembrar] = useState(true)

  useEffect(() => {
    supabase.from('reservations').select('id, event_date, child_name, client:clients(name)')
      .eq('unit_id', l.unit_id).neq('status', 'cancelada')
      .gte('event_date', format(subDays(parseISO(l.posted_date), 120), 'yyyy-MM-dd'))
      .order('event_date').limit(400)
      .then(({ data }) => setFestas((data ?? []).map((r: any) => ({
        id: r.id, label: `${format(parseISO(r.event_date), 'dd/MM/yyyy')}${r.child_name ? ' · ' + r.child_name : ''} (${r.client?.name ?? '—'})`,
      }))))
  }, [l.unit_id, l.posted_date])

  return (
    <div className="mt-2 rounded-lg border border-line bg-paper p-3 space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        {([['festa', 'Pagamento de festa'], ['receita', 'Outra receita'], ['ignorar', 'Ignorar']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setModo(k)} className={`h-8 px-3 rounded-full text-xs font-medium border ${modo === k ? 'bg-purple text-white border-purple' : 'bg-surface border-line'}`}>{label}</button>
        ))}
      </div>
      {modo === 'festa' && (
        <>
          {l.suggestions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted">Festas com esse valor em aberto:</p>
              {l.suggestions.map((s) => (
                <button key={s.reservation_id} onClick={() => setFesta(s.reservation_id!)}
                  className={`block w-full text-left px-3 py-2 rounded-lg border text-sm ${festa === s.reservation_id ? 'border-purple bg-purple-light' : 'border-line bg-surface'}`}>{s.label}</button>
              ))}
            </div>
          )}
          <label className="block">
            <span className="block text-xs text-muted mb-1">{l.suggestions.length ? 'Ou escolha outra festa' : 'De qual festa?'}</span>
            <select value={festa} onChange={(e) => setFesta(e.target.value)} className={campo}>
              <option value="">Escolha a festa...</option>
              {festas.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
          <Botoes busy={busy} ok={!!festa} onOk={() => onResolver(l, 'festa', { reservation_id: festa })} onFechar={onFechar} texto="Lançar na festa" />
        </>
      )}
      {modo === 'receita' && (
        <>
          <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descrição (ex.: rendimento, aluguel do espaço)" className={campo} />
          <Lembrar value={lembrar} onChange={setLembrar} />
          <Botoes busy={busy} ok onOk={() => onResolver(l, 'receita', { description: descricao, lembrar })} onFechar={onFechar} texto="Lançar como receita" />
        </>
      )}
      {modo === 'ignorar' && (
        <>
          <p className="text-xs text-muted">Não entra no financeiro. Use para transferência entre contas suas ou repasse das vendas no cartão que já estão lançadas nas festas.</p>
          <Lembrar value={lembrar} onChange={setLembrar} />
          <Botoes busy={busy} ok onOk={() => onResolver(l, 'ignorar', { lembrar })} onFechar={onFechar} texto="Ignorar" />
        </>
      )}
    </div>
  )
}

function ClassificarSaida({ l, busy, onResolver, onFechar }: {
  l: Linha; busy: boolean; onResolver: (l: Linha, action: string, dados?: Record<string, unknown>) => void; onFechar: () => void
}) {
  const [modo, setModo] = useState<'despesa' | 'conta' | 'ignorar'>(l.suggestions.length ? 'conta' : 'despesa')
  const [contas, setContas] = useState<{ id: string; label: string }[]>([])
  const [conta, setConta] = useState(l.suggestions[0]?.expense_id ?? '')
  const [categoria, setCategoria] = useState('')
  const [novaCategoria, setNovaCategoria] = useState('')
  const categorias = useCategoriasDespesa()
  const [fornecedor, setFornecedor] = useState('')
  const [descricao, setDescricao] = useState('')
  const [lembrar, setLembrar] = useState(true)

  useEffect(() => {
    supabase.from('expenses').select('id, category, description, supplier, amount, due_date')
      .eq('unit_id', l.unit_id).in('status', ['a_vencer', 'atrasado']).order('due_date').limit(300)
      .then(({ data }) => setContas((data ?? []).map((e: any) => ({
        id: e.id, label: `${brl(Number(e.amount))} · ${e.category}${e.supplier || e.description ? ' · ' + (e.supplier || e.description) : ''} · vence ${format(parseISO(e.due_date), 'dd/MM')}`,
      }))))
  }, [l.unit_id])

  return (
    <div className="mt-2 rounded-lg border border-line bg-paper p-3 space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        {([['despesa', 'Nova despesa'], ['conta', 'Pagou uma conta a pagar'], ['ignorar', 'Ignorar']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setModo(k)} className={`h-8 px-3 rounded-full text-xs font-medium border ${modo === k ? 'bg-purple text-white border-purple' : 'bg-surface border-line'}`}>{label}</button>
        ))}
      </div>
      {modo === 'despesa' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <CategoriaCampo categorias={categorias} valor={categoria} nova={novaCategoria} onValor={setCategoria} onNova={setNovaCategoria} />
            <input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="Fornecedor (opcional)" className={campo} />
          </div>
          <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descrição (opcional)" className={campo} />
          <Lembrar value={lembrar} onChange={setLembrar} />
          <Botoes busy={busy} ok={!!categoriaFinal(categoria, novaCategoria)} onOk={() => onResolver(l, 'despesa', { category: categoriaFinal(categoria, novaCategoria), supplier: fornecedor, description: descricao, lembrar })} onFechar={onFechar} texto="Lançar despesa paga" />
        </>
      )}
      {modo === 'conta' && (
        <>
          {l.suggestions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted">Contas em aberto com esse valor:</p>
              {l.suggestions.map((s) => (
                <button key={s.expense_id} onClick={() => setConta(s.expense_id!)}
                  className={`block w-full text-left px-3 py-2 rounded-lg border text-sm ${conta === s.expense_id ? 'border-purple bg-purple-light' : 'border-line bg-surface'}`}>{s.label}</button>
              ))}
            </div>
          )}
          <label className="block">
            <span className="block text-xs text-muted mb-1">{l.suggestions.length ? 'Ou escolha outra conta' : 'Qual conta foi paga?'}</span>
          <select value={conta} onChange={(e) => setConta(e.target.value)} className={campo} aria-label="Conta a pagar">
            <option value="">{contas.length ? 'Escolha a conta...' : 'Nenhuma conta a pagar em aberto'}</option>
            {contas.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          </label>
          <Botoes busy={busy} ok={!!conta} onOk={() => onResolver(l, 'conta', { expense_id: conta })} onFechar={onFechar} texto="Marcar como paga" />
        </>
      )}
      {modo === 'ignorar' && (
        <>
          <p className="text-xs text-muted">Não entra no financeiro. Use para transferência entre contas suas.</p>
          <Lembrar value={lembrar} onChange={setLembrar} />
          <Botoes busy={busy} ok onOk={() => onResolver(l, 'ignorar', { lembrar })} onFechar={onFechar} texto="Ignorar" />
        </>
      )}
    </div>
  )
}

function Botoes({ busy, ok, onOk, onFechar, texto }: { busy: boolean; ok: boolean; onOk: () => void; onFechar: () => void; texto: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || !ok} onClick={onOk}>{texto}</Button>
      <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
    </div>
  )
}

// Depósito que parece venda no cartão: pode ser de uma festa que já tem o
// pagamento lançado (a maquininha deposita sem a taxa, às vezes parcelado).
function ConferirCartao({ l, busy, onResolver }: {
  l: Linha; busy: boolean; onResolver: (l: Linha, action: string, dados?: Record<string, unknown>) => void
}) {
  const vendas = l.suggestions.filter((s) => s.payment_id)
  const [modo, setModo] = useState<'lancado' | 'festa' | 'nao'>('lancado')
  const [marcadas, setMarcadas] = useState<string[]>(() => vendas.filter((v) => v.bate).slice(0, 1).map((v) => v.payment_id!))
  const [festas, setFestas] = useState<{ id: string; label: string }[]>([])
  const [festa, setFesta] = useState('')
  const [valor, setValor] = useState(Math.abs(l.amount).toFixed(2).replace('.', ','))
  const [descricao, setDescricao] = useState('')

  useEffect(() => {
    supabase.from('reservations').select('id, event_date, child_name, client:clients(name)')
      .eq('unit_id', l.unit_id).neq('status', 'cancelada')
      .gte('event_date', format(subDays(parseISO(l.posted_date), 120), 'yyyy-MM-dd'))
      .order('event_date').limit(400)
      .then(({ data }) => setFestas((data ?? []).map((r: any) => ({
        id: r.id, label: `${format(parseISO(r.event_date), 'dd/MM/yyyy')}${r.child_name ? ' · ' + r.child_name : ''} (${r.client?.name ?? '—'})`,
      }))))
  }, [l.unit_id, l.posted_date])

  const valorNum = Number(valor.replace(/\./g, '').replace(',', '.'))
  return (
    <div className="mt-2 rounded-lg border border-orange/40 bg-orange-light/40 p-3 space-y-3 text-sm">
      <p>Parece <b>venda no cartão</b>. Pode ser de uma festa que <b>já tem o pagamento lançado</b> — confira para não lançar duas vezes.</p>
      <div className="flex flex-wrap gap-2">
        {([['lancado', 'Já foi lançado na festa'], ['festa', 'É de festa e não foi lançado'], ['nao', 'Não é de festa']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setModo(k)} className={`h-8 px-3 rounded-full text-xs font-medium border ${modo === k ? 'bg-purple text-white border-purple' : 'bg-surface border-line'}`}>{label}</button>
        ))}
      </div>
      {modo === 'lancado' && (
        <>
          {vendas.length === 0 ? (
            <p className="text-xs text-muted">Não achamos vendas no cartão lançadas nas festas desta unidade nos últimos dias. Se já foi lançado, pode confirmar mesmo assim.</p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-muted">Marque a(s) venda(s) que este depósito paga:</p>
              {vendas.map((v) => (
                <label key={v.payment_id} className={`flex items-start gap-2 px-3 py-2 rounded-lg border bg-surface cursor-pointer ${marcadas.includes(v.payment_id!) ? 'border-purple' : 'border-line'}`}>
                  <input type="checkbox" className="mt-0.5" checked={marcadas.includes(v.payment_id!)}
                    onChange={(e) => setMarcadas((m) => (e.target.checked ? [...m, v.payment_id!] : m.filter((x) => x !== v.payment_id)))} />
                  <span className="min-w-0">{v.label}{v.bate && <span className="ml-1 text-teal font-medium">· valor bate</span>}</span>
                </label>
              ))}
            </div>
          )}
          <Button disabled={busy} onClick={() => onResolver(l, 'cartao_lancado', { payment_ids: marcadas })}>
            <Check className="w-4 h-4" /> Confirmar: já foi lançado (não lançar de novo)
          </Button>
        </>
      )}
      {modo === 'festa' && (
        <>
          <select value={festa} onChange={(e) => setFesta(e.target.value)} className={campo} aria-label="Festa">
            <option value="">De qual festa?</option>
            {festas.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <label className="block">
            <span className="block text-xs text-muted mb-1">Valor da venda (com a taxa da maquininha). Caiu na conta: {brl(Math.abs(l.amount))}</span>
            <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" className={campo} />
          </label>
          <Button disabled={busy || !festa || !(valorNum > 0)} onClick={() => onResolver(l, 'festa', { reservation_id: festa, valor: valorNum })}>Lançar na festa</Button>
        </>
      )}
      {modo === 'nao' && (
        <>
          <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descrição (opcional)" className={campo} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => onResolver(l, 'receita', { description: descricao })}>Lançar como outra receita</Button>
            <Button variant="secondary" disabled={busy} onClick={() => onResolver(l, 'ignorar')}>Não lançar</Button>
          </div>
        </>
      )}
    </div>
  )
}
