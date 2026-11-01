import { lazy, type ComponentType } from 'react'

// Carrega uma tela só quando ela é aberta. Se o site foi atualizado enquanto
// a aba estava aberta, o arquivo antigo da tela some do servidor: aí a página
// recarrega uma vez sozinha, já com a versão nova.
export function lazyPage<T extends ComponentType<any>>(carregar: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const m = await carregar()
      sessionStorage.removeItem('recarregou-tela')
      return m
    } catch (erro) {
      let jaRecarregou = false
      try {
        jaRecarregou = sessionStorage.getItem('recarregou-tela') === '1'
        sessionStorage.setItem('recarregou-tela', '1')
      } catch {
        // sem armazenamento: tenta recarregar mesmo assim
      }
      if (!jaRecarregou) {
        window.location.reload()
        return new Promise<{ default: T }>(() => {})
      }
      throw erro
    }
  })
}

export function PageLoading() {
  return <p className="text-sm text-muted py-10 text-center">Carregando...</p>
}
