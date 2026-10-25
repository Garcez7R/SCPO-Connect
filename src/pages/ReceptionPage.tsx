import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentType, FormEvent } from 'react'
import { AlertTriangle, ArrowRight, BadgeCheck, ContactRound, Info, Search } from 'lucide-react'
import { readApiResponse } from '../api'
import PatientSelect from '../components/PatientSelect'
import { formatCpf, formatPhone, formatPostalCode } from '../inputFormatting'
import AllergyFields from '../components/AllergyFields'
import OutpatientEncounterPage from './OutpatientEncounterPage'
import ReceptionAppointmentsPage from './ReceptionAppointmentsPage'
import { usePersistentTab } from '../components/PageNavigationContext'
import ToastMessage from '../components/ToastMessage'

type Patient = {
  reference: string
  name: string
  room: string
  bed: string
  cpf?: string
  sus_card?: string
  same_number?: string
  mother_name?: string
  health_plan?: string
  birth_date?: string | null
  phone?: string
  email?: string
  address?: string
  address_number?: string
  address_complement?: string
  neighborhood?: string
  city?: string
  state?: string
  postal_code?: string
  responsible_name?: string
  responsible_status?: 'unknown' | 'not_applicable' | 'provided'
  responsible_relationship?: string
  responsible_phone?: string
  allergies?: string
  allergies_status?: 'unknown' | 'none_known' | 'known'
  active?: boolean
}
type AuthUser = { id: string; permissions: Record<string, string[]> }
type EmergencyArrivalStatus = 'waiting' | 'called' | 'in_service' | 'completed' | 'cancelled' | 'admitted'
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
  clinical_priority: 'unassigned' | 'routine' | 'priority' | 'urgent'
  queue_type?: 'common' | 'priority'
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}
type EmergencyArrivalCounts = Record<EmergencyArrivalStatus, number>
type ReceptionTab = 'emergency' | 'outpatient' | 'appointments' | 'admissions' | 'calls'
type HospitalBed = { id: string; unit_name: string; room: string; label: string; status: string; occupied: boolean }
const receptionTabs: ReceptionTab[] = ['emergency', 'outpatient', 'appointments', 'admissions', 'calls']
const receptionTabLabels: Record<ReceptionTab, string> = {
  emergency: 'Pronto atendimento',
  outpatient: 'Atendimento ambulatorial',
  appointments: 'Agendamentos',
  admissions: 'Internações',
  calls: 'Chamadas',
}

const emergencyArrivalStatuses: Record<EmergencyArrivalStatus, string> = {
  waiting: 'Aguardando',
  called: 'Chamado',
  in_service: 'Em atendimento',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  admitted: 'Internado',
}

const emptyEmergencyPatient = () => ({
  cpf: '',
  sus_card: '',
  same_number: '',
  mother_name: '',
  health_plan: '',
  birth_date: '',
  sex: '',
  phone: '',
  email: '',
  address: '',
  address_number: '',
  address_complement: '',
  neighborhood: '',
  city: '',
  state: '',
  postal_code: '',
  responsible_name: '',
  responsible_status: 'unknown' as 'unknown' | 'not_applicable' | 'provided',
  responsible_relationship: '',
  responsible_phone: '',
  responsible_address: '',
  responsible_address_number: '',
  responsible_address_complement: '',
  responsible_neighborhood: '',
  responsible_city: '',
  responsible_state: '',
  responsible_postal_code: '',
  allergies: '',
  allergies_status: 'unknown' as NonNullable<Patient['allergies_status']>,
})

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
  const [tab, setTab] = usePersistentTab(`scpo-tab-reception-${user.id}`, 'emergency', receptionTabs, receptionTabLabels)
  const [patients, setPatients] = useState<Patient[]>([])
  const [beds, setBeds] = useState<HospitalBed[]>([])
  const [arrivals, setArrivals] = useState<EmergencyArrival[]>([])
  const [counts, setCounts] = useState<EmergencyArrivalCounts>({ waiting: 0, called: 0, in_service: 0, completed: 0, cancelled: 0, admitted: 0 })
  const [patientReference, setPatientReference] = useState('')
  const [patientName, setPatientName] = useState('')
  const [createCentralPatient, setCreateCentralPatient] = useState(false)
  const [emergencyPatient, setEmergencyPatient] = useState(emptyEmergencyPatient)
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
      setCounts({ waiting: 0, called: 0, in_service: 0, completed: 0, cancelled: 0, admitted: 0, ...data.status_counts })
      setOffset(pageOffset)
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar a fila do pronto atendimento.')
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
      setCounts({ waiting: 0, called: 0, in_service: 0, completed: 0, cancelled: 0, admitted: 0, ...arrivalsData.status_counts })
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
          new_patient: createCentralPatient ? {
            name: patientName.trim(),
            ...emergencyPatient,
            birth_date: emergencyPatient.birth_date || null,
            state: emergencyPatient.state.trim().toUpperCase(),
            postal_code: emergencyPatient.postal_code.replace(/\D/g, ''),
          } : null,
          arrival_mode: arrivalMode,
          reason: reason.trim(),
          allergy_report_status: allergyReportStatus,
          reported_allergies: reportedAllergies.trim(),
        }),
      })
      const arrival = await readApiResponse<EmergencyArrival>(response)
      setPatientReference(''); setPatientName('')
      setCreateCentralPatient(false)
      setEmergencyPatient(emptyEmergencyPatient())
      setArrivalMode('walk_in'); setReason('')
      setAllergyReportStatus('not_asked'); setReportedAllergies('')
      setArrivalFormOpen(false)
      setNotice(`Chegada registrada na fila do pronto atendimento para ${arrival.patient_name}.`)
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
  const labels = { walk_in: 'Chegada espontânea', ambulance: 'Ambulância', other: 'Outro meio' }

  return <section className="reception-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">MÓDULO · RECEPÇÃO</p><h1>Recepção</h1><p className="welcome-copy">{tab === 'admissions' ? 'Consulte os pacientes e organize admissões e internações.' : tab === 'outpatient' ? 'Registre e consulte fichas de atendimento ambulatorial.' : tab === 'appointments' ? 'Organize consultas, exames e procedimentos em uma agenda compartilhada.' : tab === 'calls' ? 'Chame pacientes na sala de espera com painel visual e anúncio por voz opcional.' : 'Registre chegadas e acompanhe a fila do pronto atendimento.'}</p></div><span className="module-icon module-icon-reception"><ContactRound size={23} /></span></div>
    <div className="admin-tabs module-tabs reception-primary-tabs" role="tablist" aria-label="Fluxos da Recepção">
      <button className={`button ${tab === 'emergency' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'emergency'} onClick={() => setTab('emergency')}>Pronto atendimento <span>{counts.waiting}</span></button>
      <button className={`button ${tab === 'outpatient' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'outpatient'} onClick={() => setTab('outpatient')}>Ficha ambulatorial</button>
      <button className={`button ${tab === 'appointments' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'appointments'} onClick={() => setTab('appointments')}>Agendamentos</button>
      <button className={`button ${tab === 'calls' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'calls'} onClick={() => setTab('calls')}><span>Painel de chamadas</span><span>{counts.waiting + counts.called}</span></button>
      <button className={`button ${tab === 'admissions' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'admissions'} onClick={() => setTab('admissions')}>Admissões e leitos</button>
    </div>
    {tab === 'admissions' ? <div className="reception-admissions-page"><PatientRegistryPage receptionMode /></div> : tab === 'outpatient' ? <OutpatientEncounterPage userId={user.id} canCreate={canCreate} onArrivalQueued={() => void loadArrivals('all', '', 0)} /> : tab === 'appointments' ? <ReceptionAppointmentsPage patients={patients} canCreate={canCreate} canUpdate={canUpdate} /> : tab === 'calls' ? <WaitingRoomCallBoard canUpdate={canUpdate} /> : <>
      {error && <ToastMessage variant="error">{error}</ToastMessage>}
      {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
      <div className="hygiene-summary" aria-label="Resumo operacional do pronto atendimento"><article><strong>{counts.waiting}</strong><span>Aguardando</span></article><article><strong>{counts.in_service}</strong><span>Em atendimento</span></article><article><strong>{counts.completed}</strong><span>Concluídos</span></article><article><strong>{counts.cancelled}</strong><span>Cancelados</span></article></div>
      <div className="reception-arrival-action"><button className="button button-primary" type="button" aria-expanded={arrivalFormOpen} aria-controls="reception-arrival-form" onClick={() => setArrivalFormOpen((open) => !open)} disabled={!canCreate}>{arrivalFormOpen ? 'Fechar formulário' : 'Registrar chegada'}</button></div>
      {arrivalFormOpen && <form id="reception-arrival-form" className="hygiene-panel" onSubmit={(event) => void createArrival(event)}>
        <div className="section-heading"><div><p className="eyebrow">CHEGADA À EMERGÊNCIA</p><h2>Registrar atendimento</h2></div></div>
        <div className="field-grid field-grid-two">
          {!createCentralPatient && <><PatientSelect label="Vincular ao cadastro existente (opcional)" patients={patients} value={patientReference} onChange={(reference) => { const patient = patients.find((item) => item.reference === reference); setPatientReference(reference); setPatientName(patient?.name ?? '') }} emptyLabel="Sem vínculo cadastral" placeholder="Nome, quarto, leito, CPF, CNS ou telefone" optionLabel={(patient) => `${patient.name} · ${patient.room && patient.bed ? `Qto ${patient.room} · Leito ${patient.bed}` : 'sem acomodação atribuída'}${patient.cpf ? ` · CPF ${patient.cpf}` : ''}`} />{selectedPatient && <div className="reception-selected-patient"><ReceptionAllergyAlert status={selectedPatient.allergies_status} /><small>Vínculo cadastral selecionado · {selectedPatient.cpf ? `CPF ${selectedPatient.cpf}` : 'CPF não informado'}{selectedPatient.phone ? ` · ${selectedPatient.phone}` : ''}</small></div>}</>}
          <label className="field"><span className="field-label">{createCentralPatient ? 'Nome completo para novo cadastro' : 'Nome da pessoa atendida'}</span><input required minLength={2} maxLength={120} value={patientName} onChange={(event) => { setPatientName(event.target.value); if (patientReference) setPatientReference('') }} placeholder="Nome informado na recepção" /></label>
          <label className="field emergency-patient-toggle"><span className="field-label">Cadastro compartilhado</span><span><input type="checkbox" checked={createCentralPatient} onChange={(event) => { setCreateCentralPatient(event.target.checked); if (event.target.checked) setPatientName(''); setPatientReference(''); setEmergencyPatient(emptyEmergencyPatient()) }} /> Criar também o cadastro central sem quarto ou leito</span></label>
          {createCentralPatient && <>
            <label className="field"><span className="field-label">CPF (opcional)</span><input inputMode="numeric" maxLength={14} value={formatCpf(emergencyPatient.cpf)} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, cpf: formatCpf(event.target.value) })} placeholder="000.000.000-00" /></label>
            <label className="field"><span className="field-label">Cartão Nacional de Saúde (opcional)</span><input inputMode="numeric" maxLength={20} value={emergencyPatient.sus_card} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, sus_card: event.target.value.replace(/\D/g, '').slice(0, 20) })} /></label>
            <label className="field"><span className="field-label">Nº SAME / prontuário</span><input maxLength={40} value={emergencyPatient.same_number} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, same_number: event.target.value })} /></label>
            <label className="field"><span className="field-label">Nome da mãe</span><input maxLength={120} value={emergencyPatient.mother_name} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, mother_name: event.target.value })} /></label>
            <label className="field"><span className="field-label">Data de nascimento</span><input type="date" value={emergencyPatient.birth_date} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, birth_date: event.target.value })} /></label>
            <label className="field"><span className="field-label">Sexo (opcional)</span><select value={emergencyPatient.sex} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, sex: event.target.value })}><option value="">Não informado</option><option>Feminino</option><option>Masculino</option><option>Outro</option><option>Não informado</option></select></label>
            <label className="field"><span className="field-label">Telefone (opcional)</span><input inputMode="tel" maxLength={20} autoComplete="tel" value={formatPhone(emergencyPatient.phone)} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, phone: formatPhone(event.target.value) })} /></label>
            <label className="field"><span className="field-label">E-mail (opcional)</span><input type="email" maxLength={160} autoComplete="email" value={emergencyPatient.email} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, email: event.target.value })} /></label>
            <label className="field"><span className="field-label">Convênio</span><input maxLength={120} value={emergencyPatient.health_plan} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, health_plan: event.target.value })} placeholder="SUS ou convênio cadastrado" /></label>
            <label className="field"><span className="field-label">Rua / endereço</span><input maxLength={180} value={emergencyPatient.address} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, address: event.target.value })} /></label>
            <label className="field"><span className="field-label">Número</span><input maxLength={24} value={emergencyPatient.address_number} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, address_number: event.target.value })} /></label>
            <label className="field"><span className="field-label">Complemento</span><input maxLength={100} value={emergencyPatient.address_complement} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, address_complement: event.target.value })} /></label>
            <label className="field"><span className="field-label">Bairro</span><input maxLength={100} value={emergencyPatient.neighborhood} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, neighborhood: event.target.value })} /></label>
            <label className="field"><span className="field-label">Município</span><input maxLength={100} value={emergencyPatient.city} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, city: event.target.value })} /></label>
            <label className="field"><span className="field-label">UF</span><input maxLength={2} value={emergencyPatient.state} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, state: event.target.value.toUpperCase() })} /></label>
            <label className="field"><span className="field-label">CEP</span><input inputMode="numeric" maxLength={9} value={formatPostalCode(emergencyPatient.postal_code)} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, postal_code: formatPostalCode(event.target.value) })} /></label>
            <label className="field"><span className="field-label">Situação do responsável</span><select value={emergencyPatient.responsible_status} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, responsible_status: event.target.value as typeof emergencyPatient.responsible_status })}><option value="unknown">Não informado</option><option value="not_applicable">Não se aplica</option><option value="provided">Informado</option></select></label>
            {emergencyPatient.responsible_status === 'provided' && <>
              <label className="field"><span className="field-label">Nome do responsável</span><input required maxLength={120} value={emergencyPatient.responsible_name} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, responsible_name: event.target.value })} /></label>
              <label className="field"><span className="field-label">Vínculo com o paciente</span><input maxLength={60} value={emergencyPatient.responsible_relationship} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, responsible_relationship: event.target.value })} /></label>
              <label className="field"><span className="field-label">Telefone do responsável</span><input inputMode="tel" maxLength={20} value={formatPhone(emergencyPatient.responsible_phone)} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, responsible_phone: formatPhone(event.target.value) })} /></label>
              <label className="field"><span className="field-label">Endereço do responsável</span><input maxLength={180} value={emergencyPatient.responsible_address} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, responsible_address: event.target.value })} /></label>
              <label className="field"><span className="field-label">Número</span><input maxLength={24} value={emergencyPatient.responsible_address_number} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, responsible_address_number: event.target.value })} /></label>
              <label className="field"><span className="field-label">Complemento</span><input maxLength={100} value={emergencyPatient.responsible_address_complement} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, responsible_address_complement: event.target.value })} /></label>
              <label className="field"><span className="field-label">Bairro</span><input maxLength={100} value={emergencyPatient.responsible_neighborhood} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, responsible_neighborhood: event.target.value })} /></label>
              <label className="field"><span className="field-label">Município</span><input maxLength={100} value={emergencyPatient.responsible_city} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, responsible_city: event.target.value })} /></label>
              <label className="field"><span className="field-label">UF</span><input maxLength={2} value={emergencyPatient.responsible_state} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, responsible_state: event.target.value.toUpperCase() })} /></label>
              <label className="field"><span className="field-label">CEP</span><input inputMode="numeric" maxLength={9} value={formatPostalCode(emergencyPatient.responsible_postal_code)} onChange={(event) => setEmergencyPatient({ ...emergencyPatient, responsible_postal_code: formatPostalCode(event.target.value) })} /></label>
            </>}
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
        <div className="section-heading"><div><p className="eyebrow">PAINEL OPERACIONAL</p><h2>Fila do pronto atendimento <span className="module-total">{total}</span></h2></div><button className="button button-secondary" type="button" onClick={() => void loadArrivals(statusFilter, query, offset)} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar fila'}</button></div>
        <div className="service-tabs module-tabs" role="tablist" aria-label="Filtrar chegadas por situação">
          {([['all', 'Todas', total], ...Object.entries(emergencyArrivalStatuses).map(([value, label]) => [value, label, counts[value as EmergencyArrivalStatus]] as [EmergencyArrivalStatus, string, number])] as ['all' | EmergencyArrivalStatus, string, number][]).map(([value, label, count]) => <button className={`button ${statusFilter === value ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={statusFilter === value} key={value} onClick={() => { setStatusFilter(value); void loadArrivals(value, query, 0) }}>{label}<span>{count}</span></button>)}
        </div>
        <form className="reception-search" onSubmit={(event) => { event.preventDefault(); void loadArrivals(statusFilter, query, 0) }}><label className="field"><span className="field-label">Buscar por nome ou motivo informado</span><span className="search-input-wrap"><Search size={17} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Digite para localizar uma chegada" /></span></label><button className="button button-primary" type="submit" disabled={loading}><Search size={15} /> Buscar</button></form>
        {loading ? <div className="history-empty">Carregando fila do pronto atendimento…</div> : arrivals.length ? <div className="reception-arrival-list">{arrivals.map((arrival) => <details className="reception-arrival-details" key={arrival.id}>
            <summary className="reception-arrival-summary"><strong>{arrival.patient_name}</strong><span className={`work-order-status status-${arrival.status === 'waiting' ? 'open' : arrival.status === 'in_service' ? 'in_progress' : arrival.status}`}>{emergencyArrivalStatuses[arrival.status]}</span></summary>
            <div className="reception-arrival-card">
              <p>{arrival.reason}</p>
              <ReceptionAllergyAlert status={arrival.allergies_status} />
              {arrival.allergy_report_status === 'reported' && <p className="field-hint">Alergia relatada na chegada · confirme com a equipe clínica.</p>}
              <div className="reception-arrival-meta"><span><strong>Chegada</strong>{labels[arrival.arrival_mode]}</span><span><strong>Registrada em</strong>{dateTime(arrival.created_at)}</span><span><strong>Recepcionista</strong>{arrival.created_by}</span><span><strong>Última atualização</strong>{arrival.updated_by} · {dateTime(arrival.updated_at)}</span></div>
              {canUpdate && arrival.status !== 'completed' && arrival.status !== 'cancelled' && arrival.status !== 'admitted' && <label className="field reception-status-control"><span className="field-label">Situação operacional</span><select value={arrival.status} disabled={updating === arrival.id} onChange={(event) => void updateArrival(arrival, event.target.value as Exclude<EmergencyArrivalStatus, 'admitted'>)}><option value="waiting">Aguardando</option><option value="called">Chamado</option><option value="in_service">Em atendimento</option><option value="completed">Concluído</option><option value="cancelled">Cancelado</option></select></label>}
              {canUpdate && arrival.patient_reference && ['waiting', 'called', 'in_service'].includes(arrival.status) && <form className="reception-admission-form" onSubmit={(event) => { event.preventDefault(); void admitArrival(arrival) }}>
                <label className="field"><span className="field-label">Perfil de cuidado da internação</span><select required value={admissionDraft[arrival.id]?.treatmentTrack ?? ''} onChange={(event) => setAdmissionDraft((current) => ({ ...current, [arrival.id]: { bedId: current[arrival.id]?.bedId ?? '', treatmentTrack: event.target.value as TreatmentTrack } }))}><option value="">Selecione o perfil de cuidado</option><option value="clinical">Tratamento clínico</option><option value="psychiatric">Tratamento psiquiátrico</option><option value="combined">Cuidado clínico e psiquiátrico</option></select><span className="field-hint">Classifica o fluxo assistencial; não representa diagnóstico.</span></label>
                <label className="field"><span className="field-label">Leito físico disponível</span><select required value={admissionDraft[arrival.id]?.bedId ?? ''} onChange={(event) => setAdmissionDraft((current) => ({ ...current, [arrival.id]: { bedId: event.target.value, treatmentTrack: current[arrival.id]?.treatmentTrack ?? 'clinical' } }))}><option value="">Selecione unidade, quarto e leito</option>{beds.filter((bed) => bed.status === 'available' && !bed.occupied).map((bed) => <option key={bed.id} value={bed.id}>{bed.unit_name} · Quarto {bed.room} · Leito {bed.label}</option>)}</select>{!beds.some((bed) => bed.status === 'available' && !bed.occupied) && <span className="field-hint">Não há leitos físicos liberados. Cadastre ou libere um leito em Gestão Hospitalar.</span>}</label>
                <button className="button button-secondary" type="submit" disabled={updating === arrival.id || !admissionDraft[arrival.id]?.bedId || !admissionDraft[arrival.id]?.treatmentTrack || !beds.some((bed) => bed.id === admissionDraft[arrival.id]?.bedId && bed.status === 'available' && !bed.occupied)}>{updating === arrival.id ? 'Internando…' : 'Converter em internação'}</button>
              </form>}
            </div>
          </details>)}</div> : <div className="history-empty">Nenhuma chegada corresponde aos filtros selecionados.</div>}
        <div className="pharmacy-ledger-pagination"><span>{total ? `${offset + 1}–${Math.min(offset + arrivals.length, total)} de ${total}` : '0 registros'}</span><div><button className="button button-secondary" type="button" disabled={loading || offset === 0} onClick={() => void loadArrivals(statusFilter, query, Math.max(0, offset - 25))}>Anterior</button><button className="button button-secondary" type="button" disabled={loading || offset + arrivals.length >= total} onClick={() => void loadArrivals(statusFilter, query, offset + 25)}>Próxima</button></div></div>
      </section>
    </>}
  </section>
}

type WaitingRoomItem = {
  id: string
  patient_name: string
  first_name?: string
  status: 'waiting' | 'called' | 'in_service' | 'other'
  type: 'appointment' | 'arrival'
  arrived_at: string
  updated_at?: string
  code: string
  clinical_priority: EmergencyArrival['clinical_priority']
  queue_type: 'common' | 'priority'
}

const priorityOrder: Record<EmergencyArrival['clinical_priority'], number> = {
  urgent: 0,
  priority: 1,
  routine: 2,
  unassigned: 3,
}

function WaitingRoomCallBoard({ canUpdate, kioskMode = false }: { canUpdate: boolean; kioskMode?: boolean }) {
  const [items, setItems] = useState<WaitingRoomItem[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState('')
  const [kioskAlertsEnabled, setKioskAlertsEnabled] = useState(false)
  const [clock, setClock] = useState(() => new Date())
  const [normalBeforePriority, setNormalBeforePriority] = useState(3)
  const [normalCallsSincePriority, setNormalCallsSincePriority] = useState(0)
  const [savingCadence, setSavingCadence] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const previousCalledRef = useRef<Set<string> | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const kioskAlertsEnabledRef = useRef(false)

  const loadQueue = useCallback(async () => {
    try {
      if (kioskMode) {
        const response = await fetch('/api/v1/reception/public/queue', { cache: 'no-store' })
        const data = await readApiResponse<{ items?: WaitingRoomItem[] }>(response)
        const publicItems = data.items ?? []
        const calledNow = new Set(publicItems.filter((item) => item.status === 'called' || item.status === 'in_service').map((item) => `${item.type}-${item.id}`))
        const previousCalled = previousCalledRef.current
        if (previousCalled && kioskAlertsEnabledRef.current) {
          const newCalls = publicItems.filter((item) =>
            (item.status === 'called' || item.status === 'in_service')
            && !previousCalled.has(`${item.type}-${item.id}`),
          )
          if (newCalls.length) {
            playKioskAlert()
            newCalls.forEach((item, index) => {
              window.setTimeout(() => announce(item), 500 + index * 2500)
            })
          }
        }
        previousCalledRef.current = calledNow
        setItems(publicItems.map((item) => ({
          ...item,
          patient_name: item.first_name ?? '',
          clinical_priority: item.queue_type === 'priority' ? 'priority' : 'routine',
        })))
        setError('')
        return
      }
      const today = new Date()
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
      const params = new URLSearchParams({ from_at: start.toISOString(), to_at: end.toISOString() })
      const [appointmentsResponse, arrivalsResponse] = await Promise.all([
        fetch(`/api/v1/reception/appointments?${params}&limit=100&offset=0`),
        fetch(`/api/v1/reception/arrivals?limit=100&offset=0&${params}`),
      ])
      const [appointmentData, arrivalData] = await Promise.all([
        readApiResponse<{ appointments?: Array<{ id: number; patient_name: string; starts_at: string; arrived_at?: string | null; status: string }>; total?: number }>(appointmentsResponse),
        readApiResponse<{ arrivals?: Array<{ id: string; patient_name: string; created_at: string; status: string; clinical_priority: EmergencyArrival['clinical_priority']; queue_type?: 'common' | 'priority' }>; total?: number }>(arrivalsResponse),
      ])
      const allAppointments = [...(appointmentData.appointments ?? [])]
      const appointmentsTotal = appointmentData.total ?? allAppointments.length
      while (allAppointments.length < appointmentsTotal) {
        const nextParams = new URLSearchParams(params)
        nextParams.set('limit', '100')
        nextParams.set('offset', String(allAppointments.length))
        const nextResponse = await fetch(`/api/v1/reception/appointments?${nextParams}`)
        const nextPage = await readApiResponse<{ appointments?: Array<{ id: number; patient_name: string; starts_at: string; arrived_at?: string | null; status: string }> }>(nextResponse)
        const nextAppointments = nextPage.appointments ?? []
        if (!nextAppointments.length) break
        allAppointments.push(...nextAppointments)
      }
      const allArrivals = [...(arrivalData.arrivals ?? [])]
      const arrivalsTotal = arrivalData.total ?? allArrivals.length
      while (allArrivals.length < arrivalsTotal) {
        const nextParams = new URLSearchParams(params)
        nextParams.set('limit', '100')
        nextParams.set('offset', String(allArrivals.length))
        const nextResponse = await fetch(`/api/v1/reception/arrivals?${nextParams}`)
        const nextPage = await readApiResponse<{ arrivals?: Array<{ id: string; patient_name: string; created_at: string; status: string; clinical_priority: EmergencyArrival['clinical_priority'] }> }>(nextResponse)
        const nextArrivals = nextPage.arrivals ?? []
        if (!nextArrivals.length) break
        allArrivals.push(...nextArrivals)
      }
      const appointments = allAppointments
        .filter((item) =>
          ['arrived', 'called', 'completed'].includes(item.status)
          && Boolean(item.arrived_at),
        )
        .map((item): WaitingRoomItem => ({
          id: String(item.id),
          patient_name: item.patient_name,
          arrived_at: item.arrived_at ?? item.starts_at,
          status: item.status === 'called' ? 'called' : item.status === 'arrived' ? 'waiting' : 'other',
          type: 'appointment',
          code: '',
          clinical_priority: 'routine',
          queue_type: 'common',
        }))
      const arrivals = allArrivals
        .filter((item) => {
          const arrivalTime = new Date(item.created_at).getTime()
          return arrivalTime >= start.getTime()
            && arrivalTime < end.getTime()
        })
        .map((item): WaitingRoomItem => ({
          id: item.id,
          patient_name: item.patient_name,
          arrived_at: item.created_at,
          status: item.status === 'called'
            ? 'called'
            : item.status === 'waiting' ? 'waiting' : 'other',
          type: 'arrival',
          code: '',
          clinical_priority: item.clinical_priority,
          queue_type: item.queue_type ?? (item.clinical_priority === 'priority' || item.clinical_priority === 'urgent' ? 'priority' : 'common'),
        }))
      const numberedQueues = new Map<string, number>()
      const arrivalOrdered = [...appointments, ...arrivals].sort((left, right) =>
        left.arrived_at.localeCompare(right.arrived_at)
        || left.id.localeCompare(right.id),
      )
      const numberedItems = arrivalOrdered.map((item) => {
        const queue = item.queue_type === 'priority' ? 'P' : 'C'
        const nextNumber = (numberedQueues.get(queue) ?? 0) + 1
        numberedQueues.set(queue, nextNumber)
        return { ...item, code: `${queue}${String(nextNumber).padStart(3, '0')}` }
      })
      const calledNow = new Set(numberedItems.filter((item) => item.status === 'called').map((item) => `${item.type}-${item.id}`))
      const previousCalled = previousCalledRef.current
      if (previousCalled && kioskAlertsEnabledRef.current) {
        const newCalls = numberedItems.filter((item) =>
          item.status === 'called' && !previousCalled.has(`${item.type}-${item.id}`),
        )
        if (newCalls.length) {
          playKioskAlert()
          newCalls.forEach((item) => announce(item))
        }
      }
      previousCalledRef.current = calledNow
      const queueSettingsResponse = await fetch('/api/v1/reception/queue-settings')
      const queueSettings = await readApiResponse<{ normal_before_priority: number; normal_calls_since_priority: number }>(queueSettingsResponse)
      setNormalBeforePriority(queueSettings.normal_before_priority)
      setNormalCallsSincePriority(queueSettings.normal_calls_since_priority)
      setItems(numberedItems.filter((item) => item.status !== 'other').sort((left, right) =>
        Number(left.status === 'called') - Number(right.status === 'called')
        || priorityOrder[left.clinical_priority] - priorityOrder[right.clinical_priority]
        || left.arrived_at.localeCompare(right.arrived_at),
      ))
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível atualizar a fila de chamadas.')
    } finally {
      setLoading(false)
    }
  }, [kioskMode])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadQueue(), 0)
    const interval = window.setInterval(() => void loadQueue(), 15_000)
    const clockInterval = kioskMode ? window.setInterval(() => setClock(new Date()), 1000) : undefined
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(interval)
      if (clockInterval) window.clearInterval(clockInterval)
    }
  }, [kioskMode, loadQueue])

  useEffect(() => () => {
    void audioContextRef.current?.close()
  }, [])

  useEffect(() => {
    if (!kioskMode) return
    const context = new window.AudioContext()
    audioContextRef.current = context
    void context.resume().then(() => {
      if (context.state === 'running') {
        kioskAlertsEnabledRef.current = true
        setKioskAlertsEnabled(true)
      }
    }).catch(() => {
      kioskAlertsEnabledRef.current = false
      setKioskAlertsEnabled(false)
    })
  }, [kioskMode])

  function announce(item: WaitingRoomItem) {
    if (!('speechSynthesis' in window)) {
      setNotice('Este navegador não oferece anúncio por voz. A chamada visual continua disponível.')
      return false
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(`Senha ${item.code}. ${item.first_name ?? item.patient_name.trim().split(/\s+/)[0]}. Aguarde ser atendido.`)
    utterance.lang = 'pt-BR'
    utterance.onerror = () => setError('O navegador não conseguiu reproduzir o anúncio por voz.')
    window.speechSynthesis.speak(utterance)
    return true
  }

  function playKioskAlert() {
    const context = audioContextRef.current
    if (!context) return
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = 880
    gain.gain.setValueAtTime(0.16, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.7)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.7)
  }

  async function enableKioskAlerts() {
    try {
      const context = audioContextRef.current ?? new window.AudioContext()
      await context.resume()
      audioContextRef.current = context
      kioskAlertsEnabledRef.current = true
      setKioskAlertsEnabled(true)
      setNotice('Alertas sonoros e chamadas por voz ativados neste computador.')
      setError('')
    } catch (audioError) {
      setError(audioError instanceof Error ? audioError.message : 'Não foi possível ativar os alertas deste navegador.')
    }
  }

  async function callPatient(item: WaitingRoomItem, withVoice: boolean) {
    setUpdating(`${item.type}-${item.id}`)
    setError('')
    setNotice('')
    try {
      const path = item.type === 'appointment'
        ? `/api/v1/reception/appointments/${encodeURIComponent(item.id)}`
        : `/api/v1/reception/arrivals/${encodeURIComponent(item.id)}`
      await readApiResponse(await fetch(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'called' }),
      }))
      const voiceAvailable = withVoice ? announce(item) : true
      setNotice(`${item.code} · ${item.patient_name} foi chamado.${withVoice && !voiceAvailable ? ' O navegador não oferece anúncio por voz.' : ''}`)
      await loadQueue()
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : 'Não foi possível chamar o paciente.')
    } finally {
      setUpdating('')
    }
  }

  async function saveCallCadence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavingCadence(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/v1/reception/queue-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ normal_before_priority: normalBeforePriority }),
      })
      const updated = await readApiResponse<{ normal_before_priority: number }>(response)
      setNormalBeforePriority(updated.normal_before_priority)
      setNotice(`Alternância atualizada: ${updated.normal_before_priority} chamada(s) comum(ns) antes de uma prioritária.`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível atualizar a alternância das filas.')
    } finally {
      setSavingCadence(false)
    }
  }

  async function callNext(mode: 'automatic' | 'common' | 'priority') {
    setUpdating('next')
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/v1/reception/queue/call-next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const calledItem = await readApiResponse<{ patient_name: string; normal_calls_since_priority: number }>(response)
      setNormalCallsSincePriority(calledItem.normal_calls_since_priority)
      setNotice(`${calledItem.patient_name} foi chamado. O painel da sala de espera será atualizado automaticamente.`)
      await loadQueue()
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : 'Não foi possível chamar o próximo paciente.')
    } finally {
      setUpdating('')
    }
  }

  const waiting = items.filter((item) => item.status === 'waiting')
  const called = items.filter((item) => item.status === 'called')
  const priorityItems = items.filter((item) => item.queue_type === 'priority')
  const commonItems = items.filter((item) => item.queue_type === 'common')

  function openKioskWindow() {
    const kioskWindow = window.open('/painel-sala-espera', '_blank', 'noopener,noreferrer')
    if (!kioskWindow) setError('O navegador bloqueou a nova janela. Permita pop-ups ou acesse /painel-sala-espera neste computador.')
  }

  if (kioskMode) {
    const calledFor = (queue: WaitingRoomItem[]) => queue
      .filter((item) => item.status === 'called' || item.status === 'in_service')
      .sort((left, right) => (right.updated_at ?? right.arrived_at).localeCompare(left.updated_at ?? left.arrived_at))[0]
    const waitingFor = (queue: WaitingRoomItem[]) => queue
      .filter((item) => item.status === 'waiting')
      .sort((left, right) => left.arrived_at.localeCompare(right.arrived_at))[0]
    const kioskGroups = [
      { label: 'Chamados agora', items: [calledFor(priorityItems), calledFor(commonItems)] },
      { label: 'Próximos aguardando', items: [waitingFor(priorityItems), waitingFor(commonItems)] },
    ]
    const displayedFirstNames = new Set<string>()
    return <main className="waiting-room-kiosk" aria-label="Chamadas da Santa Casa Pedro Osório">
      <header>
        <div className="waiting-room-kiosk-brand">
          <img src="/scpo-connect-icon.png" alt="" />
          <div><h1>Santa Casa de Pedro Osório</h1><strong>Aguarde ser atendido</strong><span>Chamadas por nome e senha</span></div>
        </div>
        <div className="waiting-room-kiosk-tools">
          <time dateTime={clock.toISOString()}>{new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(clock)}</time>
          {!kioskAlertsEnabled && <button className="button button-secondary" type="button" onClick={() => void enableKioskAlerts()}>Ativar áudio</button>}
        </div>
      </header>
      {error && <ToastMessage variant="error">{error}</ToastMessage>}
      {loading ? <p className="waiting-room-display-empty">Carregando chamadas…</p> : <div className="waiting-room-kiosk-groups" aria-live="polite">
        {kioskGroups.map(({ label, items: groupItems }) => <section className="waiting-room-kiosk-group" key={label}>
          <h2>{label}</h2>
          <div className="waiting-room-kiosk-slots">
            {groupItems.map((item, index) => {
              const queueClass = index === 0 ? 'priority' : 'common'
              if (item?.first_name) displayedFirstNames.add(item.first_name)
              return <article className={`waiting-room-kiosk-card waiting-room-kiosk-card-${queueClass}`} key={queueClass}>
                {item ? <><strong>{item.code}</strong><b>{item.first_name}</b></> : <p>—</p>}
              </article>
            })}
          </div>
        </section>)}
        {!displayedFirstNames.size && <p className="waiting-room-display-empty">Nenhum paciente aguardando chamada.</p>}
      </div>}
      <footer><time dateTime={clock.toISOString()}>{new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(clock).replace(/^./, (char) => char.toUpperCase())}</time></footer>
    </main>
  }

  return <>
  <section className="waiting-room-board patient-list-panel">
    <div className="section-heading"><div><p className="eyebrow">SALA DE ESPERA</p><h2>Painel de chamadas</h2><p className="welcome-copy">Chame o próximo paciente automaticamente ou escolha manualmente a fila comum ou prioritária. A tela pública abre sem sessão de operador em <code>/painel-sala-espera</code>.</p></div><div className="waiting-room-actions"><button className="button button-secondary" type="button" onClick={() => void loadQueue()} disabled={loading}>Atualizar</button><button className="button button-secondary" type="button" onClick={openKioskWindow}>Abrir quiosque em nova janela</button></div></div>
    {canUpdate && <div className="waiting-room-call-controls"><div><strong>Chamar próximo paciente</strong><span>{normalCallsSincePriority} de {normalBeforePriority} chamada(s) comum(ns) desde a última prioritária</span></div><div className="waiting-room-actions"><button className="button button-primary" type="button" disabled={Boolean(updating)} onClick={() => void callNext('automatic')}>{updating === 'next' ? 'Chamando…' : 'Próximo automático'}</button><button className="button button-secondary" type="button" disabled={Boolean(updating)} onClick={() => void callNext('common')}>Chamar comum</button><button className="button button-secondary" type="button" disabled={Boolean(updating)} onClick={() => void callNext('priority')}>Chamar prioritário</button></div><form className="waiting-room-cadence" onSubmit={(event) => void saveCallCadence(event)}><label className="field"><span className="field-label">Comuns antes de prioritário</span><input type="number" min={1} max={20} value={normalBeforePriority} onChange={(event) => setNormalBeforePriority(Number(event.target.value))} /></label><button className="button button-secondary" type="submit" disabled={savingCadence || normalBeforePriority < 1 || normalBeforePriority > 20}>{savingCadence ? 'Salvando…' : 'Salvar alternância'}</button></form></div>}
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    {!canUpdate && <div className="form-message form-message-warning" role="note">Seu perfil pode acompanhar as chamadas, mas não pode iniciar uma chamada.</div>}
    <div className="waiting-room-counts"><article><strong>{waiting.length}</strong><span>Aguardando chamada</span></article><article><strong>{called.length}</strong><span>Chamados</span></article></div>
    {loading ? <div className="history-empty">Carregando fila de chamadas…</div> : !items.length ? <div className="history-empty">Não há pacientes aguardando ou chamados neste momento.</div> : <div className="waiting-room-lists" aria-live="polite">
      {waiting.length > 0 && <section><h3>Aguardando</h3><div className="waiting-room-cards">{waiting.map((item) => <article className="waiting-room-card" key={`${item.type}-${item.id}`}><span className="waiting-room-code">{item.code}</span><strong>{item.patient_name}</strong><small>{item.type === 'appointment' ? 'Agendamento' : 'Pronto atendimento'} · {dateTime(item.arrived_at)}</small>{canUpdate && <div className="waiting-room-actions"><button className="button button-primary" type="button" disabled={updating === `${item.type}-${item.id}`} onClick={() => void callPatient(item, false)}>Chamar na tela</button><button className="button button-secondary" type="button" disabled={updating === `${item.type}-${item.id}`} onClick={() => void callPatient(item, true)}>Chamar com voz</button></div>}</article>)}</div></section>}
      {called.length > 0 && <section><h3>Chamados</h3><div className="waiting-room-cards">{called.map((item) => <article className="waiting-room-card waiting-room-card-called" key={`${item.type}-${item.id}`}><span className="waiting-room-code">{item.code}</span><strong>{item.patient_name}</strong><small>Chamado · {dateTime(item.arrived_at)}</small>{'speechSynthesis' in window && <button className="button button-secondary" type="button" onClick={() => announce(item)}>Reanunciar por voz</button>}</article>)}</div></section>}
    </div>}
  </section>
  </>
}

export default ReceptionPage

export function WaitingRoomKioskPage() {
  return <WaitingRoomCallBoard canUpdate={false} kioskMode />
}
