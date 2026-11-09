import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bell, FileText, Megaphone, Star } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/AuthContext'
import { useCompany } from '../../lib/CompanyContext'
import { moduloLigado } from '../../lib/modules'
import { brl } from '../../lib/format'

// Sininho no canto superior direito. Mostra:
//   • Pedir avaliação: festas que aconteceram nos últimos 3 dias e ainda não
//     tiveram o pedido de avaliação enviado (o pedido conta só se foi feito
//     depois da festa). Clicar abre a Central da festa já no pedido.
//   • Comprovantes de pagamento enviados pelo portal que esperam análise.
//   • Avisos do Festou (casas clientes): mensagens do administrador geral,
//     até a pessoa clicar em Entendi (guardado neste aparelho) ou o aviso vencer.
// O sinal fica enquanto houver algum item.

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

interface Avaliacao {
  festaId: string
  cliente: string
  dataFesta: string
  aniversariante: string | null
  unidade: string | null
}

const DIAS_AVALIACAO = 3
const CHAVE_LIDOS = 'festou-avisos-lidos'

interface AvisoFestou {
  id: string
  texto: string
  criado_em: string
}

function avisosLidos(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_LIDOS) ?? '[]')
  } catch {
    return []
  }
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

function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function quandoFoi(dataFesta: string) {
  const hoje = new Date()
  const dias = Math.round((new Date(`${isoLocal(hoje)}T00:00:00`).getTime() - new Date(`${dataFesta}T00:00:00`).getTime()) / 86400000)
  return dias <= 1 ? 'ontem' : `há ${dias} dias`
}

export function NotificationBell() {
  const { can } = useAuth()
  const { brand } = useCompany()
  const navigate = useNavigate()
  const location = useLocation()
  const [pendentes, setPendentes] = useState<Pendente[]>([])
  const [avaliacoes, setAvaliacoes] = useState<Avaliacao[]>([])
  const [aberto, setAberto] = useState(false)
  const [avisosFestou, setAvisosFestou] = useState<AvisoFestou[]>([])
  const [lidos, setLidos] = useState<string[]>(avisosLidos)
  const caixa = useRef<HTMLDivElement>(null)
  const podeComprovantes = can('page:portal_avisos') || can('action:festa.pagamentos')
  // pedido de avaliação: função Satisfação (plano Master no Festou)
  const podeAvaliacao = can('page:festa_detalhe') && (can('page:lembretes') || can('page:reservas')) && moduloLigado('satisfacao', brand.disabledModules)
  const permitido = podeComprovantes || podeAvaliacao

  const carregar = useCallback(async () => {
    if (brand.platformManaged) {
      const { data, error } = await supabase.rpc('platform_announcements_for_me')
      if (!error) setAvisosFestou((data ?? []) as AvisoFestou[])
    }
    if (!permitido) return
    if (podeComprovantes) {
      const { data, error } = await supabase
        .from('portal_receipts')
        .select('id, amount, created_at, reservation:reservations(id, event_date, child_name, client:clients(name), unit:units(name))')
        .eq('status', 'em_analise')
        .order('created_at', { ascending: true })
        .limit(30)
      if (!error) {
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
      }
    }
    if (podeAvaliacao) {
      const hoje = new Date()
      const ontem = isoLocal(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1))
      const desde = isoLocal(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - DIAS_AVALIACAO))
      const { data: festas } = await supabase
        .from('reservations')
        .select('id, event_date, child_name, client:clients(name), unit:units(name)')
        .neq('status', 'cancelada')
        .neq('status', 'orcamento')
        .gte('event_date', desde)
        .lte('event_date', ontem)
        .order('event_date', { ascending: false })
      const lista = (festas ?? []) as any[]
      if (lista.length === 0) {
        setAvaliacoes([])
      } else {
        // Pedidos de avaliação feitos depois da festa (o registro é pelo nome do cliente).
        const nomes = Array.from(new Set(lista.map((f) => f.client?.name).filter(Boolean)))
        const { data: pedidos } = await supabase
          .from('contact_history')
          .select('client_name, created_at')
          .eq('type', 'Pedido de avaliação')
          .in('client_name', nomes)
          .gte('created_at', `${desde}T00:00:00`)
        setAvaliacoes(
          lista
            .filter((f) => {
              const nome = f.client?.name
              return !(pedidos ?? []).some((p) => p.client_name === nome && p.created_at.slice(0, 10) >= f.event_date)
            })
            .map((f) => ({
              festaId: f.id,
              cliente: f.client?.name ?? 'Cliente',
              dataFesta: f.event_date,
              aniversariante: f.child_name ?? null,
              unidade: f.unit?.name ?? null,
            })),
        )
      }
    }
  }, [permitido, podeComprovantes, podeAvaliacao, brand.platformManaged])

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

  const avisosAbertos = avisosFestou.filter((a) => !lidos.includes(a.id))
  function entendi(id: string) {
    // guarda só os avisos que ainda existem, para a lista não crescer
    const novos = [...lidos.filter((x) => avisosFestou.some((a) => a.id === x)), id]
    setLidos(novos)
    try {
      localStorage.setItem(CHAVE_LIDOS, JSON.stringify(novos))
    } catch {
      // sem armazenamento: o aviso some só até recarregar
    }
  }

  if (!permitido && avisosAbertos.length === 0) return null
  const n = pendentes.length + avaliacoes.length + avisosAbertos.length

  return (
    <div ref={caixa} className="relative shrink-0">
      <button
        onClick={() => setAberto((v) => !v)}
        className={`relative w-10 h-10 rounded-full flex items-center justify-center border transition-colors ${n > 0 ? 'bg-surface border-purple/40 text-purple' : 'bg-surface border-line text-muted hover:text-ink'}`}
        aria-label={n > 0 ? `${n} aviso${n === 1 ? '' : 's'}` : 'Notificações'}
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
        <div className="absolute right-0 top-12 z-50 w-[360px] max-w-[calc(100vw-2rem)] bg-surface border border-line rounded-card shadow-xl overflow-hidden">
          {n === 0 ? (
            <p className="px-4 py-6 text-sm text-muted text-center">Nenhum aviso agora. Tudo em dia.</p>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto">
              {avisosAbertos.length > 0 && (
                <section>
                  <div className="px-4 py-3 border-b border-line bg-paper/60">
                    <p className="text-sm font-semibold">Avisos do Festou ({avisosAbertos.length})</p>
                  </div>
                  <ul className="divide-y divide-line">
                    {avisosAbertos.map((a) => (
                      <li key={a.id} className="px-4 py-3 flex gap-3">
                        <span className="w-8 h-8 rounded-full bg-purple-light text-purple flex items-center justify-center shrink-0"><Megaphone className="w-4 h-4" /></span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm whitespace-pre-wrap break-words">{a.texto}</span>
                          <span className="flex items-center justify-between gap-2 mt-1">
                            <span className="text-[11px] text-muted">{haQuanto(a.criado_em)}</span>
                            <button onClick={() => entendi(a.id)} className="text-[11px] font-medium text-purple hover:underline">Entendi</button>
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {avaliacoes.length > 0 && (
                <section>
                  <div className="px-4 py-3 border-b border-line bg-paper/60">
                    <p className="text-sm font-semibold">Pedir avaliação ({avaliacoes.length})</p>
                    <p className="text-xs text-muted">Festas que já aconteceram e ainda não tiveram o pedido de avaliação enviado.</p>
                  </div>
                  <ul className="divide-y divide-line">
                    {avaliacoes.map((a) => (
                      <li key={a.festaId}>
                        <button
                          onClick={() => {
                            setAberto(false)
                            navigate(`/reservas/${a.festaId}?avaliacao=1`)
                          }}
                          className="w-full text-left px-4 py-3 hover:bg-paper flex gap-3"
                        >
                          <span className="w-8 h-8 rounded-full bg-amber-light text-amber flex items-center justify-center shrink-0"><Star className="w-4 h-4" /></span>
                          <span className="flex-1 min-w-0">
                            <span className="flex justify-between gap-2">
                              <span className="text-sm font-medium truncate">{a.cliente}</span>
                              <span className="text-xs text-muted whitespace-nowrap">festa {quandoFoi(a.dataFesta)}</span>
                            </span>
                            <span className="block text-xs text-muted truncate">
                              {a.aniversariante ? `Festa de ${a.aniversariante} · ` : 'Festa · '}
                              {a.dataFesta.split('-').reverse().join('/')}
                              {a.unidade ? ` · ${a.unidade}` : ''}
                            </span>
                            <span className="block text-[11px] font-medium text-purple mt-0.5">Pedir avaliação →</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {pendentes.length > 0 && (
                <section>
                  <div className="px-4 py-3 border-b border-t border-line bg-paper/60">
                    <p className="text-sm font-semibold">Comprovantes para analisar ({pendentes.length})</p>
                    <p className="text-xs text-muted">Enviados pelos clientes no portal da festa.</p>
                  </div>
                  <ul className="divide-y divide-line">
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
                </section>
              )}
            </div>
          )}
          {n > 0 && <p className="px-4 py-2 text-[11px] text-muted border-t border-line">Clique para abrir a festa. O aviso some depois que o pedido é enviado ou o comprovante é analisado.</p>}
        </div>
      )}
    </div>
  )
}
