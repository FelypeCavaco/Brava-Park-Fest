// Guia Festou: o conteúdo de ajuda de cada parte do sistema (gerado a partir
// da prévia aprovada em 9/11/2026). Para mudar um texto, edite aqui.
//   plano  — só para mostrar a etiqueta (Profissional/Master)
//   modulo — o artigo some para a casa que não tem essa função ligada
//   telas  — endereços em que o botão "Ajuda" abre este artigo
//   video  — true quando existe /guia/videos/<id>.mp4

export type PlanoGuia = 'todos' | 'pro' | 'master'
export interface ArtigoGuia {
  id: string
  cat: string
  plano: PlanoGuia
  onde: string
  titulo: string
  resumo: string
  passos: string[]
  dicas: string[]
  modulo?: string
  telas?: string[]
  video?: boolean
}
export interface CategoriaGuia { id: string; nome: string; desc: string; icone: string }

export const GUIA_CATEGORIAS: CategoriaGuia[] = [
  {
    "id": "inicio",
    "nome": "Primeiros passos",
    "desc": "Deixe o sistema com a cara da sua casa",
    "icone": "🚀"
  },
  {
    "id": "festas",
    "nome": "Reservas e festas",
    "desc": "Do cadastro ao dia da festa",
    "icone": "🎉"
  },
  {
    "id": "portal",
    "nome": "Portal da família",
    "desc": "O link que a família recebe",
    "icone": "📱"
  },
  {
    "id": "clientes",
    "nome": "Clientes e vendas",
    "desc": "Clientes, propostas, contratos e comissões",
    "icone": "🤝"
  },
  {
    "id": "financeiro",
    "nome": "Financeiro",
    "desc": "Entradas, saídas, resultado e planejamento",
    "icone": "💰"
  },
  {
    "id": "operacao",
    "nome": "Operação",
    "desc": "Estoque, equipe, fornecedores e relatórios",
    "icone": "📦"
  },
  {
    "id": "conta",
    "nome": "Sua conta",
    "desc": "Usuários, dados, mensalidade e privacidade",
    "icone": "⚙️"
  }
]

export const GUIA: ArtigoGuia[] = [
  {
    "id": "primeiro-acesso",
    "cat": "inicio",
    "plano": "todos",
    "onde": "Tela de login",
    "titulo": "Primeiro acesso e troca da senha",
    "resumo": "Como entrar pela primeira vez, criar a sua senha e aceitar os Termos de Uso.",
    "passos": [
      "Abra app.usefestou.com.br no navegador do computador ou do celular.",
      "Entre com o e-mail e a senha provisória que você recebeu do Festou.",
      "Na tela \"Crie a sua senha\", digite uma senha nova com pelo menos 8 caracteres e repita no campo de baixo.",
      "Leia os Termos de Uso e a Política de Privacidade (clique no nome em roxo para abrir) e marque a caixinha \"Li e aceito\".",
      "Clique em \"Salvar e entrar\". Pronto: a partir de agora, use sempre a senha nova."
    ],
    "dicas": [
      "A senha nova precisa ser diferente da provisória.",
      "Esqueceu a senha? Peça ao administrador da sua casa uma nova senha provisória em Usuários e permissões.",
      "Quando os Termos mudarem, o sistema pede o aceite de novo antes de entrar."
    ]
  },
  {
    "id": "empresa",
    "cat": "inicio",
    "plano": "todos",
    "onde": "Pedido ao suporte do Festou",
    "titulo": "Nome, logo e WhatsApp da casa",
    "resumo": "Os dados que aparecem no menu, na tela de login, no portal da família e nos PDFs. Quem altera é o suporte do Festou.",
    "passos": [
      "O nome da casa, a frase da marca, a logo e o WhatsApp da equipe ficam guardados nos dados da empresa.",
      "Para proteger esses dados, quem altera é o suporte do Festou.",
      "Para mudar, fale com o suporte pelo botão de WhatsApp aqui embaixo e diga o que quer mudar.",
      "Para trocar a logo, mande a imagem pelo WhatsApp (PNG, JPG ou WEBP, de preferência quadrada).",
      "Assim que o suporte alterar, a mudança aparece para toda a equipe e no portal das famílias."
    ],
    "dicas": [
      "Sem logo, o sistema mostra as iniciais do nome.",
      "O WhatsApp da equipe é o número que a família chama pelo portal da festa."
    ]
  },
  {
    "id": "unidades",
    "cat": "inicio",
    "plano": "todos",
    "onde": "Pedido ao suporte do Festou",
    "titulo": "Dados e regras das unidades",
    "resumo": "Chave Pix, regras do portal, roteiro da festa e outros ajustes de cada salão. Quem altera é o suporte do Festou.",
    "passos": [
      "Cada salão é uma unidade, com os próprios dados e regras.",
      "O que fica em cada unidade: razão social, CNPJ e endereço; a chave Pix usada no QR code do portal; o link de avaliação do Google; o valor da hora extra e o sinal padrão.",
      "Também ficam na unidade as regras que a família vê no portal: prazos do cardápio e da lista, idade que conta como convidado, o roteiro sugerido da festa e se a família pode mandar playlist.",
      "Para proteger esses dados (principalmente a chave Pix), quem altera é o suporte do Festou.",
      "Para mudar algo ou abrir uma unidade nova, fale com o suporte pelo botão de WhatsApp aqui embaixo."
    ],
    "dicas": [
      "Cada unidade a mais custa R$ 49,90 por mês (veja \"Planos, unidades e o que cada um inclui\").",
      "Confira a chave Pix no portal de uma festa (\"Abrir como o cliente vê\") antes de mandar o link para as famílias."
    ],
    "telas": [
      "/configuracoes"
    ]
  },
  {
    "id": "pacotes",
    "cat": "inicio",
    "plano": "todos",
    "onde": "Comercial → Pacotes e itens",
    "titulo": "Pacotes e itens extras",
    "resumo": "Os pacotes são a base do orçamento, do contrato e do cardápio do portal.",
    "passos": [
      "Abra Comercial → Pacotes e itens e clique em \"Novo pacote\".",
      "Dê um nome (ex.: Diamante) e escreva a descrição do que está incluso.",
      "Informe o preço padrão. Se o preço muda conforme o dia, preencha também \"Preço seg-qui\" e \"Preço sex-dom\".",
      "Escolha a unidade (ou \"Disponível para qualquer unidade\"), o limite de convidados e a duração em horas.",
      "Em \"Itens inclusos\", liste o que vai no contrato (ex.: docinhos, salgados, refrigerante, bolo).",
      "Em \"Pratos quentes inclusos\", diga quantos pratos quentes a família escolhe no portal (0 = só coquetel).",
      "Se o preço vale só por um período, preencha \"Vale para festas a partir de\" e \"até\". Salve.",
      "Para extras vendidos à parte (ex.: cabine de fotos), clique em \"Novo item\" na parte de Itens extras, dê nome, preço e categoria."
    ],
    "dicas": [
      "Marque \"É um prato quente adicional\" no item extra que dá direito a escolher mais um prato no portal.",
      "Na \"Ficha técnica de custo\" do pacote você lança quanto ele custa para a casa. Isso alimenta o lucro por festa.",
      "Mudar o preço do pacote não altera festas já cadastradas."
    ],
    "video": true,
    "telas": [
      "/pacotes"
    ]
  },
  {
    "id": "cardapio",
    "cat": "inicio",
    "plano": "todos",
    "onde": "Comercial → Pacotes e itens → Cardápio do portal do cliente",
    "titulo": "Cardápio do portal",
    "resumo": "As opções que a família escolhe no portal: sabor do bolo, salgados, sucos, pratos quentes.",
    "passos": [
      "Abra Comercial → Pacotes e itens e desça até \"Cardápio do portal do cliente\".",
      "Clique em \"Nova seção\" e dê um nome (ex.: Sabor do bolo, Salgados, Suco).",
      "Se quiser, escreva uma explicação para a família (ex.: \"Servidos depois do parabéns\").",
      "Defina quantas opções a família escolhe nessa seção.",
      "Adicione as opções, uma a uma, em \"Nova opção\".",
      "Em cada opção, escolha em quais pacotes ela aparece. \"Todos os pacotes\" vale também para pacotes criados depois.",
      "Se quiser, ligue \"Aceitar uma opção outro\": a família escreve o que quer e combina com a equipe.",
      "Em \"Vale para\", escolha se a seção vale para todas as unidades ou só para uma. Salve."
    ],
    "dicas": [
      "A família só consegue escolher dentro do prazo da unidade. Depois do prazo, ela ainda pode enviar, mas a equipe é avisada de que foi fora do prazo.",
      "O número de pratos quentes vem do pacote (e dos itens extras de prato quente)."
    ],
    "video": true
  },
  {
    "id": "contrato-modelo",
    "cat": "inicio",
    "plano": "todos",
    "onde": "Comercial → Contratos",
    "titulo": "Modelo de contrato da festa",
    "resumo": "O texto-base do contrato, preenchido sozinho com os dados de cada reserva.",
    "passos": [
      "Abra Comercial → Contratos.",
      "Em \"Template do contrato por unidade\", escolha a unidade e escreva (ou cole) o seu contrato.",
      "Use os campos automáticos do modelo para o nome do cliente, data, pacote, valores e convidados.",
      "Clique em \"Salvar template\"."
    ],
    "dicas": [
      "Peça para o seu advogado revisar o texto do contrato antes de usar.",
      "Cada unidade pode ter o seu próprio modelo."
    ],
    "telas": [
      "/contratos"
    ]
  },
  {
    "id": "despesa-fixa-festa",
    "cat": "inicio",
    "plano": "todos",
    "onde": "Financeiro → Despesa fixa das festas",
    "titulo": "Despesa fixa de cada festa",
    "resumo": "Custos que toda festa tem (ex.: docinhos, monitores) e entram sozinhos no custo de cada festa.",
    "passos": [
      "Abra Financeiro → Despesa fixa das festas e clique em \"Nova despesa fixa\".",
      "Escreva o que é (ex.: Docinhos) e o valor padrão.",
      "Escolha se vale para todas as unidades ou só para uma.",
      "Se o valor muda conforme o pacote, preencha o \"Valor por plano\". Salve."
    ],
    "dicas": [
      "Esses valores entram no custo de cada festa cadastrada, para o lucro por festa ficar certo.",
      "Use \"Ver por plano\" para conferir quanto cada pacote custa em despesas fixas."
    ],
    "telas": [
      "/despesas-fixas-festas"
    ]
  },
  {
    "id": "painel",
    "cat": "inicio",
    "plano": "todos",
    "onde": "Painel",
    "titulo": "O Painel principal",
    "resumo": "A primeira tela: o que precisa de atenção hoje e os números do mês.",
    "passos": [
      "O Painel abre logo depois do login.",
      "Em \"Ações rápidas\", crie uma reserva, um cliente, uma visita ou uma despesa sem precisar navegar.",
      "Veja o saldo em aberto das festas dos próximos 7 dias e os avisos do financeiro.",
      "Acompanhe o faturamento recebido, as festas confirmadas e a ocupação dos espaços no mês.",
      "Compromissos marcados como \"Avisar no Painel\" aparecem aqui até alguém clicar em \"Concluir\"."
    ],
    "dicas": [
      "A meta de faturamento do mês aparece no Painel depois que você define a meta em Relatórios e metas.",
      "Cada pessoa vê no Painel só o que o perfil dela permite."
    ],
    "telas": [
      "/"
    ]
  },
  {
    "id": "mapa-reservas",
    "cat": "festas",
    "plano": "todos",
    "onde": "Reservas → Mapa de reservas",
    "titulo": "Mapa de reservas",
    "resumo": "Todas as festas por unidade e data, em calendário, lista ou na agenda de hoje.",
    "passos": [
      "Abra Reservas → Mapa de reservas.",
      "Use \"Calendário\" para ver o mês (as setas trocam de mês), \"Lista\" para ver em tabela e \"Agenda de hoje\" para as festas do dia.",
      "No topo do menu, escolha a unidade (ou todas) para filtrar.",
      "Clique numa festa para ver o resumo e em \"Abrir Central da festa\" para ver tudo dela.",
      "Data cheia? Coloque o cliente na \"Lista de espera\". Se a data liberar, o sistema mostra \"Vaga disponível!\" e o botão \"Avisar cliente\"."
    ],
    "dicas": [
      "As cores das festas seguem a cor de cada unidade."
    ],
    "video": true,
    "telas": [
      "/reservas"
    ]
  },
  {
    "id": "nova-reserva",
    "cat": "festas",
    "plano": "todos",
    "onde": "Reservas → Mapa de reservas → Nova reserva",
    "titulo": "Cadastrar uma nova reserva",
    "resumo": "Do orçamento à festa confirmada, com pacote, aniversariante, desconto e cortesias.",
    "passos": [
      "Clique em \"Nova reserva\" (no Mapa de reservas ou nas Ações rápidas do Painel).",
      "Escolha o cliente. Se ele ainda não existe, clique em \"Cadastrar novo cliente\".",
      "Informe a data do evento, o horário de início e a unidade.",
      "Escolha o pacote (o preço vem sozinho, conforme o dia da semana).",
      "Em \"Festa cadastrada por\", deixe quem fechou a festa (vale para a comissão).",
      "Preencha o tipo de evento, o aniversariante e a idade que vai fazer. Dá para adicionar outro aniversariante.",
      "Se já souber, preencha o tema, os sabores do prato quente (separados por \"/\") e o sabor do bolo.",
      "Se houver desconto, escolha percentual ou valor fixo e informe o valor.",
      "Em \"Convidados de cortesia\", coloque convidados a mais que não são cobrados (ex.: promoção).",
      "Salve. A festa aparece no mapa e ganha a Central da festa e o portal da família."
    ],
    "dicas": [
      "A situação vira \"Quitada\" sozinha quando o total for pago.",
      "Preencher o aniversariante com a data ativa o aviso de reativação perto do próximo aniversário (plano Master)."
    ],
    "video": true
  },
  {
    "id": "central-festa",
    "cat": "festas",
    "plano": "todos",
    "onde": "Reservas → (festa) → Abrir Central da festa",
    "titulo": "Central da festa: visão geral",
    "resumo": "Tudo de uma festa numa tela: valores, pendências, cliente, pacote, portal e histórico.",
    "passos": [
      "Abra a festa pelo Mapa de reservas e clique em \"Abrir Central da festa\".",
      "No topo, veja o valor total (contrato + consumo), o que já foi pago e o saldo devedor.",
      "Em \"Pendências\", veja o que falta (ex.: saldo em aberto perto da festa, tarefas do checklist atrasadas).",
      "Na aba \"Visão geral\", confira cliente, tipo de evento, tema, sabores, convidados, unidade e pacote. Use \"Trocar\" para mudar o pacote.",
      "Em \"Cardápio\", \"Lista de convidados\" e \"Música\", veja o que a família escolheu no portal.",
      "Use \"Abrir como o cliente vê\" para ver o portal exatamente como a família vê.",
      "Em \"O que o cliente fez no portal\", veja o histórico de tudo que a família mexeu.",
      "Em \"Contato com o cliente (WhatsApp)\", envie mensagens prontas: confirmar festa, lembrete, localização, lembrete de pagamento."
    ],
    "dicas": [
      "Toda alteração fica registrada com quem mudou e quando.",
      "As abas Financeiro, Checklist, Equipe e Consumo pós-festa têm artigos próprios aqui no Guia."
    ],
    "video": true,
    "telas": [
      "/reservas/"
    ]
  },
  {
    "id": "festa-financeiro",
    "cat": "festas",
    "plano": "todos",
    "onde": "Central da festa → aba Financeiro",
    "titulo": "Pagamentos, extras e custos da festa",
    "resumo": "Registrar pagamentos, vender itens extras e lançar os custos de uma festa.",
    "passos": [
      "Na Central da festa, abra a aba \"Financeiro\".",
      "Para registrar um pagamento, informe valor, data e forma, e clique em \"Registrar pagamento\".",
      "Se a casa trabalha com parcelas, o cronograma mostra cada parcela, o vencimento e o que está em aberto.",
      "Em \"Itens extras\", escolha um item do catálogo e clique em \"Adicionar\". O valor entra no total da festa.",
      "Em \"Consumo\", lance o que a família consumiu além do contrato.",
      "Em \"Custos\", lance só gastos específicos desta festa. As sugestões da ficha técnica do pacote ajudam a preencher.",
      "Em \"Nota fiscal\", marque se foi emitida e o número da nota."
    ],
    "dicas": [
      "Se aparecer \"Já existe uma despesa parecida este mês\", confira se não é a mesma compra lançada duas vezes.",
      "Comprovantes enviados pelo portal aparecem aqui, em \"Comprovantes enviados pelo portal\" (veja o artigo \"Conferir um comprovante\")."
    ],
    "video": true
  },
  {
    "id": "checklist",
    "cat": "festas",
    "plano": "todos",
    "onde": "Central da festa → aba Checklist",
    "titulo": "Checklist da festa",
    "resumo": "As tarefas antes da festa, com prazo, para nada ficar esquecido.",
    "passos": [
      "Na Central da festa, abra a aba \"Checklist\".",
      "Marque cada tarefa quando estiver feita. A barra de progresso mostra quanto falta.",
      "Tarefas com prazo vencido aparecem como \"Atrasada\" e viram pendência no topo da festa.",
      "Use \"Confirmar com fornecedores\" para avisar os parceiros da festa."
    ],
    "dicas": [
      "O número entre parênteses no nome da aba mostra quantas tarefas já foram feitas."
    ]
  },
  {
    "id": "equipe-festa",
    "cat": "festas",
    "plano": "todos",
    "onde": "Central da festa → aba Equipe",
    "titulo": "Equipe da festa e pagamento por hora",
    "resumo": "Quem trabalha em cada festa, quanto ganha e o lançamento do pagamento.",
    "passos": [
      "Na Central da festa, abra a aba \"Equipe\".",
      "Escale as pessoas da festa, com o nome e a função.",
      "No cadastro de cada pessoa, informe o valor por hora (R$/h). Dá para editar direto na lista.",
      "Ao lançar o pagamento, o sistema sugere o valor: valor por hora × horas da festa.",
      "Clique em \"Lançar pagamento\" para registrar. Ele entra no custo da festa."
    ],
    "dicas": [
      "Use \"Exportar escala\" para mandar a equipe da festa para o grupo de WhatsApp."
    ]
  },
  {
    "id": "consumo-pos-festa",
    "cat": "festas",
    "plano": "pro",
    "onde": "Central da festa → aba Consumo pós-festa",
    "titulo": "Consumo pós-festa e baixa do estoque",
    "resumo": "Depois da festa, lance o que foi usado: o estoque baixa sozinho e o custo entra na festa.",
    "passos": [
      "Na Central da festa, abra a aba \"Consumo pós-festa\".",
      "Veja os insumos sugeridos (pelo número de convidados e pela ficha técnica).",
      "Ajuste as quantidades do que realmente foi usado.",
      "Salve. O estoque baixa sozinho e o custo vai para o lucro da festa."
    ],
    "dicas": [
      "Lançar o consumo de todas as festas deixa a média de \"Consumo por convidado\" cada vez mais certa."
    ],
    "modulo": "estoque"
  },
  {
    "id": "documentos-festa",
    "cat": "festas",
    "plano": "todos",
    "onde": "Central da festa → Documentos",
    "titulo": "Contrato e documentos da festa",
    "resumo": "Gerar o contrato em PDF e guardar arquivos da festa.",
    "passos": [
      "Em Comercial → Contratos, na lista \"Contratos por reserva\", encontre a festa.",
      "Clique em Editar contrato para conferir o texto já preenchido e em \"Salvar e baixar PDF\".",
      "Na Central da festa, em Documentos, anexe arquivos (contrato assinado, comprovantes, fotos).",
      "Clique no nome do arquivo para abrir ou baixar."
    ],
    "dicas": [
      "Os arquivos ficam guardados de forma privada: só a equipe com acesso vê.",
      "Comprovantes aprovados pelo portal entram sozinhos nos documentos da festa."
    ]
  },
  {
    "id": "cancelar-festa",
    "cat": "festas",
    "plano": "todos",
    "onde": "Central da festa → Cancelar festa / Excluir festa",
    "titulo": "Cancelar ou excluir uma festa",
    "resumo": "A diferença entre cancelar (fica no histórico) e excluir (apaga de vez).",
    "passos": [
      "Na Central da festa, clique em \"Cancelar festa\" quando o cliente desistiu. Informe o motivo.",
      "A festa fica marcada como cancelada, sai do mapa e continua no histórico e nos relatórios.",
      "Se houver devolução de dinheiro, lance o estorno no Financeiro (o sistema avisa se faltar).",
      "Use \"Excluir festa\" só para festas cadastradas por engano. A exclusão apaga a festa de vez."
    ],
    "dicas": [
      "Os motivos de cancelamento aparecem no Marketing, para você entender por que as festas caem."
    ]
  },
  {
    "id": "lembretes",
    "cat": "festas",
    "plano": "todos",
    "onde": "Lembretes diários",
    "titulo": "Lembretes diários",
    "resumo": "Quem precisa de contato hoje, com a mensagem pronta para o WhatsApp.",
    "passos": [
      "Abra \"Lembretes diários\" no menu.",
      "Em \"Pagamento pendente perto da festa\", veja as festas dos próximos 7 dias com saldo em aberto.",
      "Em \"Festa é amanhã\", confirme os detalhes com as famílias.",
      "Clique em \"Enviar\": o WhatsApp abre com a mensagem pronta. Depois de enviar, o lembrete fica marcado como \"Enviado hoje\"."
    ],
    "dicas": [
      "O pedido de avaliação da festa de ontem também aparece aqui no plano Master.",
      "As mensagens prontas podem ser editadas (\"Editar mensagem padrão\" na Central da festa)."
    ],
    "telas": [
      "/lembretes"
    ]
  },
  {
    "id": "agenda",
    "cat": "festas",
    "plano": "todos",
    "onde": "Reservas → Agenda",
    "titulo": "Agenda de visitas e compromissos",
    "resumo": "Visitas de clientes ao espaço e compromissos da equipe (as festas ficam no Mapa).",
    "passos": [
      "Abra Reservas → Agenda e clique em \"Novo compromisso\".",
      "Escreva o que é (ex.: Reunião com fornecedor), escolha a unidade e o horário (ou \"Dia inteiro\").",
      "Se repete, escolha a repetição e até quando.",
      "Marque \"Avisar no Painel\" para o compromisso aparecer para todos até alguém marcar \"Feito\".",
      "Para visitas de clientes, use \"Agendar visita\". Depois da visita, marque o resultado: virou orçamento ou não avançou (e por quê)."
    ],
    "dicas": [
      "Os motivos de visitas que não avançaram aparecem no Marketing."
    ],
    "modulo": "agenda",
    "telas": [
      "/visitas",
      "/agenda"
    ]
  },
  {
    "id": "portal-o-que-e",
    "cat": "portal",
    "plano": "todos",
    "onde": "Central da festa → Portal do cliente",
    "titulo": "O que é o portal e como enviar o link",
    "resumo": "Cada festa tem um link próprio, onde a família resolve tudo pelo celular.",
    "passos": [
      "Na Central da festa, encontre o portal do cliente.",
      "Clique em \"Enviar por WhatsApp\" para mandar o link já com uma mensagem, ou em copiar o link.",
      "A família abre o link no celular, sem baixar aplicativo e sem senha.",
      "No portal, ela vê a contagem regressiva, os preparativos com os prazos, o cardápio, a lista de convidados, a música e o pagamento.",
      "Use \"Abrir como o cliente vê\" para conferir o portal antes de mandar."
    ],
    "dicas": [
      "O link é secreto: só quem recebeu consegue abrir.",
      "O portal usa a logo, as regras e o cardápio da unidade da festa."
    ],
    "video": true
  },
  {
    "id": "portal-cardapio",
    "cat": "portal",
    "plano": "todos",
    "onde": "Portal → Cardápio",
    "titulo": "Cardápio escolhido pela família",
    "resumo": "Como a família escolhe e como a equipe acompanha.",
    "passos": [
      "No portal, a família abre \"Cardápio\" e escolhe as opções de cada seção, dentro do que o pacote permite.",
      "Ela envia o cardápio. Até o prazo, pode mudar quando quiser.",
      "Depois do prazo, ela ainda consegue enviar, mas a equipe é avisada de que foi fora do prazo.",
      "Na Central da festa, a equipe vê o cardápio confirmado (ou \"Ainda não confirmado\")."
    ],
    "dicas": [
      "O prazo do cardápio é definido nas regras do portal de cada unidade."
    ],
    "video": true
  },
  {
    "id": "portal-convidados",
    "cat": "portal",
    "plano": "todos",
    "onde": "Portal → Convidados",
    "titulo": "Lista de convidados e check-in",
    "resumo": "A família monta a lista, e ela vira o check-in da portaria no dia.",
    "passos": [
      "No portal, a família abre \"Convidados\" e adiciona os nomes, um a um ou colando vários de uma vez.",
      "O portal mostra quantos já foram adicionados e quantas vagas sobram, conforme o pacote.",
      "Ela pode mudar a lista até o prazo da unidade.",
      "No dia da festa, a portaria usa a lista para o check-in, marcando quem chegou.",
      "Quem chegou sem estar na lista pode ser sinalizado (\"chegou sem estar na lista\")."
    ],
    "dicas": [
      "A idade a partir da qual a criança conta como convidado é uma regra da unidade.",
      "Use \"Ordem alfabética\" para achar os nomes mais rápido na portaria."
    ],
    "video": true
  },
  {
    "id": "portal-musica",
    "cat": "portal",
    "plano": "todos",
    "onde": "Portal → Música da festa",
    "titulo": "Música da festa (playlist)",
    "resumo": "A família manda a playlist do Spotify ou deixa a equipe escolher.",
    "passos": [
      "A opção só aparece se a unidade permitir playlist. Para ligar ou desligar, fale com o suporte do Festou.",
      "No portal, a família cola o link da playlist do Spotify ou escolhe \"a equipe escolhe\".",
      "Na Central da festa, em \"Música\", a equipe clica em \"Abrir playlist\" ou \"Abrir no Spotify\"."
    ],
    "dicas": []
  },
  {
    "id": "portal-pix",
    "cat": "portal",
    "plano": "todos",
    "onde": "Portal → Pagamento",
    "titulo": "Pix pelo portal e o botão \"Já paguei\"",
    "resumo": "A família paga pelo QR code ou copia e cola e envia o comprovante para a equipe conferir.",
    "passos": [
      "No portal, a família abre \"Pagamento\" e escolhe o valor: a próxima parcela, o saldo total ou outro valor.",
      "O portal mostra o QR code do Pix e o código copia e cola, com o valor já preenchido e a chave da unidade.",
      "Ela paga pelo app do banco.",
      "Depois de pagar, ela toca em \"Já paguei\", confere o valor e anexa o comprovante (foto ou PDF). O comprovante é obrigatório.",
      "A equipe é avisada no sininho e confere no banco (veja \"Conferir um comprovante\").",
      "Quando a equipe confirma, o pagamento aparece no portal em \"Pagamentos registrados\" e o saldo atualiza."
    ],
    "dicas": [
      "O dinheiro cai direto na conta da casa: o Festou não passa pelo pagamento.",
      "O sistema não confirma o Pix sozinho. Sempre confira no extrato antes de aprovar."
    ],
    "video": true
  },
  {
    "id": "conferir-comprovante",
    "cat": "portal",
    "plano": "todos",
    "onde": "Sininho → Comprovantes para analisar",
    "titulo": "Conferir um comprovante",
    "resumo": "Aprovar ou recusar o comprovante que a família enviou pelo portal.",
    "passos": [
      "Quando uma família envia um comprovante, o sininho (no canto de cima) mostra um número.",
      "Clique no sininho e no comprovante: a Central da festa abre na aba Financeiro.",
      "Clique em \"Ver comprovante\" e confira no extrato do banco se o Pix realmente entrou, com o valor certo.",
      "Se entrou, clique em \"Lançar pagamento\": o pagamento é registrado e o comprovante vai para os documentos da festa.",
      "Se não entrou ou está errado, clique em \"Recusar\", escreva o motivo e confirme. A família vê o motivo no portal."
    ],
    "dicas": [
      "Foto de comprovante pode ser montada. Só aprove depois de ver o dinheiro na conta.",
      "Cada festa pode ter no máximo 5 comprovantes esperando conferência."
    ],
    "video": true
  },
  {
    "id": "portal-encerrado",
    "cat": "portal",
    "plano": "todos",
    "onde": "Central da festa",
    "titulo": "Quando o portal é encerrado",
    "resumo": "Para proteger os dados das famílias, o portal se encerra sozinho depois da festa.",
    "passos": [
      "Sete dias depois da festa, se ela estiver quitada (ou cancelada), o portal é encerrado sozinho.",
      "O link deixa de funcionar e a família vê \"Link não encontrado ou encerrado\".",
      "Os nomes da lista de convidados e as mensagens do portal são apagados. Ficam guardados só os números (quantos estavam na lista e quantos chegaram).",
      "Os demais dados da festa (pagamentos, cardápio, documentos) continuam no sistema."
    ],
    "dicas": [
      "Isso segue a LGPD: não guardar dados pessoais sem necessidade."
    ]
  },
  {
    "id": "clientes",
    "cat": "clientes",
    "plano": "todos",
    "onde": "Clientes → Clientes",
    "titulo": "Cadastro de clientes, pontos e indicação",
    "resumo": "O cadastro de cada família, com histórico de festas, pagamentos, fidelidade e indicação.",
    "passos": [
      "Abra Clientes → Clientes e clique em \"Novo cliente\".",
      "Preencha nome, telefone e, se quiser, os dados do aniversariante e de onde o cliente veio.",
      "Se o cliente veio por indicação, escolha quem indicou.",
      "Na ficha do cliente, veja os pagamentos, as festas e os pontos de fidelidade.",
      "Use \"Aplicar desconto\" para usar os pontos de fidelidade numa festa."
    ],
    "dicas": [
      "De onde o cliente veio alimenta o funil e o Marketing (canais que mais trazem festas).",
      "O telefone com DDD é o usado no WhatsApp das mensagens prontas."
    ],
    "telas": [
      "/clientes"
    ]
  },
  {
    "id": "propostas",
    "cat": "clientes",
    "plano": "pro",
    "onde": "Comercial → Propostas comerciais",
    "titulo": "Propostas comerciais em PDF",
    "resumo": "Monte uma proposta com pacote e extras e envie o PDF para o cliente.",
    "passos": [
      "Abra Comercial → Propostas comerciais e clique em \"Nova proposta\".",
      "Escolha o cliente, a data do evento (opcional), a unidade e o pacote.",
      "Marque os itens extras.",
      "Clique em \"Gerar proposta em PDF\" e envie ao cliente.",
      "Acompanhe a situação: Enviada, Aceita ou Recusada. Ao recusar, escreva o motivo."
    ],
    "dicas": [
      "Os motivos das propostas recusadas aparecem no Marketing.",
      "É preciso ter pelo menos um pacote cadastrado."
    ],
    "modulo": "propostas",
    "telas": [
      "/propostas"
    ]
  },
  {
    "id": "comissoes",
    "cat": "clientes",
    "plano": "pro",
    "onde": "Financeiro → Comissões",
    "titulo": "Comissões da equipe de vendas",
    "resumo": "Um valor por festa cadastrada, com repasse semanal.",
    "passos": [
      "Abra Financeiro → Comissões e vá em \"Configuração\".",
      "Informe o nome de quem recebe, desde quando contar as festas e de quem são as festas (ou qualquer pessoa).",
      "Defina o valor por festa. Para mudar depois, use \"Mudar o valor da comissão\" com a data a partir de quando vale.",
      "Toda segunda, o \"Próximo repasse\" soma as festas cadastradas até o domingo anterior.",
      "Informe a data e a forma de pagamento e lance o repasse. Ele entra como despesa no Financeiro."
    ],
    "dicas": [
      "Festas cadastradas depois do último domingo ficam na \"Semana em andamento\" e entram no repasse seguinte.",
      "Lançou errado? Use \"Desfazer\" em Repasses feitos."
    ],
    "modulo": "comissoes",
    "telas": [
      "/comissoes"
    ]
  },
  {
    "id": "reativacao",
    "cat": "clientes",
    "plano": "master",
    "onde": "Clientes → Reativação de clientes",
    "titulo": "Reativação de clientes",
    "resumo": "Chame de volta as famílias quando o próximo aniversário estiver chegando.",
    "passos": [
      "Abra Clientes → Reativação de clientes.",
      "Veja os clientes cujo aniversariante faz aniversário em breve, com a data da última festa.",
      "Clique em \"Entrar em contato\": o WhatsApp abre com uma mensagem pronta."
    ],
    "dicas": [
      "Só aparecem clientes com a data de nascimento do aniversariante cadastrada."
    ],
    "modulo": "reativacao",
    "telas": [
      "/reativacao"
    ]
  },
  {
    "id": "satisfacao",
    "cat": "clientes",
    "plano": "master",
    "onde": "Clientes → Satisfação (NPS)",
    "titulo": "Satisfação e pedido de avaliação no Google",
    "resumo": "Peça a avaliação depois da festa e acompanhe a nota (NPS).",
    "passos": [
      "No dia seguinte à festa, o sininho e os Lembretes mostram \"Pedir avaliação\".",
      "Clique e envie o pedido pelo WhatsApp: a família recebe o link do formulário e o link de avaliação do Google da unidade.",
      "As respostas aparecem em Clientes → Satisfação (NPS), separadas em promotores, neutros e detratores.",
      "Também dá para registrar à mão uma nota que o cliente deu por telefone, em \"Registrar resposta\"."
    ],
    "dicas": [
      "O link de avaliação do Google de cada unidade é cadastrado pelo suporte do Festou. Se ainda não tiver, mande o link pelo WhatsApp do suporte."
    ],
    "modulo": "satisfacao",
    "telas": [
      "/satisfacao"
    ]
  },
  {
    "id": "marketing",
    "cat": "clientes",
    "plano": "master",
    "onde": "Comercial → Marketing",
    "titulo": "Marketing, tráfego, CAC e funil",
    "resumo": "De onde vêm os clientes, quanto custa cada festa fechada e onde as vendas param.",
    "passos": [
      "Abra Comercial → Marketing e escolha o período.",
      "Veja os alertas automáticos (ex.: datas livres de sexta a domingo, aniversários chegando).",
      "Confira ocupação, antecedência de reserva, horários, sazonalidade, pacotes e temas mais pedidos.",
      "Veja de onde vêm os clientes, o ticket médio, a receita de extras e a inadimplência.",
      "Em Funil, veja quantos orçamentos viram festa, por canal de origem.",
      "Analise por que não fecharam: visitas que não avançaram, propostas recusadas e cancelamentos."
    ],
    "dicas": [
      "Quanto mais completo o cadastro (origem do cliente, motivos), melhores os números."
    ],
    "modulo": "marketing",
    "telas": [
      "/marketing",
      "/funil"
    ]
  },
  {
    "id": "financeiro-visao",
    "cat": "financeiro",
    "plano": "todos",
    "onde": "Financeiro → Financeiro",
    "titulo": "Como o Financeiro está organizado",
    "resumo": "As abas do Financeiro e o que cada plano mostra.",
    "passos": [
      "Abra Financeiro → Financeiro. Escolha a unidade no topo do menu: cada unidade é uma conta separada.",
      "Visão geral: quanto entrou, quanto saiu e quanto sobrou no mês, com avisos.",
      "Lançamentos: contas a pagar, despesas fixas, entradas e parcelas a receber.",
      "Resultado: o resultado do mês e, no Profissional e no Master, o lucro de cada festa.",
      "Planejamento e Comparativos (Master): ponto de equilíbrio, projeção do caixa e comparação entre meses e unidades."
    ],
    "dicas": [
      "Essencial responde \"quanto ganhei este mês?\"; Profissional, \"quais festas dão mais lucro?\"; Master, \"como vai ser o mês que vem?\".",
      "Nos gráficos, escolha o período e alterne entre barras e linhas. Passe o mouse na legenda para ver a explicação."
    ],
    "video": true,
    "telas": [
      "/financeiro"
    ]
  },
  {
    "id": "novo-lancamento",
    "cat": "financeiro",
    "plano": "todos",
    "onde": "Financeiro → Novo lançamento",
    "titulo": "Novo lançamento: despesa, conta ou entrada",
    "resumo": "Um botão só para lançar tudo o que entra e sai.",
    "passos": [
      "No Financeiro, clique em \"Novo lançamento\".",
      "Escolha o tipo: despesa paga, conta a pagar ou entrada.",
      "Escolha a unidade, a categoria (ou crie uma nova), o valor, a data e a forma.",
      "Se for de uma festa, escolha a festa (\"De onde veio?\").",
      "Para conta a pagar, informe o vencimento e, se quiser, o fornecedor.",
      "Se repete todo mês (aluguel, internet), marque \"Repete todo mês\": o sistema lança a conta sozinho, no dia de vencimento.",
      "Clique em Salvar, ou em \"Salvar e lançar outro\" para continuar lançando."
    ],
    "dicas": [
      "O sistema avisa se existe um lançamento parecido (até 5 dias de diferença). Confira se não é o mesmo.",
      "Compra de estoque? Use Estoque → Entrada de compra: assim o estoque e a conta saem juntos."
    ],
    "video": true
  },
  {
    "id": "entradas",
    "cat": "financeiro",
    "plano": "todos",
    "onde": "Financeiro → Lançamentos → Entradas",
    "titulo": "Entradas e lista de tudo que entrou",
    "resumo": "Entradas lançadas à mão e a lista completa, incluindo os pagamentos das festas.",
    "passos": [
      "Em Lançamentos, abra a lista de entradas para ver tudo o que entrou: pagamentos de festas e entradas manuais.",
      "Filtre pelo período e pela categoria.",
      "Para corrigir uma entrada lançada à mão, clique nela e edite valor, data, categoria ou descrição.",
      "Pagamentos de festa se corrigem na Central da festa, aba Financeiro."
    ],
    "dicas": [
      "Tipos de entrada comuns: aluguel do espaço, venda avulsa, reembolso, rendimento da conta."
    ]
  },
  {
    "id": "pagamentos",
    "cat": "financeiro",
    "plano": "todos",
    "onde": "Financeiro → Pagamentos",
    "titulo": "Pagamentos recebidos e taxas da maquininha",
    "resumo": "O que cada festa já pagou e quanto as taxas de cartão levaram.",
    "passos": [
      "Abra Financeiro → Pagamentos.",
      "No topo: recebido total, saldo em aberto, recebido no mês e taxa de maquininha do mês.",
      "Em \"Taxas da maquininha\", veja por forma de pagamento: recebido, taxa (%), valor da taxa e líquido.",
      "Em \"Pagamentos por festa\", veja valor firmado, pago e saldo. Clique em \"Abrir festa\" para ir à Central."
    ],
    "dicas": [
      "As taxas de cada forma de pagamento são configuradas uma vez e descontadas sozinhas."
    ],
    "telas": [
      "/pagamentos"
    ]
  },
  {
    "id": "resultado-mes",
    "cat": "financeiro",
    "plano": "todos",
    "onde": "Financeiro → Resultado",
    "titulo": "Resultado do mês",
    "resumo": "Se o mês deu lucro ou prejuízo, e de onde veio cada valor.",
    "passos": [
      "No Financeiro, abra a aba \"Resultado\".",
      "Escolha o mês.",
      "Veja o resultado em destaque (lucro ou prejuízo) e a explicação.",
      "Clique numa linha para abrir os lançamentos que formam aquele número."
    ],
    "dicas": [
      "Os custos das festas contam pela data da festa; as contas, pela data em que foram pagas."
    ],
    "telas": [
      "/resultado-do-mes"
    ]
  },
  {
    "id": "lucro-festa",
    "cat": "financeiro",
    "plano": "pro",
    "onde": "Financeiro → Resultado → Lucro por festa",
    "titulo": "Lucro por festa",
    "resumo": "Quanto cada festa deu, já descontados os custos e as taxas.",
    "passos": [
      "Na aba Resultado, abra \"Lucro por festa\".",
      "Veja, para cada festa, quanto entrou, quanto custou e quanto sobrou.",
      "Para tirar uma festa da conta (ex.: festa de cortesia), use \"tirar festa da conta\". Ela fica fora até você colocar de volta."
    ],
    "dicas": [
      "Quanto mais completos os custos (despesa fixa, ficha técnica, consumo pós-festa), mais certo o lucro."
    ],
    "modulo": "lucro",
    "telas": [
      "/lucro-por-festa"
    ]
  },
  {
    "id": "planejamento",
    "cat": "financeiro",
    "plano": "master",
    "onde": "Financeiro → Planejamento",
    "titulo": "Ponto de equilíbrio e projeção do caixa",
    "resumo": "Quantas festas a casa precisa fazer para não ter prejuízo e como o saldo vai ficar.",
    "passos": [
      "No Financeiro, abra a aba \"Planejamento\".",
      "Em Ponto de equilíbrio, veja quantas festas por mês pagam as despesas fixas da casa.",
      "Em Projeção do caixa, informe o saldo atual da conta (\"saldo informado\").",
      "O sistema projeta os próximos dias: parcelas a receber, contas, despesas fixas e custos das festas.",
      "Em \"Metas\", defina a meta de faturamento do mês."
    ],
    "dicas": [
      "Atualize o saldo informado de vez em quando para a projeção ficar certa."
    ],
    "modulo": "fin_avancado",
    "telas": [
      "/relatorios"
    ]
  },
  {
    "id": "comparativos",
    "cat": "financeiro",
    "plano": "master",
    "onde": "Financeiro → Comparativos",
    "titulo": "Comparativos",
    "resumo": "A casa está melhorando? Compare meses, unidades e anos.",
    "passos": [
      "No Financeiro, abra a aba \"Comparativos\".",
      "Compare uma unidade com a outra, um mês com o mesmo mês do ano anterior, ou ano contra ano."
    ],
    "dicas": [],
    "modulo": "fin_avancado"
  },
  {
    "id": "relatorio",
    "cat": "financeiro",
    "plano": "master",
    "onde": "Financeiro → Relatório (PDF ou Excel)",
    "titulo": "Relatório financeiro em PDF e Excel",
    "resumo": "Um relatório completo do período, com a sua logo, que explica cada número.",
    "passos": [
      "No Financeiro, clique em \"Relatório (PDF ou Excel)\".",
      "Escolha o período.",
      "Baixe em PDF (para ler ou mandar ao sócio) ou em Excel (para o contador)."
    ],
    "dicas": [],
    "modulo": "relatorio"
  },
  {
    "id": "estoque",
    "cat": "operacao",
    "plano": "pro",
    "onde": "Operação → Estoque",
    "titulo": "Estoque e lista de compras",
    "resumo": "Quantidade e valor de cada insumo por unidade, e o que precisa ser comprado.",
    "passos": [
      "Abra Operação → Estoque e clique em \"Cadastrar item\".",
      "Preencha nome, categoria, unidade de medida (un, kg, litro...), quantidade atual e custo unitário.",
      "Escolha o tipo de consumo: por convidado (varia com o público) ou por festa (velas, toalhas).",
      "Defina o estoque mínimo e marque \"Avisar na Lista de compras\".",
      "Para registrar uma compra, use \"Entrada de compra\": informe as quantidades e o valor pago. A conta a pagar é criada junto.",
      "A \"Lista de compras\" mostra o que está abaixo do mínimo ou vai faltar para as próximas festas. Ao marcar \"Recebido\", a Entrada de compra abre já com o item.",
      "Para perdas, use \"Diminuir estoque\" (não vira despesa). Para mandar para outra unidade, use \"Transferir item\"."
    ],
    "dicas": [
      "Itens sem custo deixam o lucro por festa incompleto: use \"Definir custo\".",
      "Toda movimentação fica no histórico do item."
    ],
    "video": true,
    "modulo": "estoque",
    "telas": [
      "/estoque"
    ]
  },
  {
    "id": "consumo-convidado",
    "cat": "operacao",
    "plano": "pro",
    "onde": "Operação → Consumo por convidado",
    "titulo": "Consumo por convidado",
    "resumo": "A média real que cada convidado consome, calculada pelas festas passadas.",
    "passos": [
      "Abra Operação → Consumo por convidado.",
      "Veja, por item: a média real, o valor configurado hoje, o mínimo e o máximo e quantas festas entraram na conta.",
      "Clique em \"Usar média real\" para atualizar o item com a média das festas."
    ],
    "dicas": [
      "Com menos de 3 festas, a amostra é pequena: use com cuidado.",
      "Esse valor alimenta a lista de compras do Estoque."
    ],
    "modulo": "estoque",
    "telas": [
      "/consumo-por-convidado"
    ]
  },
  {
    "id": "acertos",
    "cat": "operacao",
    "plano": "pro",
    "onde": "Financeiro → Acertos entre unidades",
    "titulo": "Acertos entre unidades",
    "resumo": "Quando uma unidade manda estoque para outra, o sistema registra quem deve a quem.",
    "passos": [
      "Ao transferir um item do estoque, o acerto é criado sozinho.",
      "Abra Financeiro → Acertos entre unidades para ver os pendentes.",
      "Quando a unidade pagar a outra, clique em \"Confirmar acerto\" e informe a data e a forma.",
      "Para corrigir, use \"Desfazer confirmação\" ou \"Cancelar acerto\" (com o motivo)."
    ],
    "dicas": [
      "Transferência entre CNPJs pode exigir nota fiscal: confirme com o seu contador."
    ],
    "modulo": "acertos",
    "telas": [
      "/acertos-entre-unidades"
    ]
  },
  {
    "id": "fornecedores",
    "cat": "operacao",
    "plano": "todos",
    "onde": "Operação → Fornecedores",
    "titulo": "Fornecedores",
    "resumo": "Parceiros terceirizados (buffet, DJ, fotógrafo, decoração) e a avaliação de cada um.",
    "passos": [
      "Abra Operação → Fornecedores e clique em \"Novo fornecedor\".",
      "Preencha nome, tipo de serviço, contato e o preço combinado.",
      "Depois de cada evento, registre a avaliação do fornecedor."
    ],
    "dicas": [
      "A avaliação média ajuda a decidir com quem continuar trabalhando."
    ],
    "telas": [
      "/fornecedores"
    ]
  },
  {
    "id": "escalas",
    "cat": "operacao",
    "plano": "pro",
    "onde": "Operação → Escalas",
    "titulo": "Escalas da equipe",
    "resumo": "A equipe escalada em cada festa do período, pronta para exportar.",
    "passos": [
      "Abra Operação → Escalas e escolha o período.",
      "Veja cada festa com a equipe escalada (ou \"Sem equipe escalada ainda\").",
      "Clique em \"Exportar período\" para mandar a escala para a equipe."
    ],
    "dicas": [
      "A equipe de cada festa é montada na Central da festa, aba Equipe."
    ],
    "modulo": "escalas",
    "telas": [
      "/escalas"
    ]
  },
  {
    "id": "aniversariantes",
    "cat": "operacao",
    "plano": "todos",
    "onde": "Operação → Relatório de aniversariantes",
    "titulo": "Relatório de aniversariantes",
    "resumo": "As festas do período com aniversariante, tema, cardápio e bolo, para a cozinha e fornecedores.",
    "passos": [
      "Abra Operação → Relatório de aniversariantes e escolha o período.",
      "Veja data, horário dos fornecedores, horário da festa, aniversariante, idade, convidados, tema, cardápio, pratos quentes e bolo.",
      "Clique em \"Exportar período\" para mandar para a cozinha ou para o fornecedor do bolo."
    ],
    "dicas": [],
    "telas": [
      "/relatorio-aniversariantes"
    ]
  },
  {
    "id": "usuarios",
    "cat": "conta",
    "plano": "todos",
    "onde": "Configurações → Usuários e permissões",
    "titulo": "Usuários, perfis e permissões",
    "resumo": "Quem tem acesso ao sistema e o que cada pessoa pode ver e fazer.",
    "passos": [
      "Abra Configurações → Usuários e permissões.",
      "Em \"Perfis de acesso\", clique em \"Criar perfil\" (ex.: Recepção) e marque o que esse perfil pode ver e fazer.",
      "Clique em \"Adicionar funcionário\", preencha nome e e-mail, escolha o perfil e gere uma senha provisória.",
      "Copie as credenciais e passe para a pessoa. A senha só aparece uma vez.",
      "Para dar um acesso a mais só para uma pessoa, use \"Personalizar os acessos desta pessoa\". Para voltar ao perfil, use \"Voltar a seguir o perfil\".",
      "Quando alguém sair da equipe, desative o acesso da pessoa."
    ],
    "dicas": [
      "O número de usuários depende do plano: Essencial até 5, Profissional até 10, Master ilimitados."
    ],
    "video": true,
    "telas": [
      "/usuarios"
    ]
  },
  {
    "id": "planos-unidades",
    "cat": "conta",
    "plano": "todos",
    "onde": "—",
    "titulo": "Planos, unidades e o que cada um inclui",
    "resumo": "O que muda entre Essencial, Profissional e Master.",
    "passos": [
      "Essencial (1 unidade, até 5 usuários): reservas, clientes, contratos, agenda, portal da família com Pix, cobrança em parcelas, lembretes e o financeiro do dia a dia.",
      "Profissional (1 unidade, até 10 usuários): tudo do Essencial, propostas, comissões, escalas, estoque, acertos entre unidades e lucro por festa.",
      "Master (2 unidades, usuários ilimitados): tudo do Profissional, satisfação e pedido de avaliação, reativação, marketing, planejamento, comparativos, relatório e suporte prioritário.",
      "Cada unidade a mais custa R$ 49,90 por mês, em qualquer plano.",
      "Para trocar de plano, fale com o Festou. Subir vale na hora; descer vale no mês seguinte. Os seus dados nunca são apagados na troca."
    ],
    "dicas": [
      "Uma função que não faz parte do seu plano não aparece no menu."
    ]
  },
  {
    "id": "mensalidade",
    "cat": "conta",
    "plano": "todos",
    "onde": "Aviso no topo do sistema",
    "titulo": "Mensalidade do Festou",
    "resumo": "Como pagar a mensalidade e o que acontece se atrasar.",
    "passos": [
      "A fatura chega por e-mail, 5 dias antes e no dia do vencimento, e pode ser paga por Pix, boleto ou cartão.",
      "Perto do vencimento, o administrador vê um aviso no topo do sistema, com o link da fatura.",
      "Depois de pago, o aviso some sozinho.",
      "Se a mensalidade atrasar além da tolerância, o acesso fica bloqueado até o pagamento. Os dados ficam guardados."
    ],
    "dicas": []
  },
  {
    "id": "exportar",
    "cat": "conta",
    "plano": "todos",
    "onde": "Configurações → Exportar dados",
    "titulo": "Exportar os seus dados",
    "resumo": "Baixe uma cópia de todos os dados da sua casa em planilha.",
    "passos": [
      "Abra Configurações → Exportar dados.",
      "Clique para baixar a planilha com os dados da casa.",
      "Guarde a cópia num lugar seguro."
    ],
    "dicas": [
      "Recomendamos exportar de vez em quando e guardar uma cópia sua.",
      "Só administradores podem exportar."
    ],
    "telas": [
      "/exportar-dados"
    ]
  },
  {
    "id": "avisos-festou",
    "cat": "conta",
    "plano": "todos",
    "onde": "Sininho",
    "titulo": "O sininho e os avisos do Festou",
    "resumo": "O que aparece no sininho e como limpar os avisos.",
    "passos": [
      "O sininho (no canto de cima) mostra um número quando há algo para fazer.",
      "Comprovantes para analisar: famílias que tocaram em \"Já paguei\" e anexaram o comprovante.",
      "Pedir avaliação: festas recentes que ainda não tiveram o pedido de avaliação (plano Master).",
      "Avisos do Festou: mensagens da equipe do Festou, como manutenções e funções novas. Clique em \"Entendi\" para tirar o aviso."
    ],
    "dicas": [
      "Os avisos somem sozinhos quando o comprovante é analisado ou o pedido é enviado."
    ]
  },
  {
    "id": "privacidade",
    "cat": "conta",
    "plano": "todos",
    "onde": "app.usefestou.com.br/termos",
    "titulo": "Termos de Uso, privacidade e LGPD",
    "resumo": "Como o Festou cuida dos dados da sua casa e das famílias.",
    "passos": [
      "Os Termos de Uso e a Política de Privacidade ficam em app.usefestou.com.br/termos.",
      "Os dados de cada casa ficam separados dos das outras casas.",
      "O portal de cada festa se encerra 7 dias depois da festa quitada, apagando a lista de convidados.",
      "Você pode exportar todos os dados quando quiser."
    ],
    "dicas": []
  }
]

// Artigo da tela aberta (o endereço mais específico ganha).
export function artigoDaTela(pathname: string): ArtigoGuia | undefined {
  let melhor: ArtigoGuia | undefined
  let tam = -1
  for (const a of GUIA) {
    for (const t of a.telas ?? []) {
      const bate = t === '/' ? pathname === '/' : t.endsWith('/') ? pathname.startsWith(t) && pathname.length > t.length : pathname === t || pathname.startsWith(t + '/')
      if (bate && t.length > tam) { melhor = a; tam = t.length }
    }
  }
  return melhor
}

export const NOME_PLANO: Record<PlanoGuia, string> = { todos: 'Todos os planos', pro: 'Profissional e Master', master: 'Master' }
