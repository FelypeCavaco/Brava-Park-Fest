import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { downloadPdf } from '../lib/pdfExport'
import { termosEstilos, termosHtml, TERMOS_VERSAO, type Fornecedor } from '../lib/termosUso'

// Quem oferece o Festou (nome, documento e contatos do painel), para os Termos.
export function useFornecedor() {
  const [f, setF] = useState<Fornecedor | null>(null)
  useEffect(() => {
    supabase.rpc('platform_terms_provider').then(({ data }) => setF((data ?? {}) as Fornecedor))
  }, [])
  return f
}

export function TermosTexto({ fornecedor, className = '' }: { fornecedor: Fornecedor; className?: string }) {
  return (
    <div
      className={`text-sm leading-relaxed text-ink/90 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-center [&_h1]:mb-1
        [&_.sub]:text-center [&_.sub]:text-xs [&_.sub]:text-muted [&_.sub]:uppercase [&_.sub]:tracking-wide [&_.sub]:mb-4
        [&_h2]:text-xs [&_h2]:font-bold [&_h2]:uppercase [&_h2]:tracking-wide [&_h2]:text-purple [&_h2]:mt-5 [&_h2]:mb-2
        [&_p]:mb-2 ${className}`}
      dangerouslySetInnerHTML={{ __html: termosHtml(fornecedor) }}
    />
  )
}

export async function baixarTermosPdf(fornecedor: Fornecedor) {
  await downloadPdf(termosHtml(fornecedor), termosEstilos, `termos-de-uso-festou-${TERMOS_VERSAO}.pdf`)
}
