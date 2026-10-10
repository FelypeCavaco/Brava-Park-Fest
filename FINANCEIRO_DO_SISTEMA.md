# Brava Park Fest — Como funciona a parte financeira do sistema

*Versão de 10/10/2026. Descreve o sistema depois das correções desta data (veja a seção 11).*

---

## Sumário

1. Visão geral: os três "caminhos" do dinheiro
2. Dinheiro que entra: pagamentos das festas
3. Status da festa e saldo devedor
4. Contas a pagar (despesas variáveis)
5. Despesas fixas mensais
6. Custos das festas (o que cada festa gasta)
7. Despesa fixa das festas
8. Estoque: compras, consumo e transferência entre unidades
9. Onde cada número aparece e como é calculado
10. Regras para não contar o mesmo gasto duas vezes
11. Correções feitas em 10/10/2026
12. Limitações que ainda existem
13. Exemplo completo, do início ao fim

---

## 1. Visão geral: os três "caminhos" do dinheiro

O sistema separa o dinheiro em três tipos de lançamento. Entender essa separação é o mais importante deste documento.

| Caminho | O que é | Onde se lança | Conta no mês… |
|---|---|---|---|
| **Pagamentos recebidos** | Dinheiro que o cliente pagou pela festa | Central da festa → aba Financeiro | …em que o pagamento foi recebido (data do pagamento) |
| **Contas a pagar** | Gastos gerais do negócio: aluguel, salários, impostos, manutenção, compras para o estoque | Financeiro | …em que a conta foi paga (data do pagamento) |
| **Custos das festas** | O que uma festa específica gastou: equipe, docinhos, DJ, decoração | Central da festa → aba Financeiro (ou automático) | …em que a festa acontece (data da festa) |

**Cada unidade é separada.** Vila Operária e São Vicente têm contas bancárias diferentes, por isso cada lançamento pertence a uma unidade. O seletor de unidade, na barra lateral, filtra as telas. Com "Ambas as unidades", os cartões aparecem separados por unidade e o fluxo de caixa mostra as duas somadas.

---

## 2. Dinheiro que entra: pagamentos das festas

**Onde:** Central da festa → aba **Financeiro** → registrar pagamento.

- Cada valor que o cliente paga vira **um lançamento**, com data, valor e forma de pagamento (Pix, cartão de crédito, cartão de débito, dinheiro, boleto, transferência, outro).
- Não existe um "plano de parcelas" com datas futuras: o sistema guarda só o que **realmente entrou**. Sinal, parcelas e quitação são todos lançamentos de pagamento.
- O pagamento pode ser removido (com o botão "Desfazer" por 6 segundos).
- **Quem pode:** quem tem a permissão "Registrar/remover pagamentos".

### Taxa da maquininha
- **Onde:** tela **Pagamentos**, quadro "Taxas da maquininha".
- Para cada forma de pagamento você informa um percentual (ex: crédito 3,5%, débito 1,5%, Pix 0%).
- O sistema usa esse percentual para calcular o **valor líquido** de cada recebimento e a **taxa do mês**. Esse desconto aparece no Resultado do mês.
- É uma **estimativa** configurada por vocês. O sistema não lê a taxa real da maquininha.

---

## 3. Status da festa e saldo devedor

**Valor devido da festa** = valor firmado no contrato (já com desconto) + itens extras vendidos + consumo pós-festa cobrado.

**Saldo devedor** = valor devido − tudo o que já foi pago.

O **status muda sozinho** conforme os pagamentos:

| Situação | Status |
|---|---|
| Orçamento sem nenhum pagamento | **Orçamento** (cinza no mapa) |
| Recebeu algum pagamento, mas ainda falta | **Confirmada** (rosa no mapa) |
| Pagou tudo | **Quitada** (verde no mapa) |
| Cancelada | **Cancelada** (vermelho) — nunca muda sozinha |

- O status é recalculado sempre que entra, muda ou sai um pagamento, um extra ou um consumo, e quando o valor da festa é alterado.
- Exemplo: uma festa Quitada que recebe um extra de R$ 300 volta a ser Confirmada até o extra ser pago.
- No histórico da festa essa mudança aparece como "Sistema (status automático)".

### Cancelamento
Ao cancelar, registra-se o **motivo**, o **% de multa retida** e o **valor devolvido** ao cliente. Os custos fixos automáticos saem da festa. Veja a limitação sobre o valor devolvido na seção 12.

---

## 4. Contas a pagar (despesas variáveis)

**Onde:** **Financeiro → Registrar conta a pagar**.

### 4.1 Lançar uma conta
1. Escolha a **unidade**, a **categoria** (Aluguel, Folha de pagamento, Fornecedores, Manutenção, Marketing, Impostos ou Outros — em "Outros" dá para escrever a categoria), a **descrição**, o **fornecedor** (opcional), o **valor** e o **vencimento**.
2. (Opcional) **Itens de estoque comprados nessa conta.** Veja a seção 8.1.
3. (Opcional) Marque **"Esta conta paga custos que já estão lançados nas festas"** quando for o caso. Veja a seção 10.
4. Clique em **Adicionar conta**.

### 4.2 Situação da conta (status)

| Status | Quando |
|---|---|
| **A vencer** | Não paga e vencimento hoje ou no futuro |
| **Atrasado** | Não paga e vencimento já passou — **o sistema muda sozinho** |
| **Pago** | Alguém marcou como paga, informando forma e data do pagamento |
| **Cancelado** | Marcado à mão (ex: conta lançada por engano que não se quer apagar) |

- Ao salvar uma conta com vencimento no passado, ela já entra como Atrasado.
- Se você editar o vencimento de uma conta atrasada para uma data futura, ela volta para A vencer.
- Toda vez que o Painel ou o Financeiro são abertos, as contas que venceram passam para Atrasado. No histórico isso aparece como "Sistema (conta venceu)".
- "Hoje" é sempre a data de Brasília.

### 4.3 Marcar como paga
- Botão **Marcar pago** na lista. Abre o formulário pedindo a **forma de pagamento** e a **data do pagamento** (vem preenchida com hoje).
- **A data do pagamento decide em que mês a saída conta**, não o vencimento. Uma conta que vence dia 30/09 e foi paga dia 02/10 conta como saída de outubro.

### 4.4 Editar e excluir
- O **lápis** edita tudo: descrição, fornecedor, categoria, valor, vencimento, status, forma e data do pagamento, e a marcação de "custos das festas".
- **Excluir** apaga na hora e mostra "Desfazer" por 6 segundos. Se a conta tinha somado itens no estoque, o estoque é descontado de volta; se você desfizer, a conta volta e o estoque soma de novo.

### 4.5 Permissões
Ações separadas por permissão: registrar conta, gerenciar despesas fixas, marcar como paga e remover. Dá para ter alguém que lança contas mas não pode marcar como paga, por exemplo.

---

## 5. Despesas fixas mensais

**Onde:** **Financeiro → Despesas fixas (recorrentes)**.

Para gastos que se repetem todo mês: aluguel, salários fixos, internet, contador.

1. Cadastre a unidade, a categoria, a descrição, o valor mensal e o **dia do vencimento**.
2. Escolha se ela já vale **neste mês** ou **só a partir do mês que vem**.
3. Todo mês o sistema **cria sozinho uma conta a pagar** com esse valor e vencimento naquele dia (se o mês não tem o dia, usa o último dia do mês; ex: dia 31 em fevereiro).
4. Essa conta funciona igual a qualquer outra: A vencer → Atrasado (se passar do dia) → Pago quando você marcar.

**Detalhes importantes:**
- A criação acontece quando alguém abre o Painel ou o Financeiro. Não precisa de mais nada, mas se ninguém abrir o sistema num mês inteiro, a conta daquele mês não é criada.
- Nunca cria duas vezes a mesma despesa no mesmo mês.
- **Pausar** a despesa fixa para de criar as próximas. As contas já criadas continuam.
- **Mudar o valor** da despesa fixa vale para os próximos meses. A conta do mês atual, se já foi criada, deve ser editada à parte.
- Na lista aparece a situação da conta deste mês (pendente, vencida ou paga).

---

## 6. Custos das festas (o que cada festa gasta)

São os gastos **de uma festa específica**. Servem para saber o **lucro de cada festa** e entram no Resultado do mês e no saldo do Financeiro. Ficam separados das contas a pagar.

Formas de um custo entrar numa festa:

| Como entra | Detalhe |
|---|---|
| **Manual** — Central da festa → Financeiro → Custos | Você lança descrição e valor. O sistema **sugere os valores da ficha técnica do pacote** (Alimentos, Bebidas, Equipe, Decoração, Outros), editáveis antes de confirmar. Se já existir uma conta a pagar parecida no mesmo mês (mesmo valor ou descrição/fornecedor parecido), ele **avisa** antes de salvar. |
| **Despesa fixa das festas** — automático | Veja a seção 7. Aparece com o selo **"fixo"**. |
| **Pagamento da equipe** — aba Equipe | Ao marcar "Compareceu", o sistema pergunta se quer lançar o pagamento (padrão R$ 150 por pessoa, editável). Vira um custo da festa e o nome mostra "Compareceu · R$ X lançado". **Desfazer a presença apaga o custo.** Substituir alguém registra o substituto e o motivo. |
| **Tela Lucro por festa** | Também permite lançar e remover custos de cada festa. |

**Ficha técnica do pacote** (Pacotes e itens → Ficha técnica): o custo-padrão de cada pacote por categoria. É só uma sugestão: nada é lançado sozinho por ela.

---

## 7. Despesa fixa das festas

**Onde:** **Financeiro → Despesa fixa das festas**.

Para custos que **toda festa tem** (ex: docinhos, salgadinhos, limpeza pós-festa).

1. Cadastre **o que é** (ex: Docinhos), **para qual unidade vale** (uma unidade ou as duas) e o **valor padrão**.
2. (Opcional) **Valor por plano:** um valor diferente para cada pacote (ex: Classic 50 = R$ 600, Gourmet 70 = R$ 820). Plano sem valor próprio usa o padrão.
3. A tela mostra o total por unidade (mínimo e máximo conforme o plano).

**O que acontece sozinho:**
- **Festa nova** já nasce com essas despesas lançadas nos custos dela, com o valor do plano da festa.
- **Trocou o pacote** da festa → o valor é recalculado para o novo plano.
- **Mudou o valor** de uma despesa fixa → atualiza as festas **de hoje em diante**. As festas passadas ficam com o valor que tinham.
- **Excluiu** a despesa fixa → sai das festas de hoje em diante. As passadas mantêm o custo.
- **Cancelou** a festa → as despesas fixas saem dela. **Descancelou** ou **mudou de unidade** → entram de novo.
- Festas que já existiam **antes** de a despesa ser cadastrada só recebem o lançamento a partir de hoje (não é retroativo para festas passadas).

---

## 8. Estoque: compras, consumo e transferência entre unidades

O estoque guarda **quantidades**, não valores em dinheiro. O dinheiro da compra fica na conta a pagar.

### 8.1 Compra (estoque entra)
- No formulário de **conta a pagar**, adicione os itens que vieram na compra: escolha o item e a quantidade.
- Para itens com tamanhos de compra (ex: suco em garrafa de 1,5 L, 3 L ou 5 L), escolha o tamanho e quantas garrafas. O sistema converte em litros sozinho.
- Ao salvar a conta, as quantidades **somam no estoque** da unidade da conta.
- Excluir a conta **desconta de volta** do estoque.

### 8.2 Ajuste manual
Na tela **Estoque**, os botões **+ / −** andam de número inteiro em número inteiro (6,5 → 7 ou 6), e o campo de quantidade aceita qualquer valor digitado (salva meio segundo depois).

### 8.3 Consumo pós-festa (estoque sai)
- **Onde:** Central da festa → aba **Consumo pós-festa**.
- Lança o que foi gasto na festa. A quantidade **sai do estoque** da unidade na hora.
- Dá para **editar** (o estoque é corrigido só pela diferença) ou **desfazer** (devolve ao estoque).
- Isto não gera dinheiro nem custo. É só controle de quantidade.
- Não confundir com **consumo cobrado à parte** (ex: chopp por litro), que é uma cobrança ao cliente e entra no valor devido da festa.

### 8.4 Lista de compras
- O item entra na **Lista de compras** quando a quantidade fica abaixo do **mínimo**.
- Se o item tem **consumo por convidado** (ex: 0,2 L de suco por pessoa), o mínimo passa a ser o necessário para a **próxima festa** da unidade, se for maior que o mínimo fixo.
- As velas numéricas (0–9, azul e rosa) seguem a mesma regra.

### 8.5 Transferência entre unidades
**Onde:** Estoque → ícone de transferir ao lado do item.

1. Escolha a **quantidade** e a **unidade de destino**. Não é possível transferir mais do que há.
2. A quantidade **sai** da unidade de origem.
3. Na unidade de destino, o sistema procura um item com o **mesmo nome exato**:
   - **existe** → soma a quantidade nele;
   - **não existe** → cria o item lá, com as mesmas configurações (categoria, unidade de medida, mínimo, consumo por convidado, fornecedor).
4. **Nenhum valor em dinheiro é movimentado.** A compra continua sendo despesa da unidade que comprou. Se for preciso "cobrar" a outra unidade, isso hoje tem que ser feito por fora (ex: uma conta a pagar na unidade de destino, de forma manual).
5. A transferência fica registrada no histórico de alterações (quem fez, quantidade antes e depois).

---

## 9. Onde cada número aparece e como é calculado

### 9.1 Financeiro — cartões do mês (por unidade)

| Cartão | Cálculo |
|---|---|
| **Entradas do mês** | Soma dos pagamentos das festas com data de pagamento neste mês |
| **Custos das festas do mês** | Custos lançados nas festas deste mês **que já aconteceram** (até hoje). Embaixo, o valor das festas que ainda vão acontecer no mês. |
| **A pagar (a vencer)** | Contas não pagas com vencimento hoje ou depois |
| **Atrasado** | Contas não pagas com vencimento já passado |
| **Saldo do mês** | Entradas do mês − contas **pagas** neste mês − custos das festas já realizadas no mês |

### 9.2 Financeiro — fluxo de caixa futuro (projeção)
**Saldo projetado** = saldo do mês + recebimentos previstos − contas a pagar (a vencer + atrasadas) − custos das próximas festas do mês.

- **Recebimentos previstos** = o que ainda falta receber das festas deste mês (valor firmado − pago).
- Contas marcadas como "paga custos das festas" não entram.

### 9.3 Financeiro — gráfico dos últimos 6 meses
- **Entradas** = pagamentos recebidos no mês.
- **Saídas** = contas pagas no mês + custos das festas do mês.
- Clicar numa barra mostra a lista de cada entrada ou saída daquele mês.

### 9.4 Financeiro — despesas por categoria
Soma das contas a pagar lançadas, por categoria (sem as marcadas como "paga custos das festas").

### 9.5 Pagamentos
Todas as festas com valor firmado, pago e saldo; total recebido, recebido no mês, saldo em aberto e taxa da maquininha do mês por forma de pagamento.

### 9.6 Resultado do mês
**Lucro líquido** = receita recebida no mês − taxas da maquininha − contas pagas no mês − custos das festas do mês.

- **Margem** = lucro ÷ receita. Abaixo de 10% aparece o alerta "Margem baixa"; de 10% a 25% fica amarela; 25% ou mais, verde.
- Mostra por unidade e os últimos 6 meses.

### 9.7 Lucro por festa
**Lucro da festa** = valor firmado da festa − custos lançados nela. Mostra o lucro total do período e a margem média.

### 9.8 Painel
- **Faturamento recebido** no mês e gráfico de 6 meses por unidade.
- **Meta do mês** com barra de progresso.
- **Contas a pagar** vencendo nos próximos 14 dias, em vermelho as vencidas (inclui as marcadas como "paga custos das festas", porque elas também precisam ser pagas).
- **Saldo em aberto** das festas dos próximos 7 dias.

### 9.9 Relatórios e metas
- Meta de faturamento por unidade e comparativo entre unidades.
- **Projeção de recebimento** dos próximos meses: o que falta receber das festas já agendadas.
- Exportação CSV.

### 9.10 Tráfego e CAC
**CAC** = gasto em tráfego pago no mês ÷ clientes novos vindos de Instagram, Facebook ou Google. É comparado ao ticket médio.

---

## 10. Regras para não contar o mesmo gasto duas vezes

**Regra principal:** cada gasto deve existir **num único lugar** que entra nas contas.

| Tipo de gasto | Onde lançar |
|---|---|
| Gasto geral do negócio (aluguel, salário fixo, imposto, conta de luz, manutenção) | **Conta a pagar** |
| Compra para o estoque | **Conta a pagar** com os itens de estoque |
| Gasto de uma festa específica (DJ exclusivo, decoração especial) | **Custo da festa** |
| Pagamento da equipe por festa | **Aba Equipe** ("Compareceu"), que lança o custo sozinho |
| Custo que toda festa tem (docinhos, salgadinhos) | **Despesa fixa das festas**, que lança sozinho |

**Quando o mesmo gasto precisa aparecer nos dois lugares.** Exemplo: o fornecedor de docinhos manda uma nota única no fim do mês, que precisa ser paga, e os docinhos já entraram como custo fixo em cada festa.

- Lance a nota como **conta a pagar** e marque **"Esta conta paga custos que já estão lançados nas festas"**.
- Ela continua na lista, vence, fica atrasada e é marcada como paga normalmente, e aparece no aviso de contas do Painel.
- Mas **não entra em nenhum total**: saldo, resultado, fluxo de caixa, a pagar, atrasado e despesas por categoria. O valor já está contado pelos custos das festas.
- Na lista ela aparece com a indicação **"Já nos custos das festas"**.

**Aviso automático:** ao lançar um custo manual numa festa, o sistema avisa se já existe uma conta a pagar parecida no mesmo mês (não considera as contas já marcadas).

---

## 11. Correções feitas em 10/10/2026

1. **Conta vencida vira "Atrasado" sozinha.** Antes, só mudava se alguém editasse, e o cartão "Atrasado" ficava zerado.
2. **Marcação "paga custos já lançados nas festas"** nas contas a pagar, para acabar com a contagem em dobro (seção 10).
3. **Saldo do mês no Financeiro inclui os custos das festas.** Antes, equipe e despesas fixas das festas não saíam do saldo, que ficava maior do que o real. A projeção também desconta os custos das próximas festas do mês. Novo cartão "Custos das festas do mês".
4. O vencimento da nova conta a pagar agora vem preenchido com **hoje** (antes vinha uma data fixa antiga).
5. Mudanças automáticas (status da festa, conta vencida) aparecem no histórico como **"Sistema"**, e não com o nome de quem estava usando o sistema naquela hora.
6. Segurança: três funções internas do banco que podiam ser chamadas sem login foram fechadas.

---

## 12. Limitações que ainda existem

- **Valor devolvido no cancelamento não sai do caixa.** O valor fica registrado na festa, mas não aparece como saída no Financeiro nem no Resultado. Hoje é preciso lançar uma conta a pagar para isso.
- **Lucro por festa e recebimentos previstos usam só o valor firmado.** Extras vendidos e consumo cobrado entram no saldo do cliente, mas não no lucro por festa nem na projeção de recebimentos.
- **Não existe plano de parcelas.** O sistema não sabe que "a 2ª parcela vence dia 15", só o que já foi pago.
- **Taxa da maquininha é estimada.** Não vem da operadora.
- **Estoque não tem preço.** A transferência entre unidades não movimenta dinheiro, e o consumo pós-festa não vira custo automaticamente.
- **Mistura de regras de data.** Recebimentos e contas contam pela data em que o dinheiro entrou ou saiu. Custos das festas contam pela data da festa. Num mês com muitas festas pagas antecipadamente, a receita aparece num mês e o custo em outro.
- **Despesas fixas mensais** só são criadas quando alguém abre o Painel ou o Financeiro naquele mês.
- **Sem conciliação bancária.** O sistema não confere com o extrato do banco.

---

## 13. Exemplo completo, do início ao fim

Festa do Pedro, Vila Operária, plano Classic 50 pessoas, sábado, valor R$ 4.500.

1. **Reserva criada** em agosto → status Orçamento. A despesa fixa das festas lança sozinha "Docinhos R$ 600" e "Limpeza pós-festa R$ 180" nos custos da festa.
2. **Sinal de R$ 1.350 por Pix** em agosto → status vira **Confirmada**. Conta como entrada de **agosto**.
3. **Venda de cabine de fotos (R$ 650)** em setembro → valor devido passa a R$ 5.150.
4. **Pagamento de R$ 3.800 no cartão de crédito** em outubro → pagou R$ 5.150 → status vira **Quitada**. Entrada de **outubro**; a taxa da maquininha (ex: 3,5% = R$ 133) é descontada no Resultado de outubro.
5. **Dia da festa (outubro):** 4 pessoas da equipe marcadas como "Compareceu" → 4 custos de R$ 150 = R$ 600. Consumo pós-festa lançado → sai do estoque (sem valor em dinheiro).
6. **Custos da festa:** R$ 600 + R$ 180 + R$ 600 = **R$ 1.380**. Contam em **outubro** (mês da festa).
7. **Fim do mês:** chega a nota do fornecedor de docinhos (R$ 2.400, várias festas). É lançada como conta a pagar **marcada** como "paga custos já lançados nas festas" → fica na lista para pagar, mas não soma em nada (os R$ 600 desta festa já estão nos custos).
8. **Lucro por festa:** R$ 4.500 (valor firmado) − R$ 1.380 = **R$ 3.120**.
9. **Resultado de outubro:** inclui os R$ 3.800 recebidos, menos a taxa de R$ 133, menos os R$ 1.380 de custos da festa, menos as contas gerais pagas em outubro.
