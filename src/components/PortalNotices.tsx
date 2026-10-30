import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { supabase } from '../lib/supabaseClient'
import { useAuth, useCurrentUserName } from '../lib/AuthContext'
import { useUnit, UNITS } from '../lib/UnitContext'
import { brl, todayIso, friendlyDbError } from '../lib/format'
import { openWhatsApp } from '../lib/whatsapp'

// Painel: tudo o que os clientes fazem no portal (avisos até alguém marcar
// como visto) e os prazos do portal que vencem sem a ação feita.

interface Aviso {
  id: string
  // Avisos agrupados (lista de convidados) marcam todos os registros juntos.
  ids: string[]
  kind: string
  description: string
  createdAt: string
  refId: string | null
  reservationId: string
  eventDate: string
  unitId: string
  crianca: string | null
  cliente: string
}

interface Prazo {
  key: string
  reservationId: string
  cliente: string
  phone: string | null
  festa: string
  tipo: 'cardapio' | 'convidados' | 'saldo'
  texto: string
  venceHoje: boolean
  mensagem: string
}

const SIGLA: Record<string, string> = { cardapio: 'CA', convidados: 'LC', musica: 'MU', comprovante: 'R$', mensagem: 'MS', avaliacao: 'AV' }

const antes = (n: number) => (n === 0 ? 'no dia da festa' : n === 7 ? '1 semana antes da festa' : `${n} ${n === 1 ? 'dia' : 'dias'} antes da festa`)
const dm = (iso: string) => iso.slice(5, 10).split('-').reverse().join('/')

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

// mode: 'financeiro' mostra só comprovantes e prazos de saldo (vai no topo
// do Painel para Administrador/Financeiro); 'operacao' mostra o resto.
export function PortalNotices({ mode = 'all' }: { mode?: 'all' | 'financeiro' | 'operacao' }) {
  const { can } = useAuth()
  const navigate = useNavigate()
  const currentUserName = useCurrentUserName()
  const { selectedUnit, unitDbIds, unitDbIdsLoading } = useUnit()
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [receiptPaths, setReceiptPaths] = useState<Record<string, { path: string; status: string; amount: number }>>({})
  const [prazos, setPrazos] = useState<Prazo[]>([])
  const [lembrados, setLembrados] = useState<Record<string, boolean>>({})
  const [recusando, setRecusando] = useState<{ id: string; reason: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const allowed = can('page:portal_avisos')

  const unitFilter = useMemo(() => {
    if (selectedUnit === 'todas') return null
    return unitDbIds[selectedUnit]?.unitId ?? null
  }, [selectedUnit, unitDbIds])

  useEffect(() => {
    if (!allowed || unitDbIdsLoading) return
    load()
    // Os avisos mudam por ações feitas em outros aparelhos (e pelo próprio
    // cliente no portal): recarrega ao voltar para a aba e a cada minuto,
    // em vez de só quando a página abre.
    const aoVoltar = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', aoVoltar)
    window.addEventListener('focus', aoVoltar)
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load() }, 60000)
    return () => {
      document.removeEventListener('visibilitychange', aoVoltar)
      window.removeEventListener('focus', aoVoltar)
      window.clearInterval(timer)
    }
  }, [allowed, unitDbIdsLoading, unitFilter])

  async function load() {
    const hoje = todayIso()
    const [{ data: evs }, { data: festas }] = await Promise.all([
      supabase
        .from('portal_events')
        .select('id, kind, description, created_at, ref_id, reservation_id, reservation:reservations(event_date, unit_id, child_name, client:clients(name))')
        .is('seen_at', null)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('reservations')
        .select('id, event_date, unit_id, child_name, final_value, menu_confirmed_at, client:clients(name, phone), payments(amount), reservation_extra_items(price_snapshot, quantity), reservation_consumption(quantity, unit_price), guest_list_pages(token), unit:units(menu_deadline_days, guest_deadline_days, payment_deadline_days)')
        .neq('status', 'cancelada')
        .gte('event_date', hoje)
        .lte('event_date', addDays(hoje, 61)),
    ])

    const brutos: Aviso[] = ((evs ?? []) as any[])
      .map((e) => ({
        id: e.id,
        ids: [e.id],
        kind: e.kind,
        description: e.description,
        createdAt: e.created_at,
        refId: e.ref_id,
        reservationId: e.reservation_id,
        eventDate: e.reservation?.event_date ?? '',
        unitId: e.reservation?.unit_id ?? '',
        crianca: e.reservation?.child_name ?? null,
        cliente: e.reservation?.client?.name ?? '—',
      }))
      .filter((a) => !unitFilter || a.unitId === unitFilter)

    // Lista de convidados: o cliente adiciona um nome por vez, então em vez
    // de um aviso por pessoa mostra um só por festa, com o resumo.
    const lista: Aviso[] = []
    const convidadosPorFesta: Record<string, { aviso: Aviso; add: number; rem: number }> = {}
    for (const a of brutos) {
      if (a.kind !== 'convidados') {
        lista.push(a)
        continue
      }
      const n = /^Adicionou (\d+) convidados/.exec(a.description)
      const add = n ? Number(n[1]) : a.description.startsWith('Adicionou') ? 1 : 0
      const rem = a.description.startsWith('Removeu') ? 1 : 0
      const g = convidadosPorFesta[a.reservationId]
      if (g) {
        g.aviso.ids.push(a.id)
        g.add += add
        g.rem += rem
      } else {
        const aviso = { ...a, ids: [a.id] }
        convidadosPorFesta[a.reservationId] = { aviso, add, rem }
        lista.push(aviso)
      }
    }
    for (const { aviso, add, rem } of Object.values(convidadosPorFesta)) {
      if (aviso.ids.length === 1) continue
      const partes = [add > 0 ? `adicionou ${add} ${add === 1 ? 'nome' : 'nomes'}` : '', rem > 0 ? `removeu ${rem} ${rem === 1 ? 'nome' : 'nomes'}` : ''].filter(Boolean)
      aviso.description = `Mexeu na lista de convidados: ${partes.join(' e ')}`
    }

    setAvisos(lista.filter((a) => (mode === 'financeiro' ? a.kind === 'comprovante' : mode === 'operacao' ? a.kind !== 'comprovante' : true)))

    const refIds = lista.filter((a) => a.kind === 'comprovante' && a.refId).map((a) => a.refId as string)
    if (refIds.length > 0) {
      const { data: rc } = await supabase.from('portal_receipts').select('id, storage_path, status, amount').in('id', refIds)
      const map: Record<string, { path: string; status: string; amount: number }> = {}
      for (const r of rc ?? []) map[r.id] = { path: r.storage_path, status: r.status, amount: Number(r.amount) }
      setReceiptPaths(map)
    }

    // Prazos: cardápio (7 dias antes), convidados e saldo (1 dia antes).
    const fs = ((festas ?? []) as any[]).filter((f) => !unitFilter || f.unit_id === unitFilter)
    // Cardápio só cobra prazo em unidade que tem seções de cardápio.
    const { data: secoesCardapio } = await supabase.from('menu_sections').select('unit_id').eq('active', true)
    const temCardapio = (unitId: string) => (secoesCardapio ?? []).some((sc: any) => !sc.unit_id || sc.unit_id === unitId)
    const tokens = fs.flatMap((f) => (Array.isArray(f.guest_list_pages) ? f.guest_list_pages : f.guest_list_pages ? [f.guest_list_pages] : []).map((g: any) => g.token))
    const guestCount: Record<string, number> = {}
    if (tokens.length > 0) {
      const { data: entries } = await supabase.from('guest_list_entries').select('token').in('token', tokens)
      for (const e of entries ?? []) guestCount[e.token] = (guestCount[e.token] ?? 0) + 1
    }
    const out: Prazo[] = []
    for (const f of fs) {
      const nome = f.client?.name ?? '—'
      const festaLabel = `Festa ${f.child_name ? `de ${f.child_name} ` : ''}· ${dm(f.event_date)} · ${UNITS.find((u) => unitDbIds[u.id]?.unitId === f.unit_id)?.name ?? ''}`
      const pages = Array.isArray(f.guest_list_pages) ? f.guest_list_pages : f.guest_list_pages ? [f.guest_list_pages] : []
      const token = pages[0]?.token as string | undefined
      const link = token ? `${window.location.origin}/portal/${token}` : ''
      const primeiroNome = nome.split(' ')[0]
      // Prazos configurados na unidade (Configurações → Unidades → Portal do cliente).
      const diasCardapio = f.unit?.menu_deadline_days ?? 7
      const diasLista = f.unit?.guest_deadline_days ?? 1
      const diasSaldo = f.unit?.payment_deadline_days ?? 1
      const prazoCardapio = addDays(f.event_date, -diasCardapio)
      const prazoLista = addDays(f.event_date, -diasLista)
      const prazoSaldo = addDays(f.event_date, -diasSaldo)
      if (temCardapio(f.unit_id) && !f.menu_confirmed_at && hoje >= prazoCardapio) {
        out.push({
          key: `${f.id}-cardapio`, reservationId: f.id, cliente: nome, phone: f.client?.phone ?? null, festa: festaLabel, tipo: 'cardapio',
          venceHoje: hoje === prazoCardapio,
          texto: `ainda não confirmou o cardápio — prato quente e bolo (prazo: ${hoje === prazoCardapio ? 'hoje' : dm(prazoCardapio)}, ${antes(diasCardapio)}).`,
          mensagem: `Olá, ${primeiroNome}! O prazo para escolher o cardápio da festa (pratos quentes e bolo) ${hoje === prazoCardapio ? 'termina hoje' : 'já terminou'}. ${link ? `É só escolher pelo portal: ${link}` : 'Me conta aqui as escolhas?'}`,
        })
      }
      if (hoje >= prazoLista && (!token || (guestCount[token] ?? 0) === 0)) {
        out.push({
          key: `${f.id}-convidados`, reservationId: f.id, cliente: nome, phone: f.client?.phone ?? null, festa: festaLabel, tipo: 'convidados',
          venceHoje: hoje === prazoLista,
          texto: `ainda não enviou a lista de convidados (prazo: ${hoje === prazoLista ? 'hoje' : dm(prazoLista)}, ${antes(diasLista)}).`,
          mensagem: `Olá, ${primeiroNome}! A lista de convidados da festa precisa ser enviada ${hoje === prazoLista ? 'até hoje' : 'o quanto antes'}. ${link ? `Pelo portal é rapidinho: ${link}` : ''}`.trim(),
        })
      }
      const devido = Number(f.final_value || 0)
        + (f.reservation_extra_items ?? []).reduce((s: number, x: any) => s + Number(x.price_snapshot) * Number(x.quantity), 0)
        + (f.reservation_consumption ?? []).reduce((s: number, x: any) => s + Number(x.quantity) * Number(x.unit_price), 0)
      const pago = (f.payments ?? []).reduce((s: number, x: any) => s + Number(x.amount), 0)
      const saldo = Math.round((devido - pago) * 100) / 100
      if (saldo > 0.005 && hoje >= prazoSaldo) {
        out.push({
          key: `${f.id}-saldo`, reservationId: f.id, cliente: nome, phone: f.client?.phone ?? null, festa: festaLabel, tipo: 'saldo',
          venceHoje: hoje === prazoSaldo,
          texto: `ainda tem saldo de ${brl(saldo)} em aberto (prazo: ${hoje === prazoSaldo ? 'hoje' : dm(prazoSaldo)}, ${antes(diasSaldo)}).`,
          mensagem: `Olá, ${primeiroNome}! Passando para lembrar do saldo de ${brl(saldo)} da festa, com prazo ${hoje === prazoSaldo ? 'até hoje' : 'já vencido'}. ${link ? `No portal tem a chave Pix e você envia o comprovante: ${link}` : ''}`.trim(),
        })
      }
    }
    setPrazos(out.filter((p) => (mode === 'financeiro' ? p.tipo === 'saldo' : mode === 'operacao' ? p.tipo !== 'saldo' : true)))

    // Lembretes de prazo já enviados hoje (em qualquer aparelho), pelo
    // registro de contatos — antes isso ficava só no aparelho que enviou.
    if (out.length > 0) {
      const inicioHoje = new Date(`${hoje}T00:00:00`).toISOString()
      const { data: enviados } = await supabase
        .from('contact_history')
        .select('client_name, type')
        .like('type', 'Lembrete de prazo do portal%')
        .gte('created_at', inicioHoje)
      const ja = new Set((enviados ?? []).map((c: any) => `${c.client_name}|${c.type}`))
      const marcados: Record<string, boolean> = {}
      for (const p of out) if (ja.has(`${p.cliente}|Lembrete de prazo do portal (${p.tipo})`)) marcados[p.key] = true
      setLembrados(marcados)
    }
  }

  async function marcarVisto(ids: string[]) {
    const { error: err } = await supabase.rpc('mark_portal_events_seen', { p_ids: ids })
    if (err) return setError(friendlyDbError(err.message))
    setAvisos((prev) => prev.filter((a) => !a.ids.some((x) => ids.includes(x))))
  }

  async function verComprovante(path: string) {
    const { data, error: err } = await supabase.storage.from('portal-comprovantes').createSignedUrl(path, 300)
    if (err || !data) return setError('Não foi possível abrir o comprovante.')
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function recusar() {
    if (!recusando || !recusando.reason.trim()) return
    const { error: err } = await supabase.rpc('reject_portal_receipt', { p_receipt: recusando.id, p_reason: recusando.reason.trim() })
    if (err) return setError(friendlyDbError(err.message))
    setRecusando(null)
    await load()
  }

  async function lembrar(p: Prazo) {
    openWhatsApp(p.phone, p.mensagem)
    setLembrados((prev) => ({ ...prev, [p.key]: true }))
    await supabase.from('contact_history').insert({ client_name: p.cliente, type: `Lembrete de prazo do portal (${p.tipo})`, channel: 'whatsapp', user_name: currentUserName })
  }

  if (!allowed) return null

  return (
    <>
      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      {(mode !== 'financeiro' || avisos.length > 0) && (
      <Card
        title={`${mode === 'financeiro' ? 'Comprovantes do portal do cliente' : 'Portal do cliente'}${avisos.length ? ` · ${avisos.length} novo${avisos.length > 1 ? 's' : ''}` : ''}`}
        action={avisos.length > 1 ? <button onClick={() => marcarVisto(avisos.flatMap((a) => a.ids))} className="text-xs text-muted hover:text-purple">Marcar todos como vistos</button> : undefined}
      >
        {avisos.length === 0 ? (
          <p className="text-sm text-muted">Nada novo. Toda alteração feita pelos clientes no portal aparece aqui.</p>
        ) : (
          <ul className="divide-y divide-line">
            {avisos.map((a) => {
              const rc = a.refId ? receiptPaths[a.refId] : undefined
              const comprovantePendente = a.kind === 'comprovante' && rc?.status === 'em_analise'
              return (
                <li key={a.id} className="py-3 flex flex-wrap gap-3 items-start">
                  <span className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold ${a.kind === 'comprovante' ? 'bg-teal-light text-teal' : 'bg-purple-light text-purple-dark'}`}>{SIGLA[a.kind] ?? '•'}</span>
                  <div className="flex-1 min-w-[200px]">
                    <p className="text-sm"><strong className="font-semibold">{a.cliente}</strong> — {a.description.charAt(0).toLowerCase() + a.description.slice(1)}</p>
                    <p className="text-xs text-muted">
                      Festa {a.crianca ? `de ${a.crianca} ` : ''}· {a.eventDate ? dm(a.eventDate) : ''} · {new Date(a.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    </p>
                    {recusando?.id === a.refId && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        <input autoFocus value={recusando.reason} onChange={(e) => setRecusando({ id: recusando.id, reason: e.target.value })} placeholder="Justificativa (obrigatória — o cliente vê no portal)" className="flex-1 min-w-[220px] border border-line rounded-lg px-2 py-1.5 text-sm" />
                        <Button variant="secondary" className="text-xs px-3 py-1.5" disabled={!recusando.reason.trim()} onClick={recusar}>Confirmar recusa</Button>
                        <button onClick={() => setRecusando(null)} className="text-xs text-muted">Voltar</button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {comprovantePendente && rc ? (
                      <>
                        <button onClick={() => verComprovante(rc.path)} className="text-xs border border-line rounded-lg px-2.5 py-1.5">Ver comprovante</button>
                        <button onClick={() => setRecusando({ id: a.refId as string, reason: '' })} className="text-xs border border-danger/30 text-danger rounded-lg px-2.5 py-1.5">Recusar</button>
                        <Button className="text-xs px-3 py-1.5" onClick={() => navigate(`/reservas/${a.reservationId}?aba=financeiro`)}>Lançar pagamento</Button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => navigate(`/reservas/${a.reservationId}`)} className="text-xs border border-line rounded-lg px-2.5 py-1.5">Abrir festa</button>
                        <button onClick={() => marcarVisto(a.ids)} className="text-xs bg-purple-light text-purple-dark font-semibold rounded-lg px-2.5 py-1.5">Marcar como visto</button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      )}

      {prazos.length > 0 && (
        <Card title={`${mode === 'financeiro' ? 'Saldos a receber — prazo do portal' : 'Prazos do portal'} · ${prazos.length} pendente${prazos.length > 1 ? 's' : ''}`} className="border-danger/40">
          <ul className="divide-y divide-line">
            {prazos.map((p) => (
              <li key={p.key} className="py-3 flex flex-wrap gap-3 items-center">
                <span className="text-[11px] font-bold uppercase tracking-wide rounded px-2 py-1 bg-danger-light text-danger">{p.venceHoje ? 'Vence hoje' : 'Prazo vencido'}</span>
                <div className="flex-1 min-w-[200px]">
                  <p className="text-sm"><strong className="font-semibold">{p.cliente}</strong> {p.texto}</p>
                  <p className="text-xs text-muted">{p.festa}{lembrados[p.key] ? ' · lembrete já enviado hoje' : ''}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => navigate(`/reservas/${p.reservationId}`)} className="text-xs border border-line rounded-lg px-2.5 py-1.5">Abrir festa</button>
                  <Button className="text-xs px-3 py-1.5" onClick={() => lembrar(p)}>Lembrar pelo WhatsApp</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
