import { Plus, X } from 'lucide-react'
import { brl, parseDecimal } from '../../lib/format'
import { FORMAS_REC } from '../../lib/recreacao'

// Pagamento dividido: parte em uma forma (ex.: Pix), parte em outra (ex.: dinheiro).
// A soma das partes precisa bater com o valor a pagar; o banco confere de novo.

export interface Parte { forma: string; valor: string }
export interface ParteNum { forma: string; valor: number }

export const partesIniciais = (): Parte[] => [{ forma: 'pix', valor: '' }, { forma: 'dinheiro', valor: '' }]
const cent = (n: number) => Math.round(n * 100)

export function partesNum(partes: Parte[]): ParteNum[] {
  return partes.map((p) => ({ forma: p.forma, valor: parseDecimal(p.valor) ?? 0 })).filter((p) => p.valor > 0)
}
export const somaPartes = (partes: Parte[]) => partesNum(partes).reduce((s, p) => s + p.valor, 0)
export const partesBatem = (partes: Parte[], total: number) => partesNum(partes).length > 0 && cent(somaPartes(partes)) === cent(total)

// Reparte as partes entre várias crianças, na ordem (quando se paga tudo junto).
export function alocar(partes: ParteNum[], devidos: number[]): ParteNum[][] {
  const resto = partes.map((p) => ({ forma: p.forma, c: cent(p.valor) }))
  return devidos.map((d) => {
    let falta = cent(d); const out: ParteNum[] = []
    for (const p of resto) {
      if (falta <= 0) break
      const x = Math.min(p.c, falta)
      if (x > 0) { out.push({ forma: p.forma, valor: x / 100 }); p.c -= x; falta -= x }
    }
    return out
  })
}

export function PagamentoDividido({ total, partes, onChange }: { total: number; partes: Parte[]; onChange: (p: Parte[]) => void }) {
  const soma = somaPartes(partes)
  const dif = cent(total) - cent(soma)
  const mudar = (i: number, patch: Partial<Parte>) => {
    const novo = partes.map((p, k) => (k === i ? { ...p, ...patch } : p))
    // com duas partes, a segunda completa sozinha o que falta
    if (patch.valor !== undefined && novo.length === 2 && i === 0) {
      const resto = cent(total) - cent(parseDecimal(patch.valor) ?? 0)
      novo[1] = { ...novo[1], valor: resto > 0 ? (resto / 100).toFixed(2).replace('.', ',') : '' }
    }
    onChange(novo)
  }
  return (
    <div className="space-y-2 rounded-xl bg-paper/70 border border-line p-3">
      {partes.map((p, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select className="campo !w-44 !py-1.5" value={p.forma} onChange={(e) => mudar(i, { forma: e.target.value })} aria-label={`Forma da parte ${i + 1}`}>
            {FORMAS_REC.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input className="campo !w-28 !py-1.5" inputMode="decimal" placeholder="R$ 0,00" value={p.valor} onChange={(e) => mudar(i, { valor: e.target.value })} aria-label={`Valor da parte ${i + 1}`} />
          {partes.length > 2 && <button type="button" onClick={() => onChange(partes.filter((_, k) => k !== i))} className="text-muted hover:text-danger" aria-label="Tirar esta parte"><X className="w-4 h-4" /></button>}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {partes.length < 4 && <button type="button" onClick={() => onChange([...partes, { forma: 'cartao_debito', valor: dif > 0 ? (dif / 100).toFixed(2).replace('.', ',') : '' }])} className="inline-flex items-center gap-1 font-semibold text-purple"><Plus className="w-3.5 h-3.5" />Outra forma</button>}
        <span className={`font-bold ${dif === 0 && soma > 0 ? 'text-teal' : 'text-amber'}`}>
          {dif === 0 && soma > 0 ? `Fechou: ${brl(total)}` : dif > 0 ? `Faltam ${brl(dif / 100)} de ${brl(total)}` : `Passou ${brl(-dif / 100)} do total de ${brl(total)}`}
        </span>
      </div>
    </div>
  )
}
