import { useState } from 'react'
import { X, FileText, FileSpreadsheet } from 'lucide-react'
import { Button } from './ui/Button'
import { useAuth } from '../lib/AuthContext'
import { useCompany } from '../lib/CompanyContext'
import { useUnit, UNITS, allUnitsLabel } from '../lib/UnitContext'
import { currentMonthValue, addMonthsToValue } from '../lib/monthUtils'
import { carregarRelatorio, nomeMesLongo } from '../lib/relatorioFinanceiro'

// Janela do relatório financeiro: escolhe o período (em meses) e baixa em PDF
// ou Excel. Usa a unidade escolhida no topo do sistema.
export function RelatorioFinanceiroModal({ onClose }: { onClose: () => void }) {
  const { profile } = useAuth()
  const { brand } = useCompany()
  const { selectedUnit, unitDbIds } = useUnit()
  const atual = currentMonthValue()
  const [mesIni, setMesIni] = useState(atual)
  const [mesFim, setMesFim] = useState(atual)
  const [gerando, setGerando] = useState<'pdf' | 'excel' | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const unidade = selectedUnit === 'todas' ? allUnitsLabel() : UNITS.find((u) => u.id === selectedUnit)?.name ?? ''
  const unitId = selectedUnit === 'todas' ? null : unitDbIds[selectedUnit]?.unitId ?? null
  const [a, b] = mesIni <= mesFim ? [mesIni, mesFim] : [mesFim, mesIni]
  let qtd = 0
  for (let m = a; m <= b && qtd < 30; m = addMonthsToValue(m, 1)) qtd++
  const muitoLongo = qtd > 24

  function atalho(meses: number) {
    setMesFim(atual)
    setMesIni(addMonthsToValue(atual, -(meses - 1)))
  }

  async function gerar(formato: 'pdf' | 'excel') {
    setErro(null)
    setGerando(formato)
    try {
      const dados = await carregarRelatorio({ mesIni: a, mesFim: b, unitId, unidade, casa: brand.name || 'Festou', geradoPor: profile?.name ?? '' })
      const arquivos = await import('../lib/relatorioFinanceiroArquivos')
      if (formato === 'pdf') await arquivos.baixarPdfRelatorio(dados)
      else await arquivos.baixarExcelRelatorio(dados)
    } catch (e: any) {
      setErro(e?.message ? `Não foi possível gerar o relatório: ${e.message}` : 'Não foi possível gerar o relatório.')
    } finally {
      setGerando(null)
    }
  }

  const campo = 'w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/40" onClick={() => !gerando && onClose()} />
      <div className="relative w-full max-w-lg bg-surface rounded-card p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-display font-semibold">Relatório financeiro</h2>
          <button onClick={onClose} disabled={!!gerando} className="text-muted hover:text-ink" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-muted mb-4">
          Mostra se teve lucro ou prejuízo no período e explica cada número, com as três visões (Caixa, Resultado das festas, Ponte e compromissos), todos os lançamentos e as contas em aberto.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted mb-1">De (mês)</label>
            <input type="month" value={mesIni} max={atual} onChange={(e) => e.target.value && setMesIni(e.target.value)} className={campo} />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Até (mês)</label>
            <input type="month" value={mesFim} max={atual} onChange={(e) => e.target.value && setMesFim(e.target.value)} className={campo} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {[
            ['Este mês', 1],
            ['Últimos 3 meses', 3],
            ['Últimos 6 meses', 6],
            ['Últimos 12 meses', 12],
          ].map(([rot, m]) => (
            <button key={rot} type="button" onClick={() => atalho(m as number)} className="text-xs px-2.5 h-7 rounded-md border border-line hover:bg-paper">
              {rot}
            </button>
          ))}
        </div>

        <div className="bg-paper rounded-lg px-3 py-2.5 text-sm mt-4">
          <p><strong>Período:</strong> {a === b ? nomeMesLongo(a) : `${nomeMesLongo(a)} a ${nomeMesLongo(b)}`} ({qtd} {qtd === 1 ? 'mês' : 'meses'})</p>
          <p><strong>Unidade:</strong> {unidade} <span className="text-xs text-muted">(troque no seletor de unidade no topo do sistema)</span></p>
          {a <= atual && b >= atual && <p className="text-xs text-muted mt-1">O mês atual entra até hoje.</p>}
        </div>
        {muitoLongo && <p className="text-sm text-danger mt-3">Escolha até 24 meses por relatório.</p>}
        {erro && <p className="text-sm bg-danger-light text-danger rounded-lg px-3 py-2 mt-3">{erro}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
          <Button type="button" onClick={() => gerar('pdf')} disabled={!!gerando || muitoLongo} className="justify-center">
            <FileText className="w-4 h-4" /> {gerando === 'pdf' ? 'Gerando o PDF…' : 'Baixar PDF'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => gerar('excel')} disabled={!!gerando || muitoLongo} className="justify-center">
            <FileSpreadsheet className="w-4 h-4" /> {gerando === 'excel' ? 'Gerando a planilha…' : 'Baixar Excel'}
          </Button>
        </div>
        {gerando && <p className="text-xs text-muted mt-2 text-center">Juntando os números de cada mês. Pode levar alguns segundos.</p>}
      </div>
    </div>
  )
}
