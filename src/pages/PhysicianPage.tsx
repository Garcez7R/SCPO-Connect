import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, ClipboardPlus, Printer, RefreshCw, Stethoscope } from 'lucide-react'
import { readApiResponse, readableApiError } from '../api'
import ToastMessage from '../components/ToastMessage'
import VitalTrendsDashboard from '../components/VitalTrendsDashboard'
import PhysicianTriageQueue from '../components/PhysicianTriageQueue'
import { PatientCareTrackBadge } from '../components/PatientCareTrackBadge'
import { BehavioralStatusBadge, type BehavioralStatus } from '../components/BehavioralStatusBadge'
import { useBreadcrumb, usePersistentTab } from '../components/PageNavigationContext'
import { printExternalPrescription, printMedicationAdministrationLabels, printMedicationScheduleSheet } from '../printClinicalForm'

const physicianTabValues = ['queue', 'records'] as const
const physicianTabLabels: Record<typeof physicianTabValues[number], string> = {
  queue: 'Fila de atendimento',
  records: 'Prontuário e prescrições',
}
const physicianPatientGroupValues = ['inpatients', 'registered'] as const
const physicianPatientGroupLabels: Record<typeof physicianPatientGroupValues[number], string> = {
  inpatients: 'Internados',
  registered: 'Cadastrados sem internação',
}

type Patient = {
  reference: string
  name: string
  room: string
  bed: string
  birth_date?: string | null
  allergies?: string
  allergies_status?: 'unknown' | 'none_known' | 'known'
  active?: boolean
  treatment_track?: 'clinical' | 'psychiatric' | 'combined' | 'unclassified'
}
type PatientBehavioralStatus = { patient_reference: string; status: BehavioralStatus | null; updated_at: string | null }
type Profile = { user_id: string; name: string; crm: string; crm_state: string }
type Prescription = {
  id: string
  patient_reference: string
  medication_name: string
  active_ingredient: string
  presentation: string
  dose: string
  route: string
  frequency: string
  administration_times: string[]
  duration: string
  quantity: string
  unit: string
  instructions: string
  is_controlled: boolean
  prescriber_name: string
  crm: string
  crm_state: string
  status: 'pending' | 'fulfilled' | 'cancelled'
  created_at: string
}
type PrescriptionForm = Omit<Prescription, 'id' | 'prescriber_name' | 'crm' | 'crm_state' | 'status' | 'created_at'>

const emptyForm: PrescriptionForm = {
  patient_reference: '',
  medication_name: '',
  active_ingredient: '',
  presentation: '',
  dose: '',
  route: '',
  frequency: '',
  administration_times: [],
  duration: '',
  quantity: '',
  unit: 'unidades',
  instructions: '',
  is_controlled: false,
}

function PhysicianPage({ userId, onOpenPatientHistory, mobileMode = false }: { userId: string; onOpenPatientHistory: (reference: string) => void; mobileMode?: boolean }) {
  const [patients, setPatients] = useState<Patient[]>([])
  const [patientTotal, setPatientTotal] = useState(0)
  const [patientPage, setPatientPage] = useState(0)
  const [patientSearch, setPatientSearch] = useState('')
  const [patientListLoading, setPatientListLoading] = useState(false)
  const [patientListError, setPatientListError] = useState('')
  const [behavioralStatuses, setBehavioralStatuses] = useState<Record<string, PatientBehavioralStatus>>({})
  const [behavioralStatusError, setBehavioralStatusError] = useState('')
  const [behavioralStatusLoading, setBehavioralStatusLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([])
  const [patientReference, setPatientReference] = useState('')
  const [physicianTab, setPhysicianTab] = usePersistentTab(
    `scpo-tab-physician-${userId}`,
    'queue',
    physicianTabValues,
    physicianTabLabels,
  )
  const [patientGroup, setPatientGroup] = usePersistentTab(
    `scpo-tab-physician-patient-group-${userId}`,
    'inpatients',
    physicianPatientGroupValues,
    physicianPatientGroupLabels,
    true,
    2,
  )
  const [treatmentTrackFilter, setTreatmentTrackFilter] = useState<'all' | NonNullable<Patient['treatment_track']>>('all')
  const [form, setForm] = useState<PrescriptionForm>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [savingPrescription, setSavingPrescription] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const visiblePatients = patients
  const selectedPatient = useMemo(
    () => visiblePatients.find((patient) => patient.reference === patientReference),
    [visiblePatients, patientReference],
  )

  useEffect(() => {
    let active = true
    fetch('/api/v1/nursing/behavioral-status')
      .then(readApiResponse<{ statuses?: PatientBehavioralStatus[] }>)
      .then((result) => {
      if (active) {
        setBehavioralStatuses(Object.fromEntries(
          (result.statuses ?? []).map((status) => [status.patient_reference, status]),
        ))
        setBehavioralStatusError('')
      }
    }).catch((statusError) => {
      if (active) setBehavioralStatusError(statusError instanceof Error ? statusError.message : 'Não foi possível carregar o semáforo comportamental.')
    }).finally(() => {
      if (active) setBehavioralStatusLoading(false)
    })
    return () => { active = false }
  }, [])
  useBreadcrumb('physician-selected-patient', physicianTab === 'records' ? selectedPatient?.name ?? null : null, 3)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError('')
      const failures: string[] = []
      const loadResource = async <T,>(path: string, label: string, apply: (data: T) => void) => {
        try {
          const data = await readApiResponse<T>(await fetch(path))
          if (active) apply(data)
        } catch (loadError) {
          failures.push(`${label}: ${readableApiError(loadError)}`)
        }
      }
      await Promise.all([
        loadResource<{ profile: Profile | null }>('/api/v1/physicians/profile', 'Perfil profissional', (data) => setProfile(data.profile)),
        loadResource<{ prescriptions: Prescription[] }>('/api/v1/physicians/prescriptions', 'Prescrições', (data) => setPrescriptions(data.prescriptions)),
      ])
      if (active) {
        setError(failures.length
          ? `Falha ao carregar ${failures.join(' · ')}. Verifique se a API clínica está disponível e se o perfil tem acesso ao módulo Médico. O acesso ao cadastro compartilhado não exige habilitar Enfermagem no perfil.`
          : '')
        setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [loadAttempt])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      async function loadPatients() {
        setPatientListLoading(true)
        try {
          const params = new URLSearchParams({
            limit: '50',
            offset: String(patientPage * 50),
            status: 'active',
            inpatient: String(patientGroup === 'inpatients'),
          })
          if (treatmentTrackFilter !== 'all') params.set('treatment_track', treatmentTrackFilter)
          if (patientSearch.trim()) params.set('search', patientSearch.trim())
          const data = await readApiResponse<{ patients?: Patient[]; total?: number }>(
            await fetch(`/api/v1/nursing/patients?${params}`, { signal: controller.signal }),
          )
          if (!active) return
          setPatients(data.patients ?? [])
          setPatientTotal(data.total ?? 0)
          setPatientListError('')
        } catch (loadError) {
          if (active && !(loadError instanceof DOMException && loadError.name === 'AbortError')) {
            setPatients([])
            setPatientTotal(0)
            setPatientListError(readableApiError(loadError))
          }
        } finally {
          if (active) setPatientListLoading(false)
        }
      }
      void loadPatients()
    }, patientSearch.trim() ? 250 : 0)
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [patientGroup, treatmentTrackFilter, patientPage, patientSearch, loadAttempt])

  async function createPrescription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedPatient) {
      setError('Selecione um paciente antes de prescrever.')
      return
    }
    setSavingPrescription(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/v1/physicians/prescriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, administration_times: form.administration_times.filter(Boolean), patient_reference: selectedPatient.reference }),
      })
      const prescription = await readApiResponse<Prescription>(response)
      setPrescriptions((current) => [prescription, ...current])
      setForm({ ...emptyForm, patient_reference: selectedPatient.reference })
      setNotice('Prescrição interna registrada para Farmácia e Enfermagem.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao registrar a prescrição.')
    } finally {
      setSavingPrescription(false)
    }
  }

  async function cancelPrescription(prescription: Prescription) {
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/v1/physicians/prescriptions/${prescription.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      const updated = await readApiResponse<Prescription>(response)
      setPrescriptions((current) => current.map((item) => item.id === updated.id ? updated : item))
      setNotice('Prescrição cancelada.')
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Falha ao cancelar a prescrição.')
    }
  }

  const patientPrescriptions = prescriptions.filter((prescription) => prescription.patient_reference === patientReference)
  const selectedPatientForm = selectedPatient && {
    name: selectedPatient.name,
    birth_date: selectedPatient.birth_date,
    room: selectedPatient.room,
    bed: selectedPatient.bed,
  }

  async function openPatientFromTriage(reference: string) {
    setError('')
    setPatientGroup('inpatients')
    setTreatmentTrackFilter('all')
    setPatientPage(0)
    setPhysicianTab('records')
    try {
      const patient = await readApiResponse<Patient>(
        await fetch(`/api/v1/nursing/patients/${encodeURIComponent(reference)}`),
      )
      setPatientGroup(patient.room.trim() && patient.bed.trim() ? 'inpatients' : 'registered')
      setPatientSearch(patient.name)
      setPatientReference(reference)
      setForm((current) => ({ ...current, patient_reference: reference }))
    } catch (loadError) {
      setError(readableApiError(loadError))
    }
  }

  return <section className={`page-enter physician-page${mobileMode ? ' physician-page-mobile' : ''}`}>
    <div className="page-title-row"><div><p className="eyebrow">{mobileMode ? 'PWA · MÉDICO' : 'MÓDULO · ASSISTÊNCIA MÉDICA'}</p><h1>Médico</h1><p className="welcome-copy">{mobileMode ? 'Fila, prontuário e prescrições em uma interface compacta. Requer conexão com o servidor.' : 'Fila de atendimentos triados, ficha clínica, sinais vitais e prescrições internas.'}</p></div><span className="module-icon module-icon-physician"><Stethoscope size={23} /></span>{!mobileMode && <a className="button button-secondary" href="/physician.html" target="_blank" rel="noreferrer">Abrir PWA móvel</a>}</div>
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {error && !loading && <button className="button button-secondary physician-retry" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}><RefreshCw size={15} /> Tentar carregar novamente</button>}
    {loading ? <div className="history-empty" role="status">Carregando dados clínicos…</div> : <>
      {!mobileMode && <section className="patient-list-panel">
        <div className="section-heading"><div><p className="eyebrow">IDENTIFICAÇÃO PROFISSIONAL</p><h2>Perfil do prescritor</h2><p className="welcome-copy">Nome e CRM/UF vinculados às prescrições e à receita impressa.</p></div></div>
        {profile ? <div className="physician-profile-summary"><strong>{profile.name}</strong><span>CRM {profile.crm}/{profile.crm_state}</span></div> : <div className="admin-warning"><Stethoscope size={19} /><div><strong>Perfil profissional não cadastrado</strong><span>Solicite à Administração que cadastre e confira seu nome e CRM/UF antes de registrar prescrições.</span></div></div>}
      </section>}
        <div className="admin-tabs module-tabs physician-tabs" role="tablist" aria-label="Fluxo de trabalho médico">
          <button className={`button ${physicianTab === 'queue' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={physicianTab === 'queue'} onClick={() => setPhysicianTab('queue')}>1. Fila de atendimento</button>
          <button className={`button ${physicianTab === 'records' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={physicianTab === 'records'} onClick={() => setPhysicianTab('records')}>2. Prontuário e prescrições</button>
      </div>
        <p className="field-hint physician-workflow-help">{physicianTab === 'queue' ? 'Revise a triagem e abra o paciente para seguir ao prontuário. Atendimentos sem triagem podem ser localizados na busca de pacientes.' : 'Escolha o grupo e o perfil de cuidado; selecione uma linha para abrir ou recolher o prontuário e registrar prescrições.'}</p>
        {physicianTab === 'queue' && <PhysicianTriageQueue onOpenPatient={(reference) => void openPatientFromTriage(reference)} />}
        {physicianTab === 'records' && <>
      <div className="patient-list-panel physician-patient-groups">
        <div className="admin-tabs module-tabs" role="tablist" aria-label="Separar pacientes cadastrados e internados">
          <button className={`button ${patientGroup === 'inpatients' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={patientGroup === 'inpatients'} onClick={() => { setPatientGroup('inpatients'); setPatientPage(0); setPatientReference(''); setForm((current) => ({ ...current, patient_reference: '' })) }}>Internados</button>
          <button className={`button ${patientGroup === 'registered' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={patientGroup === 'registered'} onClick={() => { setPatientGroup('registered'); setPatientPage(0); setPatientReference(''); setForm((current) => ({ ...current, patient_reference: '' })) }}>Cadastrados sem internação</button>
        </div>
        <div className="physician-patient-filters"><label className="field physician-care-filter"><span className="field-label">Perfil de cuidado</span><select value={treatmentTrackFilter} onChange={(event) => { setTreatmentTrackFilter(event.target.value as typeof treatmentTrackFilter); setPatientPage(0); setPatientReference(''); setForm((current) => ({ ...current, patient_reference: '' })) }}><option value="all">Todos os perfis</option><option value="clinical">Clínico</option><option value="psychiatric">Psiquiátrico</option><option value="combined">Clínico e psiquiátrico</option><option value="unclassified">Não classificado</option></select></label><label className="field physician-patient-search"><span className="field-label">Buscar paciente</span><input type="search" value={patientSearch} onChange={(event) => { setPatientSearch(event.target.value); setPatientPage(0); setPatientReference(''); setForm((current) => ({ ...current, patient_reference: '' })) }} placeholder="Nome ou identificador" /></label></div>
        <p className="field-hint">O perfil de cuidado é uma classificação operacional e não substitui diagnóstico.</p>
        {patientListError && <ToastMessage variant="error">{patientListError}</ToastMessage>}
        {behavioralStatusError && <ToastMessage variant="error">{`Falha ao carregar o semáforo comportamental: ${behavioralStatusError}`}</ToastMessage>}
        {patientListLoading && <p className="history-empty" role="status">Carregando pacientes…</p>}
        {visiblePatients.length > 0 && <div className="physician-care-roster">{visiblePatients.map((patient) => {
          const track = patient.treatment_track ?? 'unclassified'
          const expanded = patient.reference === patientReference
          return <button className={`physician-care-roster-item physician-care-${track} care-track-${track}${expanded ? ' is-selected' : ''}`} key={patient.reference} type="button" aria-expanded={expanded} onClick={() => { setPatientReference(expanded ? '' : patient.reference); setForm((current) => ({ ...current, patient_reference: expanded ? '' : patient.reference })) }}><PatientCareTrackBadge track={track} /><span className="physician-care-roster-copy"><strong>{patient.name}</strong><small>{patient.room && patient.bed ? `Quarto ${patient.room} · leito ${patient.bed}` : 'Sem acomodação atribuída'}</small>{patient.room && patient.bed && !behavioralStatusLoading && !behavioralStatusError && <BehavioralStatusBadge status={behavioralStatuses[patient.reference]?.status ?? null} />}</span><span className="physician-care-roster-action">{expanded ? 'Recolher' : 'Abrir prontuário'}</span></button>
        })}</div>}
        {!patientListLoading && !patientListError && !visiblePatients.length && <p className="history-empty">{patientSearch.trim() ? 'Nenhum paciente corresponde à busca.' : patientGroup === 'inpatients' ? 'Nenhum paciente internado está disponível.' : 'Nenhum cadastro ativo sem internação está disponível.'}</p>}
        {!patientListLoading && patientTotal > 50 && <nav className="history-pagination" aria-label="Paginação dos pacientes médicos"><span>Exibindo {patientPage * 50 + 1}–{Math.min((patientPage + 1) * 50, patientTotal)} de {patientTotal}</span><div><button className="button button-secondary" type="button" disabled={patientPage === 0} onClick={() => setPatientPage((page) => Math.max(0, page - 1))}>Anterior</button><button className="button button-secondary" type="button" disabled={(patientPage + 1) * 50 >= patientTotal} onClick={() => setPatientPage((page) => page + 1)}>Próxima</button></div></nav>}
      </div>
      {selectedPatient && <>
        <section className="patient-list-panel">
          <div className="section-heading"><div><p className="eyebrow">FICHA CLÍNICA</p><h2>{selectedPatient.name}</h2><p className="welcome-copy">{selectedPatient.room && selectedPatient.bed ? `Internado · Quarto ${selectedPatient.room} · leito ${selectedPatient.bed}` : 'Cadastro ativo sem internação'} · Nascimento: {selectedPatient.birth_date ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${selectedPatient.birth_date}T12:00:00Z`)) : 'não informado'}</p></div><div className="patient-row-actions"><PatientCareTrackBadge track={selectedPatient.treatment_track} />{!mobileMode && <button className="button button-secondary" type="button" onClick={() => onOpenPatientHistory(selectedPatient.reference)}>Histórico assistencial</button>}</div></div>
          {selectedPatient.allergies_status === 'known' && selectedPatient.allergies
            ? <div className="clinical-alert" role="alert"><AlertTriangle size={18} /><div><strong>Alergia registrada</strong><span>{selectedPatient.allergies}</span></div></div>
            : <div className={`clinical-alert ${selectedPatient.allergies_status === 'none_known' ? 'clinical-alert-clear' : 'clinical-alert-unknown'}`} role="status"><AlertTriangle size={18} /><div><strong>{selectedPatient.allergies_status === 'none_known' ? 'Sem alergias conhecidas' : 'Alergias não verificadas'}</strong><span>Confirme as informações clínicas antes de prescrever.</span></div></div>}
          <p className="physician-vitals-help">A pressão é registrada em um único campo no formato sistólica/diastólica (por exemplo, 120/80 mmHg). O gráfico separa o valor antes e depois da barra em duas linhas para facilitar a leitura da evolução.</p>
          <VitalTrendsDashboard patientReference={patientReference} patientName={selectedPatient.name} />
        </section>
        <section className="patient-list-panel">
          <div className="section-heading"><div><p className="eyebrow">PRESCRIÇÃO INTERNA</p><h2>Nova prescrição</h2><p className="welcome-copy">A prescrição fica visível à Farmácia e à Enfermagem. Medicamentos controlados são permitidos no fluxo interno.</p></div></div>
          {!profile && <ToastMessage variant="error">Salve o perfil profissional acima antes de prescrever.</ToastMessage>}
          <form className="form-grid" onSubmit={(event) => void createPrescription(event)}>
            <label className="field"><span className="field-label">Medicamento</span><input required minLength={2} maxLength={160} value={form.medication_name} onChange={(event) => setForm((current) => ({ ...current, medication_name: event.target.value }))} /></label>
            <label className="field"><span className="field-label">Princípio ativo</span><input maxLength={160} value={form.active_ingredient} onChange={(event) => setForm((current) => ({ ...current, active_ingredient: event.target.value }))} /></label>
            <label className="field"><span className="field-label">Apresentação</span><input maxLength={160} value={form.presentation} onChange={(event) => setForm((current) => ({ ...current, presentation: event.target.value }))} /></label>
            <label className="field"><span className="field-label">Dose</span><input required value={form.dose} onChange={(event) => setForm((current) => ({ ...current, dose: event.target.value }))} placeholder="Quantidade + unidade (ex.: 500 mg)" /></label>
            <label className="field"><span className="field-label">Via</span><input required list="prescription-route-options" value={form.route} onChange={(event) => setForm((current) => ({ ...current, route: event.target.value }))} placeholder="Selecione ou descreva a via" /><datalist id="prescription-route-options"><option value="Oral" /><option value="Sublingual" /><option value="Intravenosa" /><option value="Intramuscular" /><option value="Subcutânea" /><option value="Tópica" /><option value="Inalatória" /><option value="Retal" /></datalist></label>
            <label className="field"><span className="field-label">Frequência</span><input required value={form.frequency} onChange={(event) => setForm((current) => ({ ...current, frequency: event.target.value }))} placeholder="Ex.: a cada 8 horas; conforme necessidade" /></label>
            <fieldset className="field field-full prescription-times"><legend className="field-label">Horários de administração prescritos (opcional)</legend><p className="field-hint">Informe apenas os horários definidos pelo prescritor. O sistema não calcula horários a partir da frequência.</p>{form.administration_times.map((time, index) => <div className="prescription-time-row" key={`administration-time-${index}`}><input aria-label={`Horário de administração ${index + 1}`} type="time" value={time} onChange={(event) => setForm((current) => ({ ...current, administration_times: current.administration_times.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} /><button className="button button-secondary" type="button" onClick={() => setForm((current) => ({ ...current, administration_times: current.administration_times.filter((_, itemIndex) => itemIndex !== index) }))}>Remover horário</button></div>)}<button className="button button-secondary" type="button" onClick={() => setForm((current) => ({ ...current, administration_times: [...current.administration_times, ''] }))}>Adicionar horário</button></fieldset>
            <label className="field"><span className="field-label">Duração</span><input required value={form.duration} onChange={(event) => setForm((current) => ({ ...current, duration: event.target.value }))} placeholder="Ex.: 7 dias ou uso contínuo" /></label>
            <label className="field"><span className="field-label">Quantidade</span><input required inputMode="decimal" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} placeholder="Ex.: 14" /></label>
            <label className="field"><span className="field-label">Unidade</span><input required value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))} placeholder="Ex.: comprimidos, mL, frasco" /></label>
            <label className="field field-full"><span className="field-label">Orientações adicionais</span><textarea maxLength={1000} value={form.instructions} onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))} /></label>
            <label className="checkbox-label field-full"><input type="checkbox" checked={form.is_controlled} onChange={(event) => setForm((current) => ({ ...current, is_controlled: event.target.checked }))} /><span>Medicamento sujeito a controle especial (somente para o fluxo interno)</span></label>
            <div className="form-actions field-full"><button className="button button-primary" type="submit" disabled={savingPrescription || !profile}><ClipboardPlus size={16} />{savingPrescription ? 'Registrando…' : 'Registrar prescrição'}</button></div>
          </form>
        </section>
        <section className="patient-list-panel">
          <div className="section-heading"><div><p className="eyebrow">HISTÓRICO DE PRESCRIÇÕES</p><h2>Prescrições deste paciente</h2></div></div>
          {patientPrescriptions.length ? <div className="patient-list">{patientPrescriptions.map((prescription) => <article className="patient-list-row" key={prescription.id}>
            <div><strong>{prescription.medication_name}</strong><p>{prescription.dose} · {prescription.route} · {prescription.frequency} · {prescription.duration}</p>{prescription.administration_times.length > 0 && <p>Horários prescritos: {prescription.administration_times.join(' · ')}</p>}<small>{prescription.prescriber_name} · CRM {prescription.crm}/{prescription.crm_state} · {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(prescription.created_at))}</small></div>
            <div className="patient-row-actions"><span className={`physician-status physician-status-${prescription.status}`}>{prescription.status === 'pending' ? 'Pendente' : prescription.status === 'fulfilled' ? 'Atendida' : 'Cancelada'}</span>
              {prescription.status === 'pending' && <button className="button button-secondary" type="button" onClick={() => void cancelPrescription(prescription)}>Cancelar</button>}
              {!prescription.is_controlled && selectedPatientForm && <button className="button button-secondary" type="button" onClick={() => {
                if (!printExternalPrescription({ patient: selectedPatientForm, prescriberName: prescription.prescriber_name, crm: prescription.crm, crmState: prescription.crm_state, medicationName: prescription.medication_name, activeIngredient: prescription.active_ingredient, presentation: prescription.presentation, dose: prescription.dose, route: prescription.route, frequency: prescription.frequency, administrationTimes: prescription.administration_times, duration: prescription.duration, quantity: prescription.quantity, unit: prescription.unit, instructions: prescription.instructions })) {
                  setError('O navegador bloqueou a janela de impressão. Permita pop-ups para este aplicativo.')
                }
              }}><Printer size={15} /> Receita simples</button>}
              {prescription.administration_times.length > 0 && selectedPatientForm && <button className="button button-secondary" type="button" onClick={() => { if (!printMedicationAdministrationLabels({ patient: selectedPatientForm, medicationName: prescription.medication_name, dose: prescription.dose, route: prescription.route, times: prescription.administration_times, prescriberName: prescription.prescriber_name })) setError('O navegador bloqueou a janela de impressão. Permita pop-ups para este aplicativo.') }}><Printer size={15} /> Etiquetas de horários</button>}
              {selectedPatientForm && prescription.administration_times.length > 0 && <button className="button button-secondary" type="button" onClick={() => {
                const time = prescription.administration_times[0] ?? ''
                if (!time) return
                const rows = [{ patient: selectedPatientForm, medications: [{ medicationName: prescription.medication_name, dose: prescription.dose, route: prescription.route, instructions: prescription.instructions, unit: prescription.unit }] }]
                if (!printMedicationScheduleSheet({ dateLabel: new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(new Date()), timeLabel: time, rows })) {
                  setError('O navegador bloqueou a janela de impressão. Permita pop-ups para este aplicativo.')
                }
              }}><Printer size={15} /> Folha de horário</button>}
              {prescription.is_controlled && <small>Controle especial · receita externa indisponível</small>}
            </div>
          </article>)}</div> : <div className="history-empty">Nenhuma prescrição registrada para este paciente.</div>}
        </section>
      </>}
      {!patientReference && <div className="history-empty">Selecione um paciente para visualizar alergias, sinais vitais, prescrições e dados clínicos.</div>}
      </>}
    </>}
  </section>
}

export default PhysicianPage
