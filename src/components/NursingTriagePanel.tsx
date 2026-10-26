import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { RefreshCw, Save, UserRound } from 'lucide-react'
import { readApiResponse } from '../api'
import ToastMessage from './ToastMessage'
import type { TriageArrival } from '../triageTypes'

type TriageForm = {
  allergies_status: 'unknown' | 'none_known' | 'known'
  allergies: string
  conditions_treatments: string
  vital_values: Record<string, string>
  glucose_unit: 'mg/dL' | 'mmol/L'
}

const emptyTriageForm = (): TriageForm => ({
  allergies_status: 'unknown',
  allergies: '',
  conditions_treatments: '',
  vital_values: {
    pressure: '',
    heartRate: '',
    respiratoryRate: '',
    saturation: '',
    temperature: '',
    glucose: '',
  },
  glucose_unit: 'mg/dL',
})

const vitalFields: Array<[string, string, string]> = [
  ['pressure', 'Pressão arterial', 'Ex.: 120/80'],
  ['heartRate', 'Frequência cardíaca (bpm)', 'bpm'],
  ['respiratoryRate', 'Frequência respiratória (rpm)', 'rpm'],
  ['saturation', 'Saturação (%)', '%'],
  ['temperature', 'Temperatura (°C)', '°C'],
  ['glucose', 'Glicemia', 'Valor'],
]

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function toForm(arrival?: TriageArrival): TriageForm {
  if (!arrival?.triage) return emptyTriageForm()
  return {
    allergies_status: arrival.triage.allergies_status,
    allergies: arrival.triage.allergies,
    conditions_treatments: arrival.triage.conditions_treatments,
    vital_values: {
      ...emptyTriageForm().vital_values,
      ...arrival.triage.vital_values,
    },
    glucose_unit: arrival.triage.glucose_unit,
  }
}

export default function NursingTriagePanel({ canUpdate }: { canUpdate: boolean }) {
  const [arrivals, setArrivals] = useState<TriageArrival[]>([])
  const [selectedArrivalId, setSelectedArrivalId] = useState('')
  const [form, setForm] = useState<TriageForm>(emptyTriageForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const hasLoadedRef = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const selectedArrival = useMemo(
    () => arrivals.find((arrival) => arrival.arrival_id === selectedArrivalId),
    [arrivals, selectedArrivalId],
  )

  const refresh = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true)
    try {
      const data = await readApiResponse<{ arrivals: TriageArrival[] }>(
        await fetch('/api/v1/nursing/triage/arrivals', { cache: 'no-store' }),
      )
      setArrivals(data.arrivals)
      setError('')
      hasLoadedRef.current = true
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a fila de triagem.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void refresh(), 0)
    const interval = window.setInterval(() => void refresh(), 20_000)
    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(interval)
    }
  }, [refresh])

  function selectArrival(arrival: TriageArrival) {
    setSelectedArrivalId(arrival.arrival_id)
    setForm(toForm(arrival))
    setError('')
    setNotice('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedArrival) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const updated = await readApiResponse<TriageArrival>(
        await fetch(`/api/v1/nursing/reception-arrivals/${encodeURIComponent(selectedArrival.arrival_id)}/triage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
            vital_values: Object.fromEntries(
              Object.entries(form.vital_values).filter(([, value]) => value.trim()),
            ),
          }),
        }),
      )
      setArrivals((current) => current.filter((item) => item.arrival_id !== updated.arrival_id))
      setSelectedArrivalId('')
      setForm(emptyTriageForm())
      setNotice('Triagem registrada para este atendimento; o Médico já pode consultá-la.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível registrar a triagem.')
    } finally {
      setSaving(false)
    }
  }

  const priorityCount = arrivals.filter((arrival) => arrival.queue_type === 'priority').length

  return <section className="nursing-triage-panel">
    <div className="section-heading">
      <div><p className="eyebrow">RECEPÇÃO → ENFERMAGEM → MÉDICO</p><h2>Triagem de atendimentos</h2><p className="welcome-copy">Confira os dados informados na chegada, registre alergias, condições relatadas e sinais vitais. Cada salvamento gera um novo registro associado a este atendimento.</p></div>
      <button className="button button-secondary" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} /> Atualizar fila</button>
    </div>
    <div className="clinical-note"><UserRound size={17} /><span>Este registro não altera o cadastro do paciente, não cria diagnósticos nem classifica risco automaticamente. Siga o protocolo institucional de triagem.</span></div>
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    <div className="nursing-triage-summary"><strong>{arrivals.length}</strong><span>aguardando triagem</span><strong>{priorityCount}</strong><span>prioritários na fila</span></div>
    {loading ? <p className="history-empty">Carregando chegadas da Recepção…</p> : !arrivals.length
      ? <p className="history-empty">Não há chegadas em andamento para triar.</p>
      : <div className="nursing-triage-layout">
        <div className="nursing-triage-arrivals" aria-label="Chegadas aguardando triagem">
          {arrivals.map((arrival) => <button
            className={`nursing-triage-arrival ${selectedArrivalId === arrival.arrival_id ? 'is-selected' : ''}`}
            type="button"
            key={arrival.arrival_id}
            onClick={() => selectArrival(arrival)}
          >
            <span className={`waiting-room-code ${arrival.queue_type}`}>{arrival.queue_type === 'priority' ? 'Prioritária' : 'Comum'}</span>
            <strong>{arrival.patient_name}</strong>
            <span>{arrival.reason}</span>
            <small>{arrival.status === 'waiting' ? 'Aguardando' : arrival.status === 'called' ? 'Chamado' : 'Em atendimento'} · {formatDateTime(arrival.created_at)}</small>
            <small className={arrival.triage ? 'nursing-triage-complete' : 'nursing-triage-pending'}>{arrival.triage ? `Triada por ${arrival.triage.registered_by}` : 'Triagem pendente'}</small>
          </button>)}
        </div>
        {selectedArrival && <form className="nursing-triage-form" onSubmit={(event) => void submit(event)}>
          <div className="section-heading"><div><p className="eyebrow">ATENDIMENTO · {selectedArrival.queue_type === 'priority' ? 'PRIORITÁRIO' : 'COMUM'}</p><h3>{selectedArrival.patient_name}</h3><p className="welcome-copy">{selectedArrival.reason}</p></div></div>
          {!selectedArrival.patient_reference && <div className="form-message form-message-warning">Esta chegada ainda não está vinculada a um cadastro de paciente. O registro de triagem ficará associado somente à chegada.</div>}
          {(selectedArrival.allergy_report_status === 'reported' || selectedArrival.allergy_report_status === 'denied') && <div className={`clinical-alert ${selectedArrival.allergy_report_status === 'reported' ? '' : 'clinical-alert-clear'}`} role="status">
            <div><strong>{selectedArrival.allergy_report_status === 'reported' ? 'Relato de alergia na Recepção' : 'Recepção registrou negativa de alergias'}</strong>{selectedArrival.reported_allergies && <span>{selectedArrival.reported_allergies}</span>}<span>Revise com o paciente/acompanhante e registre abaixo; este relato não substitui a confirmação.</span></div>
          </div>}
          {selectedArrival.patient_allergies_status && selectedArrival.patient_allergies_status !== 'unknown' && <div className="clinical-note"><span>Cadastro atual: {selectedArrival.patient_allergies_status === 'none_known' ? 'sem alergias conhecidas' : `alergia registrada — ${selectedArrival.patient_allergies || 'detalhes não disponíveis'}`}. A triagem será salva separadamente.</span></div>}
          {selectedArrival.triage && <p className="field-hint">Registro anterior por {selectedArrival.triage.registered_by} em {formatDateTime(selectedArrival.triage.registered_at)}. Ao salvar, uma nova revisão será adicionada sem apagar a anterior.</p>}
          <label className="field"><span className="field-label">Alergias neste atendimento</span><select value={form.allergies_status} onChange={(event) => setForm((current) => ({ ...current, allergies_status: event.target.value as TriageForm['allergies_status'], allergies: event.target.value === 'known' ? current.allergies : '' }))}>
            <option value="unknown">Não avaliado / informação indisponível</option>
            <option value="none_known">Sem alergias conhecidas após conferência</option>
            <option value="known">Alergia relatada/confirmada</option>
          </select></label>
          {form.allergies_status === 'known' && <label className="field"><span className="field-label">Descreva a alergia</span><textarea required maxLength={1000} value={form.allergies} onChange={(event) => setForm((current) => ({ ...current, allergies: event.target.value }))} /></label>}
          <label className="field"><span className="field-label">Condições, comorbidades ou tratamentos relatados</span><textarea maxLength={2000} value={form.conditions_treatments} onChange={(event) => setForm((current) => ({ ...current, conditions_treatments: event.target.value }))} placeholder="Informações referidas pelo paciente/acompanhante ou observadas. O profissional médico confirma diagnósticos." /></label>
          <fieldset className="nursing-triage-vitals"><legend>Sinais vitais medidos</legend><div className="field-grid field-grid-two">{vitalFields.map(([key, label, placeholder]) => <label className="field" key={key}><span className="field-label">{label}</span><input
            inputMode={key === 'pressure' ? 'text' : 'decimal'}
            maxLength={key === 'pressure' ? 9 : 16}
            placeholder={placeholder}
            value={form.vital_values[key] ?? ''}
            onChange={(event) => setForm((current) => ({ ...current, vital_values: { ...current.vital_values, [key]: event.target.value } }))}
          /></label>)}
            <label className="field"><span className="field-label">Unidade da glicemia</span><select value={form.glucose_unit} onChange={(event) => setForm((current) => ({ ...current, glucose_unit: event.target.value as TriageForm['glucose_unit'] }))}><option value="mg/dL">mg/dL</option><option value="mmol/L">mmol/L</option></select></label>
          </div><p className="field-hint">Informe somente valores efetivamente aferidos. Não são geradas interpretações automáticas.</p></fieldset>
          {canUpdate && <button className="button button-primary" type="submit" disabled={saving || (form.allergies_status === 'known' && !form.allergies.trim())}><Save size={16} />{saving ? 'Salvando triagem…' : selectedArrival.triage ? 'Salvar nova revisão' : 'Registrar triagem'}</button>}
        </form>}
      </div>}
    {!canUpdate && <p className="work-order-privacy">Seu perfil pode consultar as chegadas, mas não pode registrar triagens.</p>}
  </section>
}
