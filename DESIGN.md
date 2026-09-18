# Direção visual — Brava Park Fest

Paleta baseada na logo oficial (urso mascote, "BRAVA PARK Fest") — roxo como
cor de marca, verde como destaque secundário, laranja usado com moderação
(vindo das estrelas da logo).

## Cor

- `ink` `#241B33` — texto principal e fundo da barra lateral (preto com base
  violeta, não preto puro)
- `paper` `#F5F2FA` — fundo geral da aplicação (neutro com leve tom violeta)
- `surface` `#FFFFFF` — fundo dos cards e tabelas
- `line` `#E2DBEE` — bordas e divisórias
- `purple` `#6D28D9` — cor de marca principal (ações, gráficos, navegação
  ativa) — vem direto do roxo da logo
- `green` `#7CB92E` — destaque secundário — vem do verde do texto "Fest" na
  logo, usado em gráficos comparativos e detalhes
- `orange` `#F2900C` — destaque pontual — vem das estrelas da logo, usado com
  moderação (ex: ícone da marca na barra lateral)
- `teal` `#1F7A5C` — status positivos (pago, confirmada, quitada)
- `amber` `#B8720A` — status de atenção (pendente, vencendo)
- `danger` `#B23A3A` — status negativos (atrasado, cancelada)

## Tipografia

- **Space Grotesk** — títulos e números de destaque (`font-display`)
- **Inter** — texto de interface, tabelas, formulários (`font-sans`)

## Multi-unidade

O sistema atende duas unidades — **Vila Operária** e **São Vicente**. Um
seletor de unidade fica fixo na barra lateral ("Ambas as unidades" ou uma
unidade específica), e o painel principal, o mapa de reservas e a lista de
espera respeitam essa seleção. Espaços, reservas e gasto de marketing são
sempre vinculados a uma unidade no banco de dados (`unit_id`); clientes são
compartilhados entre as duas.

## Layout

- Barra lateral fixa à esquerda com fundo escuro (`ink`) e o seletor de
  unidade logo abaixo da marca
- Cards com borda de 1px (`line`) em vez de sombra pesada
- Badges coloridos por status, com significado fixo em todo o sistema (teal =
  positivo, amber = atenção, danger = problema)
- Painel principal traz um mapa de calor de ocupação dos próximos 10 dias por
  espaço, além dos indicadores e do comparativo de faturamento entre as duas
  unidades
