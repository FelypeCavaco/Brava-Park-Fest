# Brava Park Fest

Sistema interno de gestão para casa de festas, com duas unidades — **Vila
Operária** e **São Vicente** — selecionáveis pela barra lateral. Cobre: mapa
de reservas, clientes, pacotes, contratos em PDF, pagamentos (sinal +
parcelas), CAC de tráfego pago e funil de conversão. Ver `DESIGN.md` para os
tokens visuais (paleta oficial da marca) usados na interface.

Este projeto foi montado como **ponto de partida** — a estrutura, o banco de dados e
as telas principais já existem, mas as páginas ainda usam dados de exemplo
(`mockData`) no lugar de consultas reais ao Supabase. Os pontos exatos onde plugar
o Supabase estão marcados com `// TODO` em cada arquivo.

## Stack

- **React + TypeScript + Vite**
- **Tailwind CSS** para estilo
- **Supabase** (Postgres + Auth) como backend
- **React Router** para navegação
- **Recharts** para os gráficos (faturamento, CAC)
- **lucide-react** para ícones

## Como rodar

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Crie um projeto gratuito em [supabase.com](https://supabase.com).
3. No SQL Editor do Supabase, rode o conteúdo de `supabase/schema.sql` — isso cria
   todas as tabelas (espaços, clientes, reservas, pacotes, contratos, pagamentos,
   marketing_spend, etc.) já com Row Level Security configurada para usuários
   autenticados.
4. Em **Authentication > Users** no Supabase, crie manualmente os logins da sua
   equipe (email + senha).
5. Copie `.env.example` para `.env` e preencha com a URL e a chave anon do seu
   projeto (em **Settings > API** no Supabase).
6. Rode o projeto:
   ```bash
   npm run dev
   ```

## Visão completa do projeto e fases

Este projeto nasceu como substituto do RecreaSoft, mas a visão final é uma
plataforma completa: agenda, CRM, portfólio comercial, contratos, financeiro,
rentabilidade por festa, operação (checklist/escala/estoque/equipamentos),
marketing (CAC/funil), pós-venda/NPS e, mais à frente, WhatsApp, pagamento
online e um assistente com IA sobre os dados do sistema.

Fases recomendadas (da mais essencial para a mais avançada):

1. **Base** — login, usuários e permissões, espaços, clientes, calendário,
   reservas, bloqueio de conflitos — *cobertura atual do schema/telas*
2. **Comercial** — portfólio, CRM, pipeline, orçamentos, propostas em PDF,
   origem dos leads, follow-up
3. **Contratos e financeiro** — contratos em PDF, sinal/parcelas, contas a
   receber, fluxo de caixa, despesas, rentabilidade por festa
4. **Operacional** — checklists, escala, estoque, equipamentos, manutenção,
   ocorrências
5. **Marketing e indicadores** — CAC, conversão, ticket médio, NPS, ocupação
6. **Automação** — WhatsApp, lembretes automáticos, pós-venda, pagamentos online
7. **IA** — assistente interno, previsão de ocupação, sugestões de preço
   (removido do escopo por enquanto — ver nota abaixo)

> **Nota:** chegamos a montar uma primeira versão do assistente de IA (chat
> dentro do sistema), mas ela foi removida por decisão consciente: um
> assistente automatizado dentro do app faz uma chamada paga à API da
> Anthropic a cada pergunta. Por enquanto, perguntas sobre os dados podem ser
> feitas diretamente numa conversa com o Claude (ex: exportando os dados
> relevantes e colando na conversa), sem custo extra além da assinatura já
> paga. Se um dia fizer sentido automatizar isso dentro do sistema, é só
> retomar essa fase.

Este scaffold cobre a **Fase 1 por completo** (banco de dados + telas), e já
inclui versões iniciais de partes das Fases 2, 3 e 5 (pacotes, contratos,
pagamentos, CAC, funil) para adiantar o caminho — mas essas ainda precisam ser
aprofundadas (pipeline Kanban, propostas em PDF, rentabilidade por festa,
despesas, etc.) quando chegar a hora.

## O que já está pronto

- Estrutura do projeto (Vite + React + TypeScript + Tailwind)
- Schema completo do banco de dados (`supabase/schema.sql`), incluindo:
  - `user_profiles` com perfis (administrador, financeiro, comercial, operacional)
  - `audit_log` para registrar criação/alteração/exclusão de dados sensíveis
  - `waitlist` (lista de espera por data/espaço)
  - `buffer_minutes` e `availability_notes` em cada espaço
- Tipos TypeScript espelhando o banco (`src/types/index.ts`)
- Layout com barra lateral e navegação entre todas as seções
- Tela de login (já conectada ao Supabase Auth)
- Mapa de reservas com visão "Lista" e "Agenda de hoje", lista de espera, e
  painel de acesso rápido ao clicar numa festa (cliente, contrato, pagamentos,
  checklist, equipe)
- Seletor de unidade na barra lateral (Vila Operária / São Vicente / ambas),
  aplicado ao painel principal, mapa de reservas e lista de espera
- Painel principal com comparativo de faturamento entre as duas unidades e
  mapa de calor de ocupação dos próximos 10 dias
- Todas as telas principais com interface pronta e dados de exemplo:
  - Painel (dashboard com indicadores e gráfico de faturamento)
  - Mapa de reservas
  - Clientes
  - Pacotes e itens extras
  - Contratos
  - Pagamentos (sinal + parcelas)
  - Tráfego pago e CAC
  - Funil de conversão

## Próximos passos (para continuar no Claude Code)

1. Trocar os dados de exemplo (`mockReservations`, `mockClients`, etc.) por
   consultas reais ao Supabase em cada página (`supabase.from('...').select()`).
2. Criar os formulários de cadastro/edição (nova reserva, novo cliente, novo
   pacote) — hoje os botões "Novo/Nova ..." ainda não abrem um formulário.
3. Implementar a geração do PDF do contrato (sugestão: uma Supabase Edge Function
   que recebe o `reservation_id`, monta o texto a partir do template e devolve o
   PDF).
4. Proteger as rotas internas verificando a sessão do Supabase Auth (redirecionar
   para `/login` se não houver usuário logado) — hoje isso está marcado como TODO
   em `src/App.tsx`.
5. Trocar o calendário simplificado (lista) do Mapa de Reservas por uma grade de
   calendário completa, se fizer falta visualizar o mês inteiro de uma vez.
6. Ligar o campo de gasto em tráfego pago (`marketing_spend`) e o cálculo de CAC a
   dados reais dos contratos fechados no mês.
7. Criar a tela de gestão de usuários (convidar/editar/desativar) usando a tabela
   `user_profiles`, e depois restringir as políticas de RLS por perfil (hoje
   qualquer usuário autenticado tem acesso total).
8. Popular a `audit_log` a partir das ações da aplicação (ou via trigger no
   Postgres) sempre que uma reserva, contrato ou pagamento for criado/alterado.
9. Quando for para a Fase 2, criar o pipeline Kanban de orçamentos, a geração de
   propostas comerciais em PDF e o cadastro estruturado do portfólio comercial.
10. Trocar a lista fixa de unidades em `src/lib/UnitContext.tsx` por uma consulta
    real à tabela `units`, e os dados de exemplo por unidade (`statsByUnit`,
    `SPACES_BY_UNIT`, etc.) por consultas filtrando por `unit_id`.
