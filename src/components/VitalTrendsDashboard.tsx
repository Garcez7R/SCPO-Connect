import { useEffect, useMemo, useState } from 'react'
import { Activity, Printer } from 'lucide-react'
import { readApiResponse } from '../api'
import ToastMessage from './ToastMessage'

type VitalRecord = {
  id: number
  patient_reference: string
  actor_name: string
  values: Record<string, string>
  glucose_unit: string
  measured_at: string
  recorded_at: string
}

type TrendResponse = {
  records: VitalRecord[]
  total: number
  generated_at: string
  range_start: string
  range_end: string
}

type TrendSeries = {
  key: string
  label: string
  color: string
  read: (record: VitalRecord) => number | null
}
type PressureView = 'both' | 'systolic' | 'diastolic'
type TrendsView = 'charts' | 'table'

function numberValue(value: string | undefined) {
  if (!value) return null
  const parsed = Number.parseFloat(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function localDateTime(value: number) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function TrendChart({
  title,
  unit,
  records,
  series,
  start,
  end,
  selectedRecordId,
  onSelectRecord,
  pressureView,
  onPressureView,
}: {
  title: string
  unit: string
  records: VitalRecord[]
  series: TrendSeries[]
  start: number
  end: number
  selectedRecordId: number | null
  onSelectRecord: (id: number) => void
  pressureView?: PressureView
  onPressureView?: (view: PressureView) => void
}) {
  const entries = series.flatMap((item) => records.flatMap((record) => {
    const value = item.read(record)
    return value === null ? [] : [{ record, value, series: item }]
  }))
  if (!entries.length) {
    return <section className="vital-trend-card"><div><h3>{title}</h3><p>Sem registros neste período.</p></div></section>
  }

  const values = entries.map(({ value }) => value)
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const padding = (maximum - minimum || Math.max(Math.abs(maximum) * 0.1, 1)) * 0.12
  const low = minimum - padding
  const high = maximum + padding
  const timeSpan = Math.max(end - start, 1)
  const yFor = (value: number) => 168 - ((value - low) / (high - low)) * 132
  const xFor = (record: VitalRecord) => 82 + ((new Date(record.measured_at).getTime() - start) / timeSpan) * 378
  const selected = records.find((record) => record.id === selectedRecordId)
  const tickValues = Array.from({ length: 4 }, (_, index) => high - ((high - low) * index) / 3)

  return <section className="vital-trend-card">
    <div className="vital-trend-card-heading"><h3>{title}</h3><span>{unit}</span>{pressureView && onPressureView && <div className="vital-pressure-view" role="group" aria-label="Exibição da pressão arterial">
      {([
        ['both', 'Sistólica + diastólica'],
        ['systolic', 'Sistólica'],
        ['diastolic', 'Diastólica'],
      ] as const).map(([view, label]) => <button key={view} type="button" aria-pressed={pressureView === view} onClick={() => onPressureView(view)}>{label}</button>)}
    </div>}</div>
    <div className="vital-trend-chart">
      <svg viewBox="0 0 480 220" role="img" aria-label={`Evolução de ${title} com ${entries.length} medições`}>
        {tickValues.map((value, index) => {
          const y = 36 + index * 44
          return <g key={index}><line x1="82" y1={y} x2="460" y2={y} className="vital-trend-gridline" /><text x="72" y={y + 4} textAnchor="end" className="vital-trend-axis-label">{value.toFixed(1).replace(/\.0$/, '')}</text></g>
        })}
        <line x1="82" y1="168" x2="460" y2="168" className="vital-trend-axis" />
        {series.map((item) => {
          const points = entries.filter((entry) => entry.series.key === item.key).sort((a, b) => a.record.measured_at.localeCompare(b.record.measured_at))
          return <g key={item.key}>
            {points.length > 1 && <polyline points={points.map(({ record, value }) => `${xFor(record)},${yFor(value)}`).join(' ')} fill="none" stroke={item.color} strokeWidth="1.7" vectorEffect="non-scaling-stroke" />}
            {points.map(({ record, value }) => <circle
              key={`${record.id}-${item.key}`}
              cx={xFor(record)}
              cy={yFor(value)}
              r={selectedRecordId === record.id ? '6' : '4.2'}
              fill={item.color}
              stroke="var(--surface)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              tabIndex={0}
              role="button"
              aria-label={`${item.label}: ${value} ${unit}, aferido em ${dateTime(record.measured_at)}`}
              onClick={() => onSelectRecord(record.id)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectRecord(record.id) } }}
            ><title>{item.label}: {value} {unit} · {dateTime(record.measured_at)}</title></circle>)}
          </g>
        })}
        {[start, (start + end) / 2, end].map((timestamp, index) => {
          const x = 82 + index * 189
          return <g key={timestamp}><line x1={x} y1="36" x2={x} y2="168" className="vital-trend-gridline" /><text x={x} y="202" textAnchor={index === 0 ? 'start' : index === 2 ? 'end' : 'middle'} className="vital-trend-axis-label">{localDateTime(timestamp)}</text></g>
        })}
      </svg>
    </div>
    <div className="vital-trend-legend">{series.map((item) => <span key={item.key}><i style={{ backgroundColor: item.color }} />{item.label}</span>)}<span>{entries.length} {entries.length === 1 ? 'medição' : 'medições'}</span></div>
    {selected && <div className="vital-trend-selected" aria-live="polite">
      <strong>{dateTime(selected.measured_at)}</strong>
      <span>Registrado em {dateTime(selected.recorded_at)} por {selected.actor_name}</span>
      <div>{Object.entries(selected.values).filter(([, value]) => value).map(([key, value]) => <span key={key}>{key === 'heartRate' ? 'FC' : key === 'respiratoryRate' ? 'FR' : key === 'temperature' ? 'Temperatura' : key === 'saturation' ? 'Saturação' : key === 'pressure' ? 'Pressão arterial' : key === 'glucose' ? `Glicose (${selected.glucose_unit})` : null}{['heartRate', 'respiratoryRate', 'temperature', 'saturation', 'pressure', 'glucose'].includes(key) ? `: ${value}${key === 'temperature' ? ' °C' : key === 'saturation' ? '%' : key === 'heartRate' ? ' bpm' : key === 'respiratoryRate' ? ' rpm' : key === 'pressure' ? ' mmHg' : ''}` : ''}</span>)}</div>
    </div>}
  </section>
}

export default function VitalTrendsDashboard({ patientReference, patientName }: { patientReference: string; patientName?: string }) {
  const [period, setPeriod] = useState<'6' | '24' | '168' | '720' | 'custom'>('168')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [pressureView, setPressureView] = useState<PressureView>('both')
  const [trendsView, setTrendsView] = useState<TrendsView>('charts')
  const [data, setData] = useState<TrendResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null)
  const incompleteRange = period === 'custom' && (!fromDate || !toDate)
  const invalidRange = period === 'custom' && Boolean(fromDate && toDate && fromDate > toDate)

  useEffect(() => {
    if (period === 'custom' && (incompleteRange || invalidRange)) {
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      const params = new URLSearchParams()
      if (period === 'custom') {
        params.set('from_at', new Date(fromDate).toISOString())
        params.set('to_at', new Date(toDate).toISOString())
      } else {
        params.set('hours', period)
      }
      fetch(`/api/v1/nursing/patients/${encodeURIComponent(patientReference)}/vital-trends?${params.toString()}`, { signal: controller.signal })
        .then((response) => readApiResponse<TrendResponse>(response))
        .then((result) => {
          setData(result)
          setSelectedRecordId(null)
        })
        .catch((loadError) => {
          if (loadError instanceof DOMException && loadError.name === 'AbortError') return
          setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a evolução dos sinais.')
          setData(null)
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [patientReference, period, fromDate, toDate, incompleteRange, invalidRange])

  const records = useMemo(() => data?.records ?? [], [data])
  const start = data ? new Date(data.range_start).getTime() : 0
  const end = data ? new Date(data.range_end).getTime() : 0
  const recordCount = records.length
  const orderedRecords = useMemo(
    () => records.slice().sort((first, second) => first.measured_at.localeCompare(second.measured_at)),
    [records],
  )
  const series = {
    systolic: { key: 'systolic', label: 'Sistólica', color: '#147d92', read: (record: VitalRecord) => numberValue(record.values.pressure?.split('/')[0]) },
    diastolic: { key: 'diastolic', label: 'Diastólica', color: '#a44b72', read: (record: VitalRecord) => numberValue(record.values.pressure?.split('/')[1]) },
    heartRate: { key: 'heartRate', label: 'Frequência cardíaca', color: '#c05c35', read: (record: VitalRecord) => numberValue(record.values.heartRate) },
    respiratoryRate: { key: 'respiratoryRate', label: 'Frequência respiratória', color: '#6476b8', read: (record: VitalRecord) => numberValue(record.values.respiratoryRate) },
    saturation: { key: 'saturation', label: 'Saturação', color: '#32825a', read: (record: VitalRecord) => numberValue(record.values.saturation) },
    temperature: { key: 'temperature', label: 'Temperatura', color: '#b17b22', read: (record: VitalRecord) => numberValue(record.values.temperature) },
    glucose: (unit: string): TrendSeries => ({ key: `glucose-${unit}`, label: `Glicose · ${unit}`, color: '#7255a1', read: (record) => record.glucose_unit === unit ? numberValue(record.values.glucose) : null }),
  }
  const pressureSeries = pressureView === 'both'
    ? [series.systolic, series.diastolic]
    : [pressureView === 'systolic' ? series.systolic : series.diastolic]
  const periodLabel = data
    ? `${dateTime(data.range_start)} a ${dateTime(data.range_end)}`
    : 'Período selecionado'

  function printTable() {
    const popup = window.open('', '_blank', 'width=1100,height=800')
    if (!popup) {
      setError('O navegador bloqueou a janela de impressão. Permita pop-ups para este aplicativo.')
      return
    }
    const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    } satisfies Record<string, string>)[character] ?? character)
    const cell = (value: string | undefined, unit = '') => value ? `${escapeHtml(value)}${unit}` : '—'
    const rows = orderedRecords.map((record) => `<tr>
      <td>${escapeHtml(dateTime(record.measured_at))}</td>
      <td>${cell(record.values.pressure, ' mmHg')}</td>
      <td>${cell(record.values.heartRate, ' bpm')}</td>
      <td>${cell(record.values.respiratoryRate, ' rpm')}</td>
      <td>${cell(record.values.saturation, '%')}</td>
      <td>${cell(record.values.temperature, ' °C')}</td>
      <td>${cell(record.values.glucose, record.glucose_unit ? ` ${escapeHtml(record.glucose_unit)}` : '')}</td>
      <td>${escapeHtml(dateTime(record.recorded_at))}</td>
      <td>${escapeHtml(record.actor_name || 'Não informado')}</td>
    </tr>`).join('')
    const patientLabel = patientName ? escapeHtml(patientName) : escapeHtml(patientReference)
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Evolução de sinais vitais</title>
      <style>
        @page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#172b3b;font:10pt Arial,sans-serif}
        h1{margin:0 0 5px;font-size:18pt}.meta{margin:0 0 14px;color:#526579}
        table{width:100%;border-collapse:collapse;font-size:8.5pt}thead{display:table-header-group}
        th,td{padding:6px 5px;border:1px solid #ccd7df;text-align:left;vertical-align:top}
        th{background:#eaf3f7;color:#285d74;font-weight:700}tbody tr:nth-child(even){background:#f5f8fa}
        @media print{tr{break-inside:avoid}}
      </style></head><body><h1>Evolução de sinais vitais</h1>
      <p class="meta">Paciente: ${patientLabel} · ${recordCount} ${recordCount === 1 ? 'medição' : 'medições'} · Período: ${escapeHtml(periodLabel)}</p>
      <table><thead><tr><th>Aferido em</th><th>Pressão arterial</th><th>FC</th><th>FR</th><th>Saturação</th><th>Temperatura</th><th>Glicose</th><th>Registrado em</th><th>Profissional</th></tr></thead><tbody>${rows}</tbody></table>
      </body></html>`)
    popup.document.close()
    popup.focus()
    window.setTimeout(() => {
      if (!popup.closed) popup.print()
    }, 250)
    setError('')
  }

  return <section className="vital-trends-dashboard" aria-label="Painel longitudinal de sinais vitais">
    <div className="vital-trends-heading"><div><p className="eyebrow">EVOLUÇÃO LONGITUDINAL</p><h2>Painel de sinais vitais</h2><p>O eixo horizontal representa data e horário da aferição; o vertical representa o valor medido. A visualização não interpreta valores nem recomenda condutas.</p></div><div className="vital-trends-period"><label className="field"><span className="field-label">Período</span><select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}><option value="6">Últimas 6 horas</option><option value="24">Últimas 24 horas</option><option value="168">Últimos 7 dias</option><option value="720">Últimos 30 dias</option><option value="custom">Selecionar período</option></select></label>{period === 'custom' && <><label className="field"><span className="field-label">De (data e hora)</span><input type="datetime-local" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} /></label><label className="field"><span className="field-label">Até (data e hora)</span><input type="datetime-local" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} /></label></>}</div></div>
    {incompleteRange && <p className="field-hint">Informe a data e a hora iniciais e finais para consultar o período.</p>}
    {invalidRange && <ToastMessage variant="error">A data e hora inicial devem ser anteriores ou iguais à data e hora final.</ToastMessage>}
    {!incompleteRange && !invalidRange && error && <ToastMessage variant="error">{error}</ToastMessage>}
    {incompleteRange ? <div className="history-empty">Selecione o período completo para consultar as medições.</div> : invalidRange ? null : loading ? <div className="history-empty">Carregando evolução…</div> : <>
      <div className="vital-trends-meta"><span>{recordCount} {recordCount === 1 ? 'coleta' : 'coletas'} no período</span><span>Atualizado em {data ? dateTime(data.generated_at) : '—'}</span></div>
      {recordCount === 0 ? <div className="history-empty"><Activity size={20} /><span>Não há sinais registrados neste período.</span></div> : <>
        <p className="vital-trends-gap-note">Os pontos são posicionados pelo horário de aferição. Os intervalos entre eles representam tempo sem coleta registrada e não indicam estabilidade.</p>
        <div className="vital-trends-view-controls" role="group" aria-label="Forma de visualizar as medições">
          <button className="button button-secondary" type="button" aria-pressed={trendsView === 'charts'} onClick={() => setTrendsView('charts')}>Gráficos</button>
          <button className="button button-secondary" type="button" aria-pressed={trendsView === 'table'} onClick={() => setTrendsView('table')}>Tabela acessível</button>
          <button className="button button-secondary vital-trends-print" type="button" onClick={printTable}><Printer size={16} /> Imprimir tabela</button>
        </div>
        {trendsView === 'charts' ? <div className="vital-trends-grid">
          <TrendChart title="Pressão arterial" unit="mmHg" records={records} series={pressureSeries} start={start} end={end} selectedRecordId={selectedRecordId} onSelectRecord={setSelectedRecordId} pressureView={pressureView} onPressureView={setPressureView} />
          <TrendChart title="Frequência cardíaca" unit="bpm" records={records} series={[series.heartRate]} start={start} end={end} selectedRecordId={selectedRecordId} onSelectRecord={setSelectedRecordId} />
          <TrendChart title="Frequência respiratória" unit="rpm" records={records} series={[series.respiratoryRate]} start={start} end={end} selectedRecordId={selectedRecordId} onSelectRecord={setSelectedRecordId} />
          <TrendChart title="Saturação" unit="%" records={records} series={[series.saturation]} start={start} end={end} selectedRecordId={selectedRecordId} onSelectRecord={setSelectedRecordId} />
          <TrendChart title="Temperatura" unit="°C" records={records} series={[series.temperature]} start={start} end={end} selectedRecordId={selectedRecordId} onSelectRecord={setSelectedRecordId} />
          <TrendChart title="Glicose · mg/dL" unit="mg/dL" records={records} series={[series.glucose('mg/dL')]} start={start} end={end} selectedRecordId={selectedRecordId} onSelectRecord={setSelectedRecordId} />
          <TrendChart title="Glicose · mmol/L" unit="mmol/L" records={records} series={[series.glucose('mmol/L')]} start={start} end={end} selectedRecordId={selectedRecordId} onSelectRecord={setSelectedRecordId} />
        </div> : <div className="vital-trends-table-wrap" role="region" aria-label="Tabela de medições de sinais vitais" tabIndex={0}>
          <table className="vital-trends-table">
            <caption>{patientName ? `Paciente: ${patientName}` : 'Medições de sinais vitais'} · {recordCount} {recordCount === 1 ? 'registro' : 'registros'} · {periodLabel}</caption>
            <thead><tr><th scope="col">Aferido em</th><th scope="col">Pressão (mmHg)</th><th scope="col">FC (bpm)</th><th scope="col">FR (rpm)</th><th scope="col">Saturação (%)</th><th scope="col">Temperatura (°C)</th><th scope="col">Glicose</th><th scope="col">Registrado em</th><th scope="col">Profissional</th></tr></thead>
            <tbody>{orderedRecords.map((record) => <tr key={record.id}>
              <td>{dateTime(record.measured_at)}</td>
              <td>{record.values.pressure || '—'}</td>
              <td>{record.values.heartRate || '—'}</td>
              <td>{record.values.respiratoryRate || '—'}</td>
              <td>{record.values.saturation ? `${record.values.saturation}%` : '—'}</td>
              <td>{record.values.temperature ? `${record.values.temperature} °C` : '—'}</td>
              <td>{record.values.glucose ? `${record.values.glucose} ${record.glucose_unit}` : '—'}</td>
              <td>{dateTime(record.recorded_at)}</td>
              <td>{record.actor_name || 'Não informado'}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </>}
    </>}
  </section>
}
