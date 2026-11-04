import { Download } from 'lucide-react'
import { baixarTermosPdf, TermosTexto, useFornecedor } from '../components/TermosTexto'
import { Button } from '../components/ui/Button'

// Página pública /termos: os Termos de Uso e a Política de Privacidade em
// vigor, para ler antes de contratar ou a qualquer momento.
export function TermsPage() {
  const fornecedor = useFornecedor()
  return (
    <div className="min-h-screen bg-paper px-4 py-8">
      <div className="max-w-3xl mx-auto bg-surface rounded-card border border-line p-6 sm:p-10">
        <img src="/marca/festou.png" alt="Festou" className="h-9 w-auto mb-6" draggable={false} />
        {fornecedor ? <TermosTexto fornecedor={fornecedor} /> : <p className="text-sm text-muted">Carregando...</p>}
        <div className="mt-6">
          <Button variant="secondary" onClick={() => fornecedor && baixarTermosPdf(fornecedor)} disabled={!fornecedor}>
            <Download className="w-4 h-4" /> Baixar em PDF
          </Button>
        </div>
      </div>
    </div>
  )
}
