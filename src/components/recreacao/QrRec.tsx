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

// Qualquer aparelho com câmera lê o QR: onde o navegador já sabe (Chrome, Edge, Android) usa o
// leitor dele; nos demais (computador, iPhone/Safari) usa o leitor jsQR, carregado só na hora.
export const podeLerQr = () => typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

export function LeitorQr({ onLido, onFechar }: { onLido: (texto: string) => void; onFechar: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    let parar = false, stream: MediaStream | null = null, timer = 0
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) { setErro('Este navegador não deixa usar a câmera aqui. Abra o sistema pelo Chrome ou pelo Safari (não por dentro de outro aplicativo) ou use o leitor de mesa.'); return }
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (parar) return stream.getTracks().forEach((t) => t.stop())
        const el = video.current!; el.srcObject = stream; await el.play()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nativo = 'BarcodeDetector' in window ? new (window as any).BarcodeDetector({ formats: ['qr_code'] }) : null
        const jsqr = nativo ? null : (await import('jsqr')).default
        const tela = document.createElement('canvas'); const ctx = tela.getContext('2d', { willReadFrequently: true })!
        const olhar = async () => {
          if (parar) return
          try {
            if (nativo) { const r = await nativo.detect(el); if (r[0]?.rawValue) { onLido(r[0].rawValue); return } }
            else if (jsqr && el.videoWidth) {
              const esc = Math.min(1, 640 / el.videoWidth); tela.width = Math.round(el.videoWidth * esc); tela.height = Math.round(el.videoHeight * esc)
              ctx.drawImage(el, 0, 0, tela.width, tela.height)
              const r = jsqr(ctx.getImageData(0, 0, tela.width, tela.height).data, tela.width, tela.height, { inversionAttempts: 'dontInvert' })
              if (r?.data) { onLido(r.data); return }
            }
          } catch { /* quadro sem imagem ainda */ }
          timer = window.setTimeout(olhar, nativo ? 200 : 250)
        }
        olhar()
      } catch (e) {
        setErro(mensagemCamera(e))
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


// Texto claro para cada motivo de a câmera não abrir.
export function mensagemCamera(e: unknown): string {
  const nome = (e as { name?: string })?.name
  if (nome === 'NotAllowedError' || nome === 'SecurityError') return 'A câmera está bloqueada para este site. Toque no cadeado ao lado do endereço, libere a câmera e atualize a página (se acabou de liberar, feche e abra o leitor de novo).'
  if (nome === 'NotFoundError' || nome === 'OverconstrainedError') return 'Não encontrei nenhuma câmera neste aparelho.'
  if (nome === 'NotReadableError' || nome === 'AbortError') return 'A câmera está sendo usada por outro programa ou aba. Feche o outro e tente de novo.'
  return 'Não consegui abrir a câmera. Libere a câmera para este site (cadeado ao lado do endereço) ou use o leitor de mesa.'
}
