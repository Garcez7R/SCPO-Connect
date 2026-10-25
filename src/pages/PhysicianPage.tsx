import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, ClipboardPlus, Printer, RefreshCw, Stethoscope } from 'lucide-react'
import { readApiResponse, readableApiError } from '../api'
import PatientSelect from '../components/PatientSelect'
import ToastMessage from '../components/ToastMessage'
import VitalTrendsDashboard from '../components/VitalTrendsDashboard'
import { printExternalPrescription, printMedicationAdministrationLabels } from '../printClinicalForm'

type Patient = {
  reference: string
  name: string
  room: string
  bed: string
  birth_date?: string | null
  allergies?: string
  allergies_status?: 'unknown' | 'none_known' | 'known'
  active?: boolean
}
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

function PhysicianPage() {
  const [patients, setPatients] = useState<Patient[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([])
  const [patientReference, setPatientReference] = useState('')
  const [form, setForm] = useState<PrescriptionForm>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [savingPrescription, setSavingPrescription] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const selectedPatient = useMemo(
    () => patients.find((patient) => patient.reference === patientReference),
    [patients, patientReference],
  )

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
        loadResource<{ patients: Patient[] }>('/api/v1/nursing/patients', 'Cadastro de pacientes', (data) => setPatients(data.patients.filter((patient) => patient.active !== false))),
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

  return <section className="page-enter physician-page">
    <div className="page-title-row"><div><p className="eyebrow">MÓDULO · ASSISTÊNCIA MÉDICA</p><h1>Médico</h1><p className="welcome-copy">Consulta clínica, evolução de sinais vitais e prescrições internas integradas.</p></div><span className="module-icon module-icon-physician"><Stethoscope size={23} /></span></div>
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {error && !loading && <button className="button button-secondary physician-retry" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}><RefreshCw size={15} /> Tentar carregar novamente</button>}
    {loading ? <div className="history-empty" role="status">Carregando dados clínicos…</div> : <>
      <section className="patient-list-panel">
        <div className="section-heading"><div><p className="eyebrow">IDENTIFICAÇÃO PROFISSIONAL</p><h2>Perfil do prescritor</h2><p className="welcome-copy">Nome e CRM/UF vinculados às prescrições e à receita impressa.</p></div></div>
        {profile ? <div className="physician-profile-summary"><strong>{profile.name}</strong><span>CRM {profile.crm}/{profile.crm_state}</span></div> : <div className="admin-warning"><Stethoscope size={19} /><div><strong>Perfil profissional não cadastrado</strong><span>Solicite à Administração que cadastre e confira seu nome e CRM/UF antes de registrar prescrições.</span></div></div>}
      </section>
      <div className="form-grid physician-patient-picker">
        <PatientSelect label="Paciente para consulta" patients={patients} value={patientReference} onChange={(reference) => { setPatientReference(reference); setForm((current) => ({ ...current, patient_reference: reference })) }} optionLabel={(patient) => `${patient.name} · quarto ${patient.room || '—'} · leito ${patient.bed || '—'}`} />
      </div>
      {selectedPatient && <>
        <section className="patient-list-panel">
          <div className="section-heading"><div><p className="eyebrow">FICHA CLÍNICA</p><h2>{selectedPatient.name}</h2><p className="welcome-copy">Nascimento: {selectedPatient.birth_date ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${selectedPatient.birth_date}T12:00:00Z`)) : 'não informado'} · Quarto {selectedPatient.room || '—'} · leito {selectedPatient.bed || '—'}</p></div></div>
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
            <label className="field"><span className="field-label">Dose</span><input required value={form.dose} onChange={(event) => setForm((current) => ({ ...current, dose: event.target.value }))} /></label>
            <label className="field"><span className="field-label">Via</span><input required value={form.route} onChange={(event) => setForm((current) => ({ ...current, route: event.target.value }))} placeholder="Oral, IV, IM…" /></label>
            <label className="field"><span className="field-label">Frequência</span><input required value={form.frequency} onChange={(event) => setForm((current) => ({ ...current, frequency: event.target.value }))} placeholder="Ex.: a cada 8 horas" /></label>
            <fieldset className="field field-full prescription-times"><legend className="field-label">Horários de administração prescritos (opcional)</legend><p className="field-hint">Informe apenas os horários definidos pelo prescritor. O sistema não calcula horários a partir da frequência.</p>{form.administration_times.map((time, index) => <div className="prescription-time-row" key={`administration-time-${index}`}><input aria-label={`Horário de administração ${index + 1}`} type="time" value={time} onChange={(event) => setForm((current) => ({ ...current, administration_times: current.administration_times.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} /><button className="button button-secondary" type="button" onClick={() => setForm((current) => ({ ...current, administration_times: current.administration_times.filter((_, itemIndex) => itemIndex !== index) }))}>Remover horário</button></div>)}<button className="button button-secondary" type="button" onClick={() => setForm((current) => ({ ...current, administration_times: [...current.administration_times, ''] }))}>Adicionar horário</button></fieldset>
            <label className="field"><span className="field-label">Duração</span><input required value={form.duration} onChange={(event) => setForm((current) => ({ ...current, duration: event.target.value }))} /></label>
            <label className="field"><span className="field-label">Quantidade</span><input required value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} /></label>
            <label className="field"><span className="field-label">Unidade</span><input required value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))} /></label>
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
              {prescription.is_controlled && <small>Controle especial · receita externa indisponível</small>}
            </div>
          </article>)}</div> : <div className="history-empty">Nenhuma prescrição registrada para este paciente.</div>}
        </section>
      </>}
      {!patientReference && <div className="history-empty">Selecione um paciente para visualizar alergias, sinais vitais, prescrições e dados clínicos.</div>}
    </>}
  </section>
}

export default PhysicianPage
