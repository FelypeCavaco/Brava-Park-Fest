# Brava Park Fest — Documentação completa do sistema de gestão

*Versão de 06/10/2026 — descreve o sistema exatamente como está em uso hoje.*

> **Para a IA revisora.** Este documento foi escrito para você fazer uma análise crítica do sistema e sugerir o que mudar e o que implementar. Ele descreve o negócio, a arquitetura, o modelo de dados, cada tela e cada regra de negócio, além das limitações conhecidas, sem maquiagem. Junto com ele você recebe um **link e um login** para navegar pelo sistema (veja a seção 14). **Não preciso de elogio, preciso de lacunas.** No final (seção 15) estão as perguntas que quero que você responda.

---

## Sumário

1. O negócio
2. Quem usa e como
3. Arquitetura técnica e infraestrutura
4. Segurança, login e permissões
5. Modelo de dados
6. Automações que rodam no banco de dados
7. Telas do sistema, uma por uma
8. A Central da festa (tela mais importante)
9. Páginas públicas (sem login)
10. Recursos transversais (busca, desfazer, histórico, PDF, WhatsApp)
11. Regras de negócio consolidadas
12. Limitações e dívidas técnicas conhecidas
13. Histórico recente de evolução
14. Como acessar o sistema
15. O que eu quero de você

---

## 1. O negócio

**Brava Park Fest** é uma casa de festas infantis com **duas unidades físicas independentes**: **Vila Operária** e **São Vicente** (Brasil). Cada unidade funciona quase como uma empresa separada:

- tem a sua própria conta bancária e dados jurídicos (CNPJ, razão social) usados no contrato;
- tem os seus próprios pacotes e preços, estoque, equipe e grupo de WhatsApp de fornecedores;
- tem um único espaço (não existem salões separados dentro de uma unidade) — **uma festa por dia por unidade**.

O produto vendido é a **festa completa**: espaço + buffet (pratos quentes, bolo, docinhos, salgadinhos, bebidas) + equipe + duração definida, em pacotes por número de convidados (ex: 40, 50 ou 60 pessoas) e por nível (ex: Classic, Gourmet). O preço muda entre dia de semana (seg–qui) e fim de semana (sex–dom). Itens extras (ex: cabine de fotos, hora extra) são vendidos à parte.

O ciclo de vida típico de um cliente:

1. Chega um contato (Instagram, Google, Facebook, indicação…).
2. Agenda uma **visita** ao espaço.
3. Recebe uma **proposta comercial** em PDF.
4. Fecha: vira uma **reserva** (orçamento → confirmada), assina o **contrato**, paga sinal e parcelas.
5. Antes da festa: envia a **lista de convidados** por um link, escolhe os pratos e o bolo, a casa escala a **equipe**, confere o **estoque** e avisa os **fornecedores**.
6. No dia: check-in dos convidados na portaria, equipe marca presença.
7. Depois: lança o **consumo pós-festa**, paga a equipe, pede **avaliação** (Google + formulário próprio).
8. Meses depois: o sistema lembra de **reativar** o cliente perto do próximo aniversário da criança.

O sistema substituiu um software de mercado (RecreaSoft) e foi construído sob medida, de forma incremental, a partir de pedidos do dono.

---

## 2. Quem usa e como

- **O dono** — acesso total (perfil Administrador). Usa principalmente o celular e o computador.
- **Gerente e equipe** — perfis criados pelo próprio dono (ex: Financeiro, Comercial, Operacional, Recepção), cada um com o seu conjunto de permissões.
- **Clientes (contratantes)** — não têm login. Interagem só por dois links públicos: a lista de convidados e o formulário de avaliação.

Uso diário real: criar e acompanhar reservas, registrar pagamentos, controlar estoque, escalar equipe, mandar mensagens de WhatsApp prontas.

---

## 3. Arquitetura técnica e infraestrutura

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + TypeScript + Vite 5 + Tailwind CSS 3, React Router 6, Recharts (gráficos), lucide-react (ícones), date-fns |
| PDFs | jsPDF e html2pdf.js, carregados sob demanda (geram download de verdade, não dependem da impressão do navegador) |
| Backend | Supabase: Postgres + Auth (email/senha) + Storage (arquivos) + uma Edge Function |
| Servidor próprio | **Não existe.** O navegador fala direto com o Supabase. Toda a proteção é feita no banco (Row Level Security + funções). |
| Hospedagem | Cloudflare Workers (site estático). Cada envio para a branch `main` do GitHub publica sozinho em ~1–2 minutos. |
| Banco: mudanças | Arquivos SQL numerados (`supabase/002…055_*.sql`), rodados **manualmente** pelo dono no SQL Editor do Supabase. Todos espelhados em `supabase/schema.sql` (instalador do zero). |
| Testes | **Nenhum teste automatizado.** Verificação é feita por compilação (TypeScript), build e testes manuais. |

Tamanho aproximado: ~15 mil linhas nas telas (`src/pages`), sendo ~3.800 só na Central da festa; ~55 migrations; ~45 tabelas.

**Ordem de publicação:** quando uma mudança precisa de coluna/tabela nova, primeiro o dono roda o SQL no Supabase, depois o código é publicado. Quando a mudança remove um acesso que o código antigo usa, é feita em duas etapas (ex: migrations 052 e 053).

---

## 4. Segurança, login e permissões

### 4.1 Login
- Supabase Auth com email e senha.
- Funcionários são criados pela tela de Usuários, que chama a Edge Function `create-employee` (usa a chave de serviço; só administrador ativo pode chamar). Ela cria o login e o perfil e mostra uma senha provisória para copiar.
- Usuário marcado como **inativo** é deslogado automaticamente e perde acesso a todas as tabelas.

### 4.2 Perfis e permissões (RBAC)
- **Perfis dinâmicos** (`roles`): o dono cria, edita e exclui perfis pela tela. O perfil com `is_admin = true` ("Administrador") tem acesso total e não passa por checagem.
- **Permissões por perfil** (`role_permission_items`): cerca de 65 chaves — uma por página (`page:financeiro`, `page:estoque`…) e uma por ação sensível (`action:festa.pagamentos`, `action:festa.trocar_pacote`, `action:festa.equipe`, `action:clientes.excluir`, `action:financeiro.marcar_pago`, `action:festa.excluir`…).
- **Ajuste individual** (`user_permission_overrides`): libera ou bloqueia uma chave para uma pessoa específica, vencendo o que o perfil dela diz.
- **Regra fail-closed** (desde a migration 046): se não existe linha dizendo "liberado", está **negado**.
- **Onde é aplicado:**
  - na tela, o menu esconde páginas sem permissão, o guard de rota bloqueia URL digitada e o componente `<Can>` esconde botões;
  - **no banco** (o que realmente protege), as políticas RLS de cada tabela chamam `has_permission(auth.uid(), 'chave')` e `is_active_user(...)`. Quem tentar chamar a API do Supabase direto do console do navegador também é barrado.
- Cobertura de botões: nem toda ação tem chave própria. Várias páginas têm só a permissão de página inteira.

### 4.3 Correções de segurança já feitas
- **045/046:** antes, qualquer funcionário logado podia se promover a administrador escrevendo no próprio perfil, e todas as tabelas aceitavam qualquer usuário autenticado. Corrigido com RBAC no banco.
- **052/053:** os links públicos (lista de convidados e avaliação) usavam políticas abertas que permitiam a quem não estava logado ler dados de **outras** festas. Agora o visitante sem login não acessa nenhuma tabela diretamente — só funções específicas que exigem o token do link e devolvem apenas os dados daquela festa, com limites (máx. 300 nomes por envio e 1.000 por lista; máx. 3 avaliações por link).
- **RLS sem recursão:** checagens de "é admin?" ficam em funções `security definer` (`is_admin_user`) para evitar o erro de recursão infinita do Postgres.

---

## 5. Modelo de dados

Principais tabelas (nomes reais no Postgres):

**Estrutura**
- `units` — as duas unidades: endereço, CNPJ, razão social, responsável, chave Pix, link de avaliação do Google, link do grupo de WhatsApp de fornecedores.
- `spaces` — o espaço físico de cada unidade (1 por unidade).

**Clientes e comercial**
- `clients` — contratante: nome, telefone, email, CPF, endereço estruturado (com busca de CEP), origem do contato (`source`: instagram, google, facebook, indicação, outro), indicação (`referred_by`), nome e **data de nascimento da criança**, pontos de fidelidade, status de reativação, último contato e data da última festa.
- `visits` — visitas agendadas ao espaço, com responsável e resultado (virou orçamento / não avançou + motivo).
- `proposals` — propostas comerciais (pacote, extras, total, status enviada/aceita/recusada + motivo da recusa).
- `leads`, `waitlist` (lista de espera por data/unidade), `contact_history` (registro das mensagens de WhatsApp enviadas pelo sistema, com o nome de quem enviou), `marketing_spend` (gasto em tráfego pago por mês/unidade), `unit_goals` (meta de faturamento mensal).

**Produto**
- `packages` — pacotes por unidade:
  - preço padrão ou preço seg–qui / sex–dom;
  - limite de convidados, duração e itens inclusos (vão para o contrato);
  - **período de validade** (`valid_from` / `valid_until`). Ex: a tabela 2026 de São Vicente vale até 31/12/2026 e a tabela 2027 a partir de 01/01/2027. O formulário de reserva só oferece pacotes válidos na data da festa.
- `extra_items` — itens extras avulsos.
- `package_costs` — "ficha técnica" de custo de cada pacote por categoria (sugestão ao lançar custos da festa).

**A festa**
- `reservations` — a festa:
  - unidade, cliente, pacote, data, início e fim, tipo de evento, convidados e cortesias;
  - nome e idade do aniversariante, tema, sabores do prato quente e do bolo;
  - `total_value` (valor cheio) e `final_value` (valor firmado com desconto), tipo e valor do desconto;
  - status (`orcamento`, `confirmada`, `quitada`, `cancelada`; o valor legado `sinal_pago` não é mais usado);
  - dados de cancelamento (motivo, % de multa retida, valor devolvido).
  - Índice único: só uma festa não cancelada por unidade por dia.
- `reservation_birthday_kids` — aniversariantes adicionais (irmãos na mesma festa).
- `payments` — cada valor recebido é uma linha (data, valor, forma de pagamento). Não há cronograma de parcelas.
- `payment_method_fees` — taxa da maquininha por forma de pagamento (editável).
- `reservation_extra_items` — extras vendidos na festa, com o preço congelado no momento da venda.
- `reservation_costs` — custos daquela festa (fornecedor, equipe, despesa fixa da festa). Separado de `expenses` de propósito, para não contar o mesmo gasto duas vezes.
- `reservation_consumption` — consumo cobrado à parte no fim da festa (ex: chopp por litro).
- `reservation_stock_consumption` — baixa de estoque feita pela festa.
- `checklist_items` — checklist operacional da festa.
- `staff_members` — cadastro fixo de funcionários da operação (nome, telefone, função mais comum).
- `staff_assignments` — escala da festa:
  - funcionário e função;
  - presença (`attended`, `attended_at`) e o pagamento lançado (`payment_cost_id`, ligação com o custo);
  - status escalado/substituído, com nome do substituto, motivo e ligação com a escala substituída.
- `reservation_notes` — observações da festa, com lembrete opcional numa data (aparece no Painel).
- `reservation_documents` — arquivos anexados (Supabase Storage, bucket privado).
- `contracts` / `contract_templates` — contrato gerado por festa a partir do modelo da unidade.
- `guest_list_pages` / `guest_list_entries` — link público da lista de convidados (token), nomes, chegada (check-in), sinalização (`flagged`) e link de playlist do Spotify.
- `review_links` / `party_reviews` — link público de avaliação e as respostas (nota de 1 a 5 por categoria + comentário).
- `nps_responses` — NPS clássico (0–10) registrado manualmente.

**Financeiro e operação**
- `expenses` — contas a pagar: categoria, fornecedor, valor, vencimento, status (a vencer/pago/atrasado/cancelado), forma e data do pagamento, ligação com a despesa fixa que a gerou.
- `recurring_expenses` — despesas fixas mensais (aluguel, folha…), com dia de vencimento e mês inicial.
- `festa_fixed_costs` / `festa_fixed_cost_package_amounts` — **despesas fixas das festas**: custo que toda festa tem (ex: docinhos R$ 600), com valor padrão, unidade e valor diferente por pacote.
- `expense_items` — itens de estoque comprados junto com uma conta a pagar.
- `inventory_items` / `inventory_purchase_variants` — estoque por unidade: quantidade, mínimo, consumo por convidado, fornecedor e tamanhos de compra (ex: suco em garrafa de 1,5 L, 3 L ou 5 L convertido em litros).
- `suppliers` / `supplier_bookings` — fornecedores terceirizados, contratações e avaliações.
- `message_templates` — mensagens de WhatsApp editáveis pela equipe.

**Controle**
- `roles`, `role_permission_items`, `user_permission_overrides`, `user_profiles` — permissões (seção 4).
- `audit_log` — histórico de quem fez o quê (seção 6.3).

---

## 6. Automações que rodam no banco de dados

São regras de banco (gatilhos e funções), por isso valem para qualquer tela e qualquer pessoa.

### 6.1 Status da festa automático (migration 055)
- Valor devido = `final_value` + extras vendidos + consumo pós-festa.
- Orçamento sem nenhum pagamento → continua **Orçamento**.
- Pagou menos que o devido → **Confirmada**.
- Pagou tudo → **Quitada**.
- **Cancelada** nunca muda sozinha.
- Recalcula quando entra, muda ou sai pagamento, extra ou consumo, e quando o valor da festa muda.

### 6.2 Despesa fixa das festas (migration 050)
- Ao criar uma festa, o sistema lança sozinho, nos custos dela, cada despesa fixa da unidade, com o valor do pacote da festa (ou o valor padrão).
- Ao trocar o pacote da festa, os valores são recalculados.
- Ao editar o valor de uma despesa fixa, as festas **futuras** são atualizadas.
- Ao cancelar a festa, os custos fixos saem. Ao descancelar ou mudar de unidade, entram de novo.
- Não é retroativo: festas que já existiam antes do cadastro da despesa não recebem o lançamento (decisão do dono).

### 6.3 Histórico completo (migration 055)
- Um gatilho em 27 tabelas grava em `audit_log` toda criação, alteração e exclusão:
  - quem fez (usuário logado e o nome dele);
  - qual tabela e registro, e a festa relacionada;
  - para alterações, o valor **de → para** de cada campo mudado.
- Textos longos são encurtados para 300 caracteres. Ações feitas pelos links públicos aparecem como "Link público ou sistema".
- O histórico vale só daqui para a frente. Ações anteriores não têm autor registrado.

### 6.4 Outras funções
- **Despesas fixas mensais.** `ensure_recurring_expenses_current_month` cria o lançamento do mês em contas a pagar. Roda de forma "preguiçosa", toda vez que o Painel ou o Financeiro abrem (não há agendador).
- **Estoque.** `record_stock_purchase` / `undo_stock_purchase` e `record_stock_consumption` / `undo_stock_consumption` / `update_stock_consumption` somam e subtraem do estoque de forma atômica.
- **Despesas fixas das festas.** `save_festa_fixed_cost` / `delete_festa_fixed_cost` gravam a despesa fixa e propagam para as festas.
- **Links públicos.** `public_*` são as funções dos links públicos (seção 9).

---

## 7. Telas do sistema, uma por uma

Barra lateral com um **seletor de unidade** (Vila Operária / São Vicente / Ambas), que filtra quase todas as telas, e uma **busca global** no topo.

### 7.1 Painel (Dashboard)
- **Indicadores do mês:**
  - faturamento recebido;
  - festas confirmadas;
  - ocupação dos espaços (% de dias com festa);
  - CAC × ticket médio;
  - meta de faturamento com barra de progresso.
- Gráfico de faturamento recebido por unidade nos últimos 6 meses.
- **Ações rápidas** (atalhos que respeitam as permissões): nova reserva, agendar visita, novo cliente, nova despesa, novo pacote, novo fornecedor, lembretes, adicionar funcionário.
- **Alertas:**
  - festas dos próximos 14 dias com dado faltando (tema, sabores, aniversariante);
  - clientes cuja criança faz aniversário em 1 a 3 meses e que ainda não marcaram festa naquele ano;
  - contas a pagar vencendo em 14 dias (vermelho se vencida);
  - saldo em aberto das festas dos próximos 7 dias.
- **Lembretes** das observações das festas (com botão Concluir).
- **Atividade recente**: as últimas ações de qualquer pessoa, com nome e o que mudou.

### 7.2 Lembretes diários
Lista calculada sozinha, cada item com botão que abre o WhatsApp com a mensagem pronta:
- pagamento pendente perto da festa;
- festa é amanhã;
- pedir avaliação da festa de ontem.

Não repete um lembrete que já foi enviado no mesmo dia.

### 7.3 Mapa de reservas
- **Calendário mensal** com o nome de cada festa na cor do status: rosa = Confirmada, verde = Quitada, vermelho e riscado = Cancelada, cinza = Orçamento. Há também uma visão em lista e a "agenda de hoje".
- **Nova reserva:**
  - cliente existente ou cadastro rápido sem sair da tela;
  - unidade, data, horário e tipo de evento;
  - pacote: só os válidos na data, em ordem alfabética e numérica, com preço calculado por dia da semana;
  - convidados e cortesias;
  - aniversariante puxado do cadastro do cliente, com a idade calculada pela data de nascimento e pela data da festa; dá para incluir mais aniversariantes;
  - tema e sabores (pratos separados por "/", o número de pratos varia com o plano);
  - desconto (valor ou %);
  - status inicial: Orçamento ou Confirmada.
- **Trava de duplicidade:** avisa antes de salvar se já existe festa ativa na mesma unidade e data, e o banco também bloqueia.
- **Lista de espera:** cliente, data desejada e unidade. Mostra "Vaga disponível!" quando a data fica livre e tem botão para avisar o cliente por WhatsApp.
- Clicar numa festa abre um resumo com o botão "Abrir Central da festa".

### 7.4 Agenda de visitas
Agendar visita (cliente, unidade, data/hora, responsável) e registrar o resultado: virou orçamento, ou não avançou (com o motivo).

### 7.5 Clientes
- Cadastro completo (busca de CEP via ViaCEP), edição e exclusão, origem, indicação, criança e data de nascimento.
- Selo de fidelidade e pontos (veja a limitação na seção 12).
- Histórico de pagamentos do cliente e ações de WhatsApp (enviar orçamento, pedir avaliação).

### 7.6 Reativação de clientes
- Clientes com criança cadastrada, ordenados pelo próximo aniversário. Destaca quem está a 1 a 3 meses e exclui quem já tem festa marcada naquele ano.
- Funil de status: nova oportunidade → contatado → negociação → nova reserva / sem interesse.
- Botão de mensagem de reativação.

### 7.7 Satisfação (NPS)
- Registro manual de nota de 0 a 10, com promotores, neutros, detratores e NPS.
- Avaliações detalhadas vindas do formulário público: médias de pratos quentes, bolo, docinhos, salgadinhos e atendimento, mais os comentários.

### 7.8 Pacotes e itens
- Criar e editar pacotes com:
  - preço padrão ou seg–qui / sex–dom;
  - limite de convidados, duração e itens inclusos;
  - **validade** ("vale para festas a partir de / até").
- Sempre em ordem alfabética, com números em ordem crescente (40, 50, 60).
- Ficha técnica de custo por categoria.
- Itens extras.

### 7.9 Contratos
- Modelo de contrato **por unidade**, com variáveis preenchidas pelos dados da festa: contratante (nome, CPF, endereço, telefone), contratada (razão social, CNPJ, endereço, responsável), data, horários, duração, local, plano e itens, limite de convidados, tema, aniversariante, valor total, sinal, hora extra e chave Pix.
- Gera o contrato da festa, que fica **congelado**. Dá para **editar o texto já gerado** (lápis) e baixar o PDF de novo.

### 7.10 Propostas comerciais
- Monta a proposta (cliente, unidade, data opcional, pacote válido na data, extras) e gera um **PDF desenhado** no modelo visual da marca.
- Controla o status (enviada/aceita/recusada + motivo) e permite regerar o PDF.

### 7.11 Tráfego e CAC
- Gasto mensal em tráfego por unidade.
- O CAC é calculado **só sobre clientes vindos de Instagram, Facebook ou Google** e comparado ao ticket médio, com a evolução de 6 meses.

### 7.12 Funil de conversão
Conversão do orçamento até a festa fechada e distribuição das festas fechadas por origem do cliente (gráfico de pizza).

### 7.13 Pagamentos
- Todas as festas com valor firmado, pago e saldo; recebido no total e no mês; saldo em aberto.
- Taxa da maquininha por forma de pagamento (editável) e o valor líquido do mês.

### 7.14 Financeiro
- **Contas a pagar:**
  - registrar (categoria, descrição, fornecedor, valor, vencimento, unidade), editar, marcar como paga (com forma e data do pagamento) e remover;
  - uma compra pode incluir **itens de estoque**, que somam no estoque sozinhos, e a exclusão desfaz.
- **Despesas fixas mensais**, com geração automática do lançamento de cada mês e escolha de começar neste mês ou no próximo.
- **Resumo por unidade:** entradas, a pagar, atrasado, custos de festas do mês e saldo do mês. O saldo só desconta o que já foi pago.
- **Fluxo de caixa futuro** e gráfico de 6 meses: somados com "Ambas as unidades", separados quando uma unidade está selecionada. Clicar num mês abre o detalhe por categoria.
- Despesas por categoria.

### 7.15 Despesa fixa das festas
Cadastro dos custos que toda festa tem: descrição, unidade, valor padrão e **valor por plano** (opcional). Mostra o total por unidade (mínimo e máximo conforme o plano). Funcionamento automático na seção 6.2.

### 7.16 Resultado do mês
Receita recebida − taxas de cartão − despesas gerais pagas − custos de festa = lucro líquido, com margem, alerta de margem baixa, resultado por unidade e os últimos 6 meses.

### 7.17 Lucro por festa
Valor de cada festa menos os custos lançados nela, com lucro total do período e margem média.

### 7.18 Relatórios e metas
- Meta de faturamento por unidade, comparativo entre unidades e projeção de recebimento dos próximos meses.
- Exportação CSV (Excel), com um log de exportações (LGPD) que **só vale durante a sessão**.

### 7.19 Estoque
- Itens por unidade com:
  - quantidade, mínimo, fornecedor e unidade de medida;
  - **consumo por convidado**: o mínimo efetivo passa a ser o necessário para a próxima festa da unidade;
  - botões +/− que andam de inteiro em inteiro, e o valor pode ser digitado livremente (salva meio segundo depois da digitação).
- **Lista de compras** automática: itens abaixo do mínimo.
- **Velas numéricas** (0–9, azul e rosa) numa grade compacta, que também alimenta a lista de compras.
- Edição, remoção e **transferência entre unidades**.

### 7.20 Fornecedores
Cadastro (tipo de serviço, contato, preço combinado), contratações por festa e avaliações pós-evento.

### 7.21 Escalas
Equipe escalada em cada festa num período (sem os substituídos), com exportação em PDF.

### 7.22 Relatório de aniversariantes
Para cozinha e fornecedores: festas do período com tema, sabores, aniversariante, idade, convidados e horário de entrega (1 hora antes da festa). Exporta PDF.

### 7.23 Usuários e permissões
- Adicionar funcionário (nome, email, perfil e senha provisória) e ativar ou desativar.
- Criar e editar perfis marcando as permissões.
- Ajustes individuais por pessoa e opção de "voltar a seguir o perfil".

---

## 8. A Central da festa (tela mais importante)

Rota `/reservas/:id`. É o "hub" de uma festa.

**Cabeçalho**
- Cliente, data, unidade, status e pacote.
- Barra de progresso e valor total (contrato + consumo), com o saldo devedor.
- Botões:
  - Dados do contratante;
  - Observações;
  - WhatsApp: confirmar festa, lembrete, localização, lembrete de pagamento, **Pedidos** (pede ao cliente a escolha de pratos e bolo), lista de convidados, **confirmar com fornecedores** (mensagem editável com horário de entrega calculado) e **pedir avaliação** (escolhe link do Google, formulário próprio ou os dois);
  - cancelar e excluir.

**Aviso de pendências (clicável)**
- Mostra quantas pendências a festa tem: saldo em aberto com vencimento passado, tarefas do checklist atrasadas ou não concluídas no prazo.
- Ao clicar, lista cada uma, com a data, e um botão que leva à aba certa.

**Aba Visão geral**
- Dados da festa, editáveis pelo lápis: data, horários, tipo, convidados, valor, desconto. Reaplica a trava de duplicidade se a data mudar.
- **Trocar pacote:**
  - só pacotes válidos na data;
  - mostra o valor antes e depois;
  - se a festa já tinha pacote, soma ou subtrai **só a diferença**; se não tinha, o valor vira o preço do novo pacote;
  - o histórico mostra quem trocou e o efeito no valor.
- Tema, sabores e aniversariantes.
- **Histórico da festa — quem fez o quê**: todas as alterações daquela festa, com nome, data/hora e campos de → para.
- Documentos anexados (upload e download privados).
- **Lista de convidados:**
  - gera o link público e envia por WhatsApp;
  - check-in de chegada e adição manual na portaria;
  - **sinalizar** convidado (destaque) e enviar os sinalizados ao cliente;
  - em tela cheia, para a portaria;
  - mostra a playlist do Spotify enviada pelo cliente (só Vila Operária).

**Aba Financeiro**
- Pagamentos: registrar e remover, com forma de pagamento.
- Itens extras vendidos.
- **Custos da festa:**
  - sugestões da ficha técnica do pacote, editáveis antes de confirmar;
  - aviso se já existe uma despesa geral parecida no mesmo mês, para não duplicar;
  - selo "fixo" nas despesas fixas automáticas;
  - pagamento da equipe ligado à presença.
- Consumo cobrado à parte.
- Cancelamento com motivo, % de multa e valor devolvido.

**Aba Checklist**
Modelo padrão de 7 tarefas (confirmar lista de convidados, horário, decoração e extras; conferir pagamentos, estoque e equipe), com prazo e progresso.

**Aba Equipe**
- **Montar equipe:** escolhe quem trabalha no cadastro de funcionários, define a função de cada um e clica em "Escalar equipe". Dá para cadastrar um funcionário novo ali mesmo.
- Editar a função depois de escalado.
- **Compareceu:** marca uma ou várias pessoas como presentes e pergunta se quer lançar o pagamento (padrão R$ 150, editável). O valor vira um custo da festa e aparece "Compareceu · R$ X lançado" ao lado do nome. É possível **desfazer a presença**, o que apaga o custo lançado.
- **Substituir:** registra o substituto e o motivo. O original fica marcado como substituído, com histórico.

**Aba Consumo pós-festa**
Lança o que foi gasto do estoque, com baixa automática, possibilidade de editar corrigindo pela diferença, e campos "outros" livres.

---

## 9. Páginas públicas (sem login)

Acessadas por links com um token aleatório, enviados por WhatsApp ao cliente.

- **Lista de convidados** (`/lista-convidados/:token`):
  - mostra só o nome do cliente, o tema e a data — nunca telefone, CPF ou valores;
  - o cliente adiciona nomes (em lote) e remove os que ainda não chegaram e não estão sinalizados;
  - nas festas da Vila Operária há um campo para colar o link de uma **playlist do Spotify** (só aceita links do Spotify).
- **Avaliação** (`/avaliacao/:token`): nota de 1 a 5 para pratos quentes, bolo, docinhos, salgadinhos e atendimento, mais um comentário livre. Máximo de 3 respostas por link.

Os dois funcionam só por funções do banco que exigem o token (seção 4.3).

---

## 10. Recursos transversais

- **Busca global:** encontra cliente, aniversariante ou festa pelo nome. O clique abre a Central da festa ou o cadastro do cliente.
- **Desfazer:**
  - toda exclusão (exceto a festa inteira) acontece na hora e mostra um botão "Desfazer" por 6 segundos, que sobrevive à troca de página;
  - desfazer recria o registro de verdade no banco;
  - excluir a festa inteira tem confirmação reforçada e exclusão adiada, porque apaga em cascata pagamentos, custos, documentos etc.
- **Histórico de quem fez o quê:** seção 6.3, exibido na Central da festa e no Painel.
- **PDFs:** contrato, proposta, escala e relatório de aniversariantes são gerados no navegador e baixados direto.
- **WhatsApp:**
  - nunca há envio automático — o sistema monta a mensagem e abre o WhatsApp (`wa.me`); para grupos, abre o link do grupo e a pessoa cola o texto;
  - cada envio fica registrado em `contact_history` com o nome de quem enviou;
  - mensagens com texto fixo no código: orçamento, lembrete de pagamento, confirmar festa, lembrete da festa, localização, pedir avaliação, avaliação pós-festa, reativação, lista de convidados, vaga disponível e pedidos;
  - "confirmar com fornecedores" é editável pela tela.
- **Responsivo:** funciona no celular (menu lateral vira gaveta).

---

## 11. Regras de negócio consolidadas

1. **Uma festa ativa por unidade por dia** (tela + índice único no banco).
2. **Valor da festa:** `total_value` é o valor cheio e `final_value` o firmado com desconto. Saldo = `final_value` + extras + consumo − pagamentos.
3. **Status** é automático pelo pagamento (6.1). Na criação só se escolhe Orçamento ou Confirmada.
4. **Pacote válido pela data da festa** (`valid_from`/`valid_until`), não pela data em que a reserva foi criada.
5. **Troca de pacote** soma ou subtrai a diferença entre os pacotes; sem pacote anterior, o valor vira o preço do novo.
6. **Preço por dia da semana:** seg–qui usa o preço de semana; sex–dom o de fim de semana; sem esses preços, usa o padrão.
7. **Custos da festa** (`reservation_costs`) são separados das despesas gerais (`expenses`) para não contar duas vezes; o sistema avisa quando parecem duplicados.
8. **Pagamento da equipe** = custo da festa, ligado à presença; desfazer a presença apaga o custo.
9. **Despesa fixa das festas** entra sozinha em toda festa nova, com o valor do plano (6.2).
10. **Estoque:** compra soma e consumo subtrai, sempre por funções atômicas; o mínimo efetivo considera a próxima festa (consumo por convidado × convidados).
11. **Horário de entrega dos fornecedores** = 1 hora antes do início da festa.
12. **Idade do aniversariante** = calculada pela data de nascimento e pela data da festa.
13. **Reativação:** criança faz aniversário em 1–3 meses e não há festa marcada naquele ano.
14. **CAC** considera só clientes de origem paga (Instagram/Facebook/Google).
15. **Saldo do mês no Financeiro** desconta só despesas pagas, não as a vencer.
16. **Cancelamento:** guarda motivo, % de multa retida e valor devolvido; os custos fixos saem da festa.

---

## 12. Limitações e dívidas técnicas conhecidas

**Processo e engenharia**
- Sem testes automatizados de nenhum tipo. Sem ambiente de homologação permanente — o sistema real é o único ambiente.
- Migrations rodadas à mão no SQL Editor; `schema.sql` é mantido à mão como espelho (risco de divergir).
- A Central da festa é um único componente de ~3.800 linhas. O pacote JavaScript é um bloco único de mais de 500 kB.
- Algumas listas ainda são fixas no código: as duas unidades (`UNITS`) e os textos das mensagens de WhatsApp (exceto o de fornecedores).
- Fuso horário: o banco usa a data UTC (o Brasil é UTC−3). Perto da meia-noite, um "hoje" calculado no banco pode divergir do da tela.

**Funcionalidades incompletas**
- **Pontos de fidelidade** existem no cadastro e aparecem na tela, mas **não há regra que acumule ou resgate pontos**.
- O log de exportações (LGPD) em Relatórios **só vale durante a sessão** — não fica gravado no banco.
- O histórico completo de alterações só existe a partir da migration 055. A tabela `audit_log` não tem política de retenção e cresce para sempre.
- Valor legado `sinal_pago` continua existindo no tipo do banco (não é mais usado).
- Não há cronograma de parcelas: só pagamentos realizados. Sem previsão de "parcela X vence dia Y" por festa.
- Despesa fixa das festas não é retroativa.
- O link de avaliação do Google tem um valor reserva fixo no código caso a unidade não tenha um cadastrado.

**Integrações que não existem**
- WhatsApp sem API: tudo depende de alguém clicar em enviar. O registro de envio é feito no clique, não confirma a entrega.
- Sem gateway de pagamento, Pix automático, conciliação bancária, nota fiscal ou integração contábil.
- A taxa da maquininha é uma estimativa configurada à mão.
- Sem notificações push, e-mail automático ou agendador. Tudo que é "automático por data" é calculado quando alguém abre a tela.
- Não é PWA nem funciona offline.

**Permissões**
- Muitas páginas têm só a permissão "ver página", sem controle por botão.
- Não há permissão por unidade (um funcionário vê as duas unidades se tem acesso à página).

---

## 13. Histórico recente de evolução (set–out/2026)

- RBAC no banco com perfis dinâmicos e regra fail-closed; correção de escalada de privilégio.
- Fim do PDF por impressão: download real; proposta comercial redesenhada no modelo da marca.
- Estoque: transferência entre unidades, edição de itens, velas numéricas, +/− inteiro e digitação livre.
- Central da festa:
  - edição de contrato gerado;
  - observações com lembretes no Painel;
  - botão Dados;
  - mensagem "Pedidos".
- Equipe: cadastro, montar equipe, presença com pagamento, desfazer, substituição com motivo.
- Lista de convidados: sinalização de convidados e playlist do Spotify (Vila Operária).
- Despesa fixa das festas com valor por plano.
- Pacotes com validade (tabela 2027 de São Vicente) e ordenação natural.
- Links públicos fechados (só funções com token).
- Mapa de reservas com novas cores.
- Correção da troca de pacote em festa sem pacote.
- Pendências clicáveis, **status automático pelo pagamento** e **histórico completo de quem fez o quê**.

---

## 14. Como acessar o sistema

O acesso é ao **sistema real, em uso**, com um login criado só para esta revisão.

- **Link:** https://brava-park-fest.brava-park-fest.workers.dev/
- **Login e senha:** enviados junto com este documento.
- **Importante: os dados são reais (clientes e festas de verdade).** Por favor, **só navegue e observe** — não crie, edite nem exclua nada, não envie mensagens e não copie dados pessoais de clientes para a sua resposta.
- O seletor de unidade, na barra lateral, alterna entre Vila Operária, São Vicente e as duas.
- Sugestão de roteiro:
  1. Painel.
  2. Mapa de reservas: abra uma festa e explore todas as abas da Central da festa.
  3. Clientes e Reativação.
  4. Pacotes, Contratos e Propostas.
  5. Pagamentos, Financeiro, Despesa fixa das festas, Resultado do mês.
  6. Estoque, Escalas, Relatório de aniversariantes.

---

## 15. O que eu quero de você (IA revisora)

Analise como um consultor externo que entende de sistemas para negócios de eventos e de software:

1. **Funcionalidades que faltam** e que um negócio deste porte (casa de festas, 2 unidades, equipe com vários perfis) provavelmente precisa.
2. **Regras de negócio** frágeis, incompletas ou arriscadas — financeiro, operacional ou de dados.
3. **Riscos:** segurança, integridade de dados, LGPD, dependência de processos manuais, experiência do usuário (inclusive no celular).
4. **Usabilidade:** depois de navegar pelo sistema, o que é confuso, lento, escondido ou poderia ter menos cliques?
5. **Arquitetura:** o que deveria mudar na forma como o sistema é construído e publicado para continuar crescendo com segurança?
6. **Prioridades:** se você escolhesse as próximas 5 coisas a construir ou corrigir, quais seriam e por quê? Dê, para cada uma, o problema, a solução proposta e o impacto esperado.

Seja direto e crítico — o objetivo é achar buraco, não validar o que já existe.
