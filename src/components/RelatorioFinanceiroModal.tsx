import { useState } from 'react'
import { X, FileText, FileSpreadsheet } from 'lucide-react'
import { Button } from './ui/Button'
import { useAuth } from '../lib/AuthContext'
import { useCompany } from '../lib/CompanyContext'
import { useUnit, UNITS, allUnitsLabel } from '../lib/UnitContext'
import { addMonthsToValue } from '../lib/monthUtils'
import {
  carregarRelatorio, hojeIso, somarDias, diasEntre, inicioDaSemana, montarFaixas, agrupamentoAutomatico, ajustarAgrupamento, textoDoPeriodo,
  NOME_AGRUPAR, type Agrupar,
} from '../lib/relatorioFinanceiro'

// Janela do relatório financeiro: escolhe o período (qualquer data inicial e final),
// como agrupar (dia, semana ou mês) e a unidade, e baixa em PDF ou Excel.
export function RelatorioFinanceiroModal({ onClose }: { onClose: () => void }) {
  const { profile } = useAuth()
  const { brand } = useCompany()
  const { selectedUnit, unitDbIds } = useUnit()
  const hoje = hojeIso()
  const [de, setDe] = useState(`${hoje.slice(0, 7)}-01`)
  const [ate, setAte] = useState(hoje)
  const [agrupar, setAgrupar] = useState<'auto' | Agrupar>('auto')
  const [unidadeSel, setUnidadeSel] = useState<string>(selectedUnit)
  const [separar, setSepar] = useState(false)
  const [gerando, setGerando] = useState<'pdf' | 'excel' | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const unidade = unidadeSel === 'todas' ? allUnitsLabel() : UNITS.find((u) => u.id === unidadeSel)?.name ?? ''
  const unitId = unidadeSel === 'todas' ? null : unitDbIds[unidadeSel]?.unitId ?? null

  // datas na ordem certa e nunca além de hoje (dias que não chegaram não têm lançamento)
  let [a, b] = de <= ate ? [de, ate] : [ate, de]
  if (b > hoje) b = hoje
  const comecaNoFuturo = a > b
  const dias = comecaNoFuturo ? 0 : diasEntre(a, b)
  const longo = dias > 800
  const sugerido = comecaNoFuturo || longo ? 'mes' : agrupamentoAutomatico(a, b)
  const pedido: Agrupar = agrupar === 'auto' ? sugerido : agrupar
  const efetivo: Agrupar = comecaNoFuturo || longo ? 'mes' : ajustarAgrupamento(a, b, pedido)
  const faixas = comecaNoFuturo || longo ? 0 : montarFaixas(a, b, efetivo).length

  function periodo(novoDe: string, novoAte: string) {
    setDe(novoDe)
    setAte(novoAte)
  }
  const mesAtual = hoje.slice(0, 7)
  const atalhos: [string, () => void][] = [
    ['Hoje', () => periodo(hoje, hoje)],
    ['Ontem', () => periodo(somarDias(hoje, -1), somarDias(hoje, -1))],
    ['Esta semana', () => periodo(inicioDaSemana(hoje), hoje)],
    ['Semana passada', () => { const ini = somarDias(inicioDaSemana(hoje), -7); periodo(ini, somarDias(ini, 6)) }],
    ['Este mês', () => periodo(`${mesAtual}-01`, hoje)],
    ['Mês passado', () => { const m = addMonthsToValue(mesAtual, -1); periodo(`${m}-01`, somarDias(`${mesAtual}-01`, -1)) }],
    ['Últimos 3 meses', () => periodo(`${addMonthsToValue(mesAtual, -2)}-01`, hoje)],
    ['Últimos 12 meses', () => periodo(`${addMonthsToValue(mesAtual, -11)}-01`, hoje)],
  ]

  async function gerar(formato: 'pdf' | 'excel') {
    setErro(null)
    setGerando(formato)
    try {
      const separarPor = unidadeSel === 'todas' && separar
        ? UNITS.map((u) => ({ nome: u.name, unitId: unitDbIds[u.id]?.unitId as string })).filter((u) => !!u.unitId)
        : undefined
      const dados = await carregarRelatorio({ de: a, ate: b, agrupar: pedido, unitId, unidade, casa: brand.name || 'Festou', geradoPor: profile?.name ?? '', separarPor })
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
  const invalido = comecaNoFuturo || longo
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
            <label htmlFor="rel-de" className="block text-xs text-muted mb-1">De (dia)</label>
            <input id="rel-de" type="date" value={de} max={hoje} onChange={(e) => e.target.value && setDe(e.target.value)} className={campo} />
          </div>
          <div>
            <label htmlFor="rel-ate" className="block text-xs text-muted mb-1">Até (dia)</label>
            <input id="rel-ate" type="date" value={ate} max={hoje} onChange={(e) => e.target.value && setAte(e.target.value)} className={campo} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {atalhos.map(([rot, fn]) => (
            <button key={rot} type="button" onClick={fn} className="text-xs px-2.5 h-7 rounded-md border border-line hover:bg-paper">
              {rot}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <div>
            <label htmlFor="rel-un" className="block text-xs text-muted mb-1">Unidade</label>
            <select id="rel-un" value={unidadeSel} onChange={(e) => { setUnidadeSel(e.target.value); if (e.target.value !== 'todas') setSepar(false) }} className={campo}>
              <option value="todas">{allUnitsLabel()}</option>
              {UNITS.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="rel-agr" className="block text-xs text-muted mb-1">Mostrar</label>
            <select id="rel-agr" value={agrupar} onChange={(e) => setAgrupar(e.target.value as 'auto' | Agrupar)} className={campo}>
              <option value="auto">Automático ({NOME_AGRUPAR[sugerido].tabela.toLowerCase()})</option>
              <option value="dia">Dia a dia</option>
              <option value="semana">Semana a semana</option>
              <option value="mes">Mês a mês</option>
            </select>
          </div>
        </div>
        {unidadeSel === 'todas' && UNITS.length > 1 && (
          <label className="flex items-start gap-2 text-sm mt-3">
            <input type="checkbox" checked={separar} onChange={(e) => setSepar(e.target.checked)} className="mt-0.5" />
            <span>
              <strong>Separar por unidade.</strong> Além do total, o relatório traz uma aba (Excel) ou seção (PDF) para cada unidade.
            </span>
          </label>
        )}

        <div className="bg-paper rounded-lg px-3 py-2.5 text-sm mt-4 space-y-0.5">
          {invalido ? null : (
            <>
              <p><strong>Período:</strong> {textoDoPeriodo(a, b)} ({dias} {dias === 1 ? 'dia' : 'dias'})</p>
              <p><strong>Unidade:</strong> {unidade}{separar && unidadeSel === 'todas' ? ' (total e cada unidade separada)' : ''}</p>
              <p><strong>Tabelas e gráficos:</strong> {NOME_AGRUPAR[efetivo].tabela.toLowerCase()} ({faixas} {faixas === 1 ? NOME_AGRUPAR[efetivo].unidade : NOME_AGRUPAR[efetivo].plural})</p>
              {efetivo !== pedido && <p className="text-xs text-muted">O período é longo para {NOME_AGRUPAR[pedido].tabela.toLowerCase()}; o relatório usa {NOME_AGRUPAR[efetivo].tabela.toLowerCase()} para ficar legível.</p>}
              {b === hoje && <p className="text-xs text-muted">O relatório vai até hoje: dias que ainda não chegaram não entram.</p>}
            </>
          )}
        </div>
        {comecaNoFuturo && <p className="text-sm text-danger mt-3">Esse período ainda não começou. Escolha datas até hoje.</p>}
        {longo && <p className="text-sm text-danger mt-3">Escolha no máximo 2 anos por relatório.</p>}
        {erro && <p className="text-sm bg-danger-light text-danger rounded-lg px-3 py-2 mt-3">{erro}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
          <Button type="button" onClick={() => gerar('pdf')} disabled={!!gerando || invalido} className="justify-center">
            <FileText className="w-4 h-4" /> {gerando === 'pdf' ? 'Gerando o PDF…' : 'Baixar PDF'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => gerar('excel')} disabled={!!gerando || invalido} className="justify-center">
            <FileSpreadsheet className="w-4 h-4" /> {gerando === 'excel' ? 'Gerando a planilha…' : 'Baixar Excel'}
          </Button>
        </div>
        {gerando && <p className="text-xs text-muted mt-2 text-center">Juntando os números de cada período{separar ? ' e de cada unidade' : ''}. Pode levar alguns segundos.</p>}
      </div>
    </div>
  )
}
