// Transforma um registro do histórico (audit_log) em texto legível.

export interface AuditEntry {
  id: string
  created_at: string
  user_name: string | null
  action: string
  entity: string
  details: {
    reservation_id?: string
    changes?: Record<string, { de: unknown; para: unknown }>
    row?: Record<string, unknown>
    old_package_name?: string
    new_package_name?: string
    diff?: number
  } | null
}

const ENTITY_LABEL: Record<string, string> = {
  reservations: 'a festa',
  payments: 'um pagamento',
  reservation_costs: 'um custo da festa',
  reservation_extra_items: 'um item extra',
  reservation_consumption: 'um consumo',
  reservation_stock_consumption: 'um consumo do estoque',
  reservation_birthday_kids: 'um aniversariante',
  reservation_notes: 'uma observação',
  reservation_documents: 'um documento',
  checklist_items: 'uma tarefa do checklist',
  staff_assignments: 'a equipe',
  staff_members: 'um funcionário',
  guest_list_entries: 'a lista de convidados',
  contracts: 'o contrato',
  clients: 'um cliente',
  expenses: 'uma despesa',
  recurring_expenses: 'uma despesa fixa mensal',
  packages: 'um pacote',
  extra_items: 'um item extra do catálogo',
  inventory_items: 'um item do estoque',
  festa_fixed_costs: 'uma despesa fixa das festas',
  suppliers: 'um fornecedor',
  visits: 'uma visita',
  agenda_items: 'um compromisso da Agenda',
  proposals: 'uma proposta',
  waitlist: 'a lista de espera',
  unit_goals: 'a meta da unidade',
  marketing_spend: 'o gasto com tráfego',
  unit_settlements: 'um acerto entre unidades',
  portal_receipts: 'um comprovante do portal',
  portal_menu_options: 'uma opção do cardápio do portal',
  other_incomes: 'uma entrada de acerto entre unidades',
  commission_rates: 'o valor da comissão',
  commission_settings: 'a configuração das comissões',
  commission_payouts: 'um repasse de comissões',
  reservation: 'a festa',
}

const FIELD_LABEL: Record<string, string> = {
  status: 'status',
  total_value: 'valor da festa',
  final_value: 'valor final',
  event_date: 'data',
  start_time: 'início',
  end_time: 'término',
  guest_count: 'convidados',
  courtesy_guests: 'convidados de cortesia',
  package_id: 'pacote',
  theme: 'tema',
  child_name: 'aniversariante',
  child_age: 'idade',
  hot_dish_flavors: 'pratos quentes',
  cake_flavor: 'sabor do bolo',
  discount_type: 'tipo de desconto',
  discount_value: 'desconto',
  event_type: 'tipo de evento',
  notes: 'observação',
  amount: 'valor',
  payment_date: 'data do pagamento',
  payment_method: 'forma de pagamento',
  description: 'descrição',
  quantity: 'quantidade',
  minimum_quantity: 'estoque mínimo',
  name: 'nome',
  phone: 'telefone',
  email: 'email',
  role: 'função',
  attended: 'presença',
  arrived: 'chegada',
  flagged: 'sinalização',
  done: 'concluída',
  due_date: 'vencimento',
  paid_date: 'data de pagamento',
  remind_on: 'lembrete',
  reminder_done: 'lembrete concluído',
  terms_text: 'texto do contrato',
  body: 'texto',
  price: 'preço',
  base_price: 'preço',
  weekday_price: 'preço seg–qui',
  weekend_price: 'preço sex–dom',
  staff_name: 'funcionário',
  substitution_reason: 'motivo da substituição',
  substituted_by_name: 'substituído por',
  cancellation_reason: 'motivo do cancelamento',
  consumption_type: 'tipo de consumo',
  quantity_per_guest: 'consumo por convidado',
  refund_amount: 'valor devolvido',
  cancellation_fee_percent: 'multa retida (%)',
  consumption_finalized: 'consumo finalizado',
  exclude_from_averages: 'fora das médias de consumo',
  exclude_reason: 'motivo de ficar fora das médias',
  covers_festa_costs: 'paga custos das festas',
  other_items_value: 'outros itens da nota',
  received_date: 'data do recebimento',
  cancel_reason: 'motivo do cancelamento',
  item_name: 'item',
  cake_dough: 'massa do bolo',
  music_choice: 'música da festa',
  menu_confirmed_at: 'cardápio confirmado em',
  hot_dish_count: 'pratos quentes inclusos',
  adds_hot_dishes: 'pratos quentes adicionais',
  reject_reason: 'motivo da recusa',
}

// Mesmo nome de campo com sentido diferente conforme a tabela.
const FIELD_LABEL_BY_ENTITY: Record<string, Record<string, string>> = {
  inventory_items: { total_value: 'valor em estoque', quantity: 'quantidade em estoque' },
}

function fieldLabel(entity: string, field: string) {
  return FIELD_LABEL_BY_ENTITY[entity]?.[field] ?? FIELD_LABEL[field] ?? field
}

const STATUS_LABEL: Record<string, string> = {
  orcamento: 'Orçamento',
  confirmada: 'Confirmada',
  sinal_pago: 'Sinal pago',
  quitada: 'Quitada',
  cancelada: 'Cancelada',
  escalado: 'Escalado',
  substituido: 'Substituído',
}

const MONEY_FIELDS = new Set(['total_value', 'final_value', 'refund_amount', 'other_items_value', 'line_value', 'unit_cost', 'total_cost', 'amount', 'price', 'base_price', 'weekday_price', 'weekend_price', 'discount_value'])

// Campos técnicos que não interessam a quem lê o histórico.
const HIDDEN_FIELDS = new Set([
  'id', 'reservation_id', 'unit_id', 'client_id', 'space_id', 'lead_id', 'staff_member_id', 'payment_cost_id',
  'fixed_cost_id', 'inventory_item_id', 'expense_id', 'recurring_expense_id', 'replaces_assignment_id', 'token',
  'attended_at', 'arrived_at', 'created_by_name', 'generated_at', 'storage_path', 'extra_item_id', 'created_at', 'updated_at',
  'has_cost', 'last_unit_cost', 'stock_value', 'settlement_batch_id', 'batch_id', 'from_unit_id', 'to_unit_id', 'from_item_id', 'to_item_id',
  'is_stock_purchase', 'payment_id', 'decided_at', 'decided_by_name', 'storage_path', 'confirmed_at', 'confirmed_by_name', 'cancelled_by_name', 'cancelled_at', 'numero',
])

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'sim' : 'não'
  if (field === 'status' && typeof value === 'string') return STATUS_LABEL[value] ?? value
  if (MONEY_FIELDS.has(field)) {
    const n = Number(value)
    if (Number.isFinite(n)) return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split('-').reverse().join('/')
  if (typeof value === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(value)) return value.slice(0, 5)
  return String(value)
}

// Nome curto do que foi criado/excluído (ex: "R$ 500,00", "Maria Silva").
function rowSummary(entity: string, row: Record<string, unknown> | undefined): string {
  if (!row) return ''
  if (entity === 'payments') return ` de ${formatValue('amount', row.amount)}`
  if (entity === 'reservation_costs' || entity === 'expenses') return `: ${row.description ?? ''} ${formatValue('amount', row.amount)}`.trimEnd()
  const label = row.name ?? row.staff_name ?? row.description ?? row.item ?? row.item_name ?? row.body ?? row.title
  return label ? `: ${String(label)}` : ''
}

export function describeAudit(entry: AuditEntry) {
  const who = entry.user_name || 'Alguém da equipe'
  const what = ENTITY_LABEL[entry.entity] ?? entry.entity
  const d = entry.details ?? {}

  if (entry.action === 'alterou_pacote') {
    return { who, text: `trocou o pacote: ${d.old_package_name ?? '—'} → ${d.new_package_name ?? '—'}`, changes: [] as string[] }
  }

  if (entry.action === 'alterou' && d.changes) {
    const changes = Object.entries(d.changes)
      .filter(([field]) => !HIDDEN_FIELDS.has(field))
      .map(([field, c]) => `${fieldLabel(entry.entity, field)}: ${formatValue(field, c.de)} → ${formatValue(field, c.para)}`)
    return { who, text: `alterou ${what}`, changes }
  }

  const verb = entry.action === 'criou' ? 'adicionou' : entry.action === 'excluiu' ? 'excluiu' : entry.action
  return { who, text: `${verb} ${what}${rowSummary(entry.entity, d.row)}`, changes: [] as string[] }
}
