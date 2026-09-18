import { createContext, useContext, useState, ReactNode } from 'react'

interface PendingDelete {
  id: string
  label: string
  undo: () => void | Promise<void>
  timer: ReturnType<typeof setTimeout>
}

interface ScheduleDeleteOptions {
  label: string
  commit: () => void | Promise<void>
  undo: () => void | Promise<void>
  // Só usar quando o "undo" NÃO consegue reconstituir de verdade o que foi
  // apagado (ex: exclusão em cascata, como apagar a festa inteira derruba
  // pagamentos/custos/documentos junto — recriar só a linha principal não
  // devolveria isso). Nesses casos raros, adia o commit pros 6s como antes.
  irreversible?: boolean
}

interface UndoContextValue {
  pendingDeletes: PendingDelete[]
  scheduleDelete: (options: ScheduleDeleteOptions) => void
  undoDelete: (id: string) => void
}

const UndoContext = createContext<UndoContextValue | null>(null)

// Fica montado uma vez, no topo do app (main.tsx), pra sobreviver a
// navegação entre páginas — se a pessoa excluir algo e mudar de tela antes
// dos segundos acabarem, o "Desfazer" continua funcionando.
//
// IMPORTANTE: `commit` roda NA HORA (não é adiado 6s). Antes era adiado, mas
// isso causava duplicação: se a tela recarregasse a lista nesse meio-tempo
// (ex: saiu e voltou pra página), o item ainda existia no banco de verdade,
// então voltava na recarga — e ao clicar "Desfazer" depois, `undo()` juntava
// outra cópia por cima, duplicando na tela. Apagando de vez na hora, qualquer
// recarga já reflete a ausência do item; "Desfazer" recria de verdade.
// Exceção: `irreversible: true` (ver ScheduleDeleteOptions) volta ao adiado.
export function UndoProvider({ children }: { children: ReactNode }) {
  const [pendingDeletes, setPendingDeletes] = useState<PendingDelete[]>([])

  function scheduleDelete({ label, commit, undo, irreversible }: ScheduleDeleteOptions) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    if (!irreversible) commit()
    const timer = setTimeout(() => {
      if (irreversible) commit()
      setPendingDeletes((prev) => prev.filter((p) => p.id !== id))
    }, 6000)
    setPendingDeletes((prev) => [...prev, { id, label, undo, timer }])
  }

  function undoDelete(id: string) {
    setPendingDeletes((prev) => {
      const entry = prev.find((p) => p.id === id)
      if (entry) {
        clearTimeout(entry.timer)
        entry.undo()
      }
      return prev.filter((p) => p.id !== id)
    })
  }

  return (
    <UndoContext.Provider value={{ pendingDeletes, scheduleDelete, undoDelete }}>
      {children}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col-reverse items-center gap-2">
        {pendingDeletes.map((p) => (
          <div key={p.id} className="bg-ink text-white rounded-lg pl-4 pr-2 py-2.5 shadow-xl flex items-center gap-3 text-sm">
            <span>{p.label}</span>
            <button onClick={() => undoDelete(p.id)} className="text-purple-light font-medium px-3 py-1.5 rounded-lg hover:bg-white/10">
              Desfazer
            </button>
          </div>
        ))}
      </div>
    </UndoContext.Provider>
  )
}

export function useUndo() {
  const ctx = useContext(UndoContext)
  if (!ctx) throw new Error('useUndo precisa estar dentro de um <UndoProvider>')
  return ctx
}
