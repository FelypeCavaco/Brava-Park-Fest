import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Camera, RefreshCw, Check, X, ImagePlus } from 'lucide-react'
import { Button } from '../ui/Button'

// Foto da criança: ao clicar, a câmera abre na hora (no computador, no tablet e no
// celular). Tira, confere, e a foto já fica anexada. Se o aparelho não tiver câmera
// liberada, cai no jeito antigo: escolher/tirar pelo seletor de arquivo.

const temCamera = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

// Lê o quadro do vídeo e devolve um JPEG já reduzido (720 px no maior lado).
function quadro(video: HTMLVideoElement): Promise<Blob> {
  const lado = 720, esc = Math.min(1, lado / Math.max(video.videoWidth, video.videoHeight))
  const c = document.createElement('canvas')
  c.width = Math.round(video.videoWidth * esc); c.height = Math.round(video.videoHeight * esc)
  c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height)
  return new Promise((ok, erro) => c.toBlob((b) => (b ? ok(b) : erro(new Error('foto'))), 'image/jpeg', 0.82))
}

function ModalCamera({ titulo, onFoto, onArquivo, onFechar }: { titulo: string; onFoto: (b: Blob) => void; onArquivo: (f: File) => void; onFechar: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [pronta, setPronta] = useState(false)
  const [tirada, setTirada] = useState<{ blob: Blob; url: string } | null>(null)

  useEffect(() => {
    let parar = false, stream: MediaStream | null = null
    ;(async () => {
      if (tirada) return
      try {
        setPronta(false)
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false })
        if (parar) return stream.getTracks().forEach((t) => t.stop())
        const el = video.current!; el.srcObject = stream; await el.play(); setPronta(true)
      } catch {
        setErro('Não consegui abrir a câmera. Libere a câmera para este site (cadeado ao lado do endereço) ou escolha uma foto do aparelho.')
      }
    })()
    return () => { parar = true; stream?.getTracks().forEach((t) => t.stop()) }
  }, [tirada])
  useEffect(() => () => { if (tirada) URL.revokeObjectURL(tirada.url) }, [tirada])

  async function tirar() {
    try { const blob = await quadro(video.current!); setTirada({ blob, url: URL.createObjectURL(blob) }) } catch { setErro('Não consegui tirar a foto. Tente de novo.') }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-ink/60" onClick={onFechar} />
      <div className="relative w-full max-w-md bg-surface rounded-2xl shadow-xl p-5 animate-card-in" role="dialog" aria-label={titulo}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Camera className="w-5 h-5 text-purple" />{titulo}</h2>
          <button type="button" onClick={onFechar} className="text-muted hover:text-ink" aria-label="Fechar câmera"><X className="w-5 h-5" /></button>
        </div>
        {erro ? (
          <div className="space-y-3">
            <p className="text-sm text-danger">{erro}</p>
            <label className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-line bg-surface text-sm font-semibold cursor-pointer hover:border-purple/40">
              <ImagePlus className="w-4 h-4" />Escolher uma foto
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onArquivo(f) }} />
            </label>
          </div>
        ) : (
          <>
            <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
              {tirada
                ? <img src={tirada.url} alt="Foto tirada" className="w-full h-full object-cover" />
                : <video ref={video} playsInline muted className="w-full h-full object-cover" />}
              {!tirada && !pronta && <span className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Abrindo a câmera...</span>}
            </div>
            <div className="flex gap-2 mt-4">
              {tirada ? (
                <>
                  <Button onClick={() => onFoto(tirada.blob)} className="flex-1 justify-center"><Check className="w-4 h-4" />Usar esta foto</Button>
                  <Button variant="secondary" onClick={() => setTirada(null)}><RefreshCw className="w-4 h-4" />Refazer</Button>
                </>
              ) : (
                <>
                  <Button onClick={tirar} disabled={!pronta} className="flex-1 justify-center"><Camera className="w-4 h-4" />Tirar foto</Button>
                  <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Envolve o "quadrinho" da foto: clicou, abriu a câmera.
export function FotoBotao({ titulo = 'Foto da criança', className, title, onFoto, children }: {
  titulo?: string; className: string; title?: string; onFoto: (arquivoOuBlob: Blob) => void; children: ReactNode
}) {
  const [aberta, setAberta] = useState(false)
  if (!temCamera()) {
    // sem câmera no navegador: seletor de arquivo (no celular abre a câmera pelo capture)
    return (
      <label className={`${className} cursor-pointer`} title={title}>
        {children}
        <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFoto(f); e.target.value = '' }} />
      </label>
    )
  }
  return (
    <>
      <button type="button" className={className} title={title} onClick={() => setAberta(true)}>{children}</button>
      {aberta && <ModalCamera titulo={titulo} onFechar={() => setAberta(false)} onFoto={(b) => { setAberta(false); onFoto(b) }} onArquivo={(f) => { setAberta(false); onFoto(f) }} />}
    </>
  )
}
