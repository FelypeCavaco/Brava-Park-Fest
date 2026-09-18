import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from './ui/Button'
import { supabase } from '../lib/supabaseClient'
import { getOrCreateReviewToken, reviewFormUrl } from '../lib/reviewLinks'
import { GOOGLE_REVIEW_LINK } from '../lib/whatsapp'

interface SendReviewModalProps {
  reservationId: string
  clienteNome: string
  phone: string | null
  unitName: string
  googleReviewLink: string | null
  onClose: () => void
  onSent: () => void
}

// Modal explícito (não copia e abre sozinho) pelo mesmo motivo do fluxo de
// fornecedores: clipboard automático falha silenciosamente em alguns
// navegadores — aqui a pessoa vê a mensagem final e escolhe copiar/abrir.
export function SendReviewModal({ reservationId, clienteNome, phone, unitName, googleReviewLink, onClose, onSent }: SendReviewModalProps) {
  const [includeLink, setIncludeLink] = useState(true)
  const [includeForm, setIncludeForm] = useState(true)
  const [formUrl, setFormUrl] = useState<string | null>(null)
  const [loadingToken, setLoadingToken] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    getOrCreateReviewToken(reservationId, clienteNome, unitName).then((token) => {
      if (!active) return
      setFormUrl(token ? reviewFormUrl(token) : null)
      setLoadingToken(false)
    })
    return () => {
      active = false
    }
  }, [reservationId, clienteNome, unitName])

  const message = useMemo(() => {
    let msg = `Olá, ${clienteNome}! Esperamos que a festa tenha sido incrível! 🎉`
    if (includeForm && formUrl) {
      msg += `\n\nPode nos contar como foi, respondendo esse formulariozinho rápido? ${formUrl}`
    }
    if (includeLink) {
      msg += `\n\nSe puder, deixe também uma avaliação no Google, é rapidinho: ${googleReviewLink || GOOGLE_REVIEW_LINK}`
    }
    return msg
  }, [clienteNome, includeForm, includeLink, formUrl, googleReviewLink])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    } catch {
      // sem permissão de clipboard — a pessoa ainda pode selecionar e copiar manualmente
    }
  }

  function handleOpenWhatsApp() {
    const digits = (phone ?? '').replace(/\D/g, '')
    const withCountry = digits.length > 0 ? (digits.startsWith('55') ? digits : `55${digits}`) : ''
    const url = withCountry
      ? `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`
    window.open(url, '_blank')
    supabase.from('contact_history').insert({ client_name: clienteNome, type: 'Pedido de avaliação', channel: 'whatsapp', user_name: 'Você' })
    onSent()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-display font-semibold">Pedir avaliação</h2>
          <button onClick={onClose} className="text-muted hover:text-ink">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2 mb-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeLink} onChange={(e) => setIncludeLink(e.target.checked)} />
            Link de avaliação do Google
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeForm}
              onChange={(e) => setIncludeForm(e.target.checked)}
              disabled={loadingToken || !formUrl}
            />
            Formulário de avaliação (pratos, bolo, atendimento...)
            {loadingToken && <span className="text-xs text-muted">gerando link...</span>}
          </label>
        </div>

        <label className="block text-xs text-muted mb-1">Mensagem que será enviada</label>
        <textarea
          readOnly
          value={message}
          rows={7}
          onFocus={(e) => e.target.select()}
          className="w-full border border-line rounded-lg px-3 py-2 text-sm mb-2 bg-paper"
        />
        {copied && <p className="text-xs text-teal mb-2">Mensagem copiada!</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1 justify-center" onClick={handleCopy}>
            Copiar mensagem
          </Button>
          <Button className="flex-1 justify-center" onClick={handleOpenWhatsApp}>
            Abrir WhatsApp
          </Button>
        </div>
      </div>
    </div>
  )
}
