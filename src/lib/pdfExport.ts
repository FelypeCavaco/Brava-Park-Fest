// Gera um arquivo PDF de verdade (baixa direto, sem depender da caixa de
// impressão do navegador) a partir de um HTML já pronto. Antes, todo PDF do
// sistema era gerado abrindo uma aba e chamando window.print(), pedindo pra
// pessoa escolher "Salvar como PDF" na caixa de impressão — mas isso depende
// do navegador/aparelho mostrar essa opção, e em vários casos só aparece
// "Imprimir" mesmo (por exemplo no Safari do iPhone, ou em navegadores/
// configurações que escondem essa opção). Gerando o PDF de verdade aqui,
// o download funciona igual em qualquer navegador/aparelho.
//
// Importada dinamicamente (só na hora de gerar um PDF) porque essa
// biblioteca é pesada — carregando ela de cara em toda tela do sistema,
// mesmo quem nunca gera PDF baixaria esse peso à toa.
export async function downloadPdf(
  bodyHtml: string,
  styles: string,
  filename: string,
  orientation: 'portrait' | 'landscape' = 'portrait',
) {
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-99999px'
  container.style.top = '0'
  if (orientation === 'landscape') container.style.width = '1000px'

  const styleEl = document.createElement('style')
  styleEl.textContent = styles
  container.appendChild(styleEl)

  // Os modelos de HTML de cada tela foram escritos como documentos completos
  // (pensando num seletor "body { ... }" pro estilo base) — aqui não existe
  // uma tag <body> de verdade dentro do container, então essa div assume o
  // papel de "body" via a classe abaixo (os modelos usam ".pdf-body").
  const content = document.createElement('div')
  content.className = 'pdf-body'
  content.innerHTML = bodyHtml
  container.appendChild(content)

  document.body.appendChild(container)

  // Dá um instante pro navegador terminar de carregar as imagens (logo,
  // mascote) antes de "fotografar" o conteúdo — senão elas saem em branco.
  await Promise.all(
    Array.from(content.querySelectorAll('img')).map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) return resolve()
          img.onload = () => resolve()
          img.onerror = () => resolve()
        }),
    ),
  )

  try {
    const html2pdf = (await import('html2pdf.js')).default
    // O pacote de tipos da lib está desatualizado e não conhece a opção
    // "pagebreak" (que existe de verdade em tempo de execução) — daí o `as any`.
    await html2pdf()
      .set({
        margin: 0,
        filename,
        image: { type: 'jpeg', quality: 0.95 },
        // letterRendering evita um bug conhecido do html2canvas que erra o
        // cálculo de espaço entre palavras em textos em negrito ("Classic40
        // pessoas" em vez de "Classic 40 pessoas") — desenha letra por letra
        // em vez de medir a palavra inteira de uma vez.
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', 'li', '.avoid-break'] },
      } as any)
      .from(content)
      .save()
  } finally {
    document.body.removeChild(container)
  }
}
