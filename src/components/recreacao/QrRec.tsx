import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Camera, X } from 'lucide-react'
import { Button } from '../ui/Button'

// Desenha o QR de um texto (aqui: o link da página do responsável).
export function QrImg({ texto, tamanho = 168, className = '' }: { texto: string; tamanho?: number; className?: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => { let vivo = true; QRCode.toDataURL(texto, { margin: 1, width: tamanho * 2, errorCorrectionLevel: 'M' }).then((s) => vivo && setSrc(s)).catch(() => {}); return () => { vivo = false } }, [texto, tamanho])
  return src ? <img src={src} width={tamanho} height={tamanho} alt="QR code de retirada" className={className} /> : <span style={{ width: tamanho, height: tamanho }} className={`inline-block rounded-lg bg-line/50 ${className}`} />
}

// Imagem pronta para a etiqueta impressa.
export const qrParaImpressao = (texto: string) => QRCode.toDataURL(texto, { margin: 0, width: 220, errorCorrectionLevel: 'M' })

// O navegador do celular/tablet (Chrome, Edge, Android) lê QR pela câmera. Onde não lê
// (iPhone/Safari), a recepção usa o leitor de mesa ou digita o código.
export const podeLerQr = () => typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia

export function LeitorQr({ onLido, onFechar }: { onLido: (texto: string) => void; onFechar: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    let parar = false, stream: MediaStream | null = null, timer = 0
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (parar) return stream.getTracks().forEach((t) => t.stop())
        const el = video.current!; el.srcObject = stream; await el.play()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const det = new (window as any).BarcodeDetector({ formats: ['qr_code'] })
        const olhar = async () => {
          if (parar) return
          try { const r = await det.detect(el); if (r[0]?.rawValue) { onLido(r[0].rawValue); return } } catch { /* quadro sem imagem ainda */ }
          timer = window.setTimeout(olhar, 200)
        }
        olhar()
      } catch {
        setErro('Não consegui abrir a câmera. Libere a câmera para este site ou use o leitor de mesa.')
      }
    })()
    return () => { parar = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-ink/60" onClick={onFechar} />
      <div className="relative w-full max-w-sm bg-surface rounded-2xl shadow-xl p-5 animate-card-in">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Camera className="w-5 h-5 text-purple" />Ler QR da retirada</h2>
          <button type="button" onClick={onFechar} className="text-muted hover:text-ink" aria-label="Fechar leitor"><X className="w-5 h-5" /></button>
        </div>
        {erro ? <p className="text-sm text-danger">{erro}</p> : (
          <div className="relative rounded-xl overflow-hidden bg-black aspect-square">
            <video ref={video} playsInline muted className="w-full h-full object-cover" />
            <span className="absolute inset-[18%] rounded-2xl border-4 border-white/80 pointer-events-none" />
          </div>
        )}
        <p className="text-xs text-muted mt-3">Aponte para o QR que aparece no celular do responsável.</p>
        <Button variant="ghost" className="mt-2 w-full justify-center" onClick={onFechar}>Cancelar</Button>
      </div>
    </div>
  )
}
