import { useEffect, useMemo, useRef, useState } from 'react'
import mascotImg from '../../assets/mascote-theo.png'

const REACTIONS = [
  'Bora fechar mais uma festa hoje? 🎉',
  'Seus números tão bonitos hoje!',
  'Vila Operária ou São Vicente, hoje o dia é nosso!',
  'Clica em mim de novo, eu gosto!',
  'Confere ali o saldo em aberto, hein 👀',
  'Toca o som que a festa é garantida!',
]

export function DashboardMascot() {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [entered, setEntered] = useState(false)
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const [reacting, setReacting] = useState(false)
  const [bubble, setBubble] = useState<string | null>(null)
  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 150)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (reduceMotion) return
    function handleMove(e: MouseEvent) {
      const el = wrapperRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const dx = (e.clientX - cx) / (window.innerWidth / 2)
      const dy = (e.clientY - cy) / (window.innerHeight / 2)
      setTilt({ x: Math.max(-1, Math.min(1, dx)), y: Math.max(-1, Math.min(1, dy)) })
    }
    window.addEventListener('mousemove', handleMove)
    return () => window.removeEventListener('mousemove', handleMove)
  }, [reduceMotion])

  function handleClick() {
    if (reacting) return
    setReacting(true)
    setBubble(REACTIONS[Math.floor(Math.random() * REACTIONS.length)])
    setTimeout(() => setReacting(false), 900)
    setTimeout(() => setBubble(null), 2600)
  }

  const tiltStyle = reduceMotion
    ? {}
    : {
        transform: `perspective(700px) rotateY(${tilt.x * 14}deg) rotateX(${tilt.y * -14}deg)`,
      }

  return (
    <div
      className={`fixed bottom-4 right-4 md:bottom-6 md:right-8 z-40 pointer-events-none transition-all duration-700 ease-out ${
        entered ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-24 scale-75'
      }`}
      style={{ transitionTimingFunction: entered ? 'cubic-bezier(0.34, 1.56, 0.64, 1)' : undefined }}
    >
      <div className="relative w-24 sm:w-32 md:w-44">
        {/* glow blob */}
        <div className="absolute inset-0 -z-10 rounded-full blur-2xl opacity-60 bg-purple animate-mascot-glow" />

        {/* floating particles in brand colors */}
        <span className="absolute -top-2 left-1 w-2 h-2 rounded-full bg-teal animate-mascot-particle pointer-events-none" style={{ animationDelay: '0s' }} />
        <span className="absolute top-4 -right-3 w-1.5 h-1.5 rounded-full bg-purple animate-mascot-particle pointer-events-none" style={{ animationDelay: '0.9s' }} />
        <span className="absolute bottom-8 -left-3 w-2 h-2 rounded-full bg-pink-400 animate-mascot-particle pointer-events-none" style={{ animationDelay: '1.6s' }} />
        <span className="absolute top-1/2 -right-2 w-1.5 h-1.5 rounded-full bg-amber animate-mascot-particle pointer-events-none" style={{ animationDelay: '0.4s' }} />

        {bubble && (
          <div className="absolute -top-14 right-0 max-w-[180px] bg-surface border border-line rounded-xl rounded-br-none px-3 py-2 shadow-lg text-xs text-ink font-medium pointer-events-none animate-mascot-bubble">
            {bubble}
          </div>
        )}

        <div className={`${reduceMotion ? '' : 'animate-mascot-float'}`}>
          <div ref={wrapperRef} className="transition-transform duration-150 ease-out will-change-transform" style={tiltStyle}>
            <button
              type="button"
              onClick={handleClick}
              aria-label="Mascote Theo — clique para uma surpresa"
              className={`pointer-events-auto block cursor-pointer drop-shadow-xl focus:outline-none ${
                reacting ? 'animate-mascot-reaction' : ''
              }`}
            >
              <img src={mascotImg} alt="Theo, o mascote da Brava Park Fest" className="w-full h-auto select-none" draggable={false} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
