import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { subDays, parseISO, isPast, format } from 'date-fns'
import {
  ArrowLeft,
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Beer,
  Ban,
  Receipt,
  File as FileIcon,
  Link as LinkIcon,
  Copy,
  Users,
  History,
  Truck,
  X,
  Pencil,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Can } from '../components/Can'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { useUndo } from '../lib/UndoContext'
import { SendReviewModal } from '../components/SendReviewModal'
import { monthBounds } from '../lib/monthUtils'
import { openWhatsApp, buildMessage, MESSAGE_TEMPLATES, MESSAGE_TEMPLATE_LABEL, type MessageTemplateKey } from '../lib/whatsapp'
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  packagePriceForDate,
  type ReservationStatus,
  type PaymentMethod,
  type InvoiceStatus,
  type DiscountType,
} from '../types'

interface FestaDetalhada {
  id: string
  unitId: string
  unidadeNome: string
  unidadeWhatsappGroupLink: string | null
  googleReviewLink: string | null
  cliente: string
  clientPhone: string | null
  data: string
  eventDateIso: string
  horario: string
  startTimeRaw: string
  endTimeRaw: string
  status: ReservationStatus
  tipoEvento: string
  convidados: number
  valorTotal: number
  finalValue: number
  childName: string | null
  childAge: number | null
  theme: string | null
  hotDishFlavors: string | null
  cakeFlavor: string | null
  courtesyGuests: number | null
  discountType: DiscountType | null
  discountValue: number | null
  packageId: string | null
  packageName: string | null
  cancellationReason: string | null
  cancellationFeePercent: number | null
  refundAmount: number | null
}

interface PackageOption {
  id: string
  name: string
  base_price: number
  weekday_price: number | null
  weekend_price: number | null
  guest_limit: number | null
}

interface FestaExtraItem {
  id: string
  extraItemId: string
  name: string
  quantity: number
  priceSnapshot: number
}

interface PackageHistoryEntry {
  id: string
  createdAt: string
  userName: string
  oldPackageName: string
  newPackageName: string
  diff: number
}

const statusTone: Record<ReservationStatus, 'purple' | 'orange' | 'teal' | 'amber' | 'danger'> = {
  orcamento: 'orange',
  confirmada: 'teal',
  sinal_pago: 'amber',
  quitada: 'teal',
  cancelada: 'danger',
}
const statusLabel: Record<ReservationStatus, string> = {
  orcamento: 'Orçamento',
  confirmada: 'Confirmada',
  sinal_pago: 'Sinal pago',
  quitada: 'Quitada',
  cancelada: 'Cancelada',
}

interface PaymentRow {
  id: string
  valor: number
  data: string
  paymentMethod: string | null
  notes: string | null
}

function paymentMethodLabel(method: string | null) {
  if (!method) return '—'
  return (PAYMENT_METHOD_LABEL as Record<string, string>)[method] ?? method
}

const EVENT_TYPES = ['Aniversário infantil', 'Debutante', 'Casamento', 'Corporativo', 'Outro']

interface CostItem { id: string; description: string; amount: number }
interface ConsumptionItem { id: string; item: string; quantity: number; unitPrice: number }
interface ChecklistItem { id: string; description: string; done: boolean; dueDate: string | null }
interface StaffRow { id: string; name: string; role: string }
interface ContactEntry { id: string; type: string; created_at: string }

const CHECKLIST_TEMPLATE = [
  'Confirmar a lista de convidados',
  'Confirmar horário da festa',
  'Confirmar decoração',
  'Confirmar extras contratados',
  'Conferir pagamentos',
  'Conferir estoque necessário',
  'Conferir equipe escalada',
]

interface InventoryItemLite {
  id: string
  name: string
  quantity: number
  unitOfMeasure: string
}

interface StockConsumptionEntry {
  id: string
  itemName: string
  quantity: number
  hasInventoryLink: boolean
}

function currency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function formatHour(t: string) {
  const [h, m] = t.split(':')
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}

// Fornecedores sempre entregam 1h antes do início da festa.
function oneHourBefore(t: string) {
  const [h, m] = t.split(':').map(Number)
  const total = (h * 60 + m - 60 + 24 * 60) % (24 * 60)
  const hh = Math.floor(total / 60)
  const mm = total % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function FestaDetalhe() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session, can } = useAuth()
  const { scheduleDelete } = useUndo()

  const [festa, setFesta] = useState<FestaDetalhada | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [tab, setTab] = useState<'geral' | 'financeiro' | 'checklist' | 'equipe' | 'estoque'>('geral')

  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [costs, setCosts] = useState<CostItem[]>([])
  const [consumption, setConsumption] = useState<ConsumptionItem[]>([])
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [contactHistory, setContactHistory] = useState<ContactEntry[]>([])

  const [payValor, setPayValor] = useState('')
  const [payData, setPayData] = useState(() => new Date().toISOString().slice(0, 10))
  const [payMetodo, setPayMetodo] = useState<PaymentMethod>('pix')
  const [payMetodoOutro, setPayMetodoOutro] = useState('')
  const [payNotes, setPayNotes] = useState('')

  const [consumoItem, setConsumoItem] = useState('Chopp (litro)')
  const [consumoQtd, setConsumoQtd] = useState('1')
  const [consumoPreco, setConsumoPreco] = useState('25')
  const [custoDesc, setCustoDesc] = useState('')
  const [custoValor, setCustoValor] = useState('')
  const [custoObs, setCustoObs] = useState('')
  const [custoAviso, setCustoAviso] = useState<{ id: string; description: string | null; supplier: string | null; category: string; amount: number }[] | null>(null)
  const [staffName, setStaffName] = useState('')
  const [staffRole, setStaffRole] = useState('')

  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelFeePercent, setCancelFeePercent] = useState('20')

  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [contractId, setContractId] = useState<string | null>(null)
  const [nfeStatus, setNfeStatus] = useState<InvoiceStatus>('nao_emitida')
  const [nfeNumber, setNfeNumber] = useState('')

  const [documents, setDocuments] = useState<{ id: string; name: string; date: string; storagePath: string }[]>([])
  const [uploadingDoc, setUploadingDoc] = useState(false)

  const [unitPackages, setUnitPackages] = useState<PackageOption[]>([])
  const [showSwapPackage, setShowSwapPackage] = useState(false)
  const [swapPackageId, setSwapPackageId] = useState('')
  const [packageHistory, setPackageHistory] = useState<PackageHistoryEntry[]>([])

  const [unitInventoryItems, setUnitInventoryItems] = useState<InventoryItemLite[]>([])
  const [stockConsumption, setStockConsumption] = useState<StockConsumptionEntry[]>([])
  const [consumptionForm, setConsumptionForm] = useState<Record<string, string>>({})
  const [outroQtd, setOutroQtd] = useState('')
  const [outroDesc, setOutroDesc] = useState('')
  const [savingConsumption, setSavingConsumption] = useState(false)

  const [extraCatalog, setExtraCatalog] = useState<{ id: string; name: string; price: number }[]>([])
  const [festaExtras, setFestaExtras] = useState<FestaExtraItem[]>([])
  const [novoExtraId, setNovoExtraId] = useState('')
  const [novoExtraQtd, setNovoExtraQtd] = useState('1')

  const [guestListToken, setGuestListToken] = useState<string | null>(null)
  const [guestEntries, setGuestEntries] = useState<{ id: string; name: string; arrived: boolean }[]>([])
  const [manualGuestName, setManualGuestName] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  const [fornecedoresCopiado, setFornecedoresCopiado] = useState(false)
  const [fornecedoresMessage, setFornecedoresMessage] = useState<string | null>(null)
  const [fornecedoresTemplate, setFornecedoresTemplate] = useState<string>(MESSAGE_TEMPLATES.confirmar_fornecedores)
  const [observacaoFornecedores, setObservacaoFornecedores] = useState('')
  const [showEditFornecedoresTemplate, setShowEditFornecedoresTemplate] = useState(false)
  const [editingFornecedoresTemplate, setEditingFornecedoresTemplate] = useState('')
  const [savingFornecedoresTemplate, setSavingFornecedoresTemplate] = useState(false)
  const [generatingLink, setGeneratingLink] = useState(false)
  const [costSuggestions, setCostSuggestions] = useState<{ category: string; amount: number }[]>([])
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [showEditDados, setShowEditDados] = useState(false)
  const [editData, setEditData] = useState('')
  const [editInicio, setEditInicio] = useState('')
  const [editFim, setEditFim] = useState('')
  const [editTipoEvento, setEditTipoEvento] = useState('')
  const [editTipoEventoOutro, setEditTipoEventoOutro] = useState('')
  const [editConvidados, setEditConvidados] = useState('')
  const [editValorTotal, setEditValorTotal] = useState('')
  const [editDescontoTipo, setEditDescontoTipo] = useState<DiscountType | ''>('')
  const [editDescontoValor, setEditDescontoValor] = useState('')
  const [editCortesia, setEditCortesia] = useState('')
  const [savingEditDados, setSavingEditDados] = useState(false)
  const [birthdayKids, setBirthdayKids] = useState<{ id: string; name: string; age: number | null }[]>([])
  const [novoKidNome, setNovoKidNome] = useState('')
  const [novoKidIdade, setNovoKidIdade] = useState('')

  useEffect(() => {
    if (!id) return
    loadFesta()
    loadPayments()
    loadCosts()
    loadConsumption()
    loadChecklist()
    loadStaff()
    loadContract()
    loadExtraCatalog()
    loadFestaExtras()
    loadGuestList()
    loadDocuments()
    loadStockConsumption()
    loadPackageHistory()
    loadFornecedoresTemplate()
    loadBirthdayKids()
  }, [id])

  async function loadBirthdayKids() {
    const { data } = await supabase.from('reservation_birthday_kids').select('id, name, age').eq('reservation_id', id).order('created_at')
    setBirthdayKids((data ?? []).map((k) => ({ id: k.id, name: k.name, age: k.age })))
  }

  async function handleAddBirthdayKid(e: FormEvent) {
    e.preventDefault()
    if (!novoKidNome.trim()) return
    const { data } = await supabase
      .from('reservation_birthday_kids')
      .insert({ reservation_id: id, name: novoKidNome.trim(), age: novoKidIdade ? Number(novoKidIdade) : null })
      .select()
      .single()
    if (data) setBirthdayKids((prev) => [...prev, { id: data.id, name: data.name, age: data.age }])
    setNovoKidNome('')
    setNovoKidIdade('')
  }

  function handleRemoveBirthdayKid(kidId: string) {
    const kid = birthdayKids.find((k) => k.id === kidId)
    if (!kid) return
    setBirthdayKids((prev) => prev.filter((k) => k.id !== kidId))
    scheduleDelete({
      label: `"${kid.name}" removido dos aniversariantes`,
      commit: async () => {
        await supabase.from('reservation_birthday_kids').delete().eq('id', kidId)
      },
      undo: async () => {
        await supabase.from('reservation_birthday_kids').insert({ id: kidId, reservation_id: id, name: kid.name, age: kid.age })
        setBirthdayKids((prev) => [...prev, kid])
      },
    })
  }

  async function loadFornecedoresTemplate() {
    const { data } = await supabase.from('message_templates').select('body').eq('key', 'confirmar_fornecedores').maybeSingle()
    if (data?.body) setFornecedoresTemplate(data.body)
  }

  // Sugestões de custo a partir da ficha técnica do pacote (cadastrada em
  // Pacotes) — só preenchem o formulário abaixo, não lançam sozinhas: dá pra
  // ajustar o valor (pode ter saído diferente do padrão) e por observação.
  useEffect(() => {
    if (festa?.packageId) loadCostSuggestions(festa.packageId)
    else setCostSuggestions([])
  }, [festa?.packageId])

  async function loadCostSuggestions(packageId: string) {
    const { data } = await supabase.from('package_costs').select('category, amount').eq('package_id', packageId)
    setCostSuggestions((data ?? []).map((c) => ({ category: c.category, amount: Number(c.amount) })))
  }

  function handleUseCustoSugerido(category: string, amount: number) {
    setCustoDesc(category)
    setCustoValor(String(amount))
    setCustoAviso(null)
  }

  useEffect(() => {
    if (festa?.cliente) loadContactHistory(festa.cliente)
  }, [festa?.cliente])

  async function loadFesta() {
    setLoading(true)
    const { data, error } = await supabase
      .from('reservations')
      .select('*, client:clients(name, phone), unit:units(name, staff_whatsapp_group_link, google_review_link), package:packages(name)')
      .eq('id', id)
      .maybeSingle()

    if (error || !data) {
      setNotFound(true)
      setLoading(false)
      return
    }

    setFesta({
      id: data.id,
      unitId: data.unit_id,
      unidadeNome: data.unit?.name ?? '',
      unidadeWhatsappGroupLink: data.unit?.staff_whatsapp_group_link ?? null,
      googleReviewLink: data.unit?.google_review_link ?? null,
      cliente: data.client?.name ?? '—',
      clientPhone: data.client?.phone ?? null,
      data: format(parseISO(data.event_date), 'dd/MM/yyyy'),
      eventDateIso: data.event_date,
      horario: `${formatHour(String(data.start_time).slice(0, 5))}–${formatHour(String(data.end_time).slice(0, 5))}`,
      startTimeRaw: String(data.start_time).slice(0, 5),
      endTimeRaw: String(data.end_time).slice(0, 5),
      status: data.status,
      tipoEvento: data.event_type ?? 'Outro',
      convidados: data.guest_count ?? 0,
      valorTotal: Number(data.total_value) || 0,
      finalValue: Number(data.final_value) || Number(data.total_value) || 0,
      childName: data.child_name,
      childAge: data.child_age,
      theme: data.theme,
      hotDishFlavors: data.hot_dish_flavors,
      cakeFlavor: data.cake_flavor,
      courtesyGuests: data.courtesy_guests,
      discountType: data.discount_type,
      discountValue: data.discount_value !== null ? Number(data.discount_value) : null,
      packageId: data.package_id,
      packageName: data.package?.name ?? null,
      cancellationReason: data.cancellation_reason,
      cancellationFeePercent: data.cancellation_fee_percent !== null ? Number(data.cancellation_fee_percent) : null,
      refundAmount: data.refund_amount !== null ? Number(data.refund_amount) : null,
    })
    setLoading(false)

    if (data.unit_id) {
      const { data: pkgs } = await supabase
        .from('packages')
        .select('id, name, base_price, weekday_price, weekend_price, guest_limit')
        .eq('active', true)
        .or(`unit_id.is.null,unit_id.eq.${data.unit_id}`)
        .order('name')
      setUnitPackages(
        (pkgs ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          base_price: Number(p.base_price),
          weekday_price: p.weekday_price != null ? Number(p.weekday_price) : null,
          weekend_price: p.weekend_price != null ? Number(p.weekend_price) : null,
          guest_limit: p.guest_limit,
        })),
      )

      await loadUnitInventory(data.unit_id)
    }
  }

  async function loadUnitInventory(unitId: string) {
    const { data: inv } = await supabase
      .from('inventory_items')
      .select('id, name, quantity, unit_of_measure')
      .eq('unit_id', unitId)
      .order('name')
    setUnitInventoryItems(
      (inv ?? []).map((item) => ({ id: item.id, name: item.name, quantity: Number(item.quantity), unitOfMeasure: item.unit_of_measure })),
    )
  }

  async function loadExtraCatalog() {
    const { data } = await supabase.from('extra_items').select('id, name, price').order('name')
    setExtraCatalog((data ?? []).map((e) => ({ id: e.id, name: e.name, price: Number(e.price) })))
  }

  async function loadFestaExtras() {
    const { data } = await supabase
      .from('reservation_extra_items')
      .select('id, quantity, price_snapshot, extra_item_id, extra_item:extra_items(name)')
      .eq('reservation_id', id)
    setFestaExtras(
      (data ?? []).map((e: any) => ({
        id: e.id,
        extraItemId: e.extra_item_id,
        name: e.extra_item?.name ?? '—',
        quantity: Number(e.quantity),
        priceSnapshot: Number(e.price_snapshot),
      })),
    )
  }

  async function loadPackageHistory() {
    const { data } = await supabase
      .from('audit_log')
      .select('id, created_at, details, user:user_profiles(name)')
      .eq('entity', 'reservation')
      .eq('entity_id', id)
      .eq('action', 'alterou_pacote')
      .order('created_at', { ascending: false })
    setPackageHistory(
      (data ?? []).map((a: any) => ({
        id: a.id,
        createdAt: new Date(a.created_at).toLocaleString('pt-BR'),
        userName: a.user?.name ?? 'Alguém da equipe',
        oldPackageName: a.details?.old_package_name ?? '—',
        newPackageName: a.details?.new_package_name ?? '—',
        diff: Number(a.details?.diff ?? 0),
      })),
    )
  }

  async function loadGuestList() {
    const { data } = await supabase.from('guest_list_pages').select('token').eq('reservation_id', id).maybeSingle()
    if (data) {
      setGuestListToken(data.token)
      loadGuestEntries(data.token)
    }
  }

  async function loadGuestEntries(token: string) {
    const { data } = await supabase.from('guest_list_entries').select('id, name, arrived').eq('token', token).order('created_at')
    setGuestEntries((data ?? []).map((e) => ({ id: e.id, name: e.name, arrived: e.arrived })))
  }

  async function toggleGuestArrived(entryId: string, currentlyArrived: boolean) {
    const previous = guestEntries
    setGuestEntries((prev) => prev.map((g) => (g.id === entryId ? { ...g, arrived: !currentlyArrived } : g)))
    const { error } = await supabase
      .from('guest_list_entries')
      .update({ arrived: !currentlyArrived, arrived_at: !currentlyArrived ? new Date().toISOString() : null })
      .eq('id', entryId)
    if (error) {
      setGuestEntries(previous)
      setError('Não foi possível atualizar o check-in.')
    }
  }

  async function handleGenerateGuestLink() {
    if (!festa) return
    setGeneratingLink(true)
    const currentPackage = unitPackages.find((p) => p.id === festa.packageId)
    const { data, error } = await supabase
      .from('guest_list_pages')
      .insert({
        reservation_id: id,
        unit_name: festa.unidadeNome,
        event_date: festa.eventDateIso,
        theme: festa.theme,
        child_name: festa.childName,
        guest_limit: currentPackage?.guest_limit ?? null,
      })
      .select('token')
      .single()
    setGeneratingLink(false)
    if (error) {
      setError('Não foi possível gerar o link.')
      return
    }
    setGuestListToken(data.token)
  }

  function guestListUrl() {
    return guestListToken ? `${window.location.origin}/lista-convidados/${guestListToken}` : ''
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(guestListUrl())
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      // navegador sem permissão de clipboard — usuário pode selecionar e copiar manualmente
    }
  }

  function handleSendGuestLinkWhatsApp() {
    if (!festa) return
    const message = buildMessage(MESSAGE_TEMPLATES.lista_convidados, { cliente: festa.cliente, link: guestListUrl() })
    openWhatsApp(festa.clientPhone, message)
  }

  async function handleAddGuestManual(e: FormEvent) {
    e.preventDefault()
    if (!guestListToken || !manualGuestName.trim()) return
    const { data, error } = await supabase
      .from('guest_list_entries')
      .insert({ token: guestListToken, name: manualGuestName.trim() })
      .select()
      .single()
    if (error) {
      setError('Não foi possível adicionar o nome.')
      return
    }
    setGuestEntries((prev) => [...prev, { id: data.id, name: data.name, arrived: false }])
    setManualGuestName('')
  }

  function handleRemoveGuest(entryId: string) {
    const guest = guestEntries.find((g) => g.id === entryId)
    if (!guest) return
    setGuestEntries((prev) => prev.filter((g) => g.id !== entryId))
    scheduleDelete({
      label: `"${guest.name}" removido da lista de convidados`,
      commit: async () => {
        await supabase.from('guest_list_entries').delete().eq('id', entryId)
      },
      undo: async () => {
        await supabase.from('guest_list_entries').insert({ id: entryId, token: guestListToken, name: guest.name, arrived: guest.arrived })
        setGuestEntries((prev) => [...prev, guest])
      },
    })
  }

  async function loadPayments() {
    const { data } = await supabase.from('payments').select('*').eq('reservation_id', id).order('payment_date')
    setPayments(
      (data ?? []).map((p) => ({
        id: p.id,
        valor: Number(p.amount),
        data: format(parseISO(p.payment_date), 'dd/MM/yyyy'),
        paymentMethod: p.payment_method,
        notes: p.notes,
      })),
    )
  }

  async function loadCosts() {
    const { data } = await supabase.from('reservation_costs').select('*').eq('reservation_id', id)
    setCosts((data ?? []).map((c) => ({ id: c.id, description: c.description, amount: Number(c.amount) })))
  }

  async function loadConsumption() {
    const { data } = await supabase.from('reservation_consumption').select('*').eq('reservation_id', id)
    setConsumption((data ?? []).map((c) => ({ id: c.id, item: c.item, quantity: Number(c.quantity), unitPrice: Number(c.unit_price) })))
  }

  async function loadChecklist() {
    // Só cria a lista padrão se ela realmente ainda não existir — nunca
    // mexe numa lista que já existe, pra não sobrescrever o que já foi marcado.
    const { data: existing } = await supabase.from('checklist_items').select('*').eq('reservation_id', id).order('description')
    if (existing && existing.length > 0) {
      setChecklist(existing.map((c) => ({ id: c.id, description: c.description, done: c.done, dueDate: c.due_date })))
      return
    }

    const { data: reservationData } = await supabase.from('reservations').select('event_date').eq('id', id).maybeSingle()
    const defaultDueDate = reservationData ? subDays(parseISO(reservationData.event_date), 7).toISOString().slice(0, 10) : null

    const rows = CHECKLIST_TEMPLATE.map((description) => ({ reservation_id: id, description, done: false, due_date: defaultDueDate }))
    const { data: inserted, error: insertError } = await supabase.from('checklist_items').insert(rows).select()

    if (insertError) {
      // Provavelmente a lista já foi criada nesse exato instante (ex: dois
      // carregamentos ao mesmo tempo) — busca de novo em vez de duplicar.
      const { data: retry } = await supabase.from('checklist_items').select('*').eq('reservation_id', id).order('description')
      setChecklist((retry ?? []).map((c) => ({ id: c.id, description: c.description, done: c.done, dueDate: c.due_date })))
      return
    }

    setChecklist((inserted ?? []).map((c) => ({ id: c.id, description: c.description, done: c.done, dueDate: c.due_date })))
  }

  async function loadStaff() {
    const { data } = await supabase.from('staff_assignments').select('*').eq('reservation_id', id)
    setStaff((data ?? []).map((s) => ({ id: s.id, name: s.staff_name, role: s.role ?? 'Equipe' })))
  }

  async function loadContract() {
    const { data } = await supabase.from('contracts').select('id, nfe_number, nfe_status').eq('reservation_id', id).maybeSingle()
    if (data) {
      setContractId(data.id)
      setNfeStatus((data.nfe_status as InvoiceStatus) ?? 'nao_emitida')
      setNfeNumber(data.nfe_number ?? '')
    }
  }

  async function loadContactHistory(clientName: string) {
    const { data } = await supabase
      .from('contact_history')
      .select('id, type, created_at')
      .eq('client_name', clientName)
      .order('created_at', { ascending: false })
      .limit(10)
    setContactHistory(data ?? [])
  }

  const dueDate = festa ? subDays(parseISO(festa.eventDateIso), 7) : null

  const totalPago = payments.reduce((s, p) => s + p.valor, 0)
  const totalConsumo = consumption.reduce((s, c) => s + c.quantity * c.unitPrice, 0)
  const totalExtrasFesta = festaExtras.reduce((s, e) => s + e.quantity * e.priceSnapshot, 0)
  const totalContrato = (festa?.finalValue ?? 0) + totalConsumo + totalExtrasFesta
  const saldoDevedor = totalContrato - totalPago

  const totalCustos = costs.reduce((s, c) => s + c.amount, 0)
  const lucroEstimado = totalContrato - totalCustos

  const checklistConcluidos = checklist.filter((c) => c.done).length
  const checklistAtrasados = checklist.filter((c) => {
    if (c.done) return false
    const itemDue = c.dueDate ? parseISO(c.dueDate) : dueDate
    return itemDue && isPast(itemDue)
  }).length

  const pendencias = useMemo(() => {
    let n = 0
    if (saldoDevedor > 0.005 && dueDate && isPast(dueDate)) n++
    if (checklistAtrasados > 0) n++
    if (checklist.length > 0 && checklistConcluidos < checklist.length) n++
    return n
  }, [saldoDevedor, dueDate, checklistAtrasados, checklist, checklistConcluidos])

  if (loading) {
    return <p className="text-sm text-muted py-10 text-center">Carregando festa...</p>
  }

  if (notFound || !festa) {
    return (
      <div className="space-y-4">
        <button onClick={() => navigate('/reservas')} className="flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft className="w-4 h-4" /> Voltar para o mapa de reservas
        </button>
        <Card>
          <p className="text-sm text-muted">Não encontrei essa festa — o link pode estar errado ou ela foi excluída.</p>
        </Card>
      </div>
    )
  }

  async function handleWhatsAppAction(templateKey: MessageTemplateKey) {
    if (!festa) return
    const message = buildMessage(MESSAGE_TEMPLATES[templateKey], {
      cliente: festa.cliente,
      data: festa.data,
      horario: festa.horario,
      unidade: festa.unidadeNome,
      valor: currency(totalContrato),
    })
    openWhatsApp(festa.clientPhone, message)
    await supabase.from('contact_history').insert({ client_name: festa.cliente, type: MESSAGE_TEMPLATE_LABEL[templateKey], channel: 'whatsapp', user_name: 'Você' })
    loadContactHistory(festa.cliente)
  }

  function handleConfirmarFornecedores() {
    if (!festa) return
    const message = buildMessage(fornecedoresTemplate, {
      unidade: festa.unidadeNome,
      horario_entrega: formatHour(oneHourBefore(festa.startTimeRaw)),
      tema: festa.theme || 'a definir',
      aniversariante_idade: `${festa.childName || 'Aniversariante a definir'} completando ${festa.childAge != null ? festa.childAge : '—'} anos`,
      observacao: observacaoFornecedores.trim() || 'Nenhuma',
    })
    setFornecedoresMessage(message)
  }

  async function handleCopyFornecedoresMessage() {
    if (!fornecedoresMessage) return
    try {
      await navigator.clipboard.writeText(fornecedoresMessage)
    } catch {
      // navegador bloqueou a cópia automática — a pessoa ainda consegue
      // selecionar o texto na caixa e copiar manualmente (Ctrl+C)
    }
    setFornecedoresCopiado(true)
    setTimeout(() => setFornecedoresCopiado(false), 3000)
  }

  async function handleAbrirGrupoFornecedores() {
    if (!festa || !festa.unidadeWhatsappGroupLink) return
    window.open(festa.unidadeWhatsappGroupLink, '_blank')
    setFornecedoresMessage(null)
    setFornecedoresCopiado(false)
    setObservacaoFornecedores('')
    await supabase.from('contact_history').insert({ client_name: festa.cliente, type: 'Confirmação com fornecedores', channel: 'whatsapp', user_name: 'Você' })
    loadContactHistory(festa.cliente)
  }

  async function handleSaveFornecedoresTemplate() {
    if (!editingFornecedoresTemplate.trim()) return
    setSavingFornecedoresTemplate(true)
    const { error } = await supabase
      .from('message_templates')
      .upsert({ key: 'confirmar_fornecedores', body: editingFornecedoresTemplate, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    setSavingFornecedoresTemplate(false)
    if (error) {
      setError('Não foi possível salvar a mensagem padrão.')
      return
    }
    setFornecedoresTemplate(editingFornecedoresTemplate)
    setShowEditFornecedoresTemplate(false)
  }

  async function loadDocuments() {
    const { data } = await supabase.from('reservation_documents').select('*').eq('reservation_id', id).order('uploaded_at', { ascending: false })
    setDocuments(
      (data ?? []).map((d) => ({
        id: d.id,
        name: d.file_name,
        date: new Date(d.uploaded_at).toLocaleDateString('pt-BR'),
        storagePath: d.storage_path,
      })),
    )
  }

  async function handleUploadDoc(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    setUploadingDoc(true)
    const path = `${id}/${Date.now()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from('festa-documentos').upload(path, file)
    if (uploadError) {
      setUploadingDoc(false)
      setError('Não foi possível enviar o arquivo.')
      return
    }

    const { data, error } = await supabase
      .from('reservation_documents')
      .insert({ reservation_id: id, file_name: file.name, storage_path: path })
      .select()
      .single()
    setUploadingDoc(false)

    if (error) {
      setError('O arquivo foi enviado, mas não foi possível salvar o registro dele.')
      return
    }

    setDocuments((prev) => [{ id: data.id, name: data.file_name, date: new Date(data.uploaded_at).toLocaleDateString('pt-BR'), storagePath: data.storage_path }, ...prev])
  }

  async function handleViewDoc(doc: { storagePath: string }) {
    const { data, error } = await supabase.storage.from('festa-documentos').createSignedUrl(doc.storagePath, 60)
    if (error || !data) {
      setError('Não foi possível abrir o arquivo.')
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  function handleRemoveDoc(doc: { id: string; storagePath: string }) {
    const fullDoc = documents.find((d) => d.id === doc.id)
    if (!fullDoc) return
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id))
    // O arquivo em si (Storage) só é apagado de verdade depois da janela de
    // desfazer — apagar o arquivo na hora junto com a linha impediria de
    // restaurar de verdade (não temos como reenviar os bytes no "Desfazer").
    setTimeout(() => {
      supabase.storage.from('festa-documentos').remove([doc.storagePath])
    }, 6000)
    scheduleDelete({
      label: `Arquivo "${fullDoc.name}" removido`,
      commit: async () => {
        await supabase.from('reservation_documents').delete().eq('id', doc.id)
      },
      undo: async () => {
        await supabase.from('reservation_documents').insert({ id: doc.id, reservation_id: id, file_name: fullDoc.name, storage_path: doc.storagePath })
        setDocuments((prev) => [fullDoc, ...prev])
      },
    })
  }

  async function loadStockConsumption() {
    const { data } = await supabase
      .from('reservation_stock_consumption')
      .select('id, item_name, quantity, inventory_item_id')
      .eq('reservation_id', id)
      .order('created_at', { ascending: false })
    setStockConsumption(
      (data ?? []).map((c) => ({ id: c.id, itemName: c.item_name, quantity: Number(c.quantity), hasInventoryLink: c.inventory_item_id !== null })),
    )
  }

  async function handleSaveConsumption(e: FormEvent) {
    e.preventDefault()
    setSavingConsumption(true)
    setError(null)

    const calls: any[] = []
    for (const item of unitInventoryItems) {
      const qty = Number(consumptionForm[item.id])
      if (!qty) continue
      calls.push(
        supabase.rpc('record_stock_consumption', {
          p_reservation_id: id,
          p_inventory_item_id: item.id,
          p_item_name: item.name,
          p_quantity: qty,
        }),
      )
    }
    const outroQtdNum = Number(outroQtd)
    if (outroQtdNum && outroDesc.trim()) {
      calls.push(
        supabase.rpc('record_stock_consumption', {
          p_reservation_id: id,
          p_inventory_item_id: null,
          p_item_name: `Outro — ${outroDesc.trim()}`,
          p_quantity: outroQtdNum,
        }),
      )
    }

    if (calls.length === 0) {
      setSavingConsumption(false)
      return
    }

    const results = await Promise.all(calls)
    setSavingConsumption(false)

    if (results.some((r) => r.error)) {
      setError('Não foi possível salvar todo o consumo — confira e tente de novo.')
    }

    setConsumptionForm({})
    setOutroQtd('')
    setOutroDesc('')
    await loadStockConsumption()
    if (festa) await loadUnitInventory(festa.unitId)
  }

  async function handleUndoConsumption(entryId: string) {
    const previous = stockConsumption
    setStockConsumption((prev) => prev.filter((c) => c.id !== entryId))
    const { error } = await supabase.rpc('undo_stock_consumption', { p_id: entryId })
    if (error) {
      setStockConsumption(previous)
      setError('Não foi possível desfazer esse lançamento.')
      return
    }
    if (festa) await loadUnitInventory(festa.unitId)
  }

  async function handleConfirmCancel(e: FormEvent) {
    e.preventDefault()
    const feePercent = Math.min(100, Math.max(0, Number(cancelFeePercent) || 0))
    const refund = Math.round(totalPago * (1 - feePercent / 100) * 100) / 100

    const { error } = await supabase
      .from('reservations')
      .update({
        status: 'cancelada',
        cancellation_reason: cancelReason.trim() || null,
        cancellation_fee_percent: feePercent,
        refund_amount: refund,
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) {
      setError('Não foi possível cancelar a festa.')
      return
    }

    setFesta((prev) => (prev ? { ...prev, status: 'cancelada', cancellationReason: cancelReason.trim() || null, cancellationFeePercent: feePercent, refundAmount: refund } : prev))
    setShowCancelModal(false)
  }

  async function toggleChecklistItem(itemId: string, currentlyDone: boolean) {
    setChecklist((prev) => prev.map((c) => (c.id === itemId ? { ...c, done: !currentlyDone } : c)))
    const { error } = await supabase.from('checklist_items').update({ done: !currentlyDone }).eq('id', itemId)
    if (error) {
      setChecklist((prev) => prev.map((c) => (c.id === itemId ? { ...c, done: currentlyDone } : c)))
      setError('Não foi possível salvar o checklist.')
    }
  }

  async function updateChecklistDueDate(itemId: string, newDueDate: string) {
    const previous = checklist
    setChecklist((prev) => prev.map((c) => (c.id === itemId ? { ...c, dueDate: newDueDate || null } : c)))
    const { error } = await supabase.from('checklist_items').update({ due_date: newDueDate || null }).eq('id', itemId)
    if (error) {
      setChecklist(previous)
      setError('Não foi possível salvar a data do checklist.')
    }
  }

  async function handleSwapPackage() {
    if (!festa || !swapPackageId) return
    const newPackage = unitPackages.find((p) => p.id === swapPackageId)
    if (!newPackage) return

    const oldPackage = unitPackages.find((p) => p.id === festa.packageId)
    const oldPrice = oldPackage ? packagePriceForDate(oldPackage, festa.eventDateIso) : 0
    const newPrice = packagePriceForDate(newPackage, festa.eventDateIso)
    const diff = newPrice - oldPrice

    const newTotalValue = Math.round((festa.valorTotal + diff) * 100) / 100
    let newFinalValue = newTotalValue
    if (festa.discountType === 'percentual') newFinalValue = newTotalValue * (1 - (festa.discountValue ?? 0) / 100)
    else if (festa.discountType === 'valor_fixo') newFinalValue = newTotalValue - (festa.discountValue ?? 0)
    newFinalValue = Math.round(newFinalValue * 100) / 100
    const newGuestCount = newPackage.guest_limit ?? festa.convidados

    const { error } = await supabase
      .from('reservations')
      .update({ package_id: newPackage.id, total_value: newTotalValue, final_value: newFinalValue, guest_count: newGuestCount })
      .eq('id', id)

    if (error) {
      setError('Não foi possível trocar o pacote.')
      return
    }

    setFesta((prev) =>
      prev
        ? { ...prev, packageId: newPackage.id, packageName: newPackage.name, valorTotal: newTotalValue, finalValue: newFinalValue, convidados: newGuestCount }
        : prev,
    )
    setShowSwapPackage(false)
    setSwapPackageId('')

    const { data: logEntry } = await supabase
      .from('audit_log')
      .insert({
        user_id: session?.user?.id ?? null,
        action: 'alterou_pacote',
        entity: 'reservation',
        entity_id: id,
        details: {
          old_package_name: oldPackage?.name ?? 'Sem pacote definido',
          new_package_name: newPackage.name,
          diff: Math.round(diff * 100) / 100,
        },
      })
      .select('id, created_at')
      .single()

    if (logEntry) {
      setPackageHistory((prev) => [
        {
          id: logEntry.id,
          createdAt: new Date(logEntry.created_at).toLocaleString('pt-BR'),
          userName: session?.user?.email ?? 'Você',
          oldPackageName: oldPackage?.name ?? 'Sem pacote definido',
          newPackageName: newPackage.name,
          diff: Math.round(diff * 100) / 100,
        },
        ...prev,
      ])
    }
  }

  async function handleAddExtraFesta(e: FormEvent) {
    e.preventDefault()
    const extra = extraCatalog.find((x) => x.id === novoExtraId)
    const qtd = Number(novoExtraQtd)
    if (!extra || !qtd) return
    const { data, error } = await supabase
      .from('reservation_extra_items')
      .insert({ reservation_id: id, extra_item_id: extra.id, quantity: qtd, price_snapshot: extra.price })
      .select()
      .single()
    if (error) {
      setError('Não foi possível adicionar o item extra.')
      return
    }
    setFestaExtras((prev) => [...prev, { id: data.id, extraItemId: extra.id, name: extra.name, quantity: qtd, priceSnapshot: extra.price }])
    setNovoExtraQtd('1')
  }

  function handleRemoveExtraFesta(rowId: string) {
    const extra = festaExtras.find((e) => e.id === rowId)
    if (!extra) return
    setFestaExtras((prev) => prev.filter((e) => e.id !== rowId))
    scheduleDelete({
      label: `Item extra "${extra.name}" removido`,
      commit: async () => {
        await supabase.from('reservation_extra_items').delete().eq('id', rowId)
      },
      undo: async () => {
        await supabase.from('reservation_extra_items').insert({
          id: rowId,
          reservation_id: id,
          extra_item_id: extra.extraItemId,
          quantity: extra.quantity,
          price_snapshot: extra.priceSnapshot,
        })
        setFestaExtras((prev) => [...prev, extra])
      },
    })
  }

  function handleExportEscala() {
    if (!festa) return
    const win = window.open('', '_blank', 'width=800,height=900')
    if (!win) return
    const rows = staff.length
      ? staff.map((s) => `<tr><td>${s.name}</td><td>${s.role}</td></tr>`).join('')
      : '<tr><td colspan="2">Nenhum funcionário escalado ainda.</td></tr>'
    win.document.write(`
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <title>Escala — ${festa.cliente}</title>
          <style>
            body { font-family: Arial, Helvetica, sans-serif; color: #241B33; padding: 32px; }
            h1 { color: #6D28D9; font-size: 18px; margin-bottom: 4px; }
            p.subtitle { color: #6E6880; margin-top: 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #E2DBEE; font-size: 14px; }
          </style>
        </head>
        <body>
          <h1>${festa.unidadeNome} — ${festa.tipoEvento} de ${festa.cliente}</h1>
          <p class="subtitle">${festa.data} · ${festa.horario}</p>
          <table>
            <thead><tr><th>Nome</th><th>Função</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>
    `)
    win.document.close()
    win.focus()
    // Pequeno atraso pra dar tempo do navegador terminar de desenhar a página
    // antes de abrir a caixa de impressão — senão alguns navegadores abrem a
    // caixa com a página ainda em branco, o que impede de "Salvar como PDF".
    setTimeout(() => win.print(), 300)
  }

  function openEditDados() {
    if (!festa) return
    setEditData(festa.eventDateIso)
    setEditInicio(festa.startTimeRaw)
    setEditFim(festa.endTimeRaw)
    const isCustomType = !EVENT_TYPES.includes(festa.tipoEvento)
    setEditTipoEvento(isCustomType ? 'Outro' : festa.tipoEvento)
    setEditTipoEventoOutro(isCustomType ? festa.tipoEvento : '')
    setEditConvidados(String(festa.convidados))
    setEditValorTotal(String(festa.valorTotal))
    setEditDescontoTipo(festa.discountType ?? '')
    setEditDescontoValor(festa.discountValue != null ? String(festa.discountValue) : '')
    setEditCortesia(festa.courtesyGuests != null ? String(festa.courtesyGuests) : '')
    setShowEditDados(true)
  }

  async function handleSaveEditDados(e: FormEvent) {
    e.preventDefault()
    if (!festa) return

    if (editData !== festa.eventDateIso) {
      const { data: conflitos } = await supabase
        .from('reservations')
        .select('id')
        .eq('unit_id', festa.unitId)
        .eq('event_date', editData)
        .neq('status', 'cancelada')
        .neq('id', festa.id)
        .limit(1)
      if ((conflitos ?? []).length > 0) {
        setError('Já existe uma festa não cancelada nesta data, nesta unidade. Só é possível ter duas festas no mesmo dia se uma delas estiver cancelada.')
        return
      }
    }

    const totalValue = Number(editValorTotal) || 0
    const descontoValor = Number(editDescontoValor) || 0
    let finalValue = totalValue
    if (editDescontoTipo === 'percentual') finalValue = totalValue * (1 - descontoValor / 100)
    else if (editDescontoTipo === 'valor_fixo') finalValue = totalValue - descontoValor
    const eventType = editTipoEvento === 'Outro' ? editTipoEventoOutro.trim() || 'Outro' : editTipoEvento

    setSavingEditDados(true)
    const { error } = await supabase
      .from('reservations')
      .update({
        event_date: editData,
        start_time: editInicio,
        end_time: editFim,
        event_type: eventType,
        guest_count: Number(editConvidados) || 0,
        total_value: totalValue,
        discount_type: editDescontoTipo || null,
        discount_value: editDescontoTipo ? descontoValor : null,
        final_value: Math.round(finalValue * 100) / 100,
        courtesy_guests: editCortesia ? Number(editCortesia) : null,
      })
      .eq('id', festa.id)
    setSavingEditDados(false)

    if (error) {
      setError('Não foi possível salvar as alterações.')
      return
    }

    setShowEditDados(false)
    await loadFesta()
  }

  function handleDeleteFesta() {
    setShowDeleteModal(false)
    const festaId = id
    const clienteNome = festa?.cliente ?? ''
    scheduleDelete({
      label: `Festa de "${clienteNome}" removida`,
      irreversible: true,
      commit: async () => {
        await supabase.from('reservations').delete().eq('id', festaId)
      },
      undo: () => navigate(`/reservas/${festaId}`),
    })
    navigate('/reservas')
  }

  async function handleAddConsumo(e: FormEvent) {
    e.preventDefault()
    const qtd = Number(consumoQtd)
    const preco = Number(consumoPreco)
    if (!consumoItem.trim() || !qtd || !preco) return
    const { data } = await supabase
      .from('reservation_consumption')
      .insert({ reservation_id: id, item: consumoItem.trim(), quantity: qtd, unit_price: preco })
      .select()
      .single()
    if (data) setConsumption((prev) => [...prev, { id: data.id, item: data.item, quantity: Number(data.quantity), unitPrice: Number(data.unit_price) }])
    setConsumoQtd('1')
  }

  function handleRemoveConsumo(itemId: string) {
    const consumo = consumption.find((c) => c.id === itemId)
    if (!consumo) return
    setConsumption((prev) => prev.filter((c) => c.id !== itemId))
    scheduleDelete({
      label: `"${consumo.item}" removido do consumo`,
      commit: async () => {
        await supabase.from('reservation_consumption').delete().eq('id', itemId)
      },
      undo: async () => {
        await supabase.from('reservation_consumption').insert({ id: itemId, reservation_id: id, item: consumo.item, quantity: consumo.quantity, unit_price: consumo.unitPrice })
        setConsumption((prev) => [...prev, consumo])
      },
    })
  }

  // Antes de lançar, confere se já não existe uma despesa geral parecida
  // (mesmo valor, ou descrição/fornecedor parecido) lançada em Financeiro no
  // mês da festa — pra evitar contar a mesma compra duas vezes no resultado.
  // Se achar algo parecido, só avisa na primeira tentativa; clicando
  // "Lançar" de novo, lança mesmo assim.
  async function checkCustoDuplicado(): Promise<typeof custoAviso> {
    if (!festa) return null
    const valor = Number(custoValor)
    const descLower = custoDesc.trim().toLowerCase()
    const { startIso, endIso } = monthBounds(festa.eventDateIso.slice(0, 7))
    const { data } = await supabase
      .from('expenses')
      .select('id, description, supplier, category, amount')
      .eq('unit_id', festa.unitId)
      .gte('due_date', startIso)
      .lt('due_date', endIso)

    const matches = (data ?? []).filter((e) => {
      const amountMatch = Math.abs(Number(e.amount) - valor) < 0.01
      const textFields = [e.description, e.supplier, e.category].filter(Boolean).map((t) => String(t).toLowerCase())
      const textMatch = descLower.length > 2 && textFields.some((t) => t.includes(descLower) || descLower.includes(t))
      return amountMatch || textMatch
    })

    return matches.length > 0 ? matches.map((m) => ({ id: m.id, description: m.description, supplier: m.supplier, category: m.category, amount: Number(m.amount) })) : null
  }

  async function handleAddCusto(e: FormEvent) {
    e.preventDefault()
    const valor = Number(custoValor)
    if (!custoDesc.trim() || !valor) return

    if (!custoAviso) {
      const aviso = await checkCustoDuplicado()
      if (aviso) {
        setCustoAviso(aviso)
        return
      }
    }

    const descricaoFinal = custoObs.trim() ? `${custoDesc.trim()} — ${custoObs.trim()}` : custoDesc.trim()
    const { data } = await supabase
      .from('reservation_costs')
      .insert({ reservation_id: id, description: descricaoFinal, amount: valor })
      .select()
      .single()
    if (data) setCosts((prev) => [...prev, { id: data.id, description: data.description, amount: Number(data.amount) }])
    setCustoDesc('')
    setCustoValor('')
    setCustoObs('')
    setCustoAviso(null)
  }

  function handleRemoveCusto(itemId: string) {
    const cost = costs.find((c) => c.id === itemId)
    if (!cost) return
    setCosts((prev) => prev.filter((c) => c.id !== itemId))
    scheduleDelete({
      label: `Custo "${cost.description}" removido`,
      commit: async () => {
        await supabase.from('reservation_costs').delete().eq('id', itemId)
      },
      undo: async () => {
        await supabase.from('reservation_costs').insert({ id: itemId, reservation_id: id, description: cost.description, amount: cost.amount })
        setCosts((prev) => [...prev, cost])
      },
    })
  }

  async function updateTema(newTema: string) {
    const previous = festa?.theme ?? null
    const value = newTema.trim() || null
    setFesta((prev) => (prev ? { ...prev, theme: value } : prev))
    const { error } = await supabase.from('reservations').update({ theme: value }).eq('id', id)
    if (error) {
      setFesta((prev) => (prev ? { ...prev, theme: previous } : prev))
      setError('Não foi possível salvar o tema.')
    }
  }

  async function updateHotDishFlavors(newValue: string) {
    const previous = festa?.hotDishFlavors ?? null
    const value = newValue.trim() || null
    setFesta((prev) => (prev ? { ...prev, hotDishFlavors: value } : prev))
    const { error } = await supabase.from('reservations').update({ hot_dish_flavors: value }).eq('id', id)
    if (error) {
      setFesta((prev) => (prev ? { ...prev, hotDishFlavors: previous } : prev))
      setError('Não foi possível salvar os sabores do prato quente.')
    }
  }

  async function updateCakeFlavor(newValue: string) {
    const previous = festa?.cakeFlavor ?? null
    const value = newValue.trim() || null
    setFesta((prev) => (prev ? { ...prev, cakeFlavor: value } : prev))
    const { error } = await supabase.from('reservations').update({ cake_flavor: value }).eq('id', id)
    if (error) {
      setFesta((prev) => (prev ? { ...prev, cakeFlavor: previous } : prev))
      setError('Não foi possível salvar o sabor do bolo.')
    }
  }

  async function handleAddStaff(e: FormEvent) {
    e.preventDefault()
    if (!staffName.trim()) return
    const { data } = await supabase
      .from('staff_assignments')
      .insert({ reservation_id: id, staff_name: staffName.trim(), role: staffRole.trim() || 'Equipe' })
      .select()
      .single()
    if (data) setStaff((prev) => [...prev, { id: data.id, name: data.staff_name, role: data.role ?? 'Equipe' }])
    setStaffName('')
    setStaffRole('')
  }

  function handleRemoveStaff(staffId: string) {
    const member = staff.find((s) => s.id === staffId)
    if (!member) return
    setStaff((prev) => prev.filter((s) => s.id !== staffId))
    scheduleDelete({
      label: `"${member.name}" removido da equipe`,
      commit: async () => {
        await supabase.from('staff_assignments').delete().eq('id', staffId)
      },
      undo: async () => {
        await supabase.from('staff_assignments').insert({ id: staffId, reservation_id: id, staff_name: member.name, role: member.role })
        setStaff((prev) => [...prev, member])
      },
    })
  }

  async function handleAddPayment(e: FormEvent) {
    e.preventDefault()
    const valor = Number(payValor)
    if (!valor) return
    const metodo = payMetodo === 'outro' ? payMetodoOutro.trim() || 'Outro' : payMetodo
    const { data, error } = await supabase
      .from('payments')
      .insert({ reservation_id: id, amount: valor, payment_date: payData, payment_method: metodo, notes: payNotes.trim() || null })
      .select()
      .single()
    if (error) {
      setError('Não foi possível registrar o pagamento.')
      return
    }
    if (data) {
      setPayments((prev) => [
        ...prev,
        { id: data.id, valor: Number(data.amount), data: format(parseISO(data.payment_date), 'dd/MM/yyyy'), paymentMethod: data.payment_method, notes: data.notes },
      ])
    }
    setPayValor('')
    setPayMetodoOutro('')
    setPayNotes('')
  }

  function handleRemovePayment(paymentId: string) {
    const payment = payments.find((p) => p.id === paymentId)
    if (!payment) return
    setPayments((prev) => prev.filter((p) => p.id !== paymentId))
    scheduleDelete({
      label: `Pagamento de ${payment.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} removido`,
      commit: async () => {
        await supabase.from('payments').delete().eq('id', paymentId)
      },
      undo: async () => {
        const [d, m, y] = payment.data.split('/')
        await supabase.from('payments').insert({
          id: paymentId,
          reservation_id: id,
          amount: payment.valor,
          payment_date: `${y}-${m}-${d}`,
          payment_method: payment.paymentMethod,
          notes: payment.notes,
        })
        setPayments((prev) => [...prev, payment])
      },
    })
  }

  async function saveNfe(newStatus: InvoiceStatus, newNumber: string) {
    if (contractId) {
      await supabase.from('contracts').update({ nfe_status: newStatus, nfe_number: newNumber || null }).eq('id', contractId)
    } else {
      const { data } = await supabase
        .from('contracts')
        .insert({ reservation_id: id, nfe_status: newStatus, nfe_number: newNumber || null })
        .select('id')
        .single()
      if (data) setContractId(data.id)
    }
  }

  return (
    <div className="space-y-6">
      <button onClick={() => navigate('/reservas')} className="flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="w-4 h-4" /> Voltar para o mapa de reservas
      </button>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{festa.tipoEvento} — {festa.cliente}</h1>
          <p className="text-sm text-muted mt-1">
            {festa.data} · {festa.horario} · {festa.unidadeNome} · {festa.convidados} convidados
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={statusTone[festa.status]}>{statusLabel[festa.status]}</Badge>
          <Can permission="action:festa.editar_dados">
            <button onClick={openEditDados} className="text-muted hover:text-purple" aria-label="Editar dados da festa" title="Editar dados da festa">
              <Pencil className="w-4 h-4" />
            </button>
          </Can>
          {festa.status !== 'cancelada' && (
            <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => setShowCancelModal(true)}>
              <Ban className="w-3.5 h-3.5" /> Cancelar festa
            </Button>
          )}
          <Can permission="action:festa.excluir_festa">
            <Button variant="secondary" className="text-xs px-3 py-1.5 !text-danger" onClick={() => setShowDeleteModal(true)}>
              <Trash2 className="w-3.5 h-3.5" /> Excluir festa
            </Button>
          </Can>
        </div>
      </div>

      {festa.status === 'cancelada' && festa.cancellationReason !== null && (
        <Card className="border-danger">
          <p className="text-sm font-medium text-danger">Festa cancelada</p>
          <p className="text-xs text-muted mt-1">
            Motivo: {festa.cancellationReason} · Multa retida: {festa.cancellationFeePercent}% · Valor devolvido ao cliente: {currency(festa.refundAmount ?? 0)}
          </p>
        </Card>
      )}

      <Card className={pendencias > 0 ? 'border-amber' : 'border-teal'}>
        <div className="flex items-center gap-2 text-sm">
          {pendencias > 0 ? <AlertTriangle className="w-4 h-4 text-amber" /> : <CheckCircle2 className="w-4 h-4 text-teal" />}
          <span className="font-medium">
            {pendencias === 0 ? 'Tudo em dia com esta festa' : `${pendencias} pendência${pendencias > 1 ? 's' : ''} nesta festa`}
          </span>
          {saldoDevedor > 0.005 && dueDate && isPast(dueDate) && <Badge tone="danger">Saldo em aberto perto da festa</Badge>}
          {checklistAtrasados > 0 && <Badge tone="amber">{checklistAtrasados} tarefa(s) atrasada(s)</Badge>}
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <p className="text-xs text-muted">Valor total (contrato + consumo)</p>
          <p className="text-xl font-display font-semibold mt-1">{currency(totalContrato)}</p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Pago</p>
          <p className="text-xl font-display font-semibold mt-1 text-teal">{currency(totalPago)}</p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Saldo devedor</p>
          <p className="text-xl font-display font-semibold mt-1 text-danger">{currency(saldoDevedor)}</p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Aniversariante{birthdayKids.length > 0 ? 's' : ''}</p>
          <p className="text-lg font-display font-semibold mt-1">{festa.childName ? `${festa.childName}${festa.childAge != null ? ` (${festa.childAge})` : ''}` : '—'}</p>
          {birthdayKids.map((k) => (
            <div key={k.id} className="flex items-center justify-between gap-2 mt-0.5">
              <p className="text-sm text-muted">{k.name}{k.age != null ? ` (${k.age})` : ''}</p>
              <Can permission="action:festa.editar_dados">
                <button onClick={() => handleRemoveBirthdayKid(k.id)} className="text-muted hover:text-danger shrink-0" aria-label="Remover aniversariante">
                  <Trash2 className="w-3 h-3" />
                </button>
              </Can>
            </div>
          ))}
          <Can permission="action:festa.editar_dados">
            <form onSubmit={handleAddBirthdayKid} className="flex gap-1.5 mt-2">
              <input
                value={novoKidNome}
                onChange={(e) => setNovoKidNome(e.target.value)}
                placeholder="Outro aniversariante"
                className="flex-1 min-w-0 border border-line rounded-lg px-2 py-1 text-xs"
              />
              <input
                type="number"
                min={0}
                value={novoKidIdade}
                onChange={(e) => setNovoKidIdade(e.target.value)}
                placeholder="Idade"
                className="w-14 border border-line rounded-lg px-2 py-1 text-xs"
              />
              <button type="submit" className="text-purple shrink-0"><Plus className="w-4 h-4" /></button>
            </form>
          </Can>
        </Card>
      </div>

      <div className="flex gap-2 flex-wrap text-sm">
        {[
          { id: 'geral', label: 'Visão geral' },
          { id: 'financeiro', label: 'Financeiro' },
          { id: 'checklist', label: `Checklist (${checklistConcluidos}/${checklist.length})` },
          { id: 'equipe', label: 'Equipe' },
          { id: 'estoque', label: 'Consumo pós-festa' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as typeof tab)}
            className={`px-3 py-1.5 rounded-lg border transition-colors ${
              tab === t.id ? 'bg-ink text-white border-ink' : 'bg-surface text-ink border-line hover:bg-paper'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'geral' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card title="Cliente e pacote">
            <dl className="text-sm space-y-2">
              <div className="flex justify-between"><dt className="text-muted">Cliente</dt><dd className="font-medium">{festa.cliente}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Tipo de evento</dt><dd>{festa.tipoEvento}</dd></div>
              <div className="flex justify-between items-center">
                <dt className="text-muted">Tema</dt>
                <dd>
                  {can('action:festa.editar_dados') ? (
                    <input
                      type="text"
                      defaultValue={festa.theme ?? ''}
                      key={festa.theme ?? ''}
                      onBlur={(e) => { if (e.target.value.trim() !== (festa.theme ?? '')) updateTema(e.target.value) }}
                      placeholder="Ainda não definido"
                      className="text-right border-b border-dashed border-line focus:border-purple focus:outline-none text-sm bg-transparent placeholder:text-muted placeholder:italic"
                    />
                  ) : (
                    festa.theme || '—'
                  )}
                </dd>
              </div>
              <div className="flex justify-between items-center gap-3">
                <dt className="text-muted shrink-0">Sabores prato quente</dt>
                <dd className="flex-1">
                  {can('action:festa.editar_dados') ? (
                    <input
                      type="text"
                      defaultValue={festa.hotDishFlavors ?? ''}
                      key={festa.hotDishFlavors ?? ''}
                      onBlur={(e) => { if (e.target.value.trim() !== (festa.hotDishFlavors ?? '')) updateHotDishFlavors(e.target.value) }}
                      placeholder="Ex: Linguiça/Carne seca"
                      className="w-full text-right border-b border-dashed border-line focus:border-purple focus:outline-none text-sm bg-transparent placeholder:text-muted placeholder:italic"
                    />
                  ) : (
                    <span className="block text-right">{festa.hotDishFlavors || '—'}</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between items-center gap-3">
                <dt className="text-muted shrink-0">Sabor do bolo</dt>
                <dd className="flex-1">
                  {can('action:festa.editar_dados') ? (
                    <input
                      type="text"
                      defaultValue={festa.cakeFlavor ?? ''}
                      key={festa.cakeFlavor ?? ''}
                      onBlur={(e) => { if (e.target.value.trim() !== (festa.cakeFlavor ?? '')) updateCakeFlavor(e.target.value) }}
                      placeholder="Ainda não definido"
                      className="w-full text-right border-b border-dashed border-line focus:border-purple focus:outline-none text-sm bg-transparent placeholder:text-muted placeholder:italic"
                    />
                  ) : (
                    <span className="block text-right">{festa.cakeFlavor || '—'}</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Convidados</dt>
                <dd>{festa.convidados}{festa.courtesyGuests ? ` + ${festa.courtesyGuests} cortesia` : ''}</dd>
              </div>
              <div className="flex justify-between"><dt className="text-muted">Unidade</dt><dd>{festa.unidadeNome}</dd></div>
              <div className="flex justify-between items-center">
                <dt className="text-muted">Pacote</dt>
                <dd className="flex items-center gap-2">
                  {festa.packageName ?? 'Sem pacote definido'}
                  {unitPackages.length > 0 && festa.status !== 'cancelada' && (
                    <Can permission="action:festa.trocar_pacote">
                      <button onClick={() => { setSwapPackageId(festa.packageId ?? ''); setShowSwapPackage(true) }} className="text-xs text-purple font-medium">
                        Trocar
                      </button>
                    </Can>
                  )}
                </dd>
              </div>
              {festa.finalValue !== festa.valorTotal && (
                <div className="flex justify-between"><dt className="text-muted">Valor cheio (antes do desconto)</dt><dd>{currency(festa.valorTotal)}</dd></div>
              )}
              <div className="flex justify-between"><dt className="text-muted">Valor firmado</dt><dd className="font-medium">{currency(festa.finalValue)}</dd></div>
            </dl>
          </Card>

          {packageHistory.length > 0 && (
            <Card title="Histórico de alterações de pacote" action={<History className="w-4 h-4 text-muted" />} className="md:col-span-2">
              <ul className="divide-y divide-line text-sm">
                {packageHistory.map((h) => (
                  <li key={h.id} className="py-2.5">
                    <p>
                      Plano alterado de <strong className="font-medium">{h.oldPackageName}</strong> para{' '}
                      <strong className="font-medium">{h.newPackageName}</strong> — valor total{' '}
                      {h.diff >= 0 ? (
                        <span className="text-danger font-medium">aumentou {currency(h.diff)}</span>
                      ) : (
                        <span className="text-teal font-medium">diminuiu {currency(Math.abs(h.diff))}</span>
                      )}
                    </p>
                    <p className="text-xs text-muted mt-0.5">{h.userName} · {h.createdAt}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Documentos da festa">
            <ul className="divide-y divide-line mb-3">
              {documents.map((d) => (
                <li key={d.id} className="py-2 flex items-center justify-between text-sm gap-2">
                  <button onClick={() => handleViewDoc(d)} className="flex items-center gap-1.5 text-left hover:text-purple min-w-0">
                    <FileIcon className="w-3.5 h-3.5 text-muted shrink-0" /> <span className="truncate">{d.name}</span>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted">{d.date}</span>
                    <Can permission="action:festa.documentos">
                      <button onClick={() => handleRemoveDoc(d)} className="text-muted hover:text-danger" aria-label="Remover documento">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </Can>
                  </div>
                </li>
              ))}
              {documents.length === 0 && <p className="text-sm text-muted py-2">Nenhum documento anexado ainda.</p>}
            </ul>
            <Can permission="action:festa.documentos">
              <label className="text-xs text-purple font-medium cursor-pointer">
                <input type="file" className="hidden" onChange={handleUploadDoc} disabled={uploadingDoc} />
                {uploadingDoc ? 'Enviando...' : '+ Anexar documento'}
              </label>
            </Can>
            <p className="text-xs text-muted mt-2">
              Os arquivos ficam guardados de forma privada — clique no nome pra abrir/baixar.
            </p>
          </Card>

          <Card title="Lista de convidados" action={<Users className="w-4 h-4 text-muted" />}>
            {!guestListToken ? (
              <div>
                <p className="text-sm text-muted mb-3">
                  Gere um link para o contratante enviar a lista de convidados direto, sem precisar de login — os
                  nomes já salvam sozinhos no sistema.
                </p>
                <Can permission="action:festa.lista_convidados">
                  <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={handleGenerateGuestLink} disabled={generatingLink}>
                    <LinkIcon className="w-3.5 h-3.5" /> {generatingLink ? 'Gerando...' : 'Gerar link'}
                  </Button>
                </Can>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <input readOnly value={guestListUrl()} className="flex-1 border border-line rounded-lg px-3 py-2 text-xs text-muted bg-paper" />
                  <button onClick={handleCopyLink} className="text-muted hover:text-purple shrink-0" aria-label="Copiar link">
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
                {linkCopied && <p className="text-xs text-teal mb-2">Link copiado!</p>}
                <Can permission="action:festa.lista_convidados">
                  <Button variant="secondary" className="text-xs px-3 py-1.5 mb-4" onClick={handleSendGuestLinkWhatsApp}>
                    Enviar por WhatsApp
                  </Button>
                </Can>

                <p className="text-xs text-muted mb-2">
                  {guestEntries.filter((g) => g.arrived).length} de {guestEntries.length} convidado(s) chegaram
                </p>
                <ul className="divide-y divide-line max-h-40 overflow-y-auto mb-3">
                  {guestEntries.map((g) => (
                    <li key={g.id} className="py-1.5 flex items-center justify-between text-sm gap-2">
                      <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={g.arrived}
                          onChange={() => toggleGuestArrived(g.id, g.arrived)}
                          disabled={!can('action:festa.lista_convidados')}
                          className="shrink-0"
                        />
                        <span className={`truncate ${g.arrived ? 'text-muted line-through' : ''}`}>{g.name}</span>
                      </label>
                      <Can permission="action:festa.lista_convidados">
                        <button onClick={() => handleRemoveGuest(g.id)} className="text-muted hover:text-danger shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </Can>
                    </li>
                  ))}
                  {guestEntries.length === 0 && <p className="text-sm text-muted py-2">Ninguém enviado ainda.</p>}
                </ul>
                <Can permission="action:festa.lista_convidados">
                  <form onSubmit={handleAddGuestManual} className="flex gap-2">
                    <input
                      value={manualGuestName}
                      onChange={(e) => setManualGuestName(e.target.value)}
                      placeholder="Adicionar nome manualmente"
                      className="flex-1 border border-line rounded-lg px-3 py-1.5 text-sm"
                    />
                    <Button type="submit" className="text-xs px-3 py-1.5"><Plus className="w-3.5 h-3.5" /></Button>
                  </form>
                </Can>
              </div>
            )}
          </Card>

          <Card title="Contato com o cliente (WhatsApp)" className="md:col-span-2">
            <div className="flex flex-wrap gap-2 mb-4">
              {(['confirmar_festa', 'lembrete_festa', 'localizacao', 'lembrete_pagamento'] as MessageTemplateKey[]).map((key) => (
                <Button key={key} variant="secondary" className="text-xs px-3 py-1.5" onClick={() => handleWhatsAppAction(key)}>
                  {MESSAGE_TEMPLATE_LABEL[key]}
                </Button>
              ))}
              <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => setShowReviewModal(true)}>
                Pedir avaliação
              </Button>
            </div>
            {contactHistory.length > 0 && (
              <ul className="text-xs text-muted space-y-1">
                {contactHistory.map((h) => (
                  <li key={h.id}>{new Date(h.created_at).toLocaleString('pt-BR')} — {h.type} — Você</li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Confirmar festa com os fornecedores"
            className="md:col-span-2"
            action={
              <button
                onClick={() => {
                  setEditingFornecedoresTemplate(fornecedoresTemplate)
                  setShowEditFornecedoresTemplate(true)
                }}
                className="text-xs text-purple font-medium"
              >
                Editar mensagem padrão
              </button>
            }
          >
            {festa.unidadeWhatsappGroupLink ? (
              <>
                <p className="text-xs text-muted mb-3">
                  Monta a mensagem com horário de entrega, tema e aniversariante — na próxima tela dá pra copiar e
                  abrir o grupo de WhatsApp da equipe/fornecedores de {festa.unidadeNome}.
                </p>
                <div className="mb-3">
                  <label className="block text-xs text-muted mb-1">Observação (opcional)</label>
                  <input
                    type="text"
                    value={observacaoFornecedores}
                    onChange={(e) => setObservacaoFornecedores(e.target.value)}
                    placeholder="Ex: festa alterada para 50 pessoas"
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={handleConfirmarFornecedores}>
                  <Truck className="w-3.5 h-3.5" /> Confirmar com fornecedores
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted">
                Ainda não tem o link do grupo de WhatsApp de {festa.unidadeNome} cadastrado. Peça pro Claude te ajudar
                a configurar isso.
              </p>
            )}
          </Card>
        </div>
      )}

      {tab === 'financeiro' && (
        <div className="space-y-4">
          <Card title="Pagamentos recebidos">
            <p className="text-xs text-muted mb-3">
              Sem parcelas fixas: registre aqui cada valor conforme o cliente for pagando, na forma e data que for. O
              saldo devedor é sempre recalculado automaticamente.
            </p>
            <table className="w-full text-sm mb-3">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="pb-2 font-medium">Data</th>
                  <th className="pb-2 font-medium">Valor</th>
                  <th className="pb-2 font-medium">Forma</th>
                  <th className="pb-2 font-medium">Observação</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 text-muted">{p.data}</td>
                    <td className="py-2 font-medium">{currency(p.valor)}</td>
                    <td className="py-2">{paymentMethodLabel(p.paymentMethod)}</td>
                    <td className="py-2 text-muted">{p.notes ?? '—'}</td>
                    <td className="py-2 text-right">
                      <Can permission="action:festa.pagamentos">
                        <button onClick={() => handleRemovePayment(p.id)} className="text-muted hover:text-danger" aria-label="Remover pagamento">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </Can>
                    </td>
                  </tr>
                ))}
                {payments.length === 0 && (
                  <tr><td colSpan={5} className="py-4 text-center text-muted">Nenhum pagamento registrado ainda.</td></tr>
                )}
              </tbody>
            </table>
            <p className="text-sm font-semibold mb-3">Saldo devedor: {currency(saldoDevedor)}</p>
            <Can permission="action:festa.pagamentos">
              <form onSubmit={handleAddPayment} className="flex flex-wrap gap-2">
                <input type="number" value={payValor} onChange={(e) => setPayValor(e.target.value)} placeholder="Valor" className="w-28 border border-line rounded-lg px-3 py-1.5 text-sm" />
                <input type="date" value={payData} onChange={(e) => setPayData(e.target.value)} className="border border-line rounded-lg px-3 py-1.5 text-sm" />
                <select value={payMetodo} onChange={(e) => setPayMetodo(e.target.value as PaymentMethod)} className="border border-line rounded-lg px-3 py-1.5 text-sm">
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>
                  ))}
                </select>
                {payMetodo === 'outro' && (
                  <input
                    value={payMetodoOutro}
                    onChange={(e) => setPayMetodoOutro(e.target.value)}
                    placeholder="Qual forma de pagamento?"
                    className="border border-line rounded-lg px-3 py-1.5 text-sm w-44"
                  />
                )}
                <input value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="Observação (opcional)" className="border border-line rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[140px]" />
                <Button type="submit" className="text-xs px-3 py-1.5"><Plus className="w-3.5 h-3.5" /> Registrar pagamento</Button>
              </form>
            </Can>
          </Card>

          <Card title="Itens extras da festa">
            <p className="text-xs text-muted mb-3">
              Itens do catálogo (fotógrafo, número em LED, etc.) cobrados nesta festa — o valor entra
              automaticamente no total.
            </p>
            <table className="w-full text-sm mb-3">
              <tbody className="divide-y divide-line">
                {festaExtras.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2">{e.name}</td>
                    <td className="py-2 text-muted">{e.quantity}x {currency(e.priceSnapshot)}</td>
                    <td className="py-2 font-medium">{currency(e.quantity * e.priceSnapshot)}</td>
                    <td className="py-2 text-right">
                      <Can permission="action:festa.itens_extras">
                        <button onClick={() => handleRemoveExtraFesta(e.id)} className="text-muted hover:text-danger">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </Can>
                    </td>
                  </tr>
                ))}
                {festaExtras.length === 0 && (
                  <tr><td colSpan={4} className="py-3 text-center text-muted">Nenhum item extra adicionado ainda.</td></tr>
                )}
              </tbody>
            </table>
            <Can permission="action:festa.itens_extras">
              {extraCatalog.length > 0 ? (
                <form onSubmit={handleAddExtraFesta} className="flex flex-wrap gap-2">
                  <select value={novoExtraId} onChange={(e) => setNovoExtraId(e.target.value)} className="border border-line rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[160px]">
                    <option value="" disabled>Escolha um item...</option>
                    {extraCatalog.map((ex) => (
                      <option key={ex.id} value={ex.id}>{ex.name} — {currency(ex.price)}</option>
                    ))}
                  </select>
                  <input type="number" min={1} value={novoExtraQtd} onChange={(e) => setNovoExtraQtd(e.target.value)} className="w-20 border border-line rounded-lg px-3 py-1.5 text-sm" />
                  <Button type="submit" className="text-xs px-3 py-1.5" disabled={!novoExtraId}><Plus className="w-3.5 h-3.5" /> Adicionar</Button>
                </form>
              ) : (
                <p className="text-xs text-muted">Cadastre itens extras em "Pacotes e itens" para poder adicioná-los aqui.</p>
              )}
            </Can>
          </Card>

          <Card title="Consumo do dia (ex: chopp cobrado por litro)" action={<Beer className="w-4 h-4 text-amber" />}>
            <p className="text-xs text-muted mb-3">
              Para festas em que o cliente escolhe pagar pelo que for consumido, lance aqui — o valor entra
              automaticamente no total da festa e fecha junto com o pagamento final.
            </p>
            <table className="w-full text-sm mb-3">
              <tbody className="divide-y divide-line">
                {consumption.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2">{c.item}</td>
                    <td className="py-2 text-muted">{c.quantity} un</td>
                    <td className="py-2 text-muted">{currency(c.unitPrice)}/un</td>
                    <td className="py-2 font-medium">{currency(c.quantity * c.unitPrice)}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => handleRemoveConsumo(c.id)} className="text-muted hover:text-danger">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {consumption.length === 0 && (
                  <tr><td colSpan={5} className="py-3 text-center text-muted">Nenhum consumo lançado ainda.</td></tr>
                )}
              </tbody>
            </table>
            <p className="text-sm font-semibold mb-3">Total do consumo: {currency(totalConsumo)}</p>
            <form onSubmit={handleAddConsumo} className="flex flex-wrap gap-2">
              <input value={consumoItem} onChange={(e) => setConsumoItem(e.target.value)} placeholder="Item" className="border border-line rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[140px]" />
              <input type="number" value={consumoQtd} onChange={(e) => setConsumoQtd(e.target.value)} placeholder="Qtd" className="w-20 border border-line rounded-lg px-3 py-1.5 text-sm" />
              <input type="number" value={consumoPreco} onChange={(e) => setConsumoPreco(e.target.value)} placeholder="Preço unit." className="w-28 border border-line rounded-lg px-3 py-1.5 text-sm" />
              <Button type="submit" className="text-xs px-3 py-1.5"><Plus className="w-3.5 h-3.5" /> Lançar</Button>
            </form>
          </Card>

          <Card title="Custos da festa e lucro estimado">
            <p className="text-xs text-muted mb-3">
              Lance aqui só gastos específicos <strong>desta festa</strong> (extras, um fornecedor contratado só pra
              ela, etc). Compras gerais de estoque ou despesas do negócio já entram em "Registrar conta a pagar", no
              Financeiro — lançar a mesma coisa nos dois lugares conta o gasto em dobro no resultado do mês.
            </p>
            <table className="w-full text-sm mb-3">
              <tbody className="divide-y divide-line">
                {costs.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2">{c.description}</td>
                    <td className="py-2 text-danger">{currency(c.amount)}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => handleRemoveCusto(c.id)} className="text-muted hover:text-danger">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {costs.length === 0 && <tr><td colSpan={3} className="py-3 text-center text-muted">Nenhum custo lançado.</td></tr>}
              </tbody>
            </table>
            {costSuggestions.filter((s) => !costs.some((c) => c.description === s.category || c.description.startsWith(`${s.category} — `))).length > 0 && (
              <div className="mb-3">
                <p className="text-xs text-muted mb-1.5">Sugestões da ficha técnica do pacote:</p>
                <div className="flex flex-wrap gap-2">
                  {costSuggestions
                    .filter((s) => !costs.some((c) => c.description === s.category || c.description.startsWith(`${s.category} — `)))
                    .map((s) => (
                      <button
                        key={s.category}
                        type="button"
                        onClick={() => handleUseCustoSugerido(s.category, s.amount)}
                        className="text-xs border border-purple/30 bg-purple-light text-purple-dark rounded-lg px-3 py-1.5 flex items-center gap-1.5"
                      >
                        <Plus className="w-3 h-3" /> {s.category} — {currency(s.amount)}
                      </button>
                    ))}
                </div>
                <p className="text-xs text-muted mt-1.5">Clique pra preencher o formulário abaixo — dá pra ajustar o valor e a observação antes de lançar.</p>
              </div>
            )}
            {custoAviso && (
              <div className="bg-amber-light text-amber text-xs rounded-lg px-3 py-2.5 mb-3">
                <p className="font-medium mb-1">Já existe uma despesa geral parecida este mês</p>
                <ul className="space-y-0.5">
                  {custoAviso.map((m) => (
                    <li key={m.id}>
                      {m.description || m.supplier || m.category} — {currency(m.amount)}
                    </li>
                  ))}
                </ul>
                <p className="mt-1">Confira se não é a mesma compra antes de lançar aqui também.</p>
              </div>
            )}
            <form onSubmit={handleAddCusto} className="flex flex-wrap gap-2 mb-3">
              <input
                value={custoDesc}
                onChange={(e) => { setCustoDesc(e.target.value); setCustoAviso(null) }}
                placeholder="Descrição (ex: Buffet)"
                className="border border-line rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[140px]"
              />
              <input
                type="number"
                value={custoValor}
                onChange={(e) => { setCustoValor(e.target.value); setCustoAviso(null) }}
                placeholder="Valor"
                className="w-28 border border-line rounded-lg px-3 py-1.5 text-sm"
              />
              <input value={custoObs} onChange={(e) => setCustoObs(e.target.value)} placeholder="Observação (opcional)" className="border border-line rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[140px]" />
              <Button type="submit" className="text-xs px-3 py-1.5">
                <Plus className="w-3.5 h-3.5" /> {custoAviso ? 'Lançar mesmo assim' : 'Lançar'}
              </Button>
            </form>
            <div className="flex items-center justify-between pt-3 border-t border-line">
              <span className="text-sm text-muted">Custos totais: {currency(totalCustos)}</span>
              <span className={`font-display font-semibold ${lucroEstimado >= 0 ? 'text-teal' : 'text-danger'}`}>
                Lucro estimado: {currency(lucroEstimado)}
              </span>
            </div>
          </Card>

          <Card title="Nota fiscal" action={<Receipt className="w-4 h-4 text-muted" />}>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">Status</label>
                <select
                  value={nfeStatus}
                  onChange={(e) => {
                    const v = e.target.value as InvoiceStatus
                    setNfeStatus(v)
                    saveNfe(v, nfeNumber)
                  }}
                  className="border border-line rounded-lg px-3 py-2 text-sm"
                >
                  <option value="nao_emitida">Não emitida</option>
                  <option value="emitida">Emitida</option>
                  <option value="cancelada">Cancelada</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Número da nota</label>
                <input
                  type="text"
                  value={nfeNumber}
                  onChange={(e) => setNfeNumber(e.target.value)}
                  onBlur={() => saveNfe(nfeStatus, nfeNumber)}
                  placeholder="Ex: 000123"
                  className="border border-line rounded-lg px-3 py-2 text-sm"
                  disabled={nfeStatus === 'nao_emitida'}
                />
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === 'checklist' && (
        <Card>
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-1">
              <span>Progresso</span>
              <span className="font-medium">{checklistConcluidos}/{checklist.length} concluídas</span>
            </div>
            <div className="h-2 bg-paper rounded-full overflow-hidden">
              <div className="h-full bg-purple rounded-full" style={{ width: `${checklist.length ? (checklistConcluidos / checklist.length) * 100 : 0}%` }} />
            </div>
          </div>
          <ul className="divide-y divide-line">
            {checklist.map((c) => {
              const itemDue = c.dueDate ? parseISO(c.dueDate) : dueDate
              const atrasada = !c.done && !!itemDue && isPast(itemDue)
              return (
                <li key={c.id} className="py-3 flex items-center justify-between gap-3">
                  {can('action:festa.checklist') ? (
                    <button onClick={() => toggleChecklistItem(c.id, c.done)} className="flex items-center gap-3 text-left flex-1">
                      {c.done ? <CheckCircle2 className="w-5 h-5 text-teal shrink-0" /> : <Circle className="w-5 h-5 text-muted shrink-0" />}
                      <span className={`text-sm ${c.done ? 'line-through text-muted' : ''}`}>{c.description}</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-3 flex-1">
                      {c.done ? <CheckCircle2 className="w-5 h-5 text-teal shrink-0" /> : <Circle className="w-5 h-5 text-muted shrink-0" />}
                      <span className={`text-sm ${c.done ? 'line-through text-muted' : ''}`}>{c.description}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 shrink-0">
                    {atrasada && <Badge tone="danger">Atrasada</Badge>}
                    <input
                      type="date"
                      value={c.dueDate ?? ''}
                      onChange={(e) => updateChecklistDueDate(c.id, e.target.value)}
                      disabled={!can('action:festa.checklist')}
                      className="border border-line rounded-lg px-2 py-1 text-xs text-muted disabled:opacity-50"
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {tab === 'equipe' && (
        <Card
          title="Equipe escalada"
          action={
            <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={handleExportEscala}>
              <FileIcon className="w-3.5 h-3.5" /> Exportar escala
            </Button>
          }
        >
          <ul className="divide-y divide-line mb-4">
            {staff.map((s) => (
              <li key={s.id} className="py-2.5 flex items-center justify-between text-sm">
                <span className="font-medium">{s.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-muted">{s.role}</span>
                  <Can permission="action:festa.equipe">
                    <button onClick={() => handleRemoveStaff(s.id)} className="text-muted hover:text-danger">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </Can>
                </div>
              </li>
            ))}
            {staff.length === 0 && <p className="text-sm text-muted py-2">Nenhum funcionário escalado ainda.</p>}
          </ul>
          <Can permission="action:festa.equipe">
            <form onSubmit={handleAddStaff} className="flex flex-wrap gap-2">
              <input value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="Nome" className="border border-line rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[140px]" />
              <input value={staffRole} onChange={(e) => setStaffRole(e.target.value)} placeholder="Função (ex: Garçom)" className="border border-line rounded-lg px-3 py-1.5 text-sm w-48" />
              <Button type="submit" className="text-xs px-3 py-1.5"><Plus className="w-3.5 h-3.5" /> Escalar</Button>
            </form>
          </Can>
        </Card>
      )}

      {tab === 'estoque' && (
        <Card title="Checklist de consumo pós-festa">
          <p className="text-xs text-muted mb-4">
            Preencha o que foi consumido de verdade nesta festa — a quantidade lançada aqui já desconta
            automaticamente do estoque da unidade. A lista é a mesma cadastrada em "Estoque": qualquer item novo que
            você adicionar lá para esta unidade aparece aqui sozinho.
          </p>
          <Can permission="action:festa.consumo_pos_festa">
            <form onSubmit={handleSaveConsumption} className="space-y-3 mb-5">
              {unitInventoryItems.length === 0 ? (
                <p className="text-sm text-muted">Nenhum item cadastrado no estoque desta unidade ainda.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {unitInventoryItems.map((item) => (
                    <div key={item.id}>
                      <label className="block text-xs text-muted mb-1">
                        {item.name} (tem {item.quantity} {item.unitOfMeasure} em estoque)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={consumptionForm[item.id] ?? ''}
                        onChange={(e) => setConsumptionForm((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        placeholder="0"
                        className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-line">
                <div>
                  <label className="block text-xs text-muted mb-1">Outros — descrição</label>
                  <input
                    type="text"
                    value={outroDesc}
                    onChange={(e) => setOutroDesc(e.target.value)}
                    placeholder="O que mais foi consumido?"
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Outros — quantidade</label>
                  <input
                    type="number"
                    min={0}
                    value={outroQtd}
                    onChange={(e) => setOutroQtd(e.target.value)}
                    placeholder="0"
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-muted">
                "Outros" fica registrado no histórico, mas como não é um item específico do estoque, não desconta nada
                automaticamente.
              </p>

              <Button type="submit" disabled={savingConsumption}>
                {savingConsumption ? 'Salvando...' : 'Salvar consumo'}
              </Button>
            </form>
          </Can>

          <p className="text-sm font-semibold mb-2">Histórico desta festa</p>
          <ul className="divide-y divide-line">
            {stockConsumption.map((c) => (
              <li key={c.id} className="py-2.5 flex items-center justify-between text-sm">
                <span>
                  {c.itemName} — {c.quantity}
                  {!c.hasInventoryLink && <span className="text-xs text-muted"> (não descontou do estoque)</span>}
                </span>
                <Can permission="action:festa.consumo_pos_festa">
                  <button onClick={() => handleUndoConsumption(c.id)} className="text-xs text-muted hover:text-danger">
                    Desfazer
                  </button>
                </Can>
              </li>
            ))}
            {stockConsumption.length === 0 && <p className="text-sm text-muted py-2">Nada lançado ainda.</p>}
          </ul>
        </Card>
      )}

      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setShowCancelModal(false)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl">
            <h2 className="text-lg font-display font-semibold mb-1">Cancelar festa</h2>
            <p className="text-sm text-muted mb-4">
              Já foi pago {currency(totalPago)} até agora. Defina a multa retida para calcular o valor a devolver.
            </p>
            <form onSubmit={handleConfirmCancel} className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">Motivo do cancelamento</label>
                <input
                  type="text"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Ex: Cliente desistiu, mudança de data..."
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Multa retida (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={cancelFeePercent}
                  onChange={(e) => setCancelFeePercent(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <p className="text-sm text-muted">
                Valor a devolver ao cliente:{' '}
                <strong className="text-ink">
                  {currency(Math.round(totalPago * (1 - Math.min(100, Math.max(0, Number(cancelFeePercent) || 0)) / 100) * 100) / 100)}
                </strong>
              </p>
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="secondary" className="flex-1 justify-center" onClick={() => setShowCancelModal(false)}>
                  Voltar
                </Button>
                <Button type="submit" className="flex-1 justify-center !bg-danger hover:!bg-danger">
                  Confirmar cancelamento
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setShowDeleteModal(false)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl">
            <h2 className="text-lg font-display font-semibold mb-1">Excluir festa</h2>
            <p className="text-sm text-muted mb-4">
              Isso apaga essa festa e tudo relacionado a ela (pagamentos, checklist, contrato) para sempre — não pode
              ser desfeito. Se você só quer liberar a data ou registrar uma desistência, use "Cancelar festa" em vez
              disso, que mantém o histórico.
            </p>
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="secondary" className="flex-1 justify-center" onClick={() => setShowDeleteModal(false)}>
                Voltar
              </Button>
              <Button type="button" className="flex-1 justify-center !bg-danger hover:!bg-danger" onClick={handleDeleteFesta} disabled={deleting}>
                {deleting ? 'Excluindo...' : 'Excluir definitivamente'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showSwapPackage && festa && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setShowSwapPackage(false)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl">
            <h2 className="text-lg font-display font-semibold mb-4">Trocar pacote</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">Novo pacote</label>
                <select value={swapPackageId} onChange={(e) => setSwapPackageId(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                  <option value="" disabled>Escolha um pacote...</option>
                  {unitPackages.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              {swapPackageId && swapPackageId !== festa.packageId && (() => {
                const oldPackage = unitPackages.find((p) => p.id === festa.packageId)
                const newPackage = unitPackages.find((p) => p.id === swapPackageId)
                if (!newPackage) return null
                const oldPrice = oldPackage ? packagePriceForDate(oldPackage, festa.eventDateIso) : 0
                const newPrice = packagePriceForDate(newPackage, festa.eventDateIso)
                const diff = newPrice - oldPrice
                return (
                  <div className="text-sm bg-paper rounded-lg p-3 space-y-1">
                    <div className="flex justify-between"><span className="text-muted">Pacote atual</span><span>{oldPackage ? currency(oldPrice) : '—'}</span></div>
                    <div className="flex justify-between"><span className="text-muted">Pacote novo</span><span>{currency(newPrice)}</span></div>
                    <div className="flex justify-between font-semibold pt-1 border-t border-line">
                      <span>{diff >= 0 ? 'Será somado ao valor total' : 'Será descontado do valor total'}</span>
                      <span className={diff >= 0 ? 'text-danger' : 'text-teal'}>{currency(Math.abs(diff))}</span>
                    </div>
                  </div>
                )
              })()}
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="secondary" className="flex-1 justify-center" onClick={() => setShowSwapPackage(false)}>
                  Cancelar
                </Button>
                <Button type="button" className="flex-1 justify-center" onClick={handleSwapPackage} disabled={!swapPackageId || swapPackageId === festa.packageId}>
                  Confirmar troca
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEditFornecedoresTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setShowEditFornecedoresTemplate(false)} />
          <div className="relative w-full max-w-lg bg-surface rounded-card p-6 shadow-xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-display font-semibold">Editar mensagem padrão</h2>
              <button onClick={() => setShowEditFornecedoresTemplate(false)} className="text-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted mb-3">
              Essa mensagem vale pra todas as festas, de qualquer unidade. Pode usar estes campos que o sistema
              preenche sozinho: <code className="text-xs bg-paper px-1 rounded">{'{{horario_entrega}}'}</code>{' '}
              <code className="text-xs bg-paper px-1 rounded">{'{{tema}}'}</code>{' '}
              <code className="text-xs bg-paper px-1 rounded">{'{{aniversariante_idade}}'}</code>{' '}
              <code className="text-xs bg-paper px-1 rounded">{'{{observacao}}'}</code>
            </p>
            <textarea
              value={editingFornecedoresTemplate}
              onChange={(e) => setEditingFornecedoresTemplate(e.target.value)}
              rows={12}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm font-mono"
            />
            <Button className="w-full justify-center mt-3" onClick={handleSaveFornecedoresTemplate} disabled={savingFornecedoresTemplate}>
              {savingFornecedoresTemplate ? 'Salvando...' : 'Salvar mensagem padrão'}
            </Button>
          </div>
        </div>
      )}

      {fornecedoresMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setFornecedoresMessage(null)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-display font-semibold">Confirmar com fornecedores</h2>
              <button onClick={() => setFornecedoresMessage(null)} className="text-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-muted mb-2">
              Copie a mensagem abaixo (clique dentro da caixa que ela já fica selecionada, Ctrl+C) e cole no grupo
              depois de abrir.
            </p>
            <textarea
              readOnly
              value={fornecedoresMessage}
              rows={10}
              onFocus={(e) => e.target.select()}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm mb-3"
            />
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1 justify-center text-xs" onClick={handleCopyFornecedoresMessage}>
                <Copy className="w-3.5 h-3.5" /> Copiar mensagem
              </Button>
              <Button className="flex-1 justify-center text-xs" onClick={handleAbrirGrupoFornecedores}>
                <Truck className="w-3.5 h-3.5" /> Abrir grupo no WhatsApp
              </Button>
            </div>
            {fornecedoresCopiado && <p className="text-xs text-teal mt-2">Copiado!</p>}
          </div>
        </div>
      )}

      {showEditDados && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setShowEditDados(false)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-semibold">Editar dados da festa</h2>
              <button onClick={() => setShowEditDados(false)} className="text-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveEditDados} className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">Data do evento</label>
                <input type="date" value={editData} onChange={(e) => setEditData(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Início</label>
                  <input type="time" value={editInicio} onChange={(e) => setEditInicio(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Fim</label>
                  <input type="time" value={editFim} onChange={(e) => setEditFim(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Tipo de evento</label>
                  <select value={editTipoEvento} onChange={(e) => setEditTipoEvento(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                    {EVENT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {editTipoEvento === 'Outro' && (
                    <input
                      type="text"
                      value={editTipoEventoOutro}
                      onChange={(e) => setEditTipoEventoOutro(e.target.value)}
                      placeholder="Qual tipo de evento?"
                      className="w-full border border-line rounded-lg px-3 py-2 text-sm mt-2"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Convidados</label>
                  <input type="number" min={0} value={editConvidados} onChange={(e) => setEditConvidados(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Valor total</label>
                  <input type="number" min={0} value={editValorTotal} onChange={(e) => setEditValorTotal(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Convidados de cortesia</label>
                  <input type="number" min={0} value={editCortesia} onChange={(e) => setEditCortesia(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Desconto</label>
                  <select value={editDescontoTipo} onChange={(e) => setEditDescontoTipo(e.target.value as DiscountType | '')} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                    <option value="">Sem desconto</option>
                    <option value="percentual">Percentual (%)</option>
                    <option value="valor_fixo">Valor fixo (R$)</option>
                  </select>
                </div>
                {editDescontoTipo && (
                  <div>
                    <label className="block text-xs text-muted mb-1">Valor do desconto</label>
                    <input type="number" min={0} value={editDescontoValor} onChange={(e) => setEditDescontoValor(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                  </div>
                )}
              </div>
              <Button type="submit" className="w-full justify-center mt-2" disabled={savingEditDados}>
                {savingEditDados ? 'Salvando...' : 'Salvar alterações'}
              </Button>
            </form>
          </div>
        </div>
      )}

      {showReviewModal && (
        <SendReviewModal
          reservationId={festa.id}
          clienteNome={festa.cliente}
          phone={festa.clientPhone}
          unitName={festa.unidadeNome}
          googleReviewLink={festa.googleReviewLink}
          onClose={() => setShowReviewModal(false)}
          onSent={() => {
            loadContactHistory(festa.cliente)
            setShowReviewModal(false)
          }}
        />
      )}
    </div>
  )
}
