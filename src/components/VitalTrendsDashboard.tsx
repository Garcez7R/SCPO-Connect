import { useEffect, useMemo, useState } from 'react'
import { Activity } from 'lucide-react'
import { readApiResponse } from '../api'

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
}

type TrendSeries = {
  key: string
  label: string
  color: string
  read: (record: VitalRecord) => number | null
}

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
}: {
  title: string
  unit: string
  records: VitalRecord[]
  series: TrendSeries[]
  start: number
  end: number
  selectedRecordId: number | null
  onSelectRecord: (id: number) => void
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
  const yFor = (value: number) => 76 - ((value - low) / (high - low)) * 60
  const xFor = (record: VitalRecord) => 17 + ((new Date(record.measured_at).getTime() - start) / timeSpan) * 78
  const selected = records.find((record) => record.id === selectedRecordId)
  const tickValues = Array.from({ length: 4 }, (_, index) => high - ((high - low) * index) / 3)

  return <section className="vital-trend-card">
    <div className="vital-trend-card-heading"><h3>{title}</h3><span>{unit}</span></div>
    <div className="vital-trend-chart">
      <svg viewBox="0 0 100 100" role="img" aria-label={`Evolução de ${title} com ${entries.length} medições`} preserveAspectRatio="none">
        {tickValues.map((value, index) => {
          const y = 16 + index * 20
          return <g key={index}><line x1="17" y1={y} x2="95" y2={y} className="vital-trend-gridline" /><text x="14" y={y + 1.5} textAnchor="end" className="vital-trend-axis-label">{value.toFixed(1).replace(/\.0$/, '')}</text></g>
        })}
        <line x1="17" y1="76" x2="95" y2="76" className="vital-trend-axis" />
        {series.map((item) => {
          const points = entries.filter((entry) => entry.series.key === item.key).sort((a, b) => a.record.measured_at.localeCompare(b.record.measured_at))
          return <g key={item.key}>
            {points.length > 1 && <polyline points={points.map(({ record, value }) => `${xFor(record)},${yFor(value)}`).join(' ')} fill="none" stroke={item.color} strokeWidth="1.7" vectorEffect="non-scaling-stroke" />}
            {points.map(({ record, value }) => <circle
              key={`${record.id}-${item.key}`}
              cx={xFor(record)}
              cy={yFor(value)}
              r={selectedRecordId === record.id ? '3' : '2.2'}
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
        <text x="17" y="91" textAnchor="start" className="vital-trend-axis-label">{localDateTime(start)}</text>
        <text x="95" y="91" textAnchor="end" className="vital-trend-axis-label">{localDateTime(end)}</text>
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

export default function VitalTrendsDashboard({ patientReference }: { patientReference: string }) {
  const [hours, setHours] = useState<6 | 24 | 168>(24)
  const [data, setData] = useState<TrendResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      fetch(`/api/v1/nursing/patients/${encodeURIComponent(patientReference)}/vital-trends?hours=${hours}`, { signal: controller.signal })
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
  }, [patientReference, hours])

  const records = useMemo(() => data?.records ?? [], [data])
  const start = data ? new Date(data.generated_at).getTime() - hours * 60 * 60 * 1000 : 0
  const end = data ? new Date(data.generated_at).getTime() : 0
  const recordCount = records.length
  const series = {
    systolic: { key: 'systolic', label: 'Sistólica', color: '#287da0', read: (record: VitalRecord) => numberValue(record.values.pressure?.split('/')[0]) },
    diastolic: { key: 'diastolic', label: 'Diastólica', color: '#a45b9d', read: (record: VitalRecord) => numberValue(record.values.pressure?.split('/')[1]) },
    heartRate: { key: 'heartRate', label: 'Frequência cardíaca', color: '#287da0', read: (record: VitalRecord) => numberValue(record.values.heartRate) },
    respiratoryRate: { key: 'respiratoryRate', label: 'Frequência respiratória', color: '#287da0', read: (record: VitalRecord) => numberValue(record.values.respiratoryRate) },
    saturation: { key: 'saturation', label: 'Saturação', color: '#287da0', read: (record: VitalRecord) => numberValue(record.values.saturation) },
    temperature: { key: 'temperature', label: 'Temperatura', color: '#287da0', read: (record: VitalRecord) => numberValue(record.values.temperature) },
    glucose: (unit: string): TrendSeries => ({ key: `glucose-${unit}`, label: `Glicose · ${unit}`, color: '#287da0', read: (record) => record.glucose_unit === unit ? numberValue(record.values.glucose) : null }),
  }

  return <section className="vital-trends-dashboard" aria-label="Painel longitudinal de sinais vitais">
    <div className="vital-trends-heading"><div><p className="eyebrow">EVOLUÇÃO LONGITUDINAL</p><h2>Painel de sinais vitais</h2><p>Visualização dos registros no tempo; não interpreta os valores nem recomenda condutas.</p></div><label className="field"><span className="field-label">Período</span><select value={hours} onChange={(event) => setHours(Number(event.target.value) as 6 | 24 | 168)}><option value={6}>Últimas 6 horas</option><option value={24}>Últimas 24 horas</option><option value={168}>Últimos 7 dias</option></select></label></div>
    {error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {loading ? <div className="history-empty">Carregando evolução…</div> : <>
      <div className="vital-trends-meta"><span>{recordCount} {recordCount === 1 ? 'coleta' : 'coletas'} no período</span><span>Atualizado em {data ? dateTime(data.generated_at) : '—'}</span></div>
      {recordCount === 0 ? <div className="history-empty"><Activity size={20} /><span>Não há sinais registrados neste período.</span></div> : <>
        <p className="vital-trends-gap-note">Os pontos são posicionados pelo horário de aferição. Os intervalos entre eles representam tempo sem coleta registrada e não indicam estabilidade.</p>
        <div className="vital-trends-grid">
          <TrendChart title="Pressão arterial" unit="mmHg" records={records} series={[series.systolic, series.diastolic]} start={start} end={end} selectedRecordId={selectedRecordId} onSelectRecord={setSelectedRecordId} />
          <TrendChart title="Frequência cardíaca" unit="bpm" records={records} series={[series.heartRate]} start={start} end={end} selectedRecordId={selectedRecordId} onSelectRecord={setSelectedRecordId} />
          <TrendChart title="Frequência respiratória" unit="rpm" records={records} series={[series.respiratoryRate]} start={start} end={end} selectedRecordId={selectedRecordId} onSelectRecord={setSelectedRecordId} />
          <TrendChart title="Saturação" unit="%" records={records} series={[series.saturation]} start={start} end={end} selectedRecordId={selectedRecordId} onSelectRecord={setSelectedRecordId} />
          <TrendChart title="Temperatura" unit="°C" records={records} series={[series.temperature]} start={start} end={end} selectedRecordId={selectedRecordId} onSelectRecord={setSelectedRecordId} />
          <TrendChart title="Glicose · mg/dL" unit="mg/dL" records={records} series={[series.glucose('mg/dL')]} start={start} end={end} selectedRecordId={selectedRecordId} onSelectRecord={setSelectedRecordId} />
          <TrendChart title="Glicose · mmol/L" unit="mmol/L" records={records} series={[series.glucose('mmol/L')]} start={start} end={end} selectedRecordId={selectedRecordId} onSelectRecord={setSelectedRecordId} />
        </div>
      </>}
    </>}
  </section>
}
