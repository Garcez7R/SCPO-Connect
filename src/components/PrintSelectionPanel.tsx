import { useState } from 'react'
import { Printer } from 'lucide-react'
import { printRows, type PrintRow } from '../printReport'

export default function PrintSelectionPanel({ title, rows }: { title: string; rows: PrintRow[] }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const visible = rows.filter((row) => {
    const day = row.date.slice(0, 10)
    const text = `${row.title} ${row.fields.map(([label, value]) => `${label} ${value}`).join(' ')}`.toLocaleLowerCase('pt-BR')
    return (!from || day >= from) && (!to || day <= to) && text.includes(query.trim().toLocaleLowerCase('pt-BR'))
  })
  const selectedRows = visible.filter((row) => selected.includes(row.id))
  function print(rowsToPrint: PrintRow[]) {
    if (!printRows(title, rowsToPrint, from, to)) window.alert('Permita a janela de impressão para este site e tente novamente.')
  }
  if (!rows.length) return null
  return <section className="print-selection-panel"><div className="print-selection-heading"><div><p className="eyebrow">RELATÓRIO IMPRESSO</p><h3>{title}</h3><small>{visible.length} registro(s) no resultado</small></div><button className="button button-secondary" type="button" onClick={() => print(visible)} disabled={!visible.length}><Printer size={15} /> Imprimir resultado</button></div><div className="print-selection-filters"><label className="field"><span className="field-label">De</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className="field"><span className="field-label">Até</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><label className="field"><span className="field-label">Buscar nos dados</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, situação ou assunto" /></label><button className="button button-secondary" type="button" onClick={() => setSelected(visible.map((row) => row.id))} disabled={!visible.length}>Selecionar resultado</button><button className="button button-secondary" type="button" onClick={() => setSelected([])} disabled={!selected.length}>Limpar seleção</button></div><div className="print-selection-list">{visible.map((row) => <label key={row.id}><input type="checkbox" checked={selected.includes(row.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} /><span>{row.title}</span><time>{row.date ? new Intl.DateTimeFormat('pt-BR').format(new Date(`${row.date.slice(0, 10)}T00:00:00`)) : ''}</time><button className="button button-secondary" type="button" onClick={(event) => { event.preventDefault(); print([row]) }}><Printer size={14} /> Imprimir item</button></label>)}</div><button className="button button-primary" type="button" onClick={() => print(selectedRows)} disabled={!selectedRows.length}><Printer size={15} /> Imprimir selecionados ({selectedRows.length})</button></section>
}
