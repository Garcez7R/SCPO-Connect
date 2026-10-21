export type PrintRow = { id: string; date: string; title: string; fields: [string, string][] }

export function printRows(title: string, rowsToPrint: PrintRow[], from = '', to = '') {
  if (!rowsToPrint.length) return false
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
  const date = (value: string) => value ? new Intl.DateTimeFormat('pt-BR').format(new Date(`${value.slice(0, 10)}T00:00:00`)) : 'Não informado'
  const popup = window.open('', '_blank', 'width=900,height=700')
  if (!popup) return false
  const cards = rowsToPrint.map((row) => `<article><h2>${escape(row.title)}</h2><p class="date">${escape(date(row.date))}</p><dl>${row.fields.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value || 'Não informado')}</dd></div>`).join('')}</dl></article>`).join('')
  popup.document.write(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${escape(title)}</title><style>body{font:14px Arial,sans-serif;color:#172b3b;margin:28px}h1{font-size:22px;margin:0 0 5px}.meta{color:#526579;margin:0 0 20px}article{border:1px solid #ccd7df;border-radius:8px;padding:14px;margin:0 0 12px;break-inside:avoid}article h2{font-size:16px;margin:0 0 4px}.date{color:#526579;margin:0 0 8px}dl{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:6px 14px}dl div{display:grid;grid-template-columns:130px 1fr;gap:8px}dt{font-weight:bold;color:#526579}dd{margin:0;overflow-wrap:anywhere}@media print{body{margin:12mm}}</style><h1>${escape(title)}</h1><p class="meta">${rowsToPrint.length} registro(s) · Emitido em ${escape(new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date()))}${from || to ? ` · Período: ${escape(from || 'início')} a ${escape(to || 'hoje')}` : ''}</p>${cards}</html>`)
  popup.document.close()
  popup.focus()
  window.setTimeout(() => {
    if (!popup.closed) popup.print()
  }, 250)
  return true
}
