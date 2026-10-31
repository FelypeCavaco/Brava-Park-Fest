import { FormEvent, useEffect, useState } from 'react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { supabase } from '../lib/supabaseClient'
import { brl, friendlyDbError, parseDecimal } from '../lib/format'
import { carregarRegraCobranca, exemploRegra, type RegraCobranca } from '../lib/installments'

// Configurações → Empresa → Cobrança: como os clientes pagam (livre ou
// parcelas programadas), a regra padrão das parcelas e multa/juros no atraso.

type Form = Record<keyof RegraCobranca, string | boolean>

const NUMEROS: [keyof RegraCobranca, number, number][] = [
  ['installment_down_percent', 0, 100], ['installment_down_days', 0, 60], ['installment_count', 0, 24],
  ['installment_first_days', 0, 365], ['installment_deadline_days', 0, 60],
  ['late_fee_percent', 0, 2], ['late_interest_percent', 0, 10], ['late_grace_days', 0, 60],
]

export function BillingSettings() {
  const [regra, setRegra] = useState<RegraCobranca | null>(null)
  const [f, setF] = useState<Form | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    carregarRegraCobranca().then((r) => {
      setRegra(r)
      if (r) setF(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? String(v).replace('.', ',') : v])) as Form)
    })
  }, [])

  if (!regra || !f) return null // antes da migração 075

  const set = (k: keyof RegraCobranca, v: string | boolean) => setF({ ...f, [k]: v })
  const num = (k: keyof RegraCobranca) => parseDecimal(String(f[k])) ?? 0
  const regraAtual: RegraCobranca = {
    ...regra,
    billing_mode: f.billing_mode as RegraCobranca['billing_mode'],
    installment_interval: f.installment_interval as RegraCobranca['installment_interval'],
    late_fees_enabled: !!f.late_fees_enabled,
    installment_down_percent: num('installment_down_percent'), installment_down_days: num('installment_down_days'),
    installment_count: num('installment_count'), installment_first_days: num('installment_first_days'),
    installment_deadline_days: num('installment_deadline_days'), late_fee_percent: num('late_fee_percent'),
    late_interest_percent: num('late_interest_percent'), late_grace_days: num('late_grace_days'),
  }
  const exemplo = exemploRegra(regraAtual)
  const exParcela = 1096.67
  const exMulta = Math.round(exParcela * regraAtual.late_fee_percent) / 100
  const exJuros = Math.round(exParcela * regraAtual.late_interest_percent / 100 * 5 / 30 * 100) / 100

  async function salvar(e: FormEvent) {
    e.preventDefault()
    for (const [k, min, max] of NUMEROS) {
      const v = parseDecimal(String(f![k]))
      if (v === null || v < min || v > max) {
        return setMsg({ ok: false, texto: k === 'late_fee_percent' ? 'A multa pode ser de no máximo 2% (Código de Defesa do Consumidor).' : `Confira os números: um deles está fora do limite (${min} a ${max}).` })
      }
    }
    setSaving(true)
    const { data: c } = await supabase.from('companies').select('id').limit(1).maybeSingle()
    const { error } = await supabase.from('companies').update({
      billing_mode: regraAtual.billing_mode, installment_down_percent: regraAtual.installment_down_percent, installment_down_days: Math.round(regraAtual.installment_down_days),
      installment_count: Math.round(regraAtual.installment_count), installment_interval: regraAtual.installment_interval,
      installment_first_days: Math.round(regraAtual.installment_first_days), installment_deadline_days: Math.round(regraAtual.installment_deadline_days),
      late_fees_enabled: regraAtual.late_fees_enabled, late_fee_percent: regraAtual.late_fee_percent,
      late_interest_percent: regraAtual.late_interest_percent, late_grace_days: Math.round(regraAtual.late_grace_days),
    }).eq('id', c?.id ?? '')
    setSaving(false)
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    setMsg({ ok: true, texto: 'Regra de cobrança salva. Vale para as festas fechadas daqui em diante (as que já têm cronograma podem ser refeitas na Central da festa).' })
    const nova = await carregarRegraCobranca()
    if (nova) setRegra(nova)
  }

  const inp = (k: keyof RegraCobranca, w = 'w-16') => (
    <input value={String(f[k])} onChange={(e) => set(k, e.target.value)} inputMode="decimal" className={`${w} border border-line rounded-lg px-2 py-1.5 text-sm text-center`} />
  )

  return (
    <Card title="Cobrança dos clientes" className="lg:col-span-3">
      {msg && <div className={`text-sm rounded-lg px-4 py-2.5 mb-3 ${msg.ok ? 'bg-teal-light text-teal' : 'bg-danger-light text-danger'}`}>{msg.texto}</div>}
      <form onSubmit={salvar} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {([['livre', 'Livre', 'O cliente paga como quiser até o prazo do saldo.'], ['parcelas', 'Parcelas programadas', 'Sinal + parcelas com data. O sistema avisa o que vence e o que atrasou.']] as const).map(([v, t, d]) => (
            <label key={v} className={`flex gap-3 items-start rounded-lg border-2 px-3 py-2.5 cursor-pointer ${f.billing_mode === v ? 'border-purple bg-purple-light' : 'border-line'}`}>
              <input type="radio" name="modo" checked={f.billing_mode === v} onChange={() => set('billing_mode', v)} className="mt-1" />
              <span><b className="text-sm">{t}</b><span className="block text-xs text-muted">{d}</span></span>
            </label>
          ))}
        </div>

        {f.billing_mode === 'parcelas' && (
          <>
            <div className="space-y-2 text-sm">
              <p className="font-semibold">Regra padrão <span className="font-normal text-xs text-muted">— cada festa nasce com este cronograma ao ser fechada; dá para ajustar festa a festa</span></p>
              <div className="flex flex-wrap items-center gap-2">Sinal de {inp('installment_down_percent')} % do valor, vencendo {inp('installment_down_days')} dias depois do fechamento</div>
              <div className="flex flex-wrap items-center gap-2">
                Restante em {inp('installment_count')} parcelas
                <select value={String(f.installment_interval)} onChange={(e) => set('installment_interval', e.target.value)} className="border border-line rounded-lg px-2 py-1.5 text-sm">
                  <option value="mensal">mensais</option><option value="quinzenal">quinzenais</option><option value="semanal">semanais</option>
                </select>
                , a primeira {inp('installment_first_days')} dias depois do sinal
              </div>
              <div className="flex flex-wrap items-center gap-2">Tudo quitado até {inp('installment_deadline_days')} dias antes da festa <span className="text-xs text-muted">(o que passaria disso vai junto para essa data)</span></div>
              {exemplo.length > 0 && (
                <p className="text-xs bg-paper rounded-lg px-3 py-2 text-muted">
                  <b className="text-ink">Exemplo:</b> festa de R$ 4.700,00 fechada hoje para daqui a 110 dias → {exemplo.map((x) => `${x.label.toLowerCase()} ${brl(x.valor)} em ${x.data.slice(0, 5)}`).join(' · ')}.
                </p>
              )}
            </div>

            <div className="space-y-2 text-sm border-t border-line pt-4">
              <label className="flex items-center gap-2 font-semibold">
                <input type="checkbox" checked={!!f.late_fees_enabled} onChange={(e) => set('late_fees_enabled', e.target.checked)} /> Cobrar multa e juros de parcela atrasada
              </label>
              {f.late_fees_enabled && (
                <>
                  <div className="flex flex-wrap items-center gap-2">Multa de {inp('late_fee_percent')} % sobre a parcela, uma vez</div>
                  <div className="flex flex-wrap items-center gap-2">Juros de {inp('late_interest_percent')} % ao mês, contados por dia de atraso</div>
                  <div className="flex flex-wrap items-center gap-2">Tolerância de {inp('late_grace_days')} dias <span className="text-xs text-muted">(só cobra se o atraso passar disso)</span></div>
                  <p className="text-xs bg-paper rounded-lg px-3 py-2 text-muted">
                    <b className="text-ink">Exemplo:</b> parcela de {brl(exParcela)} paga com 5 dias de atraso → multa {brl(exMulta)} + juros {brl(exJuros)} = <b className="text-ink">{brl(exParcela + exMulta + exJuros)}</b>.
                  </p>
                  <p className="text-xs bg-amber-light rounded-lg px-3 py-2 text-ink">
                    <b>Atenção à lei:</b> para cliente pessoa física, o Código de Defesa do Consumidor limita a multa por atraso a 2%. E o contrato precisa ter a cláusula: use os campos {'{{multa_atraso}}'} e {'{{juros_atraso}}'} no contrato-base.
                  </p>
                </>
              )}
            </div>
          </>
        )}
        <Button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
      </form>
    </Card>
  )
}
