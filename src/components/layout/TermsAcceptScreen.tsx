import { useState } from 'react'
import { Download, FileCheck } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { TERMOS_DATA, TERMOS_VERSAO } from '../../lib/termosUso'
import { baixarTermosPdf, TermosTexto, useFornecedor } from '../TermosTexto'
import { Button } from '../ui/Button'

// Antes de usar o sistema, cada pessoa das casas clientes aceita a versão
// atual dos Termos de Uso e da Política de Privacidade (fica registrado).
export function TermsAcceptScreen({ nome, novaVersao, onAceito }: { nome: string; novaVersao: boolean; onAceito: () => void }) {
  const fornecedor = useFornecedor()
  const [li, setLi] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function aceitar() {
    setErro(null)
    setSalvando(true)
    const { error } = await supabase.rpc('platform_terms_accept', { p_version: TERMOS_VERSAO, p_user_agent: navigator.userAgent })
    setSalvando(false)
    if (error) return setErro('Não foi possível registrar o aceite. Tente de novo.')
    onAceito()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-mesh px-4 py-8">
      <div className="w-full max-w-2xl bg-surface rounded-card shadow-2xl flex flex-col max-h-[92vh]">
        <div className="p-6 pb-4 border-b border-line">
          {document.documentElement.dataset.brand === 'festou' && <img src="/marca/festou.png" alt="Festou" className="h-8 w-auto mb-3" draggable={false} />}
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-full bg-purple-light text-purple flex items-center justify-center shrink-0"><FileCheck className="w-5 h-5" /></span>
            <div>
              <h1 className="text-lg font-semibold">{novaVersao ? 'Os Termos de Uso foram atualizados' : 'Termos de Uso e Política de Privacidade'}</h1>
              <p className="text-xs text-muted">
                Olá{nome ? `, ${nome.split(' ')[0]}` : ''}! Para usar o Festou, leia e aceite os Termos (versão de {TERMOS_DATA}).
                Eles explicam as regras de uso e como cuidamos dos dados.
              </p>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 overflow-y-auto flex-1 bg-paper/40">
          {fornecedor ? <TermosTexto fornecedor={fornecedor} /> : <p className="text-sm text-muted">Carregando os Termos...</p>}
        </div>
        <div className="p-6 pt-4 border-t border-line space-y-3">
          {erro && <p className="text-sm text-danger bg-danger-light rounded-lg px-3 py-2">{erro}</p>}
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="mt-1" checked={li} onChange={(e) => setLi(e.target.checked)} />
            <span>Li e aceito os <b>Termos de Uso</b> e a <b>Política de Privacidade</b> do Festou.</span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={aceitar} disabled={!li || salvando || !fornecedor}>{salvando ? 'Registrando...' : 'Aceitar e entrar'}</Button>
            <Button variant="ghost" onClick={() => fornecedor && baixarTermosPdf(fornecedor)} disabled={!fornecedor}>
              <Download className="w-4 h-4" /> Baixar em PDF
            </Button>
            <button type="button" onClick={() => supabase.auth.signOut()} className="ml-auto text-xs text-muted">Sair</button>
          </div>
        </div>
      </div>
    </div>
  )
}
