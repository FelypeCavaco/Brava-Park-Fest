import { Lock, CreditCard, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { brl } from '../../lib/format'
import { useCompany, type BillingStatus } from '../../lib/CompanyContext'
import { Button } from '../ui/Button'

// Mensalidade do sistema cobrada pelo Asaas (migração 079): aviso para o
// administrador da casa e a tela de acesso bloqueado com o link de pagamento.

const dataBr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

export function BillingBlockedScreen({ billing }: { billing: BillingStatus }) {
  const { reloadBrand } = useCompany()
  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-mesh px-4">
      <div className="w-full max-w-md bg-surface rounded-card p-6 space-y-4 shadow-2xl text-center">
        {document.documentElement.dataset.brand === 'festou' && <img src="/marca/festou.png" alt="Festou" className="h-9 w-auto mx-auto" draggable={false} />}
        <span className="w-12 h-12 rounded-full bg-danger-light text-danger flex items-center justify-center mx-auto"><Lock className="w-6 h-6" /></span>
        <div>
          <h1 className="text-xl font-semibold">Acesso suspenso</h1>
          <p className="text-sm text-muted mt-1">
            A mensalidade do sistema com vencimento em {dataBr(billing.vencimento)} está em aberto há {billing.dias_atraso} {billing.dias_atraso === 1 ? 'dia' : 'dias'}.
            Assim que o pagamento for confirmado, o acesso volta sozinho.
          </p>
        </div>
        {billing.link ? (
          <a href={billing.link} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 w-full h-11 rounded-lg bg-purple text-white font-semibold">
            <CreditCard className="w-4 h-4" /> Pagar {brl(Number(billing.valor))} agora
          </a>
        ) : (
          <p className="text-sm bg-paper rounded-lg px-3 py-2">Fale com o suporte para receber o link de pagamento.</p>
        )}
        <p className="text-xs text-muted">Pix, boleto ou cartão. Pelo Pix e pelo cartão a liberação costuma levar poucos minutos; pelo boleto, até 3 dias úteis.</p>
        <div className="flex gap-2 justify-center">
          <Button variant="secondary" onClick={() => reloadBrand()}><RefreshCw className="w-4 h-4" /> Já paguei, verificar</Button>
          <Button variant="ghost" onClick={() => supabase.auth.signOut()}>Sair</Button>
        </div>
      </div>
    </div>
  )
}

// Faixa no topo do sistema, só para administradores: 5 dias antes, no dia e
// enquanto estiver atrasada (com quantos dias faltam para o bloqueio).
export function BillingBanner({ billing }: { billing: BillingStatus }) {
  if (!billing.aviso) return null
  const texto =
    billing.aviso === 'atrasada'
      ? `A mensalidade do sistema venceu em ${dataBr(billing.vencimento)}. O acesso será suspenso ${billing.dias_para_bloqueio <= 1 ? 'amanhã' : `em ${billing.dias_para_bloqueio} dias`} se não for paga.`
      : billing.aviso === 'vence_hoje'
        ? `A mensalidade do sistema (${brl(Number(billing.valor))}) vence hoje.`
        : `A mensalidade do sistema (${brl(Number(billing.valor))}) vence em ${dataBr(billing.vencimento)}.`
  return (
    <div role="status" className={`mb-5 rounded-lg px-4 py-3 text-sm flex flex-wrap items-center gap-3 ${billing.aviso === 'atrasada' ? 'bg-danger-light text-danger' : 'bg-amber-light text-ink'}`}>
      <CreditCard className="w-4 h-4 shrink-0" />
      <span className="flex-1 min-w-[200px]">{texto}</span>
      {billing.link && (
        <a href={billing.link} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">Pagar agora</a>
      )}
    </div>
  )
}
