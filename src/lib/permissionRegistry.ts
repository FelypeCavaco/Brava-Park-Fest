// Catálogo de tudo que pode ser ligado/desligado por perfil — cada página e
// cada ação/botão sensível do sistema tem uma "chave" aqui, usada tanto pela
// tela de edição de permissões (Usuários e permissões) quanto pelos
// componentes que escondem página/botão quando o perfil não pode usar.
// Administrador nunca aparece nessa lista pra edição: ele sempre tem acesso
// total, garantido direto no código (ver src/lib/permissions.ts).

export interface PermissionDef {
  key: string
  label: string
  group: string
  route?: string // rota associada, quando esta chave é o acesso à própria página
}

export const PERMISSION_GROUPS: { group: string; items: PermissionDef[] }[] = [
  {
    group: 'Painel',
    items: [{ key: 'page:painel', label: 'Ver o Painel principal', group: 'Painel', route: '/' }],
  },
  {
    group: 'Lembretes diários',
    items: [{ key: 'page:lembretes', label: 'Ver Lembretes diários', group: 'Lembretes diários', route: '/lembretes' }],
  },
  {
    group: 'Mapa de reservas',
    items: [
      { key: 'page:reservas', label: 'Ver o Mapa de reservas', group: 'Mapa de reservas', route: '/reservas' },
      { key: 'action:reservas.nova_reserva', label: 'Criar nova reserva', group: 'Mapa de reservas' },
      { key: 'action:reservas.lista_espera', label: 'Adicionar/remover/avisar lista de espera', group: 'Mapa de reservas' },
    ],
  },
  {
    group: 'Agenda de visitas',
    items: [{ key: 'page:visitas', label: 'Ver Agenda de visitas', group: 'Agenda de visitas', route: '/visitas' }],
  },
  {
    group: 'Central da festa',
    items: [
      { key: 'page:festa_detalhe', label: 'Abrir a Central de uma festa', group: 'Central da festa', route: '/reservas/:id' },
      { key: 'action:festa.editar_dados', label: 'Editar tema, sabores e trocar dados gerais', group: 'Central da festa' },
      { key: 'action:festa.trocar_pacote', label: 'Trocar o pacote da festa', group: 'Central da festa' },
      { key: 'action:festa.pagamentos', label: 'Registrar/remover pagamentos', group: 'Central da festa' },
      { key: 'action:festa.itens_extras', label: 'Adicionar itens extras', group: 'Central da festa' },
      { key: 'action:festa.consumo_pos_festa', label: 'Lançar consumo pós-festa', group: 'Central da festa' },
      { key: 'action:festa.checklist', label: 'Marcar itens do checklist', group: 'Central da festa' },
      { key: 'action:festa.equipe', label: 'Gerenciar escala da equipe', group: 'Central da festa' },
      { key: 'action:festa.documentos', label: 'Anexar/remover documentos', group: 'Central da festa' },
      { key: 'action:festa.lista_convidados', label: 'Gerar link e gerenciar lista de convidados', group: 'Central da festa' },
      { key: 'action:festa.excluir_festa', label: 'Excluir a festa inteira', group: 'Central da festa' },
    ],
  },
  {
    group: 'Clientes',
    items: [
      { key: 'page:clientes', label: 'Ver Clientes', group: 'Clientes', route: '/clientes' },
      { key: 'action:clientes.criar_editar', label: 'Criar/editar cliente', group: 'Clientes' },
      { key: 'action:clientes.excluir', label: 'Excluir cliente', group: 'Clientes' },
    ],
  },
  {
    group: 'Reativação de clientes',
    items: [{ key: 'page:reativacao', label: 'Ver Reativação de clientes', group: 'Reativação de clientes', route: '/reativacao' }],
  },
  {
    group: 'Satisfação (NPS)',
    items: [{ key: 'page:satisfacao', label: 'Ver Satisfação (NPS)', group: 'Satisfação (NPS)', route: '/satisfacao' }],
  },
  {
    group: 'Pacotes e itens',
    items: [
      { key: 'page:pacotes', label: 'Ver Pacotes e itens', group: 'Pacotes e itens', route: '/pacotes' },
      { key: 'action:pacotes.criar_editar', label: 'Criar/editar pacote', group: 'Pacotes e itens' },
      { key: 'action:pacotes.excluir', label: 'Excluir pacote', group: 'Pacotes e itens' },
    ],
  },
  {
    group: 'Contratos',
    items: [{ key: 'page:contratos', label: 'Ver Contratos', group: 'Contratos', route: '/contratos' }],
  },
  {
    group: 'Propostas comerciais',
    items: [{ key: 'page:propostas', label: 'Ver Propostas comerciais', group: 'Propostas comerciais', route: '/propostas' }],
  },
  {
    group: 'Tráfego e CAC',
    items: [{ key: 'page:marketing', label: 'Ver Tráfego e CAC', group: 'Tráfego e CAC', route: '/marketing' }],
  },
  {
    group: 'Funil de conversão',
    items: [{ key: 'page:funil', label: 'Ver Funil de conversão', group: 'Funil de conversão', route: '/funil' }],
  },
  {
    group: 'Pagamentos',
    items: [{ key: 'page:pagamentos', label: 'Ver Pagamentos', group: 'Pagamentos', route: '/pagamentos' }],
  },
  {
    group: 'Financeiro',
    items: [
      { key: 'page:financeiro', label: 'Ver Financeiro', group: 'Financeiro', route: '/financeiro' },
      { key: 'action:financeiro.registrar_despesa', label: 'Registrar conta a pagar', group: 'Financeiro' },
      { key: 'action:financeiro.despesas_fixas', label: 'Gerenciar despesas fixas', group: 'Financeiro' },
      { key: 'action:financeiro.marcar_pago', label: 'Marcar conta como paga', group: 'Financeiro' },
      { key: 'action:financeiro.remover', label: 'Remover despesa', group: 'Financeiro' },
    ],
  },
  {
    group: 'Resultado do mês',
    items: [{ key: 'page:resultado_do_mes', label: 'Ver Resultado do mês', group: 'Resultado do mês', route: '/resultado-do-mes' }],
  },
  {
    group: 'Lucro por festa',
    items: [{ key: 'page:lucro_por_festa', label: 'Ver Lucro por festa', group: 'Lucro por festa', route: '/lucro-por-festa' }],
  },
  {
    group: 'Relatórios e metas',
    items: [{ key: 'page:relatorios', label: 'Ver Relatórios e metas', group: 'Relatórios e metas', route: '/relatorios' }],
  },
  {
    group: 'Estoque',
    items: [{ key: 'page:estoque', label: 'Ver Estoque', group: 'Estoque', route: '/estoque' }],
  },
  {
    group: 'Fornecedores',
    items: [{ key: 'page:fornecedores', label: 'Ver Fornecedores', group: 'Fornecedores', route: '/fornecedores' }],
  },
  {
    group: 'Escalas',
    items: [{ key: 'page:escalas', label: 'Ver Escalas', group: 'Escalas', route: '/escalas' }],
  },
  {
    group: 'Relatório de aniversariantes',
    items: [{ key: 'page:relatorio_aniversariantes', label: 'Ver Relatório de aniversariantes', group: 'Relatório de aniversariantes', route: '/relatorio-aniversariantes' }],
  },
]

export const ALL_PERMISSIONS: PermissionDef[] = PERMISSION_GROUPS.flatMap((g) => g.items)

// path -> permission_key, pra checagem de rota (Sidebar/RequireAuth)
export const PAGE_PERMISSION_BY_PATH: { test: (pathname: string) => boolean; key: string }[] = [
  { test: (p) => p === '/', key: 'page:painel' },
  { test: (p) => p === '/lembretes', key: 'page:lembretes' },
  { test: (p) => p === '/reservas', key: 'page:reservas' },
  { test: (p) => p.startsWith('/reservas/'), key: 'page:festa_detalhe' },
  { test: (p) => p === '/visitas', key: 'page:visitas' },
  { test: (p) => p === '/clientes', key: 'page:clientes' },
  { test: (p) => p === '/reativacao', key: 'page:reativacao' },
  { test: (p) => p === '/satisfacao', key: 'page:satisfacao' },
  { test: (p) => p === '/pacotes', key: 'page:pacotes' },
  { test: (p) => p === '/contratos', key: 'page:contratos' },
  { test: (p) => p === '/propostas', key: 'page:propostas' },
  { test: (p) => p === '/marketing', key: 'page:marketing' },
  { test: (p) => p === '/funil', key: 'page:funil' },
  { test: (p) => p === '/pagamentos', key: 'page:pagamentos' },
  { test: (p) => p === '/financeiro', key: 'page:financeiro' },
  { test: (p) => p === '/resultado-do-mes', key: 'page:resultado_do_mes' },
  { test: (p) => p === '/lucro-por-festa', key: 'page:lucro_por_festa' },
  { test: (p) => p === '/relatorios', key: 'page:relatorios' },
  { test: (p) => p === '/estoque', key: 'page:estoque' },
  { test: (p) => p === '/fornecedores', key: 'page:fornecedores' },
  { test: (p) => p === '/escalas', key: 'page:escalas' },
  { test: (p) => p === '/relatorio-aniversariantes', key: 'page:relatorio_aniversariantes' },
  // /usuarios não entra aqui: continua sendo administrador-only, fixo no código
]
