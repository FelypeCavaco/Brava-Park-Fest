import { FormEvent, useEffect, useState } from 'react'
import { Ban, Undo2, Zap, ExternalLink } from 'lucide-react'
import { Button } from '../ui/Button'
import { supabase } from '../../lib/supabaseClient'
import { brl, friendlyDbError, parseDecimal, todayIso } from '../../lib/format'
import type { Mensalidade } from './platformTypes'

// Gerenciar empresa → Mensalidade: quanto a casa paga, quando vence, o que
// já pagou e o que está em aberto.

const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')
const mesBr = (iso: string) => {
  const [a, m] = iso.split('-')
  return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1]}/${a}`
}
// Soma dias a uma data AAAA-MM-DD (sem fuso: meio-dia evita virar o dia).
const somaDias = (iso: string, dias: number) => {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}
const num = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v).replace('.', ','))

// Chama a função de servidor do painel; erro de regra volta no corpo (400).
async function chamarServidor(body: Record<string, unknown>): Promise<{ data: Record<string, unknown> | null; erro: string | null }> {
  const { data, error } = await supabase.functions.invoke('platform-admin', { body })
  let erro: string | null = (data as { error?: string } | null)?.error ?? null
  if (error && !erro) {
    try {
      erro = (await (error as { context?: Response }).context?.json())?.error ?? null
    } catch {
      // sem corpo legível
    }
    erro = erro ?? 'Não foi possível falar com o servidor. Confira se a função "platform-admin" foi atualizada no Supabase.'
  }
  return { data: erro ? null : (data as Record<string, unknown>), erro }
}

export function situacaoMensalidade(m: Mensalidade | undefined): { texto: string; tom: 'teal' | 'amber' | 'danger' | 'neutral' } {
  if (m?.bloqueada) return { texto: 'Bloqueada (pagamento)', tom: 'danger' }
  if (m?.cadastrada && m.inicio && m.inicio > todayIso()) return { texto: `Em teste até ${dataBr(somaDias(m.inicio, -1)).slice(0, 5)}`, tom: 'teal' }
  if (!m || m.situacao === 'sem_cadastro') return { texto: 'Sem mensalidade', tom: 'neutral' }
  if (m.situacao === 'sem_cobranca') return { texto: 'Sem cobrança', tom: 'neutral' }
  if (m.situacao === 'atrasada') return { texto: `Atrasada ${m.dias_atraso} ${m.dias_atraso === 1 ? 'dia' : 'dias'}`, tom: 'danger' }
  if (m.situacao === 'vence_hoje') return { texto: 'Vence hoje', tom: 'amber' }
  if (m.situacao === 'vence_logo') return { texto: `Vence ${dataBr(m.proximo_vencimento).slice(0, 5)}`, tom: 'amber' }
  return { texto: 'Em dia', tom: 'teal' }
}

interface Props {
  empresaId: string
  ativa: boolean
  m: Mensalidade | undefined
  onChanged: () => Promise<void> | void
  onSuspender: () => void
}

export function CompanyBilling({ empresaId, ativa, m, onChanged, onSuspender }: Props) {
  const [f, setF] = useState({
    plano: m?.plano ?? '', mensalidade: num(m?.mensalidade), dia: String(m?.dia_vencimento ?? 10), inicio: m?.inicio ?? todayIso(),
    implantacao: num(m?.implantacao), adicional: num(m?.unidade_adicional), unidades: String(m?.unidades_incluidas ?? 1),
    usuarios: m?.usuarios_incluidos ? String(m.usuarios_incluidos) : '', obs: m?.observacao ?? '',
  })
  const [pag, setPag] = useState({ valor: num(m?.mensalidade), data: todayIso(), forma: 'pix' })
  const [historico, setHistorico] = useState<{ id: string; competencia: string; valor: number; pago_em: string; forma: string | null }[]>([])
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [tolerancia, setTolerancia] = useState(String(m?.tolerancia_dias ?? 7))
  const [diasTeste, setDiasTeste] = useState('')

  async function carregarHistorico() {
    const { data } = await supabase.rpc('platform_billing_history', { p_company: empresaId })
    setHistorico(((data ?? []) as typeof historico).map((h) => ({ ...h, valor: Number(h.valor) })))
  }
  useEffect(() => {
    if (m?.cadastrada) carregarHistorico()
  }, [empresaId, m?.cadastrada])

  async function salvar(e: FormEvent) {
    e.preventDefault()
    const mensalidade = parseDecimal(f.mensalidade)
    if (mensalidade === null || mensalidade < 0) return setMsg({ ok: false, texto: 'Informe a mensalidade.' })
    setBusy(true)
    const { error } = await supabase.rpc('platform_billing_save', {
      p_company: empresaId,
      p_dados: {
        plano: f.plano, mensalidade, dia_vencimento: Number(f.dia), inicio: f.inicio,
        implantacao: parseDecimal(f.implantacao) ?? 0, unidade_adicional: parseDecimal(f.adicional) ?? 0,
        unidades_incluidas: Number(f.unidades) || 1, usuarios_incluidos: f.usuarios.trim() ? Number(f.usuarios) : '', observacao: f.obs,
      },
    })
    setBusy(false)
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    if (!pag.valor) setPag({ ...pag, valor: f.mensalidade })
    // ligada ao Asaas: leva o valor novo para a assinatura também
    if (m?.asaas) {
      setBusy(true)
      const r = await chamarServidor({ action: 'asaas_sync', company_id: empresaId })
      setBusy(false)
      setMsg(r.erro ? { ok: false, texto: `Mensalidade salva aqui, mas o Asaas não atualizou: ${r.erro}` } : { ok: true, texto: 'Mensalidade salva e atualizada no Asaas.' })
    } else {
      setMsg({ ok: true, texto: 'Mensalidade salva.' })
    }
    await onChanged()
  }

  async function registrarPagamento() {
    const valor = parseDecimal(pag.valor)
    if (!valor || valor <= 0) return setMsg({ ok: false, texto: 'Informe o valor pago.' })
    setBusy(true)
    const { data, error } = await supabase.rpc('platform_billing_pay', { p_company: empresaId, p_competencia: null, p_valor: valor, p_pago_em: pag.data, p_forma: pag.forma })
    setBusy(false)
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    setMsg({ ok: true, texto: `Pagamento de ${mesBr(String(data))} registrado.` })
    await Promise.all([carregarHistorico(), onChanged()])
  }

  async function ligarAsaas() {
    setBusy(true)
    const r = await chamarServidor({ action: 'asaas_sync', company_id: empresaId })
    setBusy(false)
    if (r.erro) return setMsg({ ok: false, texto: r.erro })
    const amb = r.data?.ambiente === 'producao' ? '' : ' (ambiente de testes do Asaas)'
    const avisos = r.data?.avisos && r.data.avisos !== 'ok' ? ` Atenção: os avisos de vencimento não foram ajustados (${r.data.avisos}).` : ''
    setMsg({ ok: true, texto: `Cobrança automática ligada no Asaas${amb}. Cada mês o cliente recebe a fatura e paga por Pix, boleto ou cartão.${avisos}` })
    await onChanged()
  }

  async function cancelarAsaas() {
    if (!window.confirm('Cancelar a assinatura no Asaas? As próximas faturas deixam de ser geradas e o bloqueio automático desta empresa para. Os pagamentos já registrados continuam.')) return
    setBusy(true)
    const r = await chamarServidor({ action: 'asaas_cancel', company_id: empresaId })
    setBusy(false)
    if (r.erro) return setMsg({ ok: false, texto: r.erro })
    setMsg({ ok: true, texto: 'Assinatura cancelada no Asaas.' })
    await onChanged()
  }

  async function salvarTolerancia() {
    const dias = Number(tolerancia)
    const { error } = await supabase.rpc('platform_billing_set_tolerance', { p_company: empresaId, p_dias: dias })
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    setMsg({ ok: true, texto: `Tolerância de ${dias} dias salva.` })
    await onChanged()
  }

  async function desfazer(id: string) {
    if (!window.confirm('Desfazer este pagamento? O mês volta a ficar em aberto.')) return
    const { error } = await supabase.rpc('platform_billing_undo', { p_id: id })
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    await Promise.all([carregarHistorico(), onChanged()])
  }

  const s = situacaoMensalidade(m)
  const inp = 'w-full border border-line rounded-lg px-3 py-2 text-sm'

  return (
    <div className="space-y-5">
      {msg && <div className={`text-sm rounded-lg px-4 py-2.5 ${msg.ok ? 'bg-teal-light text-teal' : 'bg-danger-light text-danger'}`}>{msg.texto}</div>}

      {m?.cadastrada && (
        <div className={`rounded-lg px-4 py-3 text-sm ${s.tom === 'danger' ? 'bg-danger-light' : s.tom === 'amber' ? 'bg-amber-light' : 'bg-paper'}`}>
          <p className="font-semibold">{s.texto}</p>
          <p className="text-xs text-muted mt-0.5">
            {m.meses_em_aberto > 0 ? `${m.meses_em_aberto} ${m.meses_em_aberto === 1 ? 'mês' : 'meses'} em aberto · ${brl(Number(m.valor_em_aberto))}` : 'Nenhum mês vencido em aberto'}
            {m.proximo_vencimento && ` · próximo vencimento ${dataBr(m.proximo_vencimento)}`}
            {m.ultimo_pagamento && ` · último pagamento ${dataBr(m.ultimo_pagamento)}`}
          </p>
          {m.situacao === 'atrasada' && ativa && (
            <button type="button" onClick={onSuspender} className="mt-2 text-xs font-medium text-danger inline-flex items-center gap-1"><Ban className="w-3.5 h-3.5" /> Suspender o acesso agora</button>
          )}
        </div>
      )}

      {m && m.asaas !== undefined && m.asaas !== null && (
        <div className="rounded-lg border border-line px-4 py-3 space-y-3">
          <div className="flex items-center gap-2">
            <Zap className={`w-4 h-4 ${m.asaas ? 'text-teal' : 'text-muted'}`} />
            <p className="text-sm font-semibold flex-1">Cobrança automática (Asaas)</p>
            <span className={`text-xs font-medium ${m.asaas ? 'text-teal' : 'text-muted'}`}>{m.asaas ? 'Ligada' : 'Desligada'}</span>
          </div>
          <p className="text-xs text-muted">
            {m.asaas
              ? 'O Asaas gera a fatura todo mês e avisa o cliente por e-mail 5 dias antes e no dia do vencimento. Pagou, o mês fica pago aqui sozinho. Vencida além da tolerância, o acesso é suspenso até pagar.'
              : 'Liga a assinatura mensal no Asaas: o cliente paga por Pix, boleto ou cartão, o pagamento entra sozinho e, se atrasar além da tolerância, o acesso é suspenso até pagar.'}
          </p>
          {m.asaas && m.link_pagamento && (
            <a href={m.link_pagamento} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-purple"><ExternalLink className="w-3.5 h-3.5" /> Fatura em aberto</a>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs text-muted mb-1">Tolerância antes de suspender</label>
              <div className="flex items-center gap-2">
                <input type="number" min={0} max={60} value={tolerancia} disabled={!m.cadastrada} onChange={(e) => setTolerancia(e.target.value)} className="w-20 border border-line rounded-lg px-3 py-2 text-sm" aria-label="Dias de tolerância" />
                <span className="text-sm text-muted">dias</span>
                <button type="button" onClick={salvarTolerancia} className="text-xs font-medium text-purple">Salvar</button>
              </div>
            </div>
            <div className="flex-1" />
            {m.asaas ? (
              <>
                <Button type="button" variant="secondary" onClick={ligarAsaas} disabled={busy}>Atualizar no Asaas</Button>
                <button type="button" onClick={cancelarAsaas} disabled={busy} className="text-xs text-muted hover:text-danger">Cancelar assinatura</button>
              </>
            ) : (
              <Button type="button" onClick={ligarAsaas} disabled={busy || !m.cadastrada || !(Number(m.mensalidade) > 0)}><Zap className="w-4 h-4" /> {busy ? 'Ligando...' : 'Ligar cobrança no Asaas'}</Button>
            )}
          </div>
          {!m.asaas && <p className="text-[11px] text-muted">{m.cadastrada ? 'Precisa do CNPJ (ou CPF) na primeira unidade da casa e de um e-mail de administrador.' : 'Primeiro preencha e salve a mensalidade aqui embaixo; depois é só clicar em Ligar.'}</p>}
        </div>
      )}

      <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-muted mb-1">Plano (opcional)</label>
          <input value={f.plano} onChange={(e) => setF({ ...f, plano: e.target.value })} placeholder="Ex.: Completo" className={inp} />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Mensalidade (R$) *</label>
          <input value={f.mensalidade} onChange={(e) => setF({ ...f, mensalidade: e.target.value })} inputMode="decimal" className={inp} />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Vence todo dia</label>
          <input type="number" min={1} max={28} value={f.dia} onChange={(e) => setF({ ...f, dia: e.target.value })} className={inp} />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Dias de teste grátis</label>
          <input
            type="number"
            min={0}
            max={365}
            value={diasTeste}
            placeholder="0"
            onChange={(e) => {
              setDiasTeste(e.target.value)
              const n = Number(e.target.value)
              // o teste começa hoje: a cobrança começa no dia seguinte ao fim do teste
              if (Number.isFinite(n) && n >= 0) setF({ ...f, inicio: somaDias(todayIso(), n) })
            }}
            className={inp}
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Início da cobrança</label>
          <input type="date" value={f.inicio} onChange={(e) => { setDiasTeste(''); setF({ ...f, inicio: e.target.value }) }} className={inp} />
        </div>
        {f.inicio > todayIso() && (
          <p className="col-span-2 text-xs bg-teal-light text-teal rounded-lg px-3 py-2">
            Teste grátis até {dataBr(somaDias(f.inicio, -1))}. Nenhuma cobrança antes disso; a primeira fatura vence no primeiro dia {f.dia || '?'} a partir de {dataBr(f.inicio)}.
          </p>
        )}
        <div>
          <label className="block text-xs text-muted mb-1">Taxa de implantação (R$)</label>
          <input value={f.implantacao} onChange={(e) => setF({ ...f, implantacao: e.target.value })} inputMode="decimal" className={inp} />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Unidades incluídas</label>
          <input type="number" min={1} value={f.unidades} onChange={(e) => setF({ ...f, unidades: e.target.value })} className={inp} />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Unidade adicional (R$/mês)</label>
          <input value={f.adicional} onChange={(e) => setF({ ...f, adicional: e.target.value })} inputMode="decimal" className={inp} />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Usuários incluídos</label>
          <input type="number" min={1} value={f.usuarios} onChange={(e) => setF({ ...f, usuarios: e.target.value })} placeholder="Vazio = ilimitados" className={inp} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-muted mb-1">Observação</label>
          <input value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} className={inp} />
        </div>
        <div className="col-span-2"><Button type="submit" disabled={busy}>Salvar mensalidade</Button></div>
      </form>

      {m?.cadastrada && (
        <div className="border-t border-line pt-4 space-y-3">
          <p className="text-sm font-semibold">Registrar pagamento</p>
          <p className="text-xs text-muted -mt-2">Quita o mês mais antigo em aberto.</p>
          <div className="grid grid-cols-3 gap-2">
            <input value={pag.valor} onChange={(e) => setPag({ ...pag, valor: e.target.value })} inputMode="decimal" placeholder="Valor" aria-label="Valor pago" className={inp} />
            <input type="date" value={pag.data} onChange={(e) => setPag({ ...pag, data: e.target.value })} aria-label="Data do pagamento" className={inp} />
            <select value={pag.forma} onChange={(e) => setPag({ ...pag, forma: e.target.value })} aria-label="Forma" className={inp}>
              <option value="pix">Pix</option><option value="boleto">Boleto</option><option value="transferencia">Transferência</option><option value="dinheiro">Dinheiro</option><option value="cartao">Cartão</option>
            </select>
          </div>
          <Button type="button" variant="secondary" onClick={registrarPagamento} disabled={busy}>Registrar pagamento</Button>
          {historico.length > 0 && (
            <div className="divide-y divide-line text-sm">
              {historico.map((h) => (
                <div key={h.id} className="flex items-center justify-between py-2">
                  <span><b>{mesBr(h.competencia)}</b> <span className="text-muted">· pago em {dataBr(h.pago_em)}{h.forma ? ` · ${h.forma}` : ''}</span></span>
                  <span className="flex items-center gap-3"><span className="tabular-nums">{brl(h.valor)}</span>
                    <button type="button" onClick={() => desfazer(h.id)} className="text-muted hover:text-danger" aria-label="Desfazer pagamento"><Undo2 className="w-4 h-4" /></button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
