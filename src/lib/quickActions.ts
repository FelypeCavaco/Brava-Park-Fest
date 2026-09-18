import type { LucideIcon } from 'lucide-react'
import { CalendarPlus, UserPlus, Receipt, BellRing, UserCog, PackagePlus, Truck, CalendarClock } from 'lucide-react'

export interface QuickAction {
  key: string
  label: string
  icon: LucideIcon
  to: string
  // precisa poder ver a página e (se houver) a ação específica pra o botão aparecer
  requires: string[]
}

// Central de atalhos usados tanto na barra do topo (em toda página) quanto
// nos botões maiores do Painel. "to" já carrega o "?novo=1" quando a página
// de destino sabe abrir o formulário de cadastro sozinha (ver
// useOpenOnQueryParam nas páginas que aceitam esse parâmetro).
export const QUICK_ACTIONS: QuickAction[] = [
  { key: 'nova-reserva', label: 'Nova reserva', icon: CalendarPlus, to: '/reservas?novo=1', requires: ['page:reservas', 'action:reservas.nova_reserva'] },
  { key: 'nova-visita', label: 'Agendar visita', icon: CalendarClock, to: '/visitas', requires: ['page:visitas'] },
  { key: 'novo-cliente', label: 'Novo cliente', icon: UserPlus, to: '/clientes?novo=1', requires: ['page:clientes', 'action:clientes.criar_editar'] },
  { key: 'nova-despesa', label: 'Nova despesa', icon: Receipt, to: '/financeiro', requires: ['page:financeiro', 'action:financeiro.registrar_despesa'] },
  { key: 'novo-pacote', label: 'Novo pacote', icon: PackagePlus, to: '/pacotes?novo=1', requires: ['page:pacotes', 'action:pacotes.criar_editar'] },
  { key: 'novo-fornecedor', label: 'Novo fornecedor', icon: Truck, to: '/fornecedores?novo=1', requires: ['page:fornecedores'] },
  { key: 'lembretes', label: 'Lembretes diários', icon: BellRing, to: '/lembretes', requires: [] },
  { key: 'novo-funcionario', label: 'Adicionar funcionário', icon: UserCog, to: '/usuarios?novo=1', requires: ['page:usuarios'] },
]
