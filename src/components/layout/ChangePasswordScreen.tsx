import { FormEvent, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { Button } from '../ui/Button'

// Primeiro acesso com senha provisória (criada por outra pessoa): antes de
// usar o sistema, a pessoa escolhe a própria senha.
export function ChangePasswordScreen({ nome }: { nome: string }) {
  const [senha, setSenha] = useState('')
  const [confirma, setConfirma] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    if (senha.length < 8) return setErro('A senha precisa ter pelo menos 8 caracteres.')
    if (senha !== confirma) return setErro('As duas senhas não são iguais.')
    setSalvando(true)
    const { error } = await supabase.auth.updateUser({ password: senha })
    if (error) {
      setSalvando(false)
      return setErro(/same|different/i.test(error.message) ? 'A nova senha precisa ser diferente da provisória.' : 'Não foi possível trocar a senha. Tente de novo.')
    }
    await supabase.rpc('password_changed')
    window.location.reload()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-mesh px-4">
      <form onSubmit={salvar} className="w-full max-w-sm bg-surface rounded-card p-6 space-y-4 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-full bg-purple-light text-purple flex items-center justify-center shrink-0"><KeyRound className="w-5 h-5" /></span>
          <div>
            <h1 className="text-lg font-semibold">Crie a sua senha</h1>
            <p className="text-xs text-muted">Olá{nome ? `, ${nome.split(' ')[0]}` : ''}! Você entrou com uma senha provisória. Escolha uma senha só sua para continuar.</p>
          </div>
        </div>
        {erro && <p className="text-sm text-danger bg-danger-light rounded-lg px-3 py-2">{erro}</p>}
        <div>
          <label htmlFor="nova-senha" className="block text-xs text-muted mb-1">Nova senha (mínimo 8 caracteres)</label>
          <input id="nova-senha" type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" autoFocus />
        </div>
        <div>
          <label htmlFor="confirma-senha" className="block text-xs text-muted mb-1">Repita a nova senha</label>
          <input id="confirma-senha" type="password" autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
        </div>
        <Button type="submit" className="w-full justify-center" disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar e entrar'}</Button>
        <button type="button" onClick={() => supabase.auth.signOut()} className="w-full text-xs text-muted">Sair</button>
      </form>
    </div>
  )
}
