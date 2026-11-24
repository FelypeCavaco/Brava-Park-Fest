import { useEffect, useRef } from 'react'

// Tela de carregamento da entrada no sistema: fundo roxo com balões subindo,
// o logo do Festou com o balão no lugar do "o", a barra com as etapas e
// fogos de artifício (uma chuva de fogos ao chegar em 100%).
// Desenhada em código (canvas + CSS), sem vídeo: leve e nítida em qualquer tela.
// Um toque ou uma tecla pula a animação.

const ETAPAS: [number, string][] = [
  [0, 'Preparando seu espaço...'],
  [30, 'Carregando agenda e reservas...'],
  [64, 'Organizando os detalhes...'],
  [100, 'Tudo pronto!'],
]
const DUR_BARRA = 3500 // ms até 100%
const ESPERA_FIM = 1450 // ms mostrando "Tudo pronto!" com os fogos
const SAIDA = 450 // ms do sumiço

const CORES_BALAO = ['#7B54D0', '#6E44C4', '#8A63DA', '#5E3AAE', '#7B54D0', '#B9497E', '#B8A3E0', '#C86A3E']
const CORES_FOGO = ['#F7C873', '#F48FB1', '#C7A6FF', '#FFFFFF', '#F06292']

interface Balao { x: number; y: number; r: number; vel: number; amp: number; fase: number; cor: string; alfa: number }
interface Particula { x: number; y: number; vx: number; vy: number; vida: number; max: number; cor: string; px: number; py: number }
interface Foguete { x: number; y: number; alvoY: number; vy: number; cor: string }

// progresso com pequenas pausas, como um carregamento de verdade
function progresso(t: number) {
  const x = Math.min(1, Math.max(0, t / DUR_BARRA))
  const suave = x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
  const degrau = Math.sin(x * Math.PI * 6) * 0.025 * (1 - x)
  return Math.min(100, Math.max(0, Math.round((suave + degrau) * 100)))
}

export function TelaCarregamento({ onFim }: { onFim: () => void }) {
  const raiz = useRef<HTMLDivElement>(null)
  const tela = useRef<HTMLCanvasElement>(null)
  const barra = useRef<HTMLDivElement>(null)
  const ponta = useRef<HTMLDivElement>(null)
  const rotulo = useRef<HTMLSpanElement>(null)
  const pct = useRef<HTMLSpanElement>(null)
  const pularRef = useRef<() => void>(() => {})
  const fimRef = useRef(onFim)
  fimRef.current = onFim

  useEffect(() => {
    const calmo = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const c = tela.current!, ctx = c.getContext('2d')!
    let L = 0, A = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const medir = () => { L = window.innerWidth; A = window.innerHeight; c.width = L * dpr; c.height = A * dpr; c.style.width = L + 'px'; c.style.height = A + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0) }
    medir()
    window.addEventListener('resize', medir)

    const sorte = (a: number, b: number) => a + Math.random() * (b - a)
    const novoBalao = (embaixo: boolean): Balao => {
      const r = sorte(14, Math.min(40, L / 24 + 12))
      return { x: sorte(0, L), y: embaixo ? A + sorte(r * 2, A * 0.6) : sorte(0, A), r, vel: sorte(22, 48), amp: sorte(8, 26), fase: sorte(0, 6.28),
        cor: CORES_BALAO[Math.floor(Math.random() * CORES_BALAO.length)], alfa: sorte(0.35, 0.7) }
    }
    const baloes: Balao[] = Array.from({ length: Math.round(Math.min(18, 8 + L / 160)) }, () => novoBalao(false))
    const particulas: Particula[] = []
    const foguetes: Foguete[] = []

    // fogos: posições longe do centro (onde está o logo)
    const lancar = (x?: number, alvoY?: number) => {
      const lado = Math.random() < 0.5 ? sorte(0.08, 0.3) : sorte(0.7, 0.92)
      foguetes.push({ x: x ?? L * lado, y: A + 10, alvoY: alvoY ?? sorte(A * 0.14, A * 0.42), vy: -sorte(A * 0.9, A * 1.2), cor: CORES_FOGO[Math.floor(Math.random() * 3)] })
    }
    const estourar = (x: number, y: number, cor: string) => {
      const n = Math.round(sorte(70, 110))
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + sorte(-0.05, 0.05), v = sorte(90, 260)
        const corP = Math.random() < 0.75 ? cor : CORES_FOGO[Math.floor(Math.random() * CORES_FOGO.length)]
        const max = sorte(1.1, 1.9)
        particulas.push({ x, y, px: x, py: y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, vida: max, max, cor: corP })
      }
    }
    const programados = calmo ? [] : [550, 1150, 1750, 2450, 3050].map((t) => ({ t, feito: false }))
    let finale = false

    const desenharBalao = (b: Balao, t: number) => {
      const x = b.x + Math.sin(t / 1000 + b.fase) * b.amp
      ctx.globalAlpha = b.alfa
      // fio
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(x, b.y + b.r)
      ctx.quadraticCurveTo(x + Math.sin(t / 600 + b.fase) * 6, b.y + b.r * 1.8, x - 2, b.y + b.r * 2.6); ctx.stroke()
      // corpo
      const g = ctx.createRadialGradient(x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.1, x, b.y, b.r * 1.1)
      g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.25, b.cor); g.addColorStop(1, b.cor)
      ctx.fillStyle = g
      ctx.beginPath(); ctx.ellipse(x, b.y, b.r * 0.84, b.r, 0, 0, Math.PI * 2); ctx.fill()
      // nó
      ctx.fillStyle = b.cor
      ctx.beginPath(); ctx.moveTo(x - 3, b.y + b.r + 4); ctx.lineTo(x + 3, b.y + b.r + 4); ctx.lineTo(x, b.y + b.r - 1); ctx.fill()
      ctx.globalAlpha = 1
    }

    let inicio = performance.now(), ultimo = inicio, raf = 0, saindo = false, fimEm = 0
    const terminar = () => {
      if (saindo) return
      saindo = true
      raiz.current?.classList.add('saindo')
      window.setTimeout(() => fimRef.current(), SAIDA)
    }
    const pular = () => terminar()
    pularRef.current = pular
    window.addEventListener('keydown', pular)

    const quadro = (agora: number) => {
      const t = agora - inicio
      const dt = Math.min(0.05, (agora - ultimo) / 1000)
      ultimo = agora
      ctx.clearRect(0, 0, L, A)

      // balões
      for (const b of baloes) {
        if (!calmo) b.y -= b.vel * dt
        if (b.y < -b.r * 3) Object.assign(b, novoBalao(true))
        desenharBalao(b, t)
      }

      // barra e etapas
      const p = calmo ? Math.min(100, Math.round((t / 1200) * 100)) : progresso(t)
      if (barra.current) barra.current.style.width = p + '%'
      if (ponta.current) ponta.current.style.left = p + '%'
      if (pct.current) pct.current.textContent = p + '%'
      if (rotulo.current) {
        const et = [...ETAPAS].reverse().find(([de]) => p >= de)![1]
        if (rotulo.current.textContent !== et) rotulo.current.textContent = et
      }

      // fogos
      for (const pr of programados) if (!pr.feito && t >= pr.t) { pr.feito = true; lancar() }
      if (p >= 100 && !finale) {
        finale = true
        fimEm = t
        if (!calmo) [0, 140, 300, 480, 700, 900].forEach((d, i) => window.setTimeout(() => lancar(L * [0.28, 0.72, 0.42, 0.6, 0.18, 0.84][i], A * sorte(0.1, 0.32)), d))
      }
      ctx.globalCompositeOperation = 'lighter'
      for (let i = foguetes.length - 1; i >= 0; i--) {
        const f = foguetes[i]
        f.y += f.vy * dt
        const brilho = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 26)
        brilho.addColorStop(0, 'rgba(255,255,255,0.9)'); brilho.addColorStop(0.25, 'rgba(255,220,240,0.35)'); brilho.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = brilho; ctx.beginPath(); ctx.arc(f.x, f.y, 26, 0, Math.PI * 2); ctx.fill()
        if (f.y <= f.alvoY) { estourar(f.x, f.y, f.cor); foguetes.splice(i, 1) }
      }
      for (let i = particulas.length - 1; i >= 0; i--) {
        const q = particulas[i]
        q.px = q.x; q.py = q.y
        q.vx *= 0.985; q.vy = q.vy * 0.985 + 70 * dt
        q.x += q.vx * dt; q.y += q.vy * dt
        q.vida -= dt
        if (q.vida <= 0) { particulas.splice(i, 1); continue }
        const a = Math.max(0, q.vida / q.max)
        ctx.globalAlpha = a
        ctx.strokeStyle = q.cor; ctx.lineWidth = 1.6
        ctx.beginPath(); ctx.moveTo(q.px - q.vx * 0.05, q.py - q.vy * 0.05); ctx.lineTo(q.x, q.y); ctx.stroke()
        ctx.fillStyle = q.cor; ctx.beginPath(); ctx.arc(q.x, q.y, 1.6, 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'

      if (finale && t - fimEm >= (calmo ? 300 : ESPERA_FIM)) terminar()
      raf = requestAnimationFrame(quadro)
    }
    raf = requestAnimationFrame(quadro)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', medir); window.removeEventListener('keydown', pular) }
  }, [])

  return (
    <div ref={raiz} className="tela-carregamento" role="status" aria-live="polite" onPointerDown={() => pularRef.current()}>
      <style>{CSS}</style>
      <canvas ref={tela} className="tc-tela" aria-hidden="true" />
      <div className="tc-centro">
        <div className="tc-logo" aria-label="Festou">
          <span>Fest</span>
          <svg className="tc-balao" viewBox="0 0 100 140" aria-hidden="true">
            <defs>
              <radialGradient id="tcBalao" cx="35%" cy="30%" r="75%">
                <stop offset="0%" stopColor="#D9C2FF" />
                <stop offset="35%" stopColor="#A57CF0" />
                <stop offset="100%" stopColor="#7340D6" />
              </radialGradient>
            </defs>
            <path d="M50 104 C50 116 58 120 54 132" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="3" strokeLinecap="round" />
            <path d="M44 101 L56 101 L50 93 Z" fill="#7340D6" />
            <ellipse cx="50" cy="52" rx="42" ry="48" fill="url(#tcBalao)" />
            <path d="M31 53 L45 66 L70 39" fill="none" stroke="#FFFFFF" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>u</span>
        </div>
        <div className="tc-barra-area">
          <div className="tc-trilho">
            <div ref={barra} className="tc-barra" />
            <div ref={ponta} className="tc-ponta" />
          </div>
          <div className="tc-texto"><span ref={rotulo}>Preparando seu espaço...</span><span ref={pct}>0%</span></div>
        </div>
      </div>
    </div>
  )
}

const CSS = `
.tela-carregamento { position: fixed; inset: 0; z-index: 200; overflow: hidden; cursor: default;
  background: radial-gradient(ellipse at 50% 42%, #5B2EA6 0%, #3E1D80 42%, #22104A 100%);
  font-family: 'Nunito', system-ui, sans-serif; color: #fff; transition: opacity ${SAIDA}ms ease; }
.tela-carregamento.saindo { opacity: 0; pointer-events: none; }
.tc-tela { position: absolute; inset: 0; }
.tc-centro { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: clamp(28px, 5vh, 56px); padding: 0 24px; }
.tc-logo { display: flex; align-items: flex-end; font-weight: 900; line-height: 1; letter-spacing: -0.01em;
  font-size: clamp(64px, 12vw, 150px); color: #F7F1FF; text-shadow: 0 0 40px rgba(199,166,255,.45), 0 6px 30px rgba(20,6,50,.5);
  animation: tcLogo 900ms cubic-bezier(.2,.8,.2,1) both; }
.tc-balao { width: .7em; height: .98em; margin: 0 .02em -.2em; filter: drop-shadow(0 0 18px rgba(199,166,255,.55)); animation: tcBalanca 2.6s ease-in-out infinite; transform-origin: 50% 90%; }
.tc-barra-area { width: min(560px, 82vw); animation: tcSobe 700ms 350ms cubic-bezier(.2,.8,.2,1) both; }
.tc-trilho { position: relative; height: 10px; border-radius: 99px; background: rgba(255,255,255,.12); }
.tc-barra { position: absolute; left: 0; top: 0; bottom: 0; width: 0; border-radius: 99px;
  background: linear-gradient(90deg, #F06292 0%, #F3A0C8 30%, #B57BF0 70%, #C9B8FF 100%); box-shadow: 0 0 16px rgba(240,98,146,.35); }
.tc-ponta { position: absolute; top: 50%; left: 0; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; background: #fff;
  box-shadow: 0 0 14px 6px rgba(255,255,255,.55), 0 0 40px 14px rgba(199,166,255,.45); }
.tc-texto { display: flex; justify-content: space-between; margin-top: 18px; font-size: clamp(15px, 2.2vw, 22px); color: #E4D9F6; font-weight: 600; }
@keyframes tcLogo { from { opacity: 0; transform: scale(.88); filter: blur(6px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes tcSobe { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes tcBalanca { 0%, 100% { transform: translateY(0) rotate(-3deg); } 50% { transform: translateY(-6%) rotate(3deg); } }
@media (prefers-reduced-motion: reduce) { .tc-logo, .tc-barra-area, .tc-balao { animation: none; } }
`
