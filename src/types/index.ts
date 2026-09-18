export interface Unit {
  id: string
  name: string
  address: string | null
  active: boolean
  // dados da contratada, usados na geração do contrato — só preenchidos
  // para as unidades cujo contrato-base já foi cadastrado
  legal_name: string | null
  cnpj: string | null
  full_address: string | null
  responsible_name: string | null
  pix_key: string | null
  extra_hour_price: number | null
  default_deposit_percent: number | null
  google_review_link: string | null
  staff_whatsapp_group_link: string | null
}

// Perfis de acesso são cadastrados e editados livremente pelo dono (tela
// Usuários e permissões) — não é mais uma lista fixa. `isAdmin` marca o
// perfil com acesso total (não passa por checagem de permissão nenhuma).
export interface Role {
  id: string
  name: string
  isAdmin: boolean
}

export interface UserProfile {
  id: string
  name: string
  roleId: string | null
  active: boolean
}

export interface AuditLogEntry {
  id: string
  user_id: string | null
  action: string
  entity: string
  entity_id: string | null
  details: Record<string, unknown> | null
  created_at: string
}

export interface WaitlistEntry {
  id: string
  client_id: string
  space_id: string | null
  desired_date: string
  notes: string | null
  client?: Client
  space?: Space
}

export type ReservationStatus =
  | 'orcamento'
  | 'confirmada'
  | 'sinal_pago'
  | 'quitada'
  | 'cancelada'

export type LeadStatus = 'orcamento' | 'negociacao' | 'fechado' | 'perdido'
export type LeadSource = 'instagram' | 'google' | 'facebook' | 'indicacao' | 'outro'
export type PayableStatus = 'a_vencer' | 'pago' | 'atrasado' | 'cancelado'
export type DiscountType = 'percentual' | 'valor_fixo'

export const PAYMENT_METHODS = [
  'pix',
  'cartao_credito',
  'cartao_debito',
  'dinheiro',
  'boleto',
  'transferencia',
  'outro',
] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  pix: 'Pix',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
  dinheiro: 'Dinheiro',
  boleto: 'Boleto',
  transferencia: 'Transferência',
  outro: 'Outro',
}

// Taxa aproximada de maquininha/cartão, descontada como custo do lucro da festa
export const PAYMENT_METHOD_FEE_PERCENT: Record<PaymentMethod, number> = {
  pix: 0,
  cartao_credito: 3.5,
  cartao_debito: 1.5,
  dinheiro: 0,
  boleto: 1.9,
  transferencia: 0,
  outro: 0,
}

export interface Space {
  id: string
  unit_id: string
  name: string
  capacity: number | null
  description: string | null
  buffer_minutes: number
  availability_notes: string | null
  active: boolean
}

export type ReactivationStatus = 'nova_oportunidade' | 'contatado' | 'negociacao' | 'nova_reserva' | 'sem_interesse'

export interface Client {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  birthday: string | null
  notes: string | null
  is_loyalty: boolean
  loyalty_points: number
  referred_by: string | null // id de outro cliente
  referral_discount_status: 'pendente' | 'aplicado' | null
  child_name: string | null
  child_birthday: string | null
  last_party_date: string | null
  total_spent: number
  last_commercial_contact: string | null
  reactivation_status: ReactivationStatus
  // dados estruturados exigidos no contrato
  cpf: string | null
  cep: string | null
  street: string | null
  address_number: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
  source: string | null
}

export const CLIENT_SOURCES = ['instagram', 'google', 'facebook', 'indicacao', 'outro'] as const
export const CLIENT_SOURCE_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  google: 'Google',
  facebook: 'Facebook',
  indicacao: 'Indicação',
  outro: 'Outro',
}

export interface Visit {
  id: string
  client_name: string
  unit_id: string
  space_name: string | null
  scheduled_at: string
  responsible: string
  result: 'virou_orcamento' | 'nao_avancou' | null
}

export interface ContactHistoryEntry {
  id: string
  client_name: string
  type: string
  channel: 'whatsapp'
  created_at: string
  user_name: string
}

export interface Lead {
  id: string
  client_id: string | null
  source: LeadSource
  status: LeadStatus
  created_at: string
}

export interface Package {
  id: string
  name: string
  description: string | null
  base_price: number
  active: boolean
  unit_id: string | null // null = disponível para qualquer unidade
  guest_limit: number | null
  duration_hours: number | null
  included_items: string | null
  weekday_price: number | null // preço segunda a quinta, quando diferente do base_price
  weekend_price: number | null // preço sexta a domingo, quando diferente do base_price
}

// Segunda a quinta (1-4) vs sexta a domingo (5,6,0) — usa weekday/weekend_price
// quando o pacote tiver essa distinção, senão cai para base_price.
export function packagePriceForDate(
  pkg: Pick<Package, 'base_price' | 'weekday_price' | 'weekend_price'>,
  isoDate: string,
): number {
  if (pkg.weekday_price == null || pkg.weekend_price == null) return pkg.base_price
  const day = new Date(`${isoDate}T00:00:00`).getDay()
  const isWeekend = day === 0 || day === 5 || day === 6
  return isWeekend ? pkg.weekend_price : pkg.weekday_price
}

export interface ExtraItem {
  id: string
  name: string
  description: string | null
  price: number
  active: boolean
}

export interface Reservation {
  id: string
  unit_id: string
  client_id: string
  space_id: string
  package_id: string | null
  lead_id: string | null
  event_date: string
  start_time: string
  end_time: string
  status: ReservationStatus
  event_type: string | null
  guest_count: number | null
  total_value: number // valor cheio do pacote + extras, antes do desconto
  notes: string | null
  child_name: string | null
  child_age: number | null
  theme: string | null
  hot_dish_flavors: string | null
  cake_flavor: string | null
  discount_type: DiscountType | null
  discount_value: number | null
  final_value: number // valor firmado, já com desconto — é o que vale no contrato
  courtesy_guests: number | null // convidados de cortesia (promoções pontuais, por reserva)
  // campos expandidos (join), preenchidos na consulta
  client?: Client
  space?: Space
  package?: Package
}

// Pagamento flexível: um lançamento por valor efetivamente recebido, sem
// cronograma fixo. Saldo devedor = reservations.final_value − soma destes.
export interface Payment {
  id: string
  reservation_id: string
  amount: number
  payment_date: string
  payment_method: PaymentMethod | null
  notes: string | null
}

export interface ContractTemplate {
  id: string
  unit_id: string
  body: string
  updated_at: string
}

export interface ChecklistItem {
  id: string
  reservation_id: string
  description: string
  done: boolean
  due_date: string | null
}

export interface StaffAssignment {
  id: string
  reservation_id: string
  staff_name: string
  role: string | null
}

export interface MarketingSpend {
  id: string
  unit_id: string
  month: string // primeiro dia do mês, ex: "2026-09-01"
  amount: number
  notes: string | null
}

export const EXPENSE_CATEGORIES = [
  'Aluguel',
  'Folha de pagamento',
  'Fornecedores',
  'Manutenção',
  'Marketing',
  'Impostos',
  'Outros',
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export interface Expense {
  id: string
  unit_id: string
  category: ExpenseCategory
  description: string | null
  supplier: string | null
  amount: number
  due_date: string
  paid_date: string | null
  status: PayableStatus
  payment_method: PaymentMethod | null
  recurring_expense_id: string | null
}

export interface RecurringExpense {
  id: string
  unit_id: string
  category: ExpenseCategory
  description: string
  amount: number
  day_of_month: number // dia do mês em que a despesa vence, ex: 5
  active: boolean
  first_charge_month: string | null // primeiro mês (yyyy-MM-01) em que gera lançamento; nulo = já vale
}

export const INVENTORY_CATEGORIES = [
  'Buffet e bebidas',
  'Descartáveis',
  'Decoração',
  'Limpeza',
  'Manutenção',
  'Outros',
] as const

export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number]

export interface InventoryItem {
  id: string
  unit_id: string
  name: string
  category: InventoryCategory
  unit_of_measure: string // ex: 'un', 'kg', 'litro', 'pacote', 'caixa'
  quantity: number
  minimum_quantity: number
  quantity_per_guest: number | null
  supplier: string | null
}

export const SUPPLIER_SERVICE_TYPES = ['Buffet externo', 'DJ', 'Fotógrafo', 'Decorador', 'Outro'] as const
export type SupplierServiceType = (typeof SUPPLIER_SERVICE_TYPES)[number]

export interface Supplier {
  id: string
  name: string
  service_type: SupplierServiceType
  contact: string | null
  default_price: number | null
  rating: number | null // 1 a 5
  notes: string | null
}

export interface SupplierBooking {
  id: string
  supplier_id: string
  reservation_label: string // nome da festa/cliente, para exibição
  amount: number
  evaluation_note: string | null
  evaluation_rating: number | null
}

export const PACKAGE_COST_CATEGORIES = ['Alimentos', 'Bebidas', 'Equipe', 'Decoração', 'Outros'] as const
export type PackageCostCategory = (typeof PACKAGE_COST_CATEGORIES)[number]

export interface PackageCostItem {
  id: string
  package_id: string
  category: PackageCostCategory
  amount: number
}

export type InvoiceStatus = 'nao_emitida' | 'emitida' | 'cancelada'
