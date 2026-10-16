# Brava Park Fest — Documentação completa do sistema de gestão

*Versão de 16/10/2026 — descreve o sistema exatamente como está em uso hoje (até a migration 065).*

> **Para a IA revisora.** Este documento foi escrito para você fazer uma análise crítica do sistema e sugerir o que mudar e o que implementar. Ele descreve o negócio, a arquitetura, o modelo de dados, cada tela e cada regra de negócio, além das limitações conhecidas, sem maquiagem. **Desta vez você recebe só este documento** — sem acesso ao sistema nem ao código. Quando algo não estiver claro o suficiente para uma conclusão, diga isso em vez de supor. **Não preciso de elogio, preciso de lacunas.** No final (seção 15) estão as perguntas que quero que você responda.

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
9. Páginas públicas (sem login) — o Portal do cliente
10. Recursos transversais (busca, desfazer, histórico, PDF, WhatsApp)
11. Regras de negócio consolidadas
12. Limitações e dívidas técnicas conhecidas
13. Histórico recente de evolução
14. Sobre o acesso
15. O que eu quero de você

---

## 1. O negócio

**Brava Park Fest** é uma casa de festas infantis em Itajaí (SC) com **duas unidades físicas independentes**: **Vila Operária** (até 100 pessoas, ~320 m²) e **São Vicente** (até 60 pessoas em 2026; até 80 em 2027). Cada unidade funciona quase como uma empresa separada:

- tem a sua própria conta bancária e dados jurídicos (CNPJ, razão social) usados no contrato;
- tem os seus próprios pacotes e preços, estoque, equipe e grupo de WhatsApp de fornecedores;
- tem um único espaço (não existem salões separados dentro de uma unidade) — **uma festa por dia por unidade**.

O produto vendido é a **festa completa**: espaço + brinquedos + buffet + bolo + docinhos + bebidas não alcoólicas + decoração + equipe + duração definida. Os pacotes variam por número de convidados (40 a 100) e por nível:

- **Classic** — coquetéis (salgados, docinhos, bolo, bebidas), sem pratos quentes;
- **Gourmet** — coquetéis + pratos quentes (de 3 opções para 40 pessoas até 9 para 100);
- **Prime** (só Vila Operária) — coquetéis, pratos quentes e jantar completo.

O preço muda entre seg–qui e sex–dom/feriados, e há tabelas diferentes para 2026 e 2027. Itens extras (ex: cabine de fotos, hora extra, prato quente adicional) são vendidos à parte. Uma **gerente** recebe **R$ 150 de comissão por festa fechada**, paga toda segunda-feira.

O ciclo de vida típico de um cliente:

1. Chega um contato (Instagram, Google, Facebook, indicação…).
2. Agenda uma **visita** ao espaço.
3. Recebe uma **proposta comercial** em PDF.
4. Fecha: vira uma **reserva** (orçamento → confirmada), assina o **contrato**, paga sinal e parcelas.
5. Antes da festa: recebe o link do **Portal do cliente**, onde escolhe pratos quentes e bolo, envia a lista de convidados e a playlist, vê a programação e manda comprovantes de pagamento. A casa escala a **equipe**, confere o **estoque** e avisa os **fornecedores**.
6. No dia: check-in dos convidados na portaria, equipe marca presença.
7. Depois: lança o **consumo pós-festa** (com custo), paga a equipe, pede **avaliação** (Google + formulário próprio no portal).
8. Meses depois: o sistema lembra de **reativar** o cliente perto do próximo aniversário da criança.

O sistema substituiu um software de mercado (RecreaSoft) e foi construído sob medida, de forma incremental, a partir de pedidos do dono. O dono considera, no futuro, **vender o sistema para outras casas de festa** (ainda não iniciado).

---

## 2. Quem usa e como

- **O dono** — acesso total (perfil Administrador). Usa principalmente o celular e o computador. Não é técnico nem contador.
- **Gerente e equipe** — perfis criados pelo próprio dono (ex: Financeiro, Comercial, Gerente, Operacional, Recepção), cada um com o seu conjunto de permissões.
- **Clientes (contratantes)** — não têm login. Interagem por um link público único por festa: o **Portal do cliente**. A conversa com a equipe é só pelo WhatsApp.

Uso diário real: criar e acompanhar reservas, registrar pagamentos, conferir comprovantes enviados pelo portal, controlar estoque, escalar equipe, mandar mensagens de WhatsApp prontas, acompanhar o financeiro.

---

## 3. Arquitetura técnica e infraestrutura

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + TypeScript + Vite 5 + Tailwind CSS 3, React Router 6, Recharts (gráficos), lucide-react (ícones), date-fns |
| PDFs | jsPDF e html2pdf.js, carregados sob demanda (geram download de verdade) |
| Backend | Supabase: Postgres + Auth (email/senha) + Storage (arquivos) + uma Edge Function. **Plano gratuito (Free)** |
| Servidor próprio | **Não existe.** O navegador fala direto com o Supabase. Toda a proteção é feita no banco (Row Level Security + funções `security definer` com checagem de permissão). |
| Hospedagem | Cloudflare Workers (site estático). Cada envio para a branch `main` do GitHub publica sozinho em ~1–2 minutos. |
| Banco: mudanças | Arquivos SQL numerados (`supabase/002…065_*.sql`), rodados **manualmente** pelo dono no SQL Editor do Supabase. Todos espelhados em `supabase/schema.sql` (instalador do zero). As mais recentes rodam dentro de uma transação e algumas têm script de reversão (`*_REVERTER_*.sql`). |
| Testes | **Não há testes automatizados no repositório.** As migrations recentes (055 em diante) foram testadas pelo desenvolvedor num Postgres local em memória (PGlite) com cenários escritos à mão, mas esses testes **não estão versionados nem rodam sozinhos**. O resto é verificado por compilação (TypeScript), build e testes manuais. |

Tamanho aproximado: 31 telas e ~18 mil linhas em `src/pages`, sendo ~4.400 só na Central da festa e ~950 no Portal do cliente; 64 migrations; ~60 tabelas.

**Ordem de publicação:** quando uma mudança precisa de coluna/tabela nova, primeiro o dono roda o SQL no Supabase, depois o código é publicado. Quando a mudança remove um acesso que o código antigo usa, é feita em duas etapas. Já houve um incidente em que o dono rodou o script de **reversão** no lugar da migration (sem perda de dados, porque a funcionalidade ainda não tinha uso).

---

## 4. Segurança, login e permissões

### 4.1 Login
- Supabase Auth com email e senha.
- Funcionários são criados pela tela de Usuários, que chama a Edge Function `create-employee` (usa a chave de serviço; só administrador ativo pode chamar). Ela cria o login e o perfil e mostra uma senha provisória para copiar.
- Usuário marcado como **inativo** é deslogado automaticamente e perde acesso a todas as tabelas.

### 4.2 Perfis e permissões (RBAC)
- **Perfis dinâmicos** (`roles`): o dono cria, edita e exclui perfis pela tela. O perfil com `is_admin = true` ("Administrador") tem acesso total e não passa por checagem.
- **Permissões por perfil** (`role_permission_items`): cerca de 75 chaves — uma por página (`page:financeiro`, `page:estoque`, `page:comissoes`, `page:portal_avisos`…) e uma por ação sensível (`action:festa.pagamentos`, `action:festa.estorno`, `action:acertos.confirmar`, `action:comissoes.pagar`, `action:estoque.custo_inicial`…). Algumas ações são **só do Administrador** por não terem linha criada para nenhum perfil (ex: desfazer acerto entre unidades, desfazer repasse de comissões).
- **Ajuste individual** (`user_permission_overrides`): libera ou bloqueia uma chave para uma pessoa específica, vencendo o que o perfil dela diz.
- **Regra fail-closed** (desde a migration 046): se não existe linha dizendo "liberado", está **negado**.
- **Onde é aplicado:**
  - na tela, o menu esconde páginas sem permissão, o guard de rota bloqueia URL digitada e o componente `<Can>` esconde botões;
  - **no banco** (o que realmente protege), as políticas RLS de cada tabela chamam `has_permission(auth.uid(), 'chave')` e `is_active_user(...)`, e as funções sensíveis checam a permissão antes de agir. Quem tentar chamar a API do Supabase direto do navegador também é barrado.
- Cobertura de botões: nem toda ação tem chave própria. Várias páginas têm só a permissão de página inteira.

### 4.3 Correções de segurança já feitas
- **045/046:** antes, qualquer funcionário logado podia se promover a administrador e todas as tabelas aceitavam qualquer usuário autenticado. Corrigido com RBAC no banco.
- **052/053:** os links públicos permitiam a quem não estava logado ler dados de **outras** festas. Agora o visitante sem login não acessa nenhuma tabela diretamente — só funções que exigem o token do link e devolvem apenas os dados daquela festa, com limites.
- **RLS sem recursão:** checagens de "é admin?" ficam em funções `security definer` (`is_admin_user`).
- **Lançamentos travados (057/058/064):** compras de estoque, acertos entre unidades, estornos de cancelamento e contas de comissão só podem ser alterados pela tela de origem — um gatilho no banco bloqueia edição ou exclusão por fora.

---

## 5. Modelo de dados

Principais tabelas (nomes reais no Postgres):

**Estrutura**
- `units` — as duas unidades: endereço, CNPJ, razão social, responsável, chave Pix, link de avaliação do Google, link do grupo de WhatsApp de fornecedores.
- `spaces` — o espaço físico de cada unidade (1 por unidade).

**Clientes e comercial**
- `clients` — contratante: nome, telefone, email, CPF, endereço estruturado, origem (`source`), indicação, nome e **data de nascimento da criança**, pontos de fidelidade, status de reativação, último contato e data da última festa.
- `visits`, `proposals`, `leads`, `waitlist`, `contact_history` (mensagens de WhatsApp enviadas, com quem enviou), `marketing_spend`, `unit_goals`.

**Produto**
- `packages` — pacotes por unidade: preço seg–qui / sex–dom (e preço padrão), limite de convidados, duração, itens inclusos (vão para o contrato), **quantidade de pratos quentes inclusos** (`hot_dish_count`, usada no portal), **período de validade** (`valid_from` / `valid_until`, pela data da festa) e `active`. Hoje convivem as tabelas 2026 e 2027 das duas unidades; planos antigos ficam inativos, mas as festas que os usam continuam com eles.
- `extra_items` — itens extras avulsos; um extra pode **acrescentar pratos quentes** à escolha do cliente (`adds_hot_dishes`).
- `package_costs` — "ficha técnica" de custo de cada pacote por categoria.

**A festa**
- `reservations` — a festa:
  - unidade, cliente, pacote, data, início e fim, tipo de evento, convidados e cortesias;
  - nome e idade do aniversariante (editáveis), tema, sabores e massa do bolo, escolha de música;
  - `total_value` (valor cheio) e `final_value` (valor firmado com desconto);
  - status (`orcamento`, `confirmada`, `quitada`, `cancelada`; o valor legado `sinal_pago` não é mais usado);
  - cancelamento: motivo, % de multa, valor devolvido, data do cancelamento (`cancelled_at`);
  - consumo pós-festa **finalizado** (`consumption_finalized`) e "excluir das médias" (`exclude_from_averages`);
  - cardápio confirmado em / enviado após o prazo (`menu_confirmed_at`, `menu_sent_late`).
  - Índice único: só uma festa não cancelada por unidade por dia.
- `reservation_birthday_kids` — aniversariantes adicionais.
- `payments` — cada valor recebido é uma linha (data, valor, forma de pagamento, criado em). Não há cronograma de parcelas.
- `payment_method_fees` — taxa da maquininha por forma de pagamento (editável).
- `reservation_extra_items` — extras vendidos, com o preço congelado.
- `reservation_costs` — custos daquela festa (equipe, despesa fixa da festa, custos manuais).
- `reservation_consumption` — consumo cobrado à parte (ex: chopp por litro).
- `reservation_stock_consumption` — baixa de estoque feita pela festa, com **custo congelado** no momento (`unit_cost`, `total_cost`, `no_cost` quando o item não tinha custo).
- `checklist_items`, `staff_members`, `staff_assignments` (escala, presença e pagamento ligado a custo), `reservation_notes` (com lembrete), `reservation_documents` (Storage privado), `contracts` / `contract_templates`.
- **Portal do cliente:** `guest_list_pages` (o token do portal), `guest_list_entries` (convidados e check-in), escolhas de cardápio e bolo, comprovantes enviados (arquivo no Storage + status lançado/recusado com justificativa), avaliações (`party_reviews`) e um log de tudo o que o cliente fez no portal (que alimenta os avisos do Painel).
- `nps_responses` — NPS (0–10) registrado manualmente.

**Financeiro e operação**
- `expenses` — contas a pagar: categoria, fornecedor, valor, vencimento, status (a vencer / atrasado / pago / cancelado), forma e data do pagamento, e marcações:
  - `covers_festa_costs` — "esta conta paga custos já lançados nas festas" (fica na lista, mas não entra em nenhum total);
  - `is_stock_purchase` + `expense_items` — compra de estoque, criada pela tela Estoque;
  - `settlement_id` / `settlement_batch_id` — conta de acerto entre unidades;
  - `reservation_id` + categoria "Estorno" — devolução de cancelamento;
  - `commission_payout_id` — conta de repasse de comissão.
- `other_incomes` — entradas que não são de festa (hoje só acertos recebidos de outra unidade).
- `unit_settlements` — acertos entre unidades (pendente / pago / cancelado), gerados por transferência de estoque.
- `recurring_expenses` — despesas fixas mensais.
- `festa_fixed_costs` / `festa_fixed_cost_package_amounts` — despesas fixas das festas, com valor por plano.
- `inventory_items` — estoque por unidade: quantidade **e valor total** (custo médio ponderado = valor ÷ quantidade), mínimo, tipo de consumo (por convidado / por festa), fornecedor, tamanhos de compra.
- `inventory_movements` — razão do estoque: toda entrada, saída, ajuste, transferência e correção de custo, com quantidade e valor antes/depois.
- `commission_rates` (valor da comissão com histórico de vigência), `commission_settings` (data de início, quem recebe), `commission_payouts` / `commission_payout_items` (repasses semanais e o que cada um pagou ou abateu).
- `suppliers` / `supplier_bookings`, `message_templates`.

**Controle**
- `roles`, `role_permission_items`, `user_permission_overrides`, `user_profiles` — permissões (seção 4).
- `audit_log` — histórico de quem fez o quê (seção 6.3).

---

## 6. Automações que rodam no banco de dados

São regras de banco (gatilhos e funções), por isso valem para qualquer tela e qualquer pessoa. "Hoje" é calculado no fuso de Brasília (`today_brazil()`).

### 6.1 Status da festa automático
- Valor devido = `final_value` + extras vendidos + consumo cobrado.
- Sem pagamento → **Orçamento**; pagou menos que o devido → **Confirmada**; pagou tudo → **Quitada**. **Cancelada** nunca muda sozinha.
- Recalcula quando entra, muda ou sai pagamento, extra ou consumo, e quando o valor da festa muda.

### 6.2 Despesa fixa das festas
- Ao criar uma festa, lança sozinho nos custos dela cada despesa fixa da unidade, com o valor do plano da festa (ou o padrão).
- Trocar o pacote recalcula; editar a despesa atualiza as festas futuras; cancelar a festa tira os custos fixos; descancelar recoloca. Não é retroativo.

### 6.3 Histórico completo
- Um gatilho em ~30 tabelas grava em `audit_log` toda criação, alteração e exclusão: quem fez, qual registro, a festa relacionada e, nas alterações, o valor **de → para** de cada campo.
- Ações automáticas aparecem como "Sistema (…)"; ações do cliente pelo portal, como "Cliente (portal)".

### 6.4 Estoque com custo (057, 062)
- Toda mudança de quantidade/valor passa por funções do banco (`stock_apply_in/out/delta`); mudar direto na tabela é bloqueado.
- **Entrada de compra** (tela Estoque) soma quantidade e valor e cria a conta a pagar vinculada; editar/excluir refaz pela diferença.
- **Consumo pós-festa** tira do estoque pelo custo médio do momento e congela esse custo no lançamento. Saída maior que o estoque zera o item (nunca negativo).
- O custo por unidade de qualquer item pode ser definido ou corrigido (com motivo, registrado no histórico).
- **Médias de consumo** (`consumption_averages`): calculadas na hora com as últimas 10 festas finalizadas de cada unidade (por convidado ou por festa).

### 6.5 Acertos entre unidades (057, 058)
- Transferir estoque de uma unidade para outra cria um **acerto** e, na unidade que recebeu, uma **conta a pagar** ("Transferência entre unidades").
- Quando essa conta é paga, o sistema lança sozinho a **entrada** na unidade que mandou e marca o acerto como pago; voltar a conta para não paga desfaz.

### 6.6 Estorno de cancelamento (057)
- Cancelar uma festa com valor devolvido cria (uma única) saída **"Estorno"** no Financeiro — já paga ou como conta a vencer. Alterar o valor devolvido atualiza o mesmo lançamento; descancelar a festa cancela o estorno.
- Antes de cancelar, o sistema avisa se já existe uma conta parecida no mesmo mês (para não duplicar).

### 6.7 Comissão da gerente (064)
- Cada festa **cadastrada** a partir da data de início (19/10/2026) gera a comissão no valor vigente no dia do cadastro (hoje R$ 150; o valor pode mudar com data de vigência e fica o histórico).
- O repasse de segunda paga as festas cadastradas até o domingo anterior. Festa cancelada **depois** de paga é **abatida** no próximo repasse; cancelada **antes** não gera comissão; se voltar, a comissão volta a ser devida. Unidade com saldo da semana não positivo não é paga (o abatimento espera).
- O repasse cria uma conta **paga** por unidade (categoria "Comissão"), travada. Desfazer repasse: só Administrador.

### 6.8 Três visões do Financeiro (063)
- Funções só de leitura (`finance_month_views`, `finance_commitments`) calculam Caixa, Resultado das festas, a Ponte entre os dois e os compromissos com festas futuras (seção 7.14). Não criam nem alteram lançamentos.

### 6.9 Outras funções
- **Despesas fixas mensais:** `ensure_recurring_expenses_current_month` cria o lançamento do mês; roda quando o Painel ou o Financeiro abrem (não há agendador).
- **Conta vencida vira "Atrasado"** sozinha (ao salvar e ao abrir o Painel/Financeiro).
- **Portal:** funções `public_*` / `portal_*` que exigem o token (seção 9), com prazos calculados no banco.

---

## 7. Telas do sistema, uma por uma

Barra lateral com um **seletor de unidade** (Vila Operária / São Vicente / Ambas), que filtra quase todas as telas, e uma **busca global** no topo.

### 7.1 Painel (Dashboard)
- Para **Administrador e Financeiro**, os avisos financeiros ficam no topo: comprovantes enviados pelo portal (Lançar / Recusar com justificativa), acertos entre unidades pendentes, contas a pagar e saldo em aberto.
- **Avisos do portal:** cada ação do cliente no portal (cardápio escolhido, convidados enviados, comprovante, avaliação…) aparece aqui; prazos vencidos sem a ação feita também são avisados.
- Indicadores do mês: faturamento recebido, festas confirmadas, ocupação, CAC × ticket médio, meta com barra de progresso.
- Gráfico de faturamento por unidade (6 meses) e gráfico **Festas por mês** com dois modos: **realizadas** (pelo mês da festa) e **fechadas/vendas** (pelo mês do cadastro), com comparação com o ano anterior.
- Ações rápidas, alertas (festas com dado faltando, reativação, contas vencendo, saldo em aberto das próximas festas), lembretes das observações e atividade recente.

### 7.2 Lembretes diários
Lista calculada sozinha, cada item com botão que abre o WhatsApp com a mensagem pronta: pagamento pendente perto da festa (com o saldo), festa é amanhã, pedir avaliação da festa de ontem. Não repete no mesmo dia.

### 7.3 Mapa de reservas
- Calendário mensal colorido por status, visão em lista e "agenda de hoje".
- **Nova reserva:** cliente existente ou cadastro rápido; unidade, data, horário, tipo; pacote (só os válidos na data e ativos, preço por dia da semana); convidados e cortesias; aniversariante(s) com idade calculada; tema e sabores; desconto; status inicial.
- Trava de duplicidade (tela + banco). Lista de espera com aviso de vaga.

### 7.4 Agenda de visitas · 7.5 Clientes · 7.6 Reativação · 7.7 Satisfação (NPS)
Sem mudanças relevantes: visitas com resultado; cadastro completo com busca de CEP; reativação por aniversário da criança (1–3 meses, sem festa no ano) com funil; NPS manual + médias das avaliações do portal.

### 7.8 Pacotes e itens
- Criar e editar pacotes (preços seg–qui / sex–dom, limite, duração, itens inclusos, **pratos quentes inclusos**, validade). Ordem alfabética e numérica natural.
- Pacote já usado em festa não é apagado: é desativado.
- Ficha técnica de custo e itens extras (com "acrescenta pratos quentes").

### 7.9 Contratos · 7.10 Propostas comerciais
Contrato por unidade com variáveis, congelado ao gerar e editável; proposta em PDF no modelo da marca, com status.

### 7.11 Tráfego e CAC · 7.12 Funil de conversão
CAC só sobre clientes de origem paga, comparado ao ticket médio; funil do orçamento à festa fechada e origem das festas.

### 7.13 Pagamentos
Todas as festas com valor firmado, pago e saldo; recebido no total e no mês; taxa da maquininha por forma de pagamento (editável) e valor líquido do mês.

### 7.14 Financeiro — três visões
No topo, três abas, todas com o filtro de unidade. Cada aba tem um quadro "O que esta tela mostra" (recolhível, lembrado por pessoa no navegador), "Entenda com um exemplo", legenda em cada card, uma linha "Não é:" e uma frase de resumo com os números reais.

- **Caixa** (só o mês atual) — a tela de sempre:
  - Entradas do mês (pagamentos pela data do pagamento) + acertos recebidos;
  - Custos das festas do mês **já realizadas** (embaixo, os das próximas);
  - A pagar e Atrasado;
  - **Saldo do mês (caixa)** = entradas + acertos − contas pagas no mês − custos das festas já realizadas;
  - Fluxo de caixa futuro (saldo projetado) e gráfico de 6 meses (a barra de saídas do mês atual inclui custos de festas que ainda vão acontecer).
- **Resultado das festas** (com seletor de mês) — cada festa conta no mês em que acontece:
  - receita da festa = valor firmado + extras + consumo cobrado;
  - custos = custos lançados + insumos consumidos (custo congelado); taxa da maquininha estimada em card próprio;
  - despesas gerais = contas pagas no mês **sem** compras de estoque, acertos, estornos e contas que pagam custos das festas;
  - festas canceladas contam no mês do cancelamento só pela multa retida (pago − devolvido) menos custos já lançados;
  - tabela por festa com status **completo / parcial** (parcial = consumo não finalizado, item sem custo ou nenhum custo lançado);
  - bloco separado "Estimado — festas que ainda vão acontecer neste mês" (fora dos totais); linha "compras de estoque × consumo"; gráfico de 6 meses.
- **Ponte e compromissos:**
  - tabela em cascata do saldo do caixa ao resultado do mês, linha por linha (adiantado de festas futuras, recebido antes do mês, a receber, multa retida, estornos, compras × insumos, acertos, taxa…), com a coluna "O que significa", lançamentos ao clicar e a linha **"Diferença não classificada"** sempre visível (conferida = R$ 0,00 em 6 meses × 2 unidades com os dados reais);
  - **dinheiro comprometido com festas futuras:** já recebido, custos previstos (lançados + insumos estimados pela média de consumo) e **reserva necessária**, com aviso se for maior que o saldo projetado.
- Corte de "festa realizada": no mês atual, até hoje; em meses passados, até o último dia daquele mês. Meses passados são recalculados com os dados atuais.
- **Contas a pagar:** registrar, editar, marcar como paga e remover. Etiquetas e cadeado para lançamentos travados (compra de estoque, acerto, estorno, comissão). Marcação "paga custos das festas". **Aviso antes de salvar** se existe custo de festa parecido no mesmo mês, com opções Voltar / Marcar e salvar / Salvar mesmo assim.
- Despesas fixas mensais e despesas por categoria.

### 7.15 Despesa fixa das festas
Custos que toda festa tem, com valor padrão e valor por plano.

### 7.16 Acertos entre unidades
Lista dos acertos gerados por transferência de estoque (pendente / pago / cancelado), confirmação de pagamento, cancelamento e desfazer (só Administrador).

### 7.17 Comissões
Valor por festa, próximo repasse (festas cadastradas até domingo, por unidade, com comissões, abatimentos e ajustes), semana em andamento, repasses feitos (com os itens) e configuração (valor com vigência, data de início, quem recebe).

### 7.18 Resultado do mês
Receita recebida − estornos − taxas − despesas pagas − custos das festas do mês + recuperação de acertos = lucro, com margem e 6 meses. Conta **pela data do pagamento**; um aviso fixo leva ao Resultado das festas.

### 7.19 Lucro por festa
Valor da festa (firmado + extras + consumo cobrado) − custos lançados − insumos consumidos; avisa itens sem custo; para festas futuras mostra lucro estimado pela média de consumo.

### 7.20 Relatórios e metas
Meta por unidade, comparativo, projeção de recebimento e exportação CSV (inclui insumos por festa e acertos). Aviso fixo de critério (data do pagamento). Log de exportações só durante a sessão.

### 7.21 Estoque e Consumo por convidado
- Itens por unidade com quantidade, **valor e custo médio**, mínimo, tipo de consumo, fornecedor; custo editável; lista de compras automática; velas numéricas; transferência entre unidades.
- **Entrada de compra** (cria a conta a pagar).
- Tela de **médias de consumo** por item (por convidado ou por festa), com as festas que entraram na média.

### 7.22 Fornecedores · 7.23 Escalas · 7.24 Relatório de aniversariantes · 7.25 Usuários e permissões
Sem mudanças relevantes desde a versão anterior.

---

## 8. A Central da festa (tela mais importante)

Rota `/reservas/:id`. É o "hub" de uma festa.

**Cabeçalho**
- Cliente, data, unidade, status e pacote; barra de progresso, valor total (contrato + extras + consumo) e saldo devedor.
- Botões: dados do contratante, observações, WhatsApp (confirmar festa, lembrete da festa, localização, **lembrete de pagamento com o saldo devedor**, Pedidos, enviar portal, confirmar com fornecedores, pedir avaliação), cancelar e excluir.
- Aviso de pendências clicável (saldo vencido, checklist atrasado).

**Aba Visão geral**
- Dados da festa editáveis; troca de pacote (só válidos na data; mostra antes/depois; soma só a diferença); a festa com plano antigo inativo continua mostrando esse plano.
- Tema, sabores e **aniversariantes editáveis** (nome, idade, mais de um aniversariante).
- Histórico "quem fez o quê", documentos anexados.
- **Portal do cliente:** gerar/enviar o link; ver cardápio escolhido (com marca "enviado após o prazo"), convidados com check-in e sinalização, playlist, comprovantes e o log do que o cliente fez; mensagens antigas do portal (a conversa agora é só pelo WhatsApp).

**Aba Financeiro**
- Pagamentos (registrar e remover), itens extras vendidos.
- **Custos da festa e lucro estimado:** custos lançados (sugestões da ficha técnica; aviso de duplicidade com despesas gerais; selo "fixo"; pagamento da equipe) + **insumos do consumo pós-festa** (custo congelado), com o lucro estimado da festa.
- Consumo cobrado à parte.
- Cancelamento com motivo, % de multa, valor devolvido (paga agora ou depois) → cria o estorno.

**Abas Checklist, Equipe e Consumo pós-festa**
- Checklist de 7 tarefas com prazo.
- Equipe: montar, editar função, marcar presença (lança o pagamento como custo, padrão R$ 150), desfazer, substituir com motivo.
- Consumo pós-festa: lança o gasto do estoque (com custo congelado), edita, desfaz, marca como **finalizado** e "excluir das médias".

---

## 9. Páginas públicas (sem login) — o Portal do cliente

Um link por festa (`/portal/:token`; o link antigo da lista de convidados redireciona para ele), com versão para celular e para computador, nas cores da marca. Nunca mostra telefone, CPF ou dados de outras festas.

Seções:
- **Início** com os próximos passos e prazos.
- **Cardápio:** escolhe os pratos quentes (quantidade = a do plano + os acrescentados por extras), a lista do cardápio da casa, o sabor e a massa do bolo. Prazo: 7 dias antes da festa; depois do prazo ainda dá para enviar, mas fica marcado "enviado após o prazo".
- **Convidados:** adiciona e remove nomes (contar convidados a partir de 5 anos); prazo: 1 dia antes.
- **Música:** playlist (opcional) ou escolha da casa.
- **Programação sugerida** (horários: parabéns, pratos, bolo, hora extra).
- **Pagamento:** saldo, prazo (1 dia antes) e envio de **comprovante**, que a equipe lança ou recusa com justificativa no Painel.
- **Regras** (= o contrato), **Como chegar**, **Histórico**, **Avaliação** (aparece no fim da festa; nota por categoria + comentário).
- **Falar com a equipe:** só um botão de WhatsApp (número único das duas unidades).

Tudo funciona por funções do banco que exigem o token; cada ação do cliente fica registrada e gera aviso no Painel.

---

## 10. Recursos transversais

- **Busca global**, **Desfazer** (exclusões com botão "Desfazer" por 6 segundos, recriando o registro de verdade; exclusão da festa inteira com confirmação reforçada), **histórico de quem fez o quê**, **PDFs** gerados no navegador.
- **WhatsApp:** nunca há envio automático — o sistema monta a mensagem e abre o WhatsApp (`wa.me`); cada envio fica em `contact_history`. Os textos das mensagens são fixos no código (exceto "confirmar com fornecedores", editável).
- **Responsivo:** funciona no celular (menu vira gaveta).

---

## 11. Regras de negócio consolidadas

1. **Uma festa ativa por unidade por dia.**
2. **Valor devido** = `final_value` + extras + consumo cobrado. Saldo = valor devido − pagamentos.
3. **Status** automático pelo pagamento.
4. **Pacote válido pela data da festa**; planos inativos não aparecem para festas novas, mas continuam nas festas que os usam.
5. **Troca de pacote** soma ou subtrai a diferença.
6. **Preço por dia da semana** (seg–qui / sex–dom).
7. **Custos da festa** separados das despesas gerais; aviso de duplicidade nos dois sentidos; conta "paga custos das festas" não entra em total nenhum.
8. **Pagamento da equipe** = custo da festa, ligado à presença.
9. **Despesa fixa das festas** entra sozinha em toda festa nova, com o valor do plano.
10. **Estoque** com custo médio ponderado; consumo com custo congelado; nunca negativo.
11. **Compra de estoque** conta no caixa quando é paga; o **consumo** conta no lucro da festa e no Resultado das festas — nunca os dois no mesmo número.
12. **Acerto entre unidades** não é faturamento nem custo de festa: no caixa, saída numa unidade e entrada na outra; em "Ambas", se anulam.
13. **Cancelamento:** multa retida = pago − devolvido; o estorno é saída de caixa; no Resultado das festas conta só a multa retida.
14. **Comissão** por festa cadastrada, repasse semanal, abatimento de cancelada já paga.
15. **Três critérios de data coexistem e são explicados na tela:** data do pagamento (Caixa, Resultado do mês, Relatórios), data da festa (Resultado das festas, Lucro por festa) e data do cadastro (comissões, gráfico de festas fechadas).
16. **Horário de entrega dos fornecedores** = 1 hora antes da festa. **Idade** calculada pela data de nascimento e da festa. **Reativação:** aniversário em 1–3 meses sem festa no ano. **CAC** só sobre origem paga.

---

## 12. Limitações e dívidas técnicas conhecidas

**Processo e engenharia**
- Sem testes automatizados no repositório; os testes de banco do desenvolvedor não rodam sozinhos. Sem ambiente de homologação — o sistema real é o único ambiente.
- Migrations rodadas à mão no SQL Editor pelo dono (já houve execução do arquivo errado); `schema.sql` mantido à mão como espelho.
- **Supabase no plano gratuito:** sem cópia de segurança diária garantida e com risco de pausa por inatividade.
- A Central da festa é um único componente de ~4.400 linhas. O pacote JavaScript é um bloco único grande.
- Muita coisa específica do Brava está fixa no código: as duas unidades (`UNITS`), número de WhatsApp, cardápio de pratos quentes, sabores e massas do bolo, cores e mascote do portal, modelos de contrato por unidade, textos das mensagens.

**Funcionalidades incompletas**
- **Pontos de fidelidade** sem regra de acúmulo ou resgate.
- Log de exportações (LGPD) só durante a sessão. `audit_log` sem política de retenção.
- Sem cronograma de parcelas (só pagamentos realizados).
- Sem histórico de versões do valor da festa: meses passados do Resultado das festas são recalculados com o valor atual.
- Despesa fixa das festas não é retroativa.
- Taxa da maquininha é estimativa configurada à mão; a projeção de recebimentos do Caixa usa só o valor firmado (sem extras/consumo).
- O "lembrar o quadro recolhido" do Financeiro fica só no navegador de cada pessoa.

**Integrações que não existem**
- WhatsApp sem API (tudo depende de clicar em enviar; o registro é feito no clique).
- Sem gateway de pagamento, Pix automático, conciliação bancária, nota fiscal ou integração contábil.
- Sem notificações push, e-mail automático ou agendador: tudo que é "automático por data" é calculado quando alguém abre a tela.
- Não é PWA nem funciona offline.

**Permissões**
- Muitas páginas têm só a permissão "ver página". Não há permissão por unidade.

---

## 13. Histórico recente de evolução (06/10 a 16/10/2026)

- **Financeiro:** conta vencida vira Atrasado sozinha; marcação "paga custos das festas"; saldo do mês passa a descontar os custos das festas realizadas.
- **Estoque com custo** (custo médio, entrada de compra, consumo com custo congelado, correção de custo, médias de consumo).
- **Acertos entre unidades** (transferência → conta a pagar → entrada na outra unidade).
- **Estorno de cancelamento** automático, com aviso de duplicidade.
- **Portal do cliente** completo (cardápio, bolo, convidados, música, programação, comprovantes, regras, avaliação, avisos no Painel; contato só por WhatsApp).
- Insumos do consumo pós-festa entram no lucro da Central da festa; Lucro por festa passa a usar o valor completo da festa.
- **Financeiro com três visões** (Caixa, Resultado das festas, Ponte e compromissos), aviso de critério no Resultado do mês e Relatórios, aviso de duplicidade nos dois sentidos.
- **Comissões da gerente** com repasse semanal.
- Gráfico de festas por mês com modo "fechadas (vendas)".
- **Planos 2026/2027:** São Vicente passa a ter Classic e Gourmet (40–60 em 2026; 40–80 em 2027); Vila Operária ganha tabela 2027.
- Aniversariante editável na Central; avisos financeiros no topo do Painel para Administrador/Financeiro; lembrete de pagamento com o saldo devedor.

---

## 14. Sobre o acesso

Nesta rodada você **não** tem acesso ao sistema nem ao código — só a este documento. Se alguma conclusão sua depender de ver a tela ou o código, aponte isso como pergunta em aberto em vez de supor.

---

## 15. O que eu quero de você (IA revisora)

Analise como um consultor externo que entende de sistemas para negócios de eventos e de software:

1. **Funcionalidades que faltam** e que um negócio deste porte (casa de festas, 2 unidades, equipe com vários perfis) provavelmente precisa.
2. **Regras de negócio** frágeis, incompletas ou arriscadas — financeiro, operacional ou de dados. Olhe com atenção especial o financeiro (três critérios de data, estoque com custo, acertos, estorno, comissão).
3. **Riscos:** segurança, integridade de dados, LGPD (o sistema guarda dados de crianças), dependência de processos manuais, continuidade (plano gratuito, sem backup garantido).
4. **Usabilidade:** pelo que está descrito, o que parece confuso, escondido ou com cliques demais — para a equipe e para o cliente no portal?
5. **Arquitetura:** o que deveria mudar na forma como o sistema é construído, testado e publicado para continuar crescendo com segurança — e para, um dia, ser vendido a outras casas de festa?
6. **Prioridades:** se você escolhesse as próximas 5 coisas a construir ou corrigir, quais seriam e por quê? Para cada uma: o problema, a solução proposta e o impacto esperado.

Seja direto e crítico — o objetivo é achar buraco, não validar o que já existe.
