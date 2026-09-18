# Brava Park Fest — Documentação completa do sistema

> Este documento foi escrito para ser enviado a outra IA fazer uma análise crítica e sugerir melhorias/funcionalidades novas. Ele descreve o negócio, a arquitetura técnica, o modelo de dados, cada funcionalidade existente e as regras de negócio mais importantes — inclusive limitações conhecidas, sem maquiagem.
>
> **O que eu (dono do sistema) quero de você, IA revisora:** olhe tudo com espírito crítico. Aponte: (1) funcionalidades que faltam e seriam valiosas para um negócio de casa de festas com duas unidades; (2) inconsistências ou regras de negócio malfeitas; (3) riscos de segurança, integridade de dados ou UX que você enxergar; (4) prioridades — o que atacar primeiro. Não preciso de elogio, preciso de lacunas.

---

## 1. O negócio

**Brava Park Fest** é uma casa de festas infantis com **duas unidades físicas independentes**: **Vila Operária** e **São Vicente**. Cada unidade tem sua própria conta bancária, seus próprios pacotes, estoque, equipe e grupo de WhatsApp de fornecedores — por isso o sistema quase nunca "mistura" dinheiro das duas unidades, exceto onde o dono pediu explicitamente para somar (ex: fluxo de caixa quando "Ambas as unidades" está selecionado).

O sistema é usado no dia a dia por: o dono (acesso total), e uma equipe com perfis de acesso diferentes (comercial, financeiro, operacional, recepção etc — perfis são criados livremente pelo próprio dono, não são fixos).

Não existe integração oficial com WhatsApp Business API, gateway de pagamento, emissor de nota fiscal ou contabilidade — tudo isso é "manual assistido": o sistema monta a mensagem/documento e a pessoa efetivamente clica para enviar/imprimir.

---

## 2. Stack técnica

- **Frontend**: React + TypeScript + Vite + Tailwind CSS, React Router v6, Recharts (gráficos), lucide-react (ícones), date-fns.
- **Backend**: Supabase (Postgres + Auth + Storage). Não há servidor próprio — o frontend fala direto com o Supabase via `supabase-js`, protegido por Row Level Security (RLS) no banco.
- **Hospedagem/execução**: rodado localmente via `npm run dev` (Vite) neste momento; sem pipeline de deploy automatizado documentado.
- **Migrations**: arquivos SQL numerados sequencialmente em `supabase/*.sql` (atualmente até `044_despesa_fixa_mes_inicial.sql`), todos também espelhados em `supabase/schema.sql` (o "instalador do zero"). Não há ferramenta de migration automatizada (tipo `supabase migration up`) — cada arquivo é colado manualmente no SQL editor do Supabase pelo dono.
- **Sem testes automatizados** (nenhum arquivo de teste no projeto).
- **Sem CI/CD.**

---

## 3. Autenticação e controle de acesso (RBAC)

- Login via Supabase Auth (email/senha). Funcionários são criados por uma Edge Function (`create-employee`) que cria o usuário no Auth e a linha correspondente em `user_profiles`.
- **Perfis de acesso (`roles`)** são dinâmicos — o dono cria/edita/exclui perfis livremente na tela "Usuários e permissões" (ex: Financeiro, Comercial, Operacional, Recepção). Não existe mais um enum fixo de papéis.
- Cada perfil tem uma lista de **permissões** (`role_permission_items`): mais de 50 chaves cobrindo cada página e cada ação sensível (ex: `action:financeiro.marcar_pago`, `action:festa.pagamentos`, `action:clientes.excluir`). O catálogo completo vive em `src/lib/permissionRegistry.ts`.
- **Regra de resolução de permissão**: perfil marcado como `isAdmin` sempre tem acesso total, sem checagem nenhuma. Para os demais: existe uma tabela de **exceções por pessoa** (`user_permission_overrides`) que, se presente, sobrescreve o que o perfil definiria. Se nem o perfil nem a exceção disserem nada sobre uma chave, o padrão é **liberado** (fail-open) — decisão deliberada para não travar ninguém acidentalmente numa tela nova antes do dono configurar.
- Um componente `<Can permission="...">` esconde botões/seções; um guard de rota (`RequireAuth`) esconde páginas inteiras e redireciona pro Painel com aviso de acesso negado.
- **Cuidado técnico já resolvido**: políticas de RLS que uma tabela usa para checar "sou admin?" não podem consultar a própria tabela (`roles` verificando `roles`) — isso causa erro de "recursão infinita" no Postgres. A solução usada foi uma função `security definer` (`is_admin_user`) que roda sem RLS.

---

## 4. Modelo de dados (tabelas principais)

Resumo das entidades centrais (nomes de coluna reais no Postgres):

- **units** — as duas unidades. Guarda dados jurídicos (CNPJ, razão social, endereço) usados na geração de contrato, chave Pix, link de avaliação do Google, link do grupo de WhatsApp da equipe/fornecedores.
- **spaces** — o espaço físico de cada unidade (hoje é 1 espaço por unidade, sem salões separados).
- **clients** — cadastro do contratante: dados de contato, dados estruturados para contrato (CPF, endereço completo), programa de fidelidade (pontos), indicação (`referred_by` + desconto de indicação), dados do aniversariante (nome + **data de nascimento**), origem do lead (`source`: instagram/google/facebook/indicação/outro), e campos de reativação (`reactivation_status`, `last_commercial_contact`, `last_party_date`).
- **reservations** — a festa em si: unidade, cliente, espaço, pacote, data/horário, status (`orcamento`→`confirmada`/`sinal_pago`→`quitada`, ou `cancelada`), valor cheio (`total_value`) vs valor firmado com desconto (`final_value`), dados do aniversariante principal (nome/idade), tema, sabores (prato quente/bolo), cortesias, e dados de cancelamento (motivo, multa retida, valor devolvido).
  - **reservation_birthday_kids** — aniversariantes adicionais da mesma festa (além do principal), para festas com mais de uma criança.
  - Existe uma **trava de banco** (`unique index ... where status <> 'cancelada'`) impedindo duas festas na mesma unidade no mesmo dia, a menos que uma esteja cancelada.
- **payments** — pagamentos recebidos por festa (não há cronograma fixo de parcelas: cada valor recebido de fato vira uma linha, com forma de pagamento). Saldo devedor = `final_value` − soma dos pagamentos.
- **payment_method_fees** — taxa de maquininha (%) por forma de pagamento, **editável pela equipe** (antes era fixa no código), usada para calcular o valor líquido de cada recebimento.
- **packages** / **extra_items** — pacotes vendáveis (com preço diferente para dia de semana x fim de semana) e itens extras avulsos.
- **package_costs** — "ficha técnica" de custo padrão de cada pacote, por categoria (Alimentos/Bebidas/Equipe/Decoração/Outros) — usada como sugestão pré-preenchida ao lançar custo de uma festa.
- **reservation_costs** — custos **específicos de uma festa** (ex: fornecedor exclusivo daquela festa). Regra de negócio importante: isto é separado de `expenses` (despesas gerais) de propósito, para não contar o mesmo gasto duas vezes.
- **reservation_consumption** — consumo avulso fechado no final da festa (ex: chopp por litro).
- **reservation_extra_items** — itens extras vendidos numa festa específica, com preço "congelado" no momento da venda (`price_snapshot`).
- **checklist_items**, **staff_assignments** — checklist operacional e escala de equipe por festa.
- **reservation_documents** — arquivos anexados à festa (Supabase Storage).
- **guest_list_pages** / **guest_list_entries** — lista de convidados enviada pelo próprio contratante via **link público sem login** (dados leves só: nome do convidado, tema, data — nunca telefone/CPF/valor). Tem check-in de chegada na portaria.
- **review_links** / **party_reviews** — formulário de avaliação pós-festa por link público: nota de 1 a 5 para pratos quentes, bolo, docinhos, salgadinhos e atendimento, mais comentário livre.
- **contracts** / **contract_templates** — motor de contrato: um texto-modelo por unidade com variáveis `{{...}}`, preenchido e congelado por reserva ao gerar.
- **proposals** — propostas comerciais (PDF gerado no navegador), com pacote/extras/total e status (enviada/aceita/recusada + motivo).
- **expenses** — contas a pagar gerais do negócio: categoria, fornecedor, valor, vencimento, status (`a_vencer`/`pago`/`atrasado`/`cancelado`), forma de pagamento (quando paga), e link opcional para uma **despesa fixa** que a gerou.
- **recurring_expenses** — "moldes" de despesa fixa (aluguel, folha etc). Uma função de banco (`ensure_recurring_expenses_current_month`) gera, sozinha, um lançamento real em `expenses` todo mês, no dia de vencimento configurado — rodando de forma preguiçosa (é chamada toda vez que o Painel ou o Financeiro carregam, não depende de cron). É possível escolher, na criação, se a despesa fixa já vale **este mês** ou só a **partir do mês que vem** (`first_charge_month`).
- **expense_items** — itens de estoque comprados junto com uma conta a pagar (ligação com `inventory_items`); duas funções de banco (`record_stock_purchase` / `undo_stock_purchase`) somam/desfazem a quantidade no estoque de forma atômica.
- **inventory_items** — estoque por unidade, com quantidade mínima e **consumo por convidado** (`quantity_per_guest`) usado para calcular sozinho quanto precisa comprar para a próxima festa. Tem variantes de compra (`inventory_purchase_variants` — ex: suco vendido em garrafas de 1,5L/3L/5L, convertido para litros no estoque).
- **marketing_spend** — investimento em tráfego pago por mês/unidade, usado para calcular CAC.
- **unit_goals** — meta de faturamento do mês por unidade.
- **suppliers** / **supplier_bookings** — fornecedores terceirizados (buffet externo, DJ, fotógrafo, decorador) com histórico de contratações e avaliação.
- **visits** — agenda de visitas de clientes em potencial ao espaço, com resultado (virou orçamento / não avançou + motivo).
- **contact_history** — log de toda mensagem de WhatsApp "enviada" pelo sistema (na real, é só registrado quando o usuário confirma o envio).
- **audit_log** — log genérico de ações (ex: troca de pacote de uma festa).
- **roles**, **role_permission_items**, **user_permission_overrides**, **user_profiles** — RBAC (seção 3).
- **message_templates** — mensagens de WhatsApp editáveis pela própria equipe (ex: mensagem de confirmação com fornecedores), com fallback hardcoded no código caso a tabela ainda não tenha a chave.

---

## 5. Funcionalidades por módulo (o que existe hoje)

### Painel (Dashboard)
Visão geral do mês: faturamento recebido x previsto, festas confirmadas, ocupação dos espaços, CAC/ticket médio, gráfico de faturamento dos últimos 6 meses por unidade, "ações rápidas" (atalhos para as tarefas mais comuns), barra de progresso da meta do mês, mascote animado.
Alertas automáticos:
- Festas nos próximos 14 dias com dado pendente (tema, sabores, nome/idade do aniversariante).
- Clientes cujo aniversariante faz aniversário de novo em 1, 2 ou 3 meses **e que ainda não têm festa marcada naquele ano** (cruza com `reservations` pra não sugerir reativação de quem já fechou).
- Contas a pagar vencendo nos próximos 14 dias, ficando **vermelho** quando já passou do vencimento.
- Saldo em aberto das festas dos próximos 7 dias.
- Atividade recente (audit log).

### Lembretes diários
Tela separada que já filtra sozinha: pagamento pendente perto da festa, festa é amanhã, pedir avaliação da festa de ontem — cada um com botão "Enviar" que abre o WhatsApp com a mensagem pronta.

### Mapa de reservas (Reservations)
Calendário mensal + lista + "agenda de hoje". Criação de festa com: cliente (ou cadastro rápido embutido, sem sair da tela), unidade, data/horário, pacote (preço já calculado por dia de semana x fim de semana), tipo de evento, convidados, **nome/idade do aniversariante puxados automaticamente do cadastro do cliente** (idade recalculada pela data de nascimento + data do evento), possibilidade de **mais de um aniversariante**, tema, sabores, desconto, cortesias.
**Trava de festa duplicada**: antes de salvar, verifica se já existe outra festa não cancelada na mesma unidade/data e bloqueia com aviso (mais uma trava redundante no banco).
**Lista de espera**: cliente + data desejada + unidade; o sistema mostra um selo "Vaga disponível!" quando a data pedida deixa de estar ocupada (comparando com as reservas ativas).

### Central da festa (FestaDetalhe)
O "hub" de uma festa específica — abas: Visão geral, Financeiro, Checklist, Equipe, Consumo pós-festa.
- Edição de dados gerais (data, horário, tipo, convidados, valor, desconto — reaplica a mesma trava de duplicidade se a data mudar).
- Troca de pacote com **histórico de quem trocou e o efeito no valor** (usa `audit_log`).
- Pagamentos (registrar/remover, com forma de pagamento).
- Itens extras vendidos na festa.
- Custos específicos da festa, com **sugestões pré-preenchidas vindas da ficha técnica do pacote** (editáveis antes de confirmar, com campo de observação) e um **aviso** se já existir uma despesa geral parecida (mesmo valor/fornecedor) lançada em Financeiro no mesmo mês — para não contar o gasto duas vezes.
- Consumo pós-festa (com ou sem baixa automática no estoque).
- Checklist operacional com modelo padrão.
- Escala de equipe.
- Documentos anexados (upload/download privado).
- Lista de convidados: gera link público, mostra check-in em tempo real.
- Cancelamento de festa (motivo, % de multa, valor devolvido).
- Exclusão da festa inteira (única ação "irreversível de verdade" no sistema — ver seção 7).
- Botões de WhatsApp: confirmar festa, lembrete, localização, lembrete de pagamento, **confirmar com fornecedores** (mensagem com horário de entrega calculado automaticamente = 1h antes da festa, tema, aniversariante, observação livre — mensagem editável pela equipe), e **pedir avaliação** (modal com checkbox pra escolher se manda o link do Google, o link do formulário de avaliação, ou os dois).

### Clientes
Cadastro (nome, telefone, email, endereço estruturado com busca de CEP, CPF, data de nascimento do aniversariante, origem, fidelidade, indicação), edição via lápis, histórico de pagamentos por cliente, ações rápidas de WhatsApp (orçamento, pedir avaliação).

### Reativação de clientes
Lista clientes com aniversariante cadastrado, calcula quando é o próximo aniversário e destaca quem está a 1–3 meses — **excluindo quem já tem festa marcada naquele ano**. Funil de status (nova oportunidade → contatado → negociação → nova reserva / sem interesse).

### Agenda de visitas
Agendamento de visita ao espaço por cliente em potencial (unidade, data/hora, responsável), resultado (virou orçamento / não avançou, com observação do motivo).

### Pacotes e itens
CRUD de pacotes (com preço diferenciado por dia de semana) e itens extras. Ficha técnica de custo por categoria (usada pela Central da festa como sugestão).

### Contratos
Motor de template por unidade (texto com variáveis), geração de PDF (impressão do navegador) por festa, status de nota fiscal.

### Propostas comerciais
Monta proposta (pacote + extras), gera PDF, controla status (enviada/aceita/recusada + motivo), e agora tem botão para **gerar o PDF de novo** a qualquer momento sem recriar a proposta.

### Satisfação (NPS)
Registro manual de nota 0–10 (NPS clássico) + **avaliação detalhada por categoria** vinda do formulário público pós-festa (médias de pratos quentes/bolo/docinhos/salgadinhos/atendimento + comentários).

### Pagamentos
Lista de todas as festas com valor firmado x pago x saldo, recebido total/mês, e **detalhamento de taxa de maquininha por forma de pagamento** (editável), mostrando o valor líquido de cada forma.

### Financeiro
- Contas a pagar (com item de estoque vinculado — a compra já soma no estoque sozinha, e a exclusão desfaz a soma).
- Despesas fixas com geração automática mensal (seção 4).
- Cartões de resumo por unidade (entradas do mês, a pagar, atrasado, saldo do mês — **saldo só desconta despesa já paga de verdade**, não a vencer).
- Fluxo de caixa futuro (projeção) e gráfico dos últimos 6 meses — **somados quando "Ambas as unidades" está selecionado**, separados quando uma unidade específica está selecionada. Clicar numa barra abre o detalhe (lista de cada entrada/saída daquele mês, separado por categoria com subtotal).
- Despesas por categoria.
- Edição completa de qualquer lançamento (lápis).

### Resultado do mês
Receita recebida (bruta) − taxas de cartão − despesas gerais pagas − custos de festa = lucro líquido, com margem e comparação dos últimos 6 meses.

### Lucro por festa
Lucro real de cada festa individual (valor firmado − custos lançados naquela festa).

### Relatórios e metas
Meta de faturamento por unidade, comparativo entre unidades, projeção de recebimento futuro, exportação CSV com log (LGPD) de quem exportou.

### Estoque
Itens por unidade com consumo por convidado (calcula sozinho quanto precisa comprar pra próxima festa), "velas numéricas" agrupadas de forma compacta (0–9 azul/rosa), lista de compras automática.

### Escalas
Agenda de equipe por festa num intervalo de datas, com impressão.

### Relatório de aniversariantes
Lista para cozinha/fornecedores: tema, sabores, aniversariante, idade, quantidade de convidados, horário de entrega dos fornecedores (calculado).

### Fornecedores
Cadastro de fornecedores terceirizados, histórico de contratações por festa, avaliação (nota + comentário).

### Tráfego e CAC
Gasto em tráfego pago por mês/unidade, CAC calculado **só sobre clientes vindos de Instagram/Facebook/Google** (tráfego pago de verdade), comparado ao ticket médio, evolução dos últimos 6 meses.

### Funil de conversão
Taxa de conversão geral (recebidas → negociação → fechadas) e conversão por origem do cliente, com gráfico de pizza.

### Usuários e permissões
CRUD de funcionários e de perfis de acesso dinâmicos (ver seção 3), com resumo de "quantos acessos cada perfil libera" e possibilidade de customizar o acesso de uma pessoa específica além do perfil dela.

---

## 6. Sistema de "Desfazer" (undo global)

Qualquer exclusão no sistema (não edição, só exclusão) mostra um aviso "Desfazer" por 6 segundos, no canto inferior da tela, que sobrevive à troca de página. A exclusão acontece **na hora** (não fica esperando os 6s) e, se a pessoa clicar em desfazer, o registro é **recriado de verdade no banco** com os mesmos dados — não é só um "voltar visualmente". A única exceção é excluir a **festa inteira**, que continua com exclusão adiada de propósito, porque cascadeia (apaga pagamentos, custos, documentos etc. junto) e recriar só a linha principal não devolveria os dados filhos.

---

## 7. Integrações externas (todas manuais/assistidas, nenhuma automática de verdade)

- **WhatsApp**: nunca há envio automático. O sistema monta a mensagem e abre `wa.me` (número individual) ou o link do grupo (para grupos, já que o WhatsApp não permite pré-preencher texto em grupo — o usuário precisa colar manualmente).
- **CEP**: busca endereço via ViaCEP ao digitar o CEP do cliente.
- **PDF**: gerado abrindo uma nova janela com HTML/CSS e chamando `window.print()` do navegador (usuário escolhe "Salvar como PDF" na caixa de impressão) — não há geração de PDF no servidor.
- **Storage de arquivos**: Supabase Storage, usado para documentos da festa.

---

## 8. Limitações e dívidas técnicas conhecidas (não escondam isso da análise)

- **Sem testes automatizados** de nenhum tipo.
- **Sem CI/CD** — deploy e migrations são manuais.
- Um bug conhecido e **ainda não corrigido**: o histórico de troca de pacote (`audit_log` com embed de `user_profiles`) retorna erro 400 silencioso porque não existe FK direta entre as duas tabelas — a função engole o erro e mostra lista vazia. Baixa prioridade, mas existe.
- WhatsApp "oficial" (API Business) nunca foi integrado — tudo depende de o funcionário clicar em enviar.
- Geração de PDF depende do navegador/impressora virtual do usuário — já teve bug de "abre a caixa de impressão em branco" corrigido com um pequeno atraso antes do `print()`, mas ainda é uma solução frágil comparada a gerar PDF no servidor.
- Não há geração automática de nota fiscal (só um campo de status manual).
- `payment_method_fees` e as taxas de cartão são uma **estimativa configurada manualmente** — não vêm de uma integração real com adquirente/maquininha.
- Não existe controle de estoque com múltiplos fornecedores/preços por item (preço de compra não é rastreado por item, só o gasto total da conta a pagar).
- A meta de faturamento (`unit_goals`) é só mensal, sem histórico de metas passadas comparado a realizado.
- Não existe app mobile nem PWA — é uma SPA web comum, usada no navegador (inclusive celular).

---

## 9. O que eu quero de você (IA revisora)

Analisando tudo isso como um consultor externo que entende de sistemas para negócios de eventos/festas:

1. Que funcionalidades **estão faltando** e um negócio deste porte (casa de festas, 2 unidades, equipe com múltiplos perfis) provavelmente precisaria?
2. Que **regras de negócio** parecem frágeis, incompletas ou arriscadas (financeiro, operacional, ou de dados)?
3. Que **riscos** você identifica (segurança, integridade de dados, experiência do usuário, dependência de processos manuais)?
4. Dado tudo isso, **qual seria sua ordem de prioridade** se você fosse escolher as próximas 5 coisas a construir?

Seja direto e crítico — o objetivo é achar buraco, não validar o que já existe.
