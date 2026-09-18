import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

// Permite que um botão de ação rápida em outra página navegue direto pra cá
// já abrindo o formulário de cadastro (ex: /reservas?novo=1), sem precisar
// clicar de novo em "Nova reserva" ao chegar.
export function useOpenOnQueryParam(param: string, onOpen: () => void) {
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    if (searchParams.get(param) === '1') {
      onOpen()
      const next = new URLSearchParams(searchParams)
      next.delete(param)
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
