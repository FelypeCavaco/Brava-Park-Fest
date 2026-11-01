import { Check, Circle } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { ITENS_AUTOMATICOS, ITENS_MANUAIS, progressoImplantacao, type ItensImplantacao } from './platformTypes'

// Gerenciar empresa → Implantação: o roteiro para deixar a casa pronta. Os
// itens de cima o sistema confere sozinho; os de baixo você marca.
export function CompanySetup({ empresaId, itens, onChanged }: { empresaId: string; itens: ItensImplantacao | undefined; onChanged: () => Promise<void> | void }) {
  if (!itens) return <p className="text-sm text-muted">O roteiro de implantação aparece depois da migração 077.</p>
  const manual = (itens.manual ?? {}) as Record<string, boolean>
  const prog = progressoImplantacao(itens)!

  async function marcar(id: string, feito: boolean) {
    await supabase.rpc('platform_setup_mark', { p_company: empresaId, p_item: id, p_feito: feito })
    await onChanged()
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex justify-between text-sm mb-1"><span className="font-semibold">{prog.feitos} de {prog.total} prontos</span>{prog.feitos === prog.total && <span className="text-teal font-medium">Implantação completa</span>}</div>
        <div className="h-2 rounded-full bg-line overflow-hidden"><div className="h-full bg-green" style={{ width: `${(prog.feitos / prog.total) * 100}%` }} /></div>
      </div>
      <p className="text-xs text-muted">Para configurar o que falta, clique em <b>Abrir</b> na empresa.</p>
      <ul className="space-y-2">
        {ITENS_AUTOMATICOS.map((i) => {
          const ok = itens[i.id] === true
          return (
            <li key={i.id} className="flex gap-2.5 items-start text-sm">
              {ok ? <Check className="w-4 h-4 text-teal mt-0.5 shrink-0" /> : <Circle className="w-4 h-4 text-muted mt-0.5 shrink-0" />}
              <span><span className={ok ? '' : 'font-medium'}>{i.label}</span><span className="block text-xs text-muted">{ok ? 'Feito' : i.onde}</span></span>
            </li>
          )
        })}
      </ul>
      <div className="border-t border-line pt-3 space-y-2">
        <p className="text-xs text-muted">Você marca:</p>
        {ITENS_MANUAIS.map((i) => (
          <label key={i.id} className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={!!manual[i.id]} onChange={(e) => marcar(i.id, e.target.checked)} /> {i.label}
          </label>
        ))}
      </div>
    </div>
  )
}
