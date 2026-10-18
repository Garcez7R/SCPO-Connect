import { useState } from 'react'
import { Printer } from 'lucide-react'

export type PrintRow = { id: string; date: string; title: string; fields: [string, string][] }

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
    if (!rowsToPrint.length) return
    const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
    const date = (value: string) => value ? new Intl.DateTimeFormat('pt-BR').format(new Date(`${value.slice(0, 10)}T00:00:00`)) : 'Não informado'
    const popup = window.open('', '_blank', 'width=900,height=700')
    if (!popup) { window.alert('Permita a janela de impressão para este site e tente novamente.'); return }
    const cards = rowsToPrint.map((row) => `<article><h2>${escape(row.title)}</h2><p class="date">${escape(date(row.date))}</p><dl>${row.fields.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value || 'Não informado')}</dd></div>`).join('')}</dl></article>`).join('')
    popup.document.write(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${escape(title)}</title><style>body{font:14px Arial,sans-serif;color:#172b3b;margin:28px}h1{font-size:22px;margin:0 0 5px}.meta{color:#526579;margin:0 0 20px}article{border:1px solid #ccd7df;border-radius:8px;padding:14px;margin:0 0 12px;break-inside:avoid}article h2{font-size:16px;margin:0 0 4px}.date{color:#526579;margin:0 0 8px}dl{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:6px 14px}dl div{display:grid;grid-template-columns:130px 1fr;gap:8px}dt{font-weight:bold;color:#526579}dd{margin:0;overflow-wrap:anywhere}@media print{body{margin:12mm}}</style><h1>${escape(title)}</h1><p class="meta">${rowsToPrint.length} registro(s) · Emitido em ${escape(new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date()))}${from || to ? ` · Período: ${escape(from || 'início')} a ${escape(to || 'hoje')}` : ''}</p>${cards}<script>window.onload=()=>window.print()</script></html>`)
    popup.document.close()
  }
  if (!rows.length) return null
  return <section className="print-selection-panel"><div className="print-selection-heading"><div><p className="eyebrow">RELATÓRIO IMPRESSO</p><h3>{title}</h3><small>{visible.length} registro(s) no resultado</small></div><button className="button button-secondary" type="button" onClick={() => print(visible)} disabled={!visible.length}><Printer size={15} /> Imprimir resultado</button></div><div className="print-selection-filters"><label className="field"><span className="field-label">De</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className="field"><span className="field-label">Até</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><label className="field"><span className="field-label">Buscar nos dados</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, status ou assunto" /></label><button className="button button-secondary" type="button" onClick={() => setSelected(visible.map((row) => row.id))} disabled={!visible.length}>Selecionar resultado</button><button className="button button-secondary" type="button" onClick={() => setSelected([])} disabled={!selected.length}>Limpar seleção</button></div><div className="print-selection-list">{visible.map((row) => <label key={row.id}><input type="checkbox" checked={selected.includes(row.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} /><span>{row.title}</span><time>{row.date ? new Intl.DateTimeFormat('pt-BR').format(new Date(`${row.date.slice(0, 10)}T00:00:00`)) : ''}</time><button className="button button-secondary" type="button" onClick={(event) => { event.preventDefault(); print([row]) }}><Printer size={14} /> Imprimir item</button></label>)}</div><button className="button button-primary" type="button" onClick={() => print(selectedRows)} disabled={!selectedRows.length}><Printer size={15} /> Imprimir selecionados ({selectedRows.length})</button></section>
}
