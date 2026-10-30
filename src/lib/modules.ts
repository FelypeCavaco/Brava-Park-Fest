// Funções que o administrador geral liga ou desliga por empresa (painel da
// plataforma). Desligada, some do menu, das telas e dos atalhos daquela
// empresa — até para o administrador dela. O núcleo (reservas, clientes,
// pacotes, pagamentos, financeiro) não entra aqui: é sempre ligado.
export interface ModuloOpcional {
  id: string
  label: string
  descricao: string
  // chaves de permissão da função; terminando em "." vale para todas as ações dela
  keys: string[]
}

export const MODULOS: ModuloOpcional[] = [
  { id: 'agenda', label: 'Agenda', descricao: 'Calendário de visitas e compromissos, com aviso no Painel.', keys: ['page:visitas'] },
  { id: 'comissoes', label: 'Comissões', descricao: 'Comissão por festa cadastrada e repasse semanal.', keys: ['page:comissoes', 'action:comissoes.'] },
  { id: 'marketing', label: 'Marketing e funil', descricao: 'Ocupação, perfil das festas, canais, tráfego, CAC e funil de vendas.', keys: ['page:marketing', 'page:funil'] },
  { id: 'estoque', label: 'Estoque e consumo', descricao: 'Estoque, lista de compras e consumo por convidado.', keys: ['page:estoque', 'action:estoque.'] },
  { id: 'acertos', label: 'Acertos entre unidades', descricao: 'Para empresas com mais de uma unidade que trocam estoque.', keys: ['page:acertos', 'action:acertos.'] },
  { id: 'propostas', label: 'Propostas comerciais', descricao: 'Propostas em PDF para enviar aos clientes.', keys: ['page:propostas'] },
  { id: 'escalas', label: 'Escalas da equipe', descricao: 'Escala de monitores e equipe por festa.', keys: ['page:escalas'] },
  { id: 'reativacao', label: 'Reativação de clientes', descricao: 'Lembrete de aniversário para chamar clientes antigos.', keys: ['page:reativacao'] },
  { id: 'satisfacao', label: 'Satisfação (NPS)', descricao: 'Pesquisa de satisfação depois da festa.', keys: ['page:satisfacao'] },
  { id: 'lucro', label: 'Lucro por festa', descricao: 'Resultado de cada festa (receita menos custos).', keys: ['page:lucro_por_festa'] },
]

export function chaveDesligada(key: string, desligados: string[]): boolean {
  if (desligados.length === 0) return false
  return MODULOS.some((m) => desligados.includes(m.id) && m.keys.some((k) => (k.endsWith('.') ? key.startsWith(k) : key === k)))
}
