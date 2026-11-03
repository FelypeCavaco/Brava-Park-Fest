import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bell, FileText } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/AuthContext'
import { brl } from '../../lib/format'

// Sininho no canto superior direito: comprovantes de pagamento enviados pelo
// portal do cliente que ainda esperam a equipe aprovar ou recusar. O sinal
// fica enquanto houver algum em análise.

interface Pendente {
  id: string
  valor: number
  enviadoEm: string
  festaId: string
  cliente: string
  dataFesta: string
  aniversariante: string | null
  unidade: string | null
}

function haQuanto(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  return `há ${d} ${d === 1 ? 'dia' : 'dias'}`
}

export function NotificationBell() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [pendentes, setPendentes] = useState<Pendente[]>([])
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)
  const permitido = can('page:portal_avisos') || can('action:festa.pagamentos')

  const carregar = useCallback(async () => {
    if (!permitido) return
    const { data, error } = await supabase
      .from('portal_receipts')
      .select('id, amount, created_at, reservation:reservations(id, event_date, child_name, client:clients(name), unit:units(name))')
      .eq('status', 'em_analise')
      .order('created_at', { ascending: true })
      .limit(30)
    if (error) return
    setPendentes(
      ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        valor: Number(r.amount),
        enviadoEm: r.created_at,
        festaId: r.reservation?.id,
        cliente: r.reservation?.client?.name ?? 'Cliente',
        dataFesta: r.reservation?.event_date ?? '',
        aniversariante: r.reservation?.child_name ?? null,
        unidade: r.reservation?.unit?.name ?? null,
      })),
    )
  }, [permitido])

  // Atualiza ao abrir cada tela, a cada minuto e ao voltar para a aba.
  useEffect(() => {
    carregar()
  }, [carregar, location.pathname])
  useEffect(() => {
    const t = setInterval(carregar, 60000)
    const foco = () => carregar()
    window.addEventListener('focus', foco)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', foco)
    }
  }, [carregar])

  // fecha ao clicar fora
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberto])

  if (!permitido) return null
  const n = pendentes.length

  return (
    <div ref={caixa} className="relative shrink-0">
      <button
        onClick={() => setAberto((v) => !v)}
        className={`relative w-10 h-10 rounded-full flex items-center justify-center border transition-colors ${n > 0 ? 'bg-surface border-purple/40 text-purple' : 'bg-surface border-line text-muted hover:text-ink'}`}
        aria-label={n > 0 ? `${n} comprovante${n === 1 ? '' : 's'} esperando análise` : 'Notificações'}
        aria-expanded={aberto}
      >
        <Bell className="w-5 h-5" />
        {n > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-danger text-white text-[11px] font-bold flex items-center justify-center ring-2 ring-paper">
            {n > 9 ? '9+' : n}
          </span>
        )}
      </button>

      {aberto && (
        <div className="absolute right-0 top-12 z-50 w-[340px] max-w-[calc(100vw-2rem)] bg-surface border border-line rounded-card shadow-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-line">
            <p className="text-sm font-semibold">Comprovantes para analisar</p>
            <p className="text-xs text-muted">Enviados pelos clientes no portal da festa.</p>
          </div>
          {n === 0 ? (
            <p className="px-4 py-6 text-sm text-muted text-center">Nenhum comprovante esperando. Tudo em dia.</p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto divide-y divide-line">
              {pendentes.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => {
                      setAberto(false)
                      navigate(`/reservas/${p.festaId}?aba=financeiro`)
                    }}
                    className="w-full text-left px-4 py-3 hover:bg-paper flex gap-3"
                  >
                    <span className="w-8 h-8 rounded-full bg-purple-light text-purple flex items-center justify-center shrink-0"><FileText className="w-4 h-4" /></span>
                    <span className="flex-1 min-w-0">
                      <span className="flex justify-between gap-2">
                        <span className="text-sm font-medium truncate">{p.cliente}</span>
                        <span className="text-sm font-semibold tabular-nums">{brl(p.valor)}</span>
                      </span>
                      <span className="block text-xs text-muted truncate">
                        {p.aniversariante ? `Festa de ${p.aniversariante} · ` : 'Festa · '}
                        {p.dataFesta ? p.dataFesta.split('-').reverse().join('/') : ''}
                        {p.unidade ? ` · ${p.unidade}` : ''}
                      </span>
                      <span className="block text-[11px] text-muted">Enviado {haQuanto(p.enviadoEm)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {n > 0 && <p className="px-4 py-2 text-[11px] text-muted border-t border-line">Clique para abrir a festa e aprovar ou recusar. O sinal some quando não houver nenhum esperando.</p>}
        </div>
      )}
    </div>
  )
}
