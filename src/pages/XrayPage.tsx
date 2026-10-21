import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  ClipboardList,
  Info,
  Printer,
  Search,
  ScanLine,
} from 'lucide-react'
import { readApiResponse } from '../api'
import { printLaboratoryRequest } from '../printClinicalForm'

type Patient = {
  reference: string
  name: string
  room: string
  bed: string
  birth_date?: string | null
  allergies?: string
  allergies_status?: 'unknown' | 'none_known' | 'known'
}
type AuthUser = { id: string; permissions: Record<string, string[]> }
type XrayStatus = 'requested' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
type XrayRequest = {
  id: number
  patient_reference: string
  exam_label: string
  exam_type?: 'xray' | 'laboratory'
  observations?: string
  status: XrayStatus
  result: string
  result_recorded_by: string
  result_recorded_at: string | null
  created_at: string
}

const xrayStatuses: Record<XrayStatus, string> = {
  requested: 'Solicitado',
  scheduled: 'Agendado',
  in_progress: 'Em execução',
  completed: 'Concluído',
  cancelled: 'Cancelado',
}

const laboratoryExamOptions = [
  'TGO', 'TGP', 'Gama GT', 'EQU (urina)', 'HIV', 'Sífilis', 'TSH', 'T3', 'T4',
  'Vitamina B12', 'Vitamina D', 'HCV', 'Anti-HBs', 'Hemograma', 'VHS', 'PCR', 'PSA',
  'Colesterol total', 'Colesterol fracionado', 'Triglicerídeos', 'Ureia', 'Creatinina',
  'Bilirrubina direta', 'Bilirrubina indireta', 'Bilirrubina total', 'Amilase', 'Lipase',
]

function dateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function patientLocationLabel(patient: Pick<Patient, 'room' | 'bed'>) {
  return patient.room.trim() && patient.bed.trim()
    ? `Quarto ${patient.room} · leito ${patient.bed}`
    : 'Sem quarto/leito atribuído'
}

function PatientAllergyAlert({ patient }: { patient?: Patient }) {
  if (!patient) return null
  if (patient.allergies_status === 'known' && patient.allergies) {
    return <div className="clinical-alert" role="alert"><AlertTriangle size={19} /><div><strong>Alerta cadastral · alergia conhecida</strong><span>{patient.allergies}</span></div></div>
  }
  if (patient.allergies_status === 'none_known') {
    return <div className="clinical-alert clinical-alert-clear" role="status"><BadgeCheck size={19} /><div><strong>Sem alergias conhecidas</strong><span>Informação confirmada no cadastro.</span></div></div>
  }
  return <div className="clinical-alert clinical-alert-unknown" role="status"><Info size={19} /><div><strong>Alergias não verificadas</strong><span>Confirme antes de iniciar condutas ou administrar substâncias.</span></div></div>
}

export default function XrayPage({ user }: { user: AuthUser }) {
  const [section, setSection] = useState<'xray' | 'laboratory'>('xray')
  const [patients, setPatients] = useState<Patient[]>([])
  const [requests, setRequests] = useState<XrayRequest[]>([])
  const [patientSearch, setPatientSearch] = useState('')
  const [patientReference, setPatientReference] = useState('')
  const [examLabel, setExamLabel] = useState('')
  const [selectedLaboratoryExams, setSelectedLaboratoryExams] = useState<string[]>([])
  const [otherExam, setOtherExam] = useState('')
  const [observations, setObservations] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'active' | 'all' | XrayStatus>('active')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [updating, setUpdating] = useState<number | null>(null)
  const [resultDrafts, setResultDrafts] = useState<Record<number, string>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const canUpdate = user.permissions.xray?.includes('alterar') ?? false
  const selectedPatient = patients.find((patient) => patient.reference === patientReference)

  async function loadData() {
    setLoading(true)
    try {
      const [patientResponse, requestResponse] = await Promise.all([
        fetch('/api/v1/nursing/patients'),
        fetch('/api/v1/xray/requests'),
      ])
      const [patientData, requestData] = await Promise.all([
        readApiResponse<{ patients?: Patient[] }>(patientResponse),
        readApiResponse<{ requests?: XrayRequest[] }>(requestResponse),
      ])
      setPatients(patientData.patients ?? [])
      setRequests(requestData.requests ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar os dados de Raio X.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    const loadXrayData = async () => {
      setLoading(true)
      try {
        const [patientResponse, requestResponse] = await Promise.all([
          fetch('/api/v1/nursing/patients'),
          fetch('/api/v1/xray/requests'),
        ])
        const [patientData, requestData] = await Promise.all([
          readApiResponse<{ patients?: Patient[] }>(patientResponse),
          readApiResponse<{ requests?: XrayRequest[] }>(requestResponse),
        ])
        if (!active) return
        setPatients(patientData.patients ?? [])
        setRequests(requestData.requests ?? [])
        setError('')
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar os dados de Raio X.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadXrayData()
    return () => { active = false }
  }, [user.id])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/v1/xray/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_reference: patientReference, exam_label: examLabel.trim(), exam_type: 'xray' }),
      })
      const data = await readApiResponse<XrayRequest>(response)
      setRequests((current) => [data, ...current])
      setPatientReference('')
      setPatientSearch('')
      setExamLabel('')
      setNotice('Exame incluído na fila de Raio X.')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Falha ao solicitar o exame.')
    } finally {
      setSaving(false)
    }
  }

  async function submitLaboratory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/v1/xray/laboratory-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_reference: patientReference,
          exams: selectedLaboratoryExams,
          other_exam: otherExam.trim(),
          observations: observations.trim(),
        }),
      })
      const data = await readApiResponse<{ requests: XrayRequest[] }>(response)
      setRequests((current) => [...data.requests, ...current])
      setSelectedLaboratoryExams([])
      setOtherExam('')
      setObservations('')
      setNotice(`${data.requests.length} exame(s) incluído(s) na fila laboratorial.`)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Falha ao solicitar os exames laboratoriais.')
    } finally {
      setSaving(false)
    }
  }

  async function updateStatus(request: XrayRequest, status: XrayStatus) {
    setUpdating(request.id)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/v1/xray/requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const updated = await readApiResponse<XrayRequest>(response)
      setRequests((current) => current.map((item) => item.id === updated.id ? updated : item))
      setNotice(`Exame atualizado: ${xrayStatuses[updated.status]}.`)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Falha ao atualizar o exame.')
    } finally {
      setUpdating(null)
    }
  }

  async function saveResult(request: XrayRequest) {
    const result = (resultDrafts[request.id] ?? '').trim()
    if (result.length < 3) return
    setUpdating(request.id)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/v1/xray/requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result }),
      })
      const updated = await readApiResponse<XrayRequest>(response)
      setRequests((current) => current.map((item) => item.id === updated.id ? updated : item))
      setResultDrafts((current) => {
        const next = { ...current }
        delete next[request.id]
        return next
      })
      setNotice('Resultado registrado na solicitação do exame.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível registrar o resultado.')
    } finally {
      setUpdating(null)
    }
  }

  const sectionRequests = requests.filter((request) => (request.exam_type ?? 'xray') === (section === 'xray' ? 'xray' : 'laboratory'))
  const activeCount = sectionRequests.filter((request) => ['requested', 'scheduled', 'in_progress'].includes(request.status)).length
  const filteredPatients = patients.filter((patient) =>
    `${patient.name} ${patient.room} ${patient.bed}`.toLocaleLowerCase('pt-BR')
      .includes(patientSearch.trim().toLocaleLowerCase('pt-BR')),
  )
  const visibleRequests = sectionRequests.filter((request) => {
    const matchesStatus = filter === 'all' || (filter === 'active'
      ? ['requested', 'scheduled', 'in_progress'].includes(request.status)
      : request.status === filter)
    const patient = patients.find((item) => item.reference === request.patient_reference)
    const searchable = `${patient?.name ?? ''} ${patient?.room ?? ''} ${patient?.bed ?? ''} ${request.exam_label}`.toLocaleLowerCase('pt-BR')
    return matchesStatus && searchable.includes(query.trim().toLocaleLowerCase('pt-BR'))
  })
  const patientName = (reference: string) => {
    const patient = patients.find((item) => item.reference === reference)
    return patient ? `${patient.name} · ${patientLocationLabel(patient)}` : 'Paciente não localizado'
  }

  return <section className="xray-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">MÓDULO · CENTRAL DE EXAMES</p><h1>Central de Exames</h1><p className="welcome-copy">Solicite exames laboratoriais e acompanhe a fila de Raio X e exames.</p></div><span className="module-icon module-icon-xray"><ScanLine size={23} /></span></div>
    <div className="admin-tabs module-tabs xray-tabs" role="tablist" aria-label="Seções da Central de Exames">
      <button className={`button ${section === 'xray' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={section === 'xray'} onClick={() => setSection('xray')}><ScanLine size={16} /> Raio X</button>
      <button className={`button ${section === 'laboratory' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={section === 'laboratory'} onClick={() => setSection('laboratory')}><ClipboardList size={16} /> Exames</button>
    </div>
    <div className="hygiene-summary" aria-label={`Resumo ${section === 'xray' ? 'da fila de Raio X' : 'da fila laboratorial'}`}><article><strong>{sectionRequests.length}</strong><span>Total de solicitações</span></article><article><strong>{activeCount}</strong><span>Exames ativos</span></article><article><strong>{sectionRequests.filter((request) => request.status === 'in_progress').length}</strong><span>Em execução</span></article></div>
    {error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}
    <form className="hygiene-panel" onSubmit={(event) => void (section === 'xray' ? submit(event) : submitLaboratory(event))}>
      <div className="section-heading"><div><p className="eyebrow">{section === 'xray' ? 'NOVO EXAME' : 'REQUISIÇÃO LABORATORIAL'}</p><h2>{section === 'xray' ? 'Adicionar à fila de Raio X' : 'Solicitar exames'}</h2></div></div>
      <div className="field-grid field-grid-two">
        <label className="field"><span className="field-label">Buscar paciente por nome, quarto ou leito</span><input type="search" value={patientSearch} onChange={(event) => { setPatientSearch(event.target.value); setPatientReference('') }} placeholder="Digite para filtrar pacientes" /></label>
        <label className="field"><span className="field-label">Paciente</span><select required value={patientReference} onChange={(event) => { setPatientReference(event.target.value); const selected = patients.find((patient) => patient.reference === event.target.value); if (selected) setPatientSearch(`${selected.name} · ${patientLocationLabel(selected)}`) }}><option value="">Selecione um paciente</option>{filteredPatients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patientLocationLabel(patient)}</option>)}</select></label>
        {section === 'xray' ? <label className="field xray-field-wide"><span className="field-label">Exame solicitado</span><input required minLength={2} maxLength={80} value={examLabel} onChange={(event) => setExamLabel(event.target.value)} placeholder="Ex.: radiografia de tórax" /></label> : <>
          <fieldset className="laboratory-exam-fieldset xray-field-wide"><legend>Exames disponíveis</legend><div className="laboratory-exam-grid">{laboratoryExamOptions.map((exam) => <label className="checkbox-label" key={exam}><input type="checkbox" checked={selectedLaboratoryExams.includes(exam)} onChange={() => setSelectedLaboratoryExams((current) => current.includes(exam) ? current.filter((item) => item !== exam) : [...current, exam])} /><span>{exam}</span></label>)}</div></fieldset>
          <label className="field"><span className="field-label">Outros exames</span><input maxLength={72} value={otherExam} onChange={(event) => setOtherExam(event.target.value)} placeholder="Descreva outro exame" /></label>
          <label className="field"><span className="field-label">Observações</span><textarea maxLength={1000} rows={3} value={observations} onChange={(event) => setObservations(event.target.value)} placeholder="Informações adicionais para a solicitação" /></label>
          {selectedPatient && (selectedLaboratoryExams.length > 0 || otherExam.trim()) && <div className="xray-field-wide laboratory-print-preview"><strong>Prévia da identificação</strong><span>{selectedPatient.name} · Nascimento: {selectedPatient.birth_date || 'não informado'} · Quarto {selectedPatient.room || '—'} · Leito {selectedPatient.bed || '—'}</span><button className="button button-secondary" type="button" onClick={() => { if (!printLaboratoryRequest(selectedPatient, selectedLaboratoryExams, otherExam, observations)) setError('Permita a janela de impressão para gerar o formulário.') }}><Printer size={16} /> Imprimir formulário</button></div>}
        </>}
      </div>
      <PatientAllergyAlert patient={selectedPatient} />
      {section === 'xray' && <p className="work-order-privacy">Registre somente o nome do exame neste campo. Não inclua diagnóstico ou dados clínicos adicionais.</p>}
      <button className="button button-primary" type="submit" disabled={saving || !patients.length || (section === 'laboratory' && selectedLaboratoryExams.length === 0 && !otherExam.trim())}>{saving ? 'Registrando…' : section === 'xray' ? 'Solicitar exame' : 'Registrar exames'} <ArrowRight size={16} /></button>
    </form>
    <section className="patient-list-panel xray-queue-panel">
      <div className="section-heading"><div><p className="eyebrow">PAINEL OPERACIONAL</p><h2>{section === 'xray' ? 'Fila de Raio X' : 'Fila de exames'} <span className="module-total">{visibleRequests.length}</span></h2></div><button className="button button-secondary" type="button" onClick={() => void loadData()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar fila'}</button></div>
      <div className="service-tabs module-tabs" role="tablist" aria-label="Filtrar exames por situação">
        {([
          ['active', 'Ativos'],
          ['all', 'Todos'],
          ...Object.entries(xrayStatuses),
        ] as [typeof filter, string][]).map(([value, label]) => <button className={`button ${filter === value ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={filter === value} key={value} onClick={() => setFilter(value)}>{label}{value === 'active' && <span>{activeCount}</span>}</button>)}
      </div>
      <label className="field xray-search"><span className="field-label">Buscar por paciente, quarto, leito ou exame</span><span className="search-input-wrap"><Search size={17} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Digite para localizar um exame" /></span></label>
      {loading ? <div className="history-empty">Carregando fila de exames…</div> : visibleRequests.length ? <div className="xray-request-list">{visibleRequests.map((request) => <article className="xray-request-card" key={request.id}>
        <div className="xray-request-main"><div><h3>{patientName(request.patient_reference)}</h3><p>{request.exam_label}</p>{request.observations && <small>Observações: {request.observations}</small>}<time>{dateTime(request.created_at)}</time></div><span className={`work-order-status status-${request.status === 'requested' ? 'open' : request.status === 'scheduled' ? 'in_progress' : request.status === 'in_progress' ? 'in_progress' : request.status === 'completed' ? 'completed' : 'cancelled'}`}>{xrayStatuses[request.status]}</span></div>
        {request.result && <div className="xray-result"><strong>Resultado registrado</strong><p>{request.result}</p><small>{request.result_recorded_by}{request.result_recorded_at ? ` · ${dateTime(request.result_recorded_at)}` : ''}</small></div>}
        {canUpdate && <form className="xray-result-form" onSubmit={(event) => { event.preventDefault(); void saveResult(request) }}><label className="field"><span className="field-label">{request.result ? 'Atualizar resultado' : 'Resultado do exame'}</span><textarea required minLength={3} maxLength={4000} rows={3} value={resultDrafts[request.id] ?? ''} onChange={(event) => setResultDrafts((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Registre o laudo/resultado conforme fluxo institucional" /></label><button className="button button-secondary" type="submit" disabled={updating === request.id || (resultDrafts[request.id] ?? '').trim().length < 3}>{updating === request.id ? 'Salvando…' : request.result ? 'Atualizar resultado' : 'Salvar resultado'}</button></form>}
        {canUpdate && <label className="field xray-status-control"><span className="field-label">Atualizar situação</span><select value={request.status} disabled={updating === request.id || request.status === 'completed' || request.status === 'cancelled'} onChange={(event) => void updateStatus(request, event.target.value as XrayStatus)}><option value="requested">Solicitado</option><option value="scheduled">Agendado</option><option value="in_progress">Em execução</option><option value="completed">Concluído</option><option value="cancelled">Cancelado</option></select></label>}
      </article>)}</div> : <div className="history-empty"><Activity size={20} /><span>{requests.length ? 'Nenhum exame corresponde a este filtro.' : 'Nenhuma solicitação de exame foi registrada.'}</span></div>}
    </section>
  </section>
}
