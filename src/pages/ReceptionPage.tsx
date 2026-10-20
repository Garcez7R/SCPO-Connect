import { useEffect, useState } from 'react'
import type { ComponentType, FormEvent } from 'react'
import { ArrowRight, Building2, Search, AlertTriangle, BadgeCheck, Info } from 'lucide-react'
import { readApiResponse } from '../api'
import { formatCpf, formatPhone } from '../inputFormatting'
import AllergyFields from '../components/AllergyFields'
import OutpatientEncounterPage from './OutpatientEncounterPage'
import ReceptionAppointmentsPage from './ReceptionAppointmentsPage'

type Patient = {
  reference: string
  name: string
  room: string
  bed: string
  cpf?: string
  sus_card?: string
  birth_date?: string | null
  phone?: string
  allergies?: string
  allergies_status?: 'unknown' | 'none_known' | 'known'
  active?: boolean
}
type AuthUser = { id: string; permissions: Record<string, string[]> }
type EmergencyArrivalStatus = 'waiting' | 'in_service' | 'completed' | 'cancelled' | 'admitted'
type TreatmentTrack = 'clinical' | 'psychiatric' | 'combined'
type AllergyReportStatus = 'not_asked' | 'reported' | 'denied'
type EmergencyArrival = {
  id: string
  patient_reference: string | null
  patient_name: string
  allergies_status?: Patient['allergies_status']
  allergy_report_status?: AllergyReportStatus
  arrival_mode: 'walk_in' | 'ambulance' | 'other'
  reason: string
  status: EmergencyArrivalStatus
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}
type EmergencyArrivalCounts = Record<EmergencyArrivalStatus, number>
type ReceptionTab = 'emergency' | 'outpatient' | 'appointments' | 'admissions'
type HospitalBed = { id: string; unit_name: string; room: string; label: string; status: string; occupied: boolean }

const emergencyArrivalStatuses: Record<EmergencyArrivalStatus, string> = {
  waiting: 'Aguardando',
  in_service: 'Em atendimento',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  admitted: 'Internado',
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function PatientAllergyAlert({ patient }: { patient: Pick<Patient, 'allergies' | 'allergies_status'> }) {
  if (patient.allergies_status === 'known' && patient.allergies) {
    return <div className="clinical-alert" role="alert"><AlertTriangle size={19} /><div><strong>Alerta cadastral · alergia conhecida</strong><span>{patient.allergies}</span></div></div>
  }
  if (patient.allergies_status === 'none_known') {
    return <div className="clinical-alert clinical-alert-clear" role="status"><BadgeCheck size={19} /><div><strong>Sem alergias conhecidas</strong><span>Informação confirmada no cadastro.</span></div></div>
  }
  return <div className="clinical-alert clinical-alert-unknown" role="status"><Info size={19} /><div><strong>Alergias não verificadas</strong><span>Confirme com a equipe clínica antes de iniciar condutas.</span></div></div>
}

function ReceptionAllergyAlert({ status }: { status?: Patient['allergies_status'] }) {
  if (status === 'known') {
    return <div className="clinical-alert" role="alert"><AlertTriangle size={19} /><div><strong>Alerta de alergia</strong><span>Confirme os detalhes com a equipe clínica antes do atendimento.</span></div></div>
  }
  if (status === 'none_known') {
    return <div className="clinical-alert clinical-alert-clear" role="status"><BadgeCheck size={19} /><div><strong>Sem alergias conhecidas</strong><span>Status confirmado no cadastro.</span></div></div>
  }
  return <div className="clinical-alert clinical-alert-unknown" role="status"><Info size={19} /><div><strong>Alergias não verificadas</strong><span>Encaminhe para confirmação pela equipe clínica.</span></div></div>
}

function ReceptionPage({ user, PatientRegistryPage }: { user: AuthUser; PatientRegistryPage: ComponentType<{ receptionMode?: boolean }> }) {
  const [tab, setTab] = useState<ReceptionTab>('emergency')
  const [patients, setPatients] = useState<Patient[]>([])
  const [beds, setBeds] = useState<HospitalBed[]>([])
  const [arrivals, setArrivals] = useState<EmergencyArrival[]>([])
  const [counts, setCounts] = useState<EmergencyArrivalCounts>({ waiting: 0, in_service: 0, completed: 0, cancelled: 0, admitted: 0 })
  const [patientReference, setPatientReference] = useState('')
  const [patientName, setPatientName] = useState('')
  const [createCentralPatient, setCreateCentralPatient] = useState(false)
  const [emergencyPatient, setEmergencyPatient] = useState({ cpf: '', sus_card: '', birth_date: '', sex: '', phone: '', allergies: '', allergies_status: 'unknown' as NonNullable<Patient['allergies_status']> })
  const [patientSearch, setPatientSearch] = useState('')
  const [arrivalMode, setArrivalMode] = useState<EmergencyArrival['arrival_mode']>('walk_in')
  const [reason, setReason] = useState('')
  const [allergyReportStatus, setAllergyReportStatus] = useState<AllergyReportStatus>('not_asked')
  const [reportedAllergies, setReportedAllergies] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | EmergencyArrivalStatus>('all')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [arrivalFormOpen, setArrivalFormOpen] = useState(false)
  const [updating, setUpdating] = useState('')
  const [admissionDraft, setAdmissionDraft] = useState<Record<string, { bedId: string; treatmentTrack: TreatmentTrack }>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const canCreate = user.permissions.reception?.includes('criar') ?? false
  const canUpdate = user.permissions.reception?.includes('alterar') ?? false

  async function loadArrivals(filter = statusFilter, search = query, pageOffset = 0) {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '25', offset: String(pageOffset) })
      if (filter !== 'all') params.set('status', filter)
      if (search.trim()) params.set('q', search.trim())
      const response = await fetch(`/api/v1/reception/arrivals?${params}`)
      const data = await readApiResponse<{ arrivals?: EmergencyArrival[]; total?: number; status_counts?: Partial<EmergencyArrivalCounts> }>(response)
      setArrivals(data.arrivals ?? [])
      setTotal(data.total ?? 0)
      setCounts({ waiting: 0, in_service: 0, completed: 0, cancelled: 0, admitted: 0, ...data.status_counts })
      setOffset(pageOffset)
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar a fila de emergência.')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    let current = true
    Promise.all([
      fetch('/api/v1/nursing/patients'),
      fetch('/api/v1/reception/arrivals?limit=25&offset=0'),
      fetch('/api/v1/nursing/beds'),
    ]).then(async ([patientResponse, arrivalsResponse, bedResponse]) => {
      const [patientData, arrivalsData, bedData] = await Promise.all([
        readApiResponse<{ patients?: Patient[] }>(patientResponse),
        readApiResponse<{ arrivals?: EmergencyArrival[]; total?: number; status_counts?: Partial<EmergencyArrivalCounts> }>(arrivalsResponse),
        readApiResponse<{ beds?: HospitalBed[] }>(bedResponse),
      ])
      if (!current) return
      setPatients(patientData.patients ?? [])
      setBeds(bedData.beds ?? [])
      setArrivals(arrivalsData.arrivals ?? [])
      setTotal(arrivalsData.total ?? 0)
      setCounts({ waiting: 0, in_service: 0, completed: 0, cancelled: 0, admitted: 0, ...arrivalsData.status_counts })
      setError('')
    }).catch((loadError) => {
      if (current) setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a Recepção.')
    }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [user.id])

  async function createArrival(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/v1/reception/arrivals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_reference: patientReference || null,
          patient_name: patientName.trim(),
          new_patient: createCentralPatient ? { name: patientName.trim(), ...emergencyPatient, birth_date: emergencyPatient.birth_date || null } : null,
          arrival_mode: arrivalMode,
          reason: reason.trim(),
          allergy_report_status: allergyReportStatus,
          reported_allergies: reportedAllergies.trim(),
        }),
      })
      await readApiResponse<EmergencyArrival>(response)
      setPatientReference(''); setPatientName(''); setPatientSearch('')
      setCreateCentralPatient(false)
      setEmergencyPatient({ cpf: '', sus_card: '', birth_date: '', sex: '', phone: '', allergies: '', allergies_status: 'unknown' })
      setArrivalMode('walk_in'); setReason('')
      setAllergyReportStatus('not_asked'); setReportedAllergies('')
      setArrivalFormOpen(false)
      setNotice('Chegada registrada na fila de emergência.')
      await loadArrivals(statusFilter, query, 0)
      if (createCentralPatient) {
        try {
          const patientResponse = await fetch('/api/v1/nursing/patients')
          const patientData = await readApiResponse<{ patients?: Patient[] }>(patientResponse)
          setPatients(patientData.patients ?? [])
        } catch (refreshError) {
          setError(refreshError instanceof Error
            ? `Chegada registrada, mas não foi possível atualizar a lista de pacientes: ${refreshError.message}`
            : 'Chegada registrada, mas não foi possível atualizar a lista de pacientes.')
        }
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao registrar a chegada.')
    } finally { setSaving(false) }
  }

  async function updateArrival(arrival: EmergencyArrival, status: Exclude<EmergencyArrivalStatus, 'admitted'>) {
    setUpdating(arrival.id); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/v1/reception/arrivals/${encodeURIComponent(arrival.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      await readApiResponse<EmergencyArrival>(response)
      setNotice(`Situação atualizada: ${emergencyArrivalStatuses[status]}.`)
      await loadArrivals(statusFilter, query, offset)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Falha ao atualizar o atendimento.')
    } finally { setUpdating('') }
  }

  async function admitArrival(arrival: EmergencyArrival) {
    const draft = admissionDraft[arrival.id]
    const bedId = draft?.bedId
    const bed = beds.find((item) => item.id === bedId && item.status === 'available' && !item.occupied)
    if (!bed) return
    setUpdating(arrival.id); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/v1/reception/arrivals/${encodeURIComponent(arrival.id)}/admission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bed_id: bed.id, treatment_track: draft.treatmentTrack }),
      })
      await readApiResponse(response)
      setNotice(`${arrival.patient_name} foi internado em ${bed.unit_name}, quarto ${bed.room}, leito ${bed.label}.`)
      setAdmissionDraft((current) => { const next = { ...current }; delete next[arrival.id]; return next })
      await loadArrivals(statusFilter, query, offset)
      const patientResponse = await fetch('/api/v1/nursing/patients')
      const [patientData, bedResponse] = await Promise.all([
        readApiResponse<{ patients?: Patient[] }>(patientResponse),
        fetch('/api/v1/nursing/beds').then(readApiResponse<{ beds?: HospitalBed[] }>),
      ])
      setPatients(patientData.patients ?? [])
      setBeds(bedResponse.beds ?? [])
    } catch (admissionError) {
      setError(admissionError instanceof Error ? admissionError.message : 'Não foi possível concluir a internação.')
    } finally { setUpdating('') }
  }

  const selectedPatient = patients.find((patient) => patient.reference === patientReference)
  const filteredPatients = patients.filter((patient) => `${patient.name} ${patient.room} ${patient.bed} ${patient.cpf ?? ''} ${patient.sus_card ?? ''} ${patient.phone ?? ''}`.toLocaleLowerCase('pt-BR').includes(patientSearch.trim().toLocaleLowerCase('pt-BR')))
  const labels = { walk_in: 'Chegada espontânea', ambulance: 'Ambulância', other: 'Outro meio' }

  return <section className="reception-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">MÓDULO · RECEPÇÃO</p><h1>Recepção</h1><p className="welcome-copy">{tab === 'admissions' ? 'Consulte os pacientes e organize admissões e internações.' : tab === 'outpatient' ? 'Registre e consulte fichas de atendimento ambulatorial.' : tab === 'appointments' ? 'Organize consultas, exames e procedimentos em uma agenda compartilhada.' : 'Registre chegadas e acompanhe os atendimentos de emergência.'}</p></div><span className="module-icon"><Building2 size={23} /></span></div>
    <div className="admin-tabs module-tabs reception-primary-tabs" role="tablist" aria-label="Fluxos da Recepção">
      <button className={`button ${tab === 'emergency' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'emergency'} onClick={() => setTab('emergency')}>Emergência <span>{counts.waiting}</span></button>
      <button className={`button ${tab === 'outpatient' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'outpatient'} onClick={() => setTab('outpatient')}>Ficha ambulatorial</button>
      <button className={`button ${tab === 'appointments' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'appointments'} onClick={() => setTab('appointments')}>Agendamentos</button>
      <button className={`button ${tab === 'admissions' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'admissions'} onClick={() => setTab('admissions')}>Admissões e leitos</button>
    </div>
    {tab === 'admissions' ? <div className="reception-admissions-page"><PatientRegistryPage receptionMode /></div> : tab === 'outpatient' ? <OutpatientEncounterPage userId={user.id} canCreate={canCreate} /> : tab === 'appointments' ? <ReceptionAppointmentsPage patients={patients} canCreate={canCreate} canUpdate={canUpdate} /> : <>
      {error && <div className="form-message form-message-error" role="alert">{error}</div>}
      {notice && <div className="form-message form-message-success" role="status">{notice}</div>}
      <div className="hygiene-summary" aria-label="Resumo operacional da emergência"><article><strong>{counts.waiting}</strong><span>Aguardando</span></article><article><strong>{counts.in_service}</strong><span>Em atendimento</span></article><article><strong>{counts.completed}</strong><span>Concluídos</span></article><article><strong>{counts.cancelled}</strong><span>Cancelados</span></article></div>
      <div className="reception-arrival-action"><button className="button button-primary" type="button" aria-expanded={arrivalFormOpen} aria-controls="reception-arrival-form" onClick={() => setArrivalFormOpen((open) => !open)} disabled={!canCreate}>{arrivalFormOpen ? 'Fechar formulário' : 'Registrar chegada'}</button></div>
      {arrivalFormOpen && <form id="reception-arrival-form" className="hygiene-panel" onSubmit={(event) => void createArrival(event)}>
        <div className="section-heading"><div><p className="eyebrow">CHEGADA À EMERGÊNCIA</p><h2>Registrar atendimento</h2></div></div>
        <div className="field-grid field-grid-two">
          {!createCentralPatient && <><label className="field"><span className="field-label">Buscar paciente cadastrado (opcional)</span><input type="search" value={patientSearch} onChange={(event) => { setPatientSearch(event.target.value); setPatientReference('') }} placeholder="Nome, quarto, leito ou identificador" /></label>
          <label className="field"><span className="field-label">Vincular ao cadastro existente</span><select value={patientReference} onChange={(event) => { const reference = event.target.value; const patient = patients.find((item) => item.reference === reference); setPatientReference(reference); setPatientName(patient?.name ?? ''); if (patient) setPatientSearch(`${patient.name} · ${patient.room && patient.bed ? `Qto ${patient.room} · Leito ${patient.bed}` : 'sem acomodação'}`) }}><option value="">Sem vínculo cadastral</option>{filteredPatients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patient.room && patient.bed ? `Qto ${patient.room} · Leito ${patient.bed}` : 'sem acomodação atribuída'}{patient.cpf ? ` · CPF ${patient.cpf}` : ''}</option>)}</select></label>{selectedPatient && <div className="reception-selected-patient"><ReceptionAllergyAlert status={selectedPatient.allergies_status} /><small>Vínculo cadastral selecionado · {selectedPatient.cpf ? `CPF ${selectedPatient.cpf}` : 'CPF não informado'}{selectedPatient.phone ? ` · ${selectedPatient.phone}` : ''}</small></div>}{patientSearch.trim() && !filteredPatients.length && <p className="form-message" role="status">Nenhum cadastro correspondente. Você pode registrar a chegada sem vínculo ou criar um cadastro central.</p>}</>}
          <label className="field"><span className="field-label">{createCentralPatient ? 'Nome completo para novo cadastro' : 'Nome da pessoa atendida'}</span><input required minLength={2} maxLength={120} value={patientName} onChange={(event) => { setPatientName(event.target.value); if (patientReference) setPatientReference('') }} placeholder="Nome informado na recepção" /></label>
          <label className="field emergency-patient-toggle"><span className="field-label">Cadastro compartilhado</span><span><input type="checkbox" checked={createCentralPatient} onChange={(event) => { setCreateCentralPatient(event.target.checked); if (event.target.checked) setPatientName(''); setPatientReference(''); setPatientSearch(''); setEmergencyPatient({ cpf: '', sus_card: '', birth_date: '', sex: '', phone: '', allergies: '', allergies_status: 'unknown' }) }} /> Criar também o cadastro central sem quarto ou leito</span></label>
          {createCentralPatient && <>
            <label className="field"><span className="field-label">CPF (opcional)</span><input inputMode="numeric" maxLength={14} value={formatCpf(emergencyPatient.cpf)} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, cpf: formatCpf(event.target.value) })} placeholder="000.000.000-00" /></label>
            <label className="field"><span className="field-label">Cartão Nacional de Saúde (opcional)</span><input inputMode="numeric" maxLength={20} value={emergencyPatient.sus_card} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, sus_card: event.target.value.replace(/\D/g, '').slice(0, 20) })} /></label>
            <label className="field"><span className="field-label">Data de nascimento</span><input type="date" value={emergencyPatient.birth_date} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, birth_date: event.target.value })} /></label>
            <label className="field"><span className="field-label">Sexo (opcional)</span><select value={emergencyPatient.sex} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, sex: event.target.value })}><option value="">Não informado</option><option>Feminino</option><option>Masculino</option><option>Outro</option><option>Não informado</option></select></label>
            <label className="field"><span className="field-label">Telefone (opcional)</span><input inputMode="tel" maxLength={20} autoComplete="tel" value={formatPhone(emergencyPatient.phone)} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, phone: formatPhone(event.target.value) })} /></label>
            <AllergyFields status={emergencyPatient.allergies_status} allergies={emergencyPatient.allergies} onChange={(allergies_status, allergies) => setEmergencyPatient((current) => ({ ...current, allergies_status, allergies }))} />
            <PatientAllergyAlert patient={emergencyPatient} />
          </>}
          <label className="field"><span className="field-label">Meio de chegada</span><select value={arrivalMode} onChange={(event) => setArrivalMode(event.target.value as EmergencyArrival['arrival_mode'])}><option value="walk_in">Chegada espontânea</option><option value="ambulance">Ambulância</option><option value="other">Outro meio</option></select></label>
          <label className="field"><span className="field-label">Relato de alergia pelo paciente/acompanhante</span><select value={allergyReportStatus} onChange={(event) => { const status = event.target.value as AllergyReportStatus; setAllergyReportStatus(status); if (status !== 'reported') setReportedAllergies('') }}><option value="not_asked">Não perguntado</option><option value="denied">Negado pelo paciente/acompanhante</option><option value="reported">Alergia relatada (aguarda confirmação clínica)</option></select></label>
          {allergyReportStatus === 'reported' && <label className="field"><span className="field-label">Alergia relatada (não confirmada)</span><textarea required minLength={2} maxLength={500} value={reportedAllergies} onChange={(event) => setReportedAllergies(event.target.value)} placeholder="Registre o relato sem alterar o cadastro clínico confirmado" /></label>}
          <label className="field reception-reason-field"><span className="field-label">Motivo informado para a procura</span><textarea required minLength={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Registre a informação necessária para identificar a chegada" /></label>
        </div>
        <p className="work-order-privacy">A recepção registra a chegada e a situação operacional. Esta tela não atribui prioridade clínica nem substitui o protocolo institucional de classificação de risco.</p>
        <button className="button button-primary" type="submit" disabled={!canCreate || saving}>{saving ? 'Registrando…' : 'Registrar chegada'} <ArrowRight size={16} /></button>
      </form>}
      <section className="patient-list-panel reception-queue-panel">
        <div className="section-heading"><div><p className="eyebrow">PAINEL OPERACIONAL</p><h2>Fila de emergência <span className="module-total">{total}</span></h2></div><button className="button button-secondary" type="button" onClick={() => void loadArrivals(statusFilter, query, offset)} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar fila'}</button></div>
        <div className="service-tabs module-tabs" role="tablist" aria-label="Filtrar chegadas por situação">
          {([['all', 'Todas', total], ...Object.entries(emergencyArrivalStatuses).map(([value, label]) => [value, label, counts[value as EmergencyArrivalStatus]] as [EmergencyArrivalStatus, string, number])] as ['all' | EmergencyArrivalStatus, string, number][]).map(([value, label, count]) => <button className={`button ${statusFilter === value ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={statusFilter === value} key={value} onClick={() => { setStatusFilter(value); void loadArrivals(value, query, 0) }}>{label}<span>{count}</span></button>)}
        </div>
        <form className="reception-search" onSubmit={(event) => { event.preventDefault(); void loadArrivals(statusFilter, query, 0) }}><label className="field"><span className="field-label">Buscar por nome ou motivo informado</span><span className="search-input-wrap"><Search size={17} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Digite para localizar uma chegada" /></span></label><button className="button button-primary" type="submit" disabled={loading}><Search size={15} /> Buscar</button></form>
        {loading ? <div className="history-empty">Carregando fila de emergência…</div> : arrivals.length ? <div className="reception-arrival-list">{arrivals.map((arrival) => <article className="reception-arrival-card" key={arrival.id}>
          <div className="reception-arrival-heading"><div><h3>{arrival.patient_name}</h3><p>{arrival.reason}</p></div><span className={`work-order-status status-${arrival.status === 'waiting' ? 'open' : arrival.status === 'in_service' ? 'in_progress' : arrival.status}`}>{emergencyArrivalStatuses[arrival.status]}</span></div>
          <ReceptionAllergyAlert status={arrival.allergies_status} />
          {arrival.allergy_report_status === 'reported' && <p className="field-hint">Alergia relatada na chegada · confirme com a equipe clínica.</p>}
          <div className="reception-arrival-meta"><span><strong>Chegada</strong>{labels[arrival.arrival_mode]}</span><span><strong>Registrada em</strong>{dateTime(arrival.created_at)}</span><span><strong>Recepcionista</strong>{arrival.created_by}</span><span><strong>Última atualização</strong>{arrival.updated_by} · {dateTime(arrival.updated_at)}</span></div>
          {canUpdate && arrival.status !== 'completed' && arrival.status !== 'cancelled' && arrival.status !== 'admitted' && <label className="field reception-status-control"><span className="field-label">Situação operacional</span><select value={arrival.status} disabled={updating === arrival.id} onChange={(event) => void updateArrival(arrival, event.target.value as Exclude<EmergencyArrivalStatus, 'admitted'>)}><option value="waiting">Aguardando</option><option value="in_service">Em atendimento</option><option value="completed">Concluído</option><option value="cancelled">Cancelado</option></select></label>}
          {canUpdate && arrival.patient_reference && ['waiting', 'in_service'].includes(arrival.status) && <form className="reception-admission-form" onSubmit={(event) => { event.preventDefault(); void admitArrival(arrival) }}>
            <label className="field"><span className="field-label">Perfil de cuidado da internação</span><select required value={admissionDraft[arrival.id]?.treatmentTrack ?? ''} onChange={(event) => setAdmissionDraft((current) => ({ ...current, [arrival.id]: { bedId: current[arrival.id]?.bedId ?? '', treatmentTrack: event.target.value as TreatmentTrack } }))}><option value="">Selecione o perfil de cuidado</option><option value="clinical">Tratamento clínico</option><option value="psychiatric">Tratamento psiquiátrico</option><option value="combined">Cuidado clínico e psiquiátrico</option></select><span className="field-hint">Classifica o fluxo assistencial; não representa diagnóstico.</span></label>
            <label className="field"><span className="field-label">Leito físico disponível</span><select required value={admissionDraft[arrival.id]?.bedId ?? ''} onChange={(event) => setAdmissionDraft((current) => ({ ...current, [arrival.id]: { bedId: event.target.value, treatmentTrack: current[arrival.id]?.treatmentTrack ?? 'clinical' } }))}><option value="">Selecione unidade, quarto e leito</option>{beds.filter((bed) => bed.status === 'available' && !bed.occupied).map((bed) => <option key={bed.id} value={bed.id}>{bed.unit_name} · Quarto {bed.room} · Leito {bed.label}</option>)}</select>{!beds.some((bed) => bed.status === 'available' && !bed.occupied) && <span className="field-hint">Não há leitos físicos liberados. Cadastre ou libere um leito em Gestão Hospitalar.</span>}</label>
            <button className="button button-secondary" type="submit" disabled={updating === arrival.id || !admissionDraft[arrival.id]?.bedId || !admissionDraft[arrival.id]?.treatmentTrack || !beds.some((bed) => bed.id === admissionDraft[arrival.id]?.bedId && bed.status === 'available' && !bed.occupied)}>{updating === arrival.id ? 'Internando…' : 'Converter em internação'}</button>
          </form>}
        </article>)}</div> : <div className="history-empty">Nenhuma chegada corresponde aos filtros selecionados.</div>}
        <div className="pharmacy-ledger-pagination"><span>{total ? `${offset + 1}–${Math.min(offset + arrivals.length, total)} de ${total}` : '0 registros'}</span><div><button className="button button-secondary" type="button" disabled={loading || offset === 0} onClick={() => void loadArrivals(statusFilter, query, Math.max(0, offset - 25))}>Anterior</button><button className="button button-secondary" type="button" disabled={loading || offset + arrivals.length >= total} onClick={() => void loadArrivals(statusFilter, query, offset + 25)}>Próxima</button></div></div>
      </section>
    </>}
  </section>
}


export default ReceptionPage
