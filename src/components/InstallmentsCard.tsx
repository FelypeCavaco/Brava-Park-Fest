import { FormEvent, useEffect, useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { supabase } from '../lib/supabaseClient'
import { brl, todayIso, parseDecimal, friendlyDbError } from '../lib/format'
import { carregarCronograma, carregarRegraCobranca, situacaoTexto, type Cronograma, type Parcela, type RegraCobranca } from '../lib/installments'
import { buildMessage, MESSAGE_TEMPLATES, openWhatsApp } from '../lib/whatsapp'

// Central da festa → Financeiro: cronograma de parcelas (empresa no modo
// "parcelas programadas"). Os pagamentos quitam as parcelas em ordem de
// vencimento; a parcela atrasada mostra multa e juros de hoje.

interface Props {
  reservationId: string
  cliente: string
  telefone: string | null
  crianca: string | null
  pix: string | null
  linkPortal: string | null
  podeLancar: boolean
  // depois de lançar pagamento / mudar o cronograma (recarrega pagamentos e saldo)
  onChanged: () => void
}

const dm = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7)
const PILL: Record<string, string> = {
  paga: 'bg-teal-light text-teal',
  atrasada: 'bg-danger-light text-danger',
  vence_hoje: 'bg-amber-light text-amber',
  parcial: 'bg-amber-light text-amber',
  a_vencer: 'bg-line/60 text-muted',
}
const FORMAS: [string, string][] = [['pix', 'Pix'], ['cartao_credito', 'Cartão de crédito'], ['cartao_debito', 'Cartão de débito'], ['dinheiro', 'Dinheiro'], ['boleto', 'Boleto'], ['transferencia', 'Transferência']]

export function InstallmentsCard({ reservationId, cliente, telefone, crianca, pix, linkPortal, podeLancar, onChanged }: Props) {
  const hoje = todayIso()
  const [regra, setRegra] = useState<RegraCobranca | null>(null)
  const [cron, setCron] = useState<Cronograma | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lancando, setLancando] = useState<{ p: Parcela; valor: string; forma: string; data: string; dispensar: boolean; motivo: string } | null>(null)
  const [ajustando, setAjustando] = useState<{ label: string; due_date: string; amount: string }[] | null>(null)

  async function load() {
    const [r, c] = await Promise.all([carregarRegraCobranca(), carregarCronograma(reservationId)])
    setRegra(r)
    setCron(c)
  }
  useEffect(() => { load() }, [reservationId])

  if (!regra || !cron) return null
  // Empresa no modo livre e festa sem parcelas: o quadro não aparece.
  if (regra.billing_mode !== 'parcelas' && cron.parcelas.length === 0) return null

  const pago = Math.min(cron.pago, cron.valor_festa)
  const pct = cron.valor_festa > 0 ? Math.round((pago / cron.valor_festa) * 100) : 0

  function lembrar(p: Parcela) {
    const encargos = p.multa + p.juros
    const msg = buildMessage(MESSAGE_TEMPLATES.lembrete_parcela, {
      cliente: cliente.split(' ')[0],
      parcela: p.label.toLowerCase(),
      festa: crianca ? `festa ${/a$/i.test(crianca.trim()) ? 'da' : 'do'} ${crianca}` : 'festa',
      valor: brl(p.aberto),
      vencimento: p.status === 'atrasada' ? `que venceu em ${dm(p.vencimento)}` : p.status === 'vence_hoje' ? 'que vence hoje' : `que vence em ${dm(p.vencimento)}`,
      encargos: encargos > 0 ? `\nCom a multa e os juros previstos no contrato, o valor para pagamento hoje é ${brl(p.total_hoje)}.` : '',
      pix: pix ? `\nPode pagar pelo Pix (chave: ${pix})` : '',
      link: linkPortal ? ` e enviar o comprovante pelo portal: ${linkPortal}` : '',
    })
    openWhatsApp(telefone, msg)
  }

  function abrirLancamento(p: Parcela) {
    setError(null)
    setLancando({ p, valor: String(p.aberto.toFixed(2)).replace('.', ','), forma: 'pix', data: hoje, dispensar: false, motivo: '' })
  }

  async function lancar(e: FormEvent) {
    e.preventDefault()
    if (!lancando) return
    const { p } = lancando
    const valor = parseDecimal(lancando.valor)
    if (!valor || valor <= 0) return setError('Informe o valor da parcela recebido.')
    const encargos = Math.round((p.multa + p.juros) * 100) / 100
    if (encargos > 0 && lancando.dispensar && !lancando.motivo.trim()) return setError('Informe o motivo para dispensar a multa e os juros.')
    setBusy(true)
    const { error: e1 } = await supabase.from('payments').insert({
      reservation_id: reservationId, amount: valor, payment_date: lancando.data, payment_method: lancando.forma, notes: `${p.label} (cronograma)`,
    })
    if (e1) { setBusy(false); return setError('Não foi possível registrar o pagamento.') }
    if (encargos > 0) {
      const { error: e2 } = lancando.dispensar
        ? await supabase.rpc('waive_installment_fees', { p_res: reservationId, p_label: p.label, p_amount: encargos, p_reason: lancando.motivo.trim() })
        : await supabase.rpc('register_installment_fees', { p_res: reservationId, p_amount: encargos, p_date: lancando.data, p_method: lancando.forma, p_label: p.label })
      if (e2) { setBusy(false); setError(`Pagamento lançado, mas a multa e os juros não: ${friendlyDbError(e2.message)}`); await load(); onChanged(); return }
    }
    setBusy(false)
    setLancando(null)
    await load()
    onChanged()
  }

  async function refazerPelaRegra() {
    if (cron && cron.parcelas.length > 0 && !window.confirm('Refazer o cronograma pela regra da empresa? As datas e valores ajustados à mão nesta festa serão substituídos. Os pagamentos já feitos continuam e quitam as parcelas novas em ordem.')) return
    setBusy(true)
    const { error: err } = await supabase.rpc('generate_installments', { p_res: reservationId })
    setBusy(false)
    if (err) return setError(friendlyDbError(err.message))
    await load()
  }

  async function salvarAjuste(e: FormEvent) {
    e.preventDefault()
    if (!ajustando) return
    const itens = ajustando.map((x) => ({ label: x.label.trim(), due_date: x.due_date, amount: parseDecimal(x.amount) ?? 0 }))
    setBusy(true)
    const { error: err } = await supabase.rpc('save_installments', { p_res: reservationId, p_items: itens })
    setBusy(false)
    if (err) return setError(friendlyDbError(err.message))
    setAjustando(null)
    await load()
  }

  const somaAjuste = ajustando ? Math.round(ajustando.reduce((t, x) => t + (parseDecimal(x.amount) ?? 0), 0) * 100) / 100 : 0

  return (
    <Card
      title="Cronograma de pagamento"
      action={podeLancar && (
        <div className="flex gap-2">
          {cron.parcelas.length > 0 && (
            <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => setAjustando(cron.parcelas.map((p) => ({ label: p.label, due_date: p.vencimento, amount: String(p.valor.toFixed(2)).replace('.', ',') })))}>
              Ajustar parcelas
            </Button>
          )}
          <Button variant="secondary" className="text-xs px-3 py-1.5" disabled={busy} onClick={refazerPelaRegra}>
            {cron.parcelas.length > 0 ? 'Refazer pela regra' : 'Gerar cronograma'}
          </Button>
        </div>
      )}
    >
      {error && !lancando && !ajustando && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 mb-3">{error}</div>}
      {cron.parcelas.length === 0 ? (
        <p className="text-sm text-muted">Esta festa ainda não tem cronograma. Ele nasce sozinho quando a festa é fechada; para criar agora, clique em "Gerar cronograma".</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="bg-paper rounded-lg px-3 py-2"><p className="text-[11px] text-muted">Valor da festa</p><p className="font-display font-semibold tabular-nums">{brl(cron.valor_festa)}</p></div>
            <div className="bg-paper rounded-lg px-3 py-2"><p className="text-[11px] text-muted">Pago</p><p className="font-display font-semibold tabular-nums text-teal">{brl(pago)}</p></div>
            <div className="bg-paper rounded-lg px-3 py-2"><p className="text-[11px] text-muted">Em atraso{cron.encargos > 0 ? ' (com multa e juros)' : ''}</p><p className={`font-display font-semibold tabular-nums ${cron.em_atraso > 0 ? 'text-danger' : ''}`}>{brl(cron.em_atraso + cron.encargos)}</p></div>
            <div className="bg-paper rounded-lg px-3 py-2"><p className="text-[11px] text-muted">A vencer</p><p className="font-display font-semibold tabular-nums">{brl(cron.a_vencer)}</p></div>
          </div>
          <div className="h-2 rounded-full bg-line overflow-hidden" aria-label={`${pct}% pago`}><div className="h-full bg-teal" style={{ width: `${pct}%` }} /></div>
          {Math.abs(cron.diferenca) >= 0.01 && (
            <p className="text-xs bg-amber-light text-ink rounded-lg px-3 py-2">
              A soma das parcelas ({brl(cron.soma_parcelas)}) está diferente do valor da festa ({brl(cron.valor_festa)}) — o valor mudou depois do cronograma (pacote, extras, consumo). Use "Refazer pela regra" ou "Ajustar parcelas".
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="pb-2 font-medium">Parcela</th><th className="pb-2 font-medium">Vencimento</th><th className="pb-2 font-medium text-right">Valor</th><th className="pb-2 font-medium">Situação</th><th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {cron.parcelas.map((p) => (
                  <tr key={p.seq}>
                    <td className="py-2.5">{p.label}</td>
                    <td className="py-2.5 tabular-nums">{dm(p.vencimento)}</td>
                    <td className="py-2.5 text-right tabular-nums whitespace-nowrap">
                      {brl(p.valor)}
                      {p.status === 'parcial' && <span className="block text-[11px] text-muted">falta {brl(p.aberto)}</span>}
                      {p.multa + p.juros > 0 && (
                        <>
                          <span className="block text-[11px] text-danger font-semibold">hoje {brl(p.total_hoje)}</span>
                          <span className="block text-[11px] text-muted">multa {brl(p.multa)} + juros {brl(p.juros)}</span>
                        </>
                      )}
                    </td>
                    <td className="py-2.5"><span className={`inline-block text-[11px] font-semibold rounded-full px-2 py-0.5 ${PILL[p.status]}`}>{situacaoTexto(p, hoje)}</span></td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      {p.aberto > 0 && (p.status === 'atrasada' || p.status === 'vence_hoje' || p.status === 'parcial' || p === cron.parcelas.find((x) => x.aberto > 0)) && (
                        <span className="inline-flex gap-2">
                          {telefone && <button onClick={() => lembrar(p)} className="text-xs font-medium text-teal">Lembrar no WhatsApp</button>}
                          {podeLancar && <button onClick={() => abrirLancamento(p)} className="text-xs font-medium text-purple">Lançar pagamento</button>}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {lancando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setLancando(null)} />
          <div className="relative w-full max-w-sm bg-surface rounded-card p-6 shadow-xl max-h-[90vh] overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-display font-semibold">Lançar pagamento · {lancando.p.label}</h2>
              <button onClick={() => setLancando(null)} className="text-muted hover:text-ink" aria-label="Fechar"><X className="w-5 h-5" /></button>
            </div>
            {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-3 py-2 mb-3">{error}</div>}
            <form onSubmit={lancar} className="space-y-3">
              {lancando.p.multa + lancando.p.juros > 0 && (
                <div className="bg-paper rounded-lg px-3 py-2 text-sm space-y-0.5">
                  <p>Parcela em aberto: <b>{brl(lancando.p.aberto)}</b></p>
                  <p>Multa: <b>{brl(lancando.p.multa)}</b> · Juros ({lancando.p.dias_atraso} {lancando.p.dias_atraso === 1 ? 'dia' : 'dias'}): <b>{brl(lancando.p.juros)}</b></p>
                  <p className="text-ink">Total a receber hoje: <b>{brl(lancando.dispensar ? lancando.p.aberto : lancando.p.total_hoje)}</b></p>
                </div>
              )}
              <div>
                <label className="block text-xs text-muted mb-1">Valor da parcela recebido</label>
                <input value={lancando.valor} onChange={(e) => setLancando({ ...lancando, valor: e.target.value })} inputMode="decimal" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                <p className="text-[11px] text-muted mt-1">Pagou a mais? O que sobra abate a próxima parcela. A menos? A parcela fica "paga em parte".</p>
              </div>
              {lancando.p.multa + lancando.p.juros > 0 && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={lancando.dispensar} onChange={(e) => setLancando({ ...lancando, dispensar: e.target.checked })} /> Dispensar multa e juros desta vez
                  </label>
                  {lancando.dispensar ? (
                    <input value={lancando.motivo} onChange={(e) => setLancando({ ...lancando, motivo: e.target.value })} placeholder="Motivo (fica anotado na festa)" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                  ) : (
                    <p className="text-[11px] text-muted">Multa e juros ({brl(lancando.p.multa + lancando.p.juros)}) entram como receita própria no Financeiro, sem mudar o valor da festa.</p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Forma</label>
                  <select value={lancando.forma} onChange={(e) => setLancando({ ...lancando, forma: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                    {FORMAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Data</label>
                  <input type="date" value={lancando.data} onChange={(e) => setLancando({ ...lancando, data: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <Button type="submit" className="w-full justify-center" disabled={busy}>{busy ? 'Lançando...' : 'Lançar'}</Button>
            </form>
          </div>
        </div>
      )}

      {ajustando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setAjustando(null)} />
          <div className="relative w-full max-w-lg bg-surface rounded-card p-6 shadow-xl max-h-[90vh] overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-display font-semibold">Ajustar parcelas desta festa</h2>
              <button onClick={() => setAjustando(null)} className="text-muted hover:text-ink" aria-label="Fechar"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-muted mb-3">Para quando o cliente negocia diferente da regra. A soma precisa ser igual ao valor da festa.</p>
            {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-3 py-2 mb-3">{error}</div>}
            <form onSubmit={salvarAjuste} className="space-y-2">
              {ajustando.map((x, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto_7rem_auto] gap-2 items-center">
                  <input value={x.label} onChange={(e) => setAjustando(ajustando.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} placeholder="Parcela" className="border border-line rounded-lg px-2 py-1.5 text-sm min-w-0" />
                  <input type="date" value={x.due_date} onChange={(e) => setAjustando(ajustando.map((y, j) => (j === i ? { ...y, due_date: e.target.value } : y)))} className="border border-line rounded-lg px-2 py-1.5 text-sm" />
                  <input value={x.amount} onChange={(e) => setAjustando(ajustando.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} inputMode="decimal" className="border border-line rounded-lg px-2 py-1.5 text-sm text-right" />
                  <button type="button" onClick={() => setAjustando(ajustando.filter((_, j) => j !== i))} className="text-muted hover:text-danger" aria-label="Apagar parcela"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              <button type="button" onClick={() => setAjustando([...ajustando, { label: '', due_date: hoje, amount: '' }])} className="text-sm text-purple font-medium flex items-center gap-1"><Plus className="w-4 h-4" /> Adicionar parcela</button>
              <p className={`text-xs font-semibold ${Math.abs(somaAjuste - cron.valor_festa) < 0.01 ? 'text-teal' : 'text-danger'}`}>
                Soma: {brl(somaAjuste)} de {brl(cron.valor_festa)} {Math.abs(somaAjuste - cron.valor_festa) < 0.01 ? '✓' : `(falta ${brl(cron.valor_festa - somaAjuste)})`}
              </p>
              <Button type="submit" className="w-full justify-center" disabled={busy}>{busy ? 'Salvando...' : 'Salvar cronograma'}</Button>
            </form>
          </div>
        </div>
      )}
    </Card>
  )
}
