import { FormEvent, useState } from 'react'
import { KeyRound, X } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { Button } from '../ui/Button'
import { TERMOS_VERSAO } from '../../lib/termosUso'
import { TermosTexto, useFornecedor } from '../TermosTexto'

// Primeiro acesso com senha provisória (criada por outra pessoa): antes de
// usar o sistema, a pessoa escolhe a própria senha. Nas casas do Festou, já
// aceita os Termos de Uso aqui mesmo (caixinha obrigatória), sem uma segunda tela.
export function ChangePasswordScreen({ nome, pedirTermos = false }: { nome: string; pedirTermos?: boolean }) {
  const [senha, setSenha] = useState('')
  const [confirma, setConfirma] = useState('')
  const [aceito, setAceito] = useState(false)
  const [lendo, setLendo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const fornecedor = useFornecedor()

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    if (senha.length < 8) return setErro('A senha precisa ter pelo menos 8 caracteres.')
    if (senha !== confirma) return setErro('As duas senhas não são iguais.')
    if (pedirTermos && !aceito) return setErro('Para continuar, marque que leu e aceita os Termos de Uso.')
    setSalvando(true)
    const { error } = await supabase.auth.updateUser({ password: senha })
    if (error) {
      setSalvando(false)
      return setErro(/same|different/i.test(error.message) ? 'A nova senha precisa ser diferente da provisória.' : 'Não foi possível trocar a senha. Tente de novo.')
    }
    await supabase.rpc('password_changed')
    if (pedirTermos) await supabase.rpc('platform_terms_accept', { p_version: TERMOS_VERSAO, p_user_agent: navigator.userAgent })
    window.location.reload()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-mesh px-4 py-6">
      <form onSubmit={salvar} className="w-full max-w-sm bg-surface rounded-card p-6 space-y-4 shadow-2xl">
        {document.documentElement.dataset.brand === 'festou' && <img src="/marca/festou.png" alt="Festou" className="h-9 w-auto mx-auto mb-2" draggable={false} />}
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
        {pedirTermos && (
          <label className="flex items-start gap-2 text-xs leading-snug cursor-pointer bg-paper rounded-lg px-3 py-2.5">
            <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)} className="mt-0.5 shrink-0" />
            <span>
              Li e aceito os{' '}
              <button type="button" onClick={() => setLendo(true)} className="text-purple font-medium underline">Termos de Uso e a Política de Privacidade</button>{' '}
              do Festou, inclusive as regras de disponibilidade do sistema e de limitação de responsabilidade.
            </span>
          </label>
        )}
        <Button type="submit" className="w-full justify-center" disabled={salvando || (pedirTermos && !aceito)}>{salvando ? 'Salvando...' : 'Salvar e entrar'}</Button>
        <button type="button" onClick={() => supabase.auth.signOut()} className="w-full text-xs text-muted">Sair</button>
      </form>

      {lendo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setLendo(false)} />
          <div className="relative w-full max-w-2xl max-h-[85vh] bg-surface rounded-card shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-line">
              <p className="font-semibold text-sm">Termos de Uso e Política de Privacidade</p>
              <button type="button" onClick={() => setLendo(false)} className="text-muted hover:text-ink" aria-label="Fechar"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              {fornecedor ? <TermosTexto fornecedor={fornecedor} /> : <p className="text-sm text-muted">Carregando os Termos...</p>}
            </div>
            <div className="px-5 py-3 border-t border-line flex flex-wrap gap-2 justify-end">
              <Button type="button" variant="secondary" onClick={() => setLendo(false)}>Fechar</Button>
              <Button type="button" onClick={() => { setAceito(true); setLendo(false) }}>Li e aceito</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
