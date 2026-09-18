-- =========================================================
-- LIMPEZA DE DADOS DE TESTE — rodar UMA VEZ, manualmente, no SQL Editor do
-- Supabase (não é uma migration de schema, por isso não tem número nem
-- entra no schema.sql — uma instalação nova já nasce sem esses dados).
--
-- Apaga: todos os clientes cadastrados — e, por tabela em cascata (mesma
-- regra que já existia no banco), tudo que pendura neles: festas
-- (reservations), lista de espera, pagamentos, itens extras, custos de
-- festa, consumo pós-festa, documentos anexados (só a linha no banco — o
-- arquivo em si continua no Storage, ver aviso abaixo), checklist, equipe
-- escalada, lista de convidados pública e check-ins, formulário de
-- avaliação pós-festa e contratos gerados.
-- Apaga também: despesas fixas cadastradas (recurring_expenses) e todas as
-- contas a pagar já lançadas (expenses) — nessa ordem não importa, porque
-- a ligação entre elas é "on delete set null", não cascata.
--
-- NÃO apaga: pacotes, itens extras do catálogo, fornecedores, usuários e
-- perfis de acesso, unidades, propostas comerciais, metas de faturamento e
-- gasto de tráfego pago (marketing_spend/unit_goals) — nada disso foi
-- pedido como "teste".
--
-- AVISO sobre Storage: os arquivos que foram anexados a alguma festa
-- (bucket "festa-documentos") NÃO são apagados por este script — apagar a
-- linha do banco não apaga o arquivo de verdade no Storage, são sistemas
-- separados. Se quiser limpar os arquivos também, me avisa que eu te passo
-- o comando (ou você pode ir em Storage > festa-documentos no painel do
-- Supabase e apagar a pasta manualmente).
--
-- Isso é irreversível — não tem "Desfazer" pra isso, diferente das
-- exclusões feitas pela tela do sistema.
-- =========================================================

delete from expenses;
delete from recurring_expenses;
delete from clients;
