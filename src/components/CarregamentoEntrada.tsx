import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { TelaCarregamento } from './TelaCarregamento'

// Mostra a tela de carregamento uma vez, logo depois que a pessoa entra com
// e-mail e senha. A marca é feita antes do login (a sessão pode chegar antes
// de o login terminar) e retirada se o login der erro. Recarregar a página
// com a sessão já aberta não mostra a animação de novo.
const CHAVE = 'festou_entrada'

export function marcarEntrada() { try { sessionStorage.setItem(CHAVE, '1') } catch { /* navegador sem armazenamento */ } }
export function desmarcarEntrada() { try { sessionStorage.removeItem(CHAVE) } catch { /* idem */ } }

export function CarregamentoEntrada() {
  const { session } = useAuth()
  const [mostrar, setMostrar] = useState(false)
  useEffect(() => {
    if (!session) return
    try {
      if (sessionStorage.getItem(CHAVE)) { sessionStorage.removeItem(CHAVE); setMostrar(true) }
    } catch { /* sem armazenamento: entra direto */ }
  }, [session])
  return mostrar ? <TelaCarregamento onFim={() => setMostrar(false)} /> : null
}
