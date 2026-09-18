import { FormEvent, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { PartyPopper } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { Button } from '../components/ui/Button'

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
    <div className="min-h-screen flex items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-8">
          <PartyPopper className="w-7 h-7 text-orange" strokeWidth={1.75} />
          <span className="font-display text-xl text-white font-semibold">Brava Park Fest</span>
        </div>

        <form onSubmit={handleSubmit} className="bg-surface rounded-card p-6 space-y-4">
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
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple"
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
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple"
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
