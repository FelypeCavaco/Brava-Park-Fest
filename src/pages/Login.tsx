import { FormEvent, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { Button } from '../components/ui/Button'
import logo from '../assets/logo-brava-park-fest.png'
import mascotImg from '../assets/mascote-theo.png'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { session } = useAuth()

  const from = (location.state as { from?: Location })?.from?.pathname ?? '/'
  const deactivated = (location.state as { deactivated?: boolean })?.deactivated ?? false

  // Se já estiver logado (ex: sessão salva no navegador) e cair aqui de novo, manda direto pra dentro.
  useEffect(() => {
    if (session) navigate(from, { replace: true })
  }, [session, from, navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    setLoading(false)
    if (error) {
      setError('Não foi possível entrar. Confira o email e a senha.')
      return
    }
    navigate(from, { replace: true })
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-brand-mesh px-4 overflow-hidden">
      {/* Estrelinhas decorativas flutuantes, nas cores da marca */}
      <span className="pointer-events-none absolute top-[12%] left-[10%] w-3 h-3 rounded-full bg-orange/70 blur-[1px] animate-float-slow" style={{ animationDelay: '0s' }} />
      <span className="pointer-events-none absolute top-[22%] right-[16%] w-2 h-2 rounded-full bg-green/70 blur-[1px] animate-float-slow" style={{ animationDelay: '1.4s' }} />
      <span className="pointer-events-none absolute bottom-[18%] left-[18%] w-2.5 h-2.5 rounded-full bg-purple-light/80 blur-[1px] animate-float-slow" style={{ animationDelay: '2.6s' }} />
      <span className="pointer-events-none absolute bottom-[28%] right-[12%] w-2 h-2 rounded-full bg-orange/60 blur-[1px] animate-float-slow" style={{ animationDelay: '0.8s' }} />
      <span className="pointer-events-none absolute top-[50%] left-[6%] w-1.5 h-1.5 rounded-full bg-green/60 blur-[1px] animate-float-slow" style={{ animationDelay: '3.2s' }} />

      {/* Mascote Theo, só em telas maiores — decorativo, não atrapalha o formulário no celular */}
      <img
        src={mascotImg}
        alt=""
        aria-hidden
        className="pointer-events-none select-none hidden lg:block absolute bottom-0 right-[8%] w-72 xl:w-80 drop-shadow-2xl animate-float-slow"
        style={{ animationDuration: '7s' }}
        draggable={false}
      />

      <div className="relative w-full max-w-sm animate-card-in">
        <div className="flex flex-col items-center gap-3 justify-center mb-8">
          <img
            src={logo}
            alt="Brava Park Fest"
            className="w-24 h-24 rounded-full shadow-2xl shadow-purple/50 ring-4 ring-white/10 animate-logo-drift"
            draggable={false}
          />
          <span className="font-display text-2xl text-white font-semibold tracking-tight">Brava Park Fest</span>
          <span className="text-xs text-shimmer font-medium uppercase tracking-[0.2em]">Aqui a diversão é garantida</span>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface/95 backdrop-blur-xl rounded-card p-6 space-y-4 shadow-2xl border border-white/10"
        >
          {deactivated && (
            <p className="text-sm text-danger bg-danger-light rounded-lg px-3 py-2">
              Seu acesso foi desativado. Fale com um administrador do sistema.
            </p>
          )}
          <div>
            <label className="block text-sm font-medium text-ink/80 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple transition-shadow"
              placeholder="voce@bravaparkfest.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink/80 mb-1">Senha</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple transition-shadow"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button type="submit" disabled={loading} className="w-full justify-center">
            {loading ? 'Entrando...' : 'Entrar'}
          </Button>
        </form>

        <p className="text-center text-xs text-white/40 mt-4">
          Acesso restrito à equipe. Usuários criados manualmente no painel do Supabase.
        </p>
      </div>
    </div>
  )
}
