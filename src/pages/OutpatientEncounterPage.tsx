import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Printer, Save, Trash2 } from 'lucide-react'
import { readApiResponse } from '../api'
import ToastMessage from '../components/ToastMessage'
import { formatCpf } from '../inputFormatting'

type Patient = {
  reference: string
  name: string
  room: string
  bed: string
  cpf?: string
  sus_card?: string
  same_number?: string
  active?: boolean
}

type ActivityRow = { professional_activity: string; procedure: string }
type PatientSnapshot = Record<string, string>
type EncounterType = 'outpatient' | 'urgent_emergency' | 'first_consultation' | 'return' | 'emergency_referral' | 'reference_consultation'
type Referral = 'discharge' | 'return_same_unit' | 'exams' | 'specialty' | 'hospital' | 'emergency'
type Program = 'prenatal' | 'puericulture' | 'cervical_cancer'

type OutpatientEncounter = {
  id: number
  patient_reference: string
  patient_snapshot: PatientSnapshot
  encounter_type: EncounterType
  physician_name: string
  examination: string
  activity_rows: ActivityRow[]
  group_name: string
  programs: Program[]
  diagnostic_hypothesis: string
  antibiotic_prescription: string
  referral: Referral
  created_by: string
  created_at: string
}

type NewPatientForm = {
  name: string
  mother_name: string
  birth_date: string
  sex: string
  cpf: string
  sus_card: string
  same_number: string
  health_plan: string
  phone: string
  email: string
  address: string
  address_number: string
  address_complement: string
  neighborhood: string
  city: string
  state: string
  postal_code: string
}

const encounterTypes: Array<[EncounterType, string]> = [
  ['outpatient', 'Ambulatorial'],
  ['urgent_emergency', 'Urgência / emergência'],
  ['first_consultation', 'Primeira consulta'],
  ['return', 'Retorno'],
  ['emergency_referral', 'Urgência / emergência / referência'],
  ['reference_consultation', 'Consulta de referência'],
]

const referralOptions: Array<[Referral, string]> = [
  ['discharge', 'Alta'],
  ['return_same_unit', 'Retorno na mesma unidade'],
  ['exams', 'Exames'],
  ['specialty', 'Ambulatório especializado'],
  ['hospital', 'Hospital'],
  ['emergency', 'Pronto-socorro'],
]

const programOptions: Array<[Program, string]> = [
  ['prenatal', 'PN (pré-natal)'],
  ['puericulture', 'Puericultura'],
  ['cervical_cancer', 'CA ginecológico'],
]

const emptyActivityRow = (): ActivityRow => ({ professional_activity: '', procedure: '' })
const emptyActivityRows = (): ActivityRow[] => Array.from({ length: 3 }, emptyActivityRow)
const emptyNewPatient = (): NewPatientForm => ({
  name: '',
  mother_name: '',
  birth_date: '',
  sex: '',
  cpf: '',
  sus_card: '',
  same_number: '',
  health_plan: '',
  phone: '',
  email: '',
  address: '',
  address_number: '',
  address_complement: '',
  neighborhood: '',
  city: '',
  state: '',
  postal_code: '',
})

function dateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function dateOnly(value?: string) {
  if (!value) return 'Não informado'
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? 'Não informado' : new Intl.DateTimeFormat('pt-BR').format(parsed)
}

function ageLabel(snapshot: PatientSnapshot) {
  if (snapshot.age) return `${snapshot.age} anos`
  if (!snapshot.birth_date) return 'Não informado'
  const birthDate = new Date(`${snapshot.birth_date}T12:00:00`)
  if (Number.isNaN(birthDate.getTime())) return 'Não informado'
  const now = new Date()
  let age = now.getFullYear() - birthDate.getFullYear()
  if (now.getMonth() < birthDate.getMonth() || (now.getMonth() === birthDate.getMonth() && now.getDate() < birthDate.getDate())) age -= 1
  return `${age} anos`
}

function encounterLabel(value: EncounterType) {
  return encounterTypes.find(([type]) => type === value)?.[1] ?? value
}

function marked(value: boolean) {
  return value ? '[X]' : '[ ]'
}

function OutpatientEncounterPage({ userId, canCreate, onArrivalQueued }: { userId: string; canCreate: boolean; onArrivalQueued?: () => void }) {
  const [patients, setPatients] = useState<Patient[]>([])
  const [encounters, setEncounters] = useState<OutpatientEncounter[]>([])
  const [patientSearch, setPatientSearch] = useState('')
  const [patientReference, setPatientReference] = useState('')
  const [newPatientMode, setNewPatientMode] = useState(false)
  const [newPatient, setNewPatient] = useState<NewPatientForm>(emptyNewPatient)
  const [encounterType, setEncounterType] = useState<EncounterType>('outpatient')
  const [physicianName, setPhysicianName] = useState('')
  const [examination, setExamination] = useState('')
  const [activityRows, setActivityRows] = useState<ActivityRow[]>(emptyActivityRows)
  const [groupName, setGroupName] = useState('')
  const [programs, setPrograms] = useState<Program[]>([])
  const [diagnosticHypothesis, setDiagnosticHypothesis] = useState('')
  const [antibioticPrescription, setAntibioticPrescription] = useState('')
  const [referral, setReferral] = useState<Referral>('discharge')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [printingEncounter, setPrintingEncounter] = useState<OutpatientEncounter | null>(null)

  async function loadEncounters() {
    const response = await fetch('/api/v1/reception/encounters?limit=50&offset=0')
    const data = await readApiResponse<{ encounters?: OutpatientEncounter[] }>(response)
    setEncounters(data.encounters ?? [])
  }

  useEffect(() => {
    let active = true
    async function loadData() {
      setLoading(true)
      try {
        const [patientResponse, encounterResponse] = await Promise.all([
          fetch('/api/v1/nursing/patients'),
          fetch('/api/v1/reception/encounters?limit=50&offset=0'),
        ])
        const [patientData, encounterData] = await Promise.all([
          readApiResponse<{ patients?: Patient[] }>(patientResponse),
          readApiResponse<{ encounters?: OutpatientEncounter[] }>(encounterResponse),
        ])
        if (!active) return
        setPatients(patientData.patients ?? [])
        setEncounters(encounterData.encounters ?? [])
        setError('')
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os atendimentos ambulatoriais.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadData()
    return () => { active = false }
  }, [userId])

  useEffect(() => {
    if (!printingEncounter) return
    const finishPrint = () => {
      document.body.classList.remove('print-outpatient-encounter')
      setPrintingEncounter(null)
    }
    document.body.classList.add('print-outpatient-encounter')
    window.addEventListener('afterprint', finishPrint)
    const timer = window.setTimeout(() => window.print(), 120)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('afterprint', finishPrint)
      document.body.classList.remove('print-outpatient-encounter')
    }
  }, [printingEncounter])

  const filteredPatients = patients.filter((patient) =>
    `${patient.name} ${patient.cpf ?? ''} ${patient.sus_card ?? ''} ${patient.reference}`
      .toLocaleLowerCase('pt-BR')
      .includes(patientSearch.trim().toLocaleLowerCase('pt-BR')),
  )

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    const payload = {
      patient_reference: newPatientMode ? null : patientReference || null,
      new_patient: newPatientMode ? {
        ...newPatient,
        name: newPatient.name.trim(),
        cpf: formatCpf(newPatient.cpf),
        sus_card: newPatient.sus_card.replace(/\D/g, ''),
        birth_date: newPatient.birth_date || null,
        state: newPatient.state.trim().toUpperCase(),
        allergies_status: 'unknown',
      } : null,
      encounter_type: encounterType,
      same_number: newPatientMode
        ? newPatient.same_number.trim()
        : patients.find((patient) => patient.reference === patientReference)?.same_number ?? '',
      physician_name: physicianName.trim(),
      examination: examination.trim(),
      activity_rows: activityRows,
      group_name: groupName.trim(),
      programs,
      diagnostic_hypothesis: diagnosticHypothesis.trim(),
      antibiotic_prescription: antibioticPrescription.trim(),
      referral,
    }
    try {
      const response = await fetch('/api/v1/reception/encounters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const created = await readApiResponse<OutpatientEncounter>(response)
      setEncounters((current) => [created, ...current.filter((item) => item.id !== created.id)])
      setPatientReference('')
      setPatientSearch('')
      setNewPatientMode(false)
      setNewPatient(emptyNewPatient())
      setEncounterType('outpatient')
      setPhysicianName('')
      setExamination('')
      setActivityRows(emptyActivityRows())
      setGroupName('')
      setPrograms([])
      setDiagnosticHypothesis('')
      setAntibioticPrescription('')
      setReferral('discharge')
      setNotice('Ficha ambulatorial salva no histórico do paciente.')
      onArrivalQueued?.()
      if (newPatientMode) {
        try {
          const patientsResponse = await fetch('/api/v1/nursing/patients')
          const patientData = await readApiResponse<{ patients?: Patient[] }>(patientsResponse)
          setPatients(patientData.patients ?? [])
        } catch (refreshError) {
          setError(refreshError instanceof Error ? `Ficha salva; não foi possível atualizar a lista de pacientes: ${refreshError.message}` : 'Ficha salva; não foi possível atualizar a lista de pacientes.')
        }
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar a ficha ambulatorial.')
    } finally {
      setSaving(false)
    }
  }

  const printEncounter = printingEncounter

  return <section className="outpatient-encounter-page">
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    <form className="outpatient-encounter-form" onSubmit={(event) => void submit(event)}>
      <div className="section-heading"><div><p className="eyebrow">FICHA AMBULATORIAL · SIA/SUS-RS</p><h2>Novo atendimento</h2><p className="welcome-copy">O registro fica associado ao cadastro central e pode ser consultado e impresso depois.</p></div></div>
      <div className="outpatient-patient-choice">
        {!newPatientMode ? <>
          <label className="field"><span className="field-label">Buscar paciente cadastrado</span><input type="search" value={patientSearch} onChange={(event) => { setPatientSearch(event.target.value); setPatientReference('') }} placeholder="Nome, CPF, CNS ou número do cadastro" /></label>
          <label className="field"><span className="field-label">Paciente</span><select required value={patientReference} onChange={(event) => setPatientReference(event.target.value)}><option value="">Selecione o paciente</option>{filteredPatients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name}{patient.cpf ? ` · CPF ${patient.cpf}` : ''}</option>)}</select></label>
          <button className="button button-secondary outpatient-new-patient-toggle" type="button" onClick={() => { setNewPatientMode(true); setPatientReference(''); setPatientSearch('') }}>Cadastrar novo paciente</button>
        </> : <>
          <div className="outpatient-new-patient-heading"><div><strong>Novo cadastro central</strong><span>O paciente será reutilizado em consultas e internações.</span></div><button className="button button-secondary" type="button" onClick={() => { setNewPatientMode(false); setNewPatient(emptyNewPatient()) }}>Escolher cadastrado</button></div>
          <div className="field-grid field-grid-two outpatient-new-patient-fields">
            <label className="field"><span className="field-label">Nome completo</span><input required minLength={2} maxLength={120} value={newPatient.name} onChange={(event) => setNewPatient({ ...newPatient, name: event.target.value })} /></label>
            <label className="field"><span className="field-label">Nome da mãe</span><input maxLength={120} value={newPatient.mother_name} onChange={(event) => setNewPatient({ ...newPatient, mother_name: event.target.value })} /></label>
            <label className="field"><span className="field-label">Data de nascimento</span><input type="date" value={newPatient.birth_date} onChange={(event) => setNewPatient({ ...newPatient, birth_date: event.target.value })} /></label>
            <label className="field"><span className="field-label">Sexo</span><select value={newPatient.sex} onChange={(event) => setNewPatient({ ...newPatient, sex: event.target.value })}><option value="">Não informado</option><option value="Feminino">Feminino</option><option value="Masculino">Masculino</option><option value="Outro">Outro</option><option value="Prefere não informar">Prefere não informar</option></select></label>
            <label className="field"><span className="field-label">CPF</span><input inputMode="numeric" maxLength={14} value={formatCpf(newPatient.cpf)} onChange={(event) => setNewPatient({ ...newPatient, cpf: formatCpf(event.target.value) })} placeholder="000.000.000-00" /></label>
            <label className="field"><span className="field-label">CNS / Cartão SUS</span><input inputMode="numeric" maxLength={20} value={newPatient.sus_card} onChange={(event) => setNewPatient({ ...newPatient, sus_card: event.target.value.replace(/\D/g, '') })} /></label>
            <label className="field"><span className="field-label">Nº SAME / prontuário</span><input maxLength={40} value={newPatient.same_number} onChange={(event) => setNewPatient({ ...newPatient, same_number: event.target.value })} /></label>
            <label className="field"><span className="field-label">Convênio</span><input maxLength={120} value={newPatient.health_plan} onChange={(event) => setNewPatient({ ...newPatient, health_plan: event.target.value })} placeholder="SUS ou convênio cadastrado" /></label>
            <label className="field"><span className="field-label">Telefone</span><input inputMode="tel" maxLength={40} value={newPatient.phone} onChange={(event) => setNewPatient({ ...newPatient, phone: event.target.value })} /></label>
            <label className="field"><span className="field-label">E-mail</span><input type="email" maxLength={160} value={newPatient.email} onChange={(event) => setNewPatient({ ...newPatient, email: event.target.value })} /></label>
            <label className="field"><span className="field-label">Rua / endereço</span><input maxLength={180} value={newPatient.address} onChange={(event) => setNewPatient({ ...newPatient, address: event.target.value })} /></label>
            <label className="field"><span className="field-label">Número</span><input maxLength={24} value={newPatient.address_number} onChange={(event) => setNewPatient({ ...newPatient, address_number: event.target.value })} /></label>
            <label className="field"><span className="field-label">Complemento</span><input maxLength={100} value={newPatient.address_complement} onChange={(event) => setNewPatient({ ...newPatient, address_complement: event.target.value })} /></label>
            <label className="field"><span className="field-label">Bairro</span><input maxLength={100} value={newPatient.neighborhood} onChange={(event) => setNewPatient({ ...newPatient, neighborhood: event.target.value })} /></label>
            <label className="field"><span className="field-label">Município</span><input maxLength={100} value={newPatient.city} onChange={(event) => setNewPatient({ ...newPatient, city: event.target.value })} /></label>
            <label className="field"><span className="field-label">UF</span><input maxLength={2} value={newPatient.state} onChange={(event) => setNewPatient({ ...newPatient, state: event.target.value.toUpperCase() })} /></label>
            <label className="field"><span className="field-label">CEP</span><input inputMode="numeric" maxLength={12} value={newPatient.postal_code} onChange={(event) => setNewPatient({ ...newPatient, postal_code: event.target.value.replace(/\D/g, '').slice(0, 8) })} /></label>
          </div>
        </>}
      </div>
      <div className="field-grid field-grid-three outpatient-details-grid">
        <label className="field"><span className="field-label">Tipo de atendimento</span><select value={encounterType} onChange={(event) => setEncounterType(event.target.value as EncounterType)}>{encounterTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field"><span className="field-label">Nº SAME / prontuário</span><input maxLength={40} value={newPatientMode ? newPatient.same_number : patients.find((patient) => patient.reference === patientReference)?.same_number ?? ''} readOnly={!newPatientMode} onChange={(event) => setNewPatient((current) => ({ ...current, same_number: event.target.value }))} placeholder="Cadastro central do paciente" /></label>
        <label className="field"><span className="field-label">Médico responsável / plantonista</span><input maxLength={120} value={physicianName} onChange={(event) => setPhysicianName(event.target.value)} placeholder="Nome do médico" /></label>
      </div>
      <label className="field"><span className="field-label">Exame</span><textarea maxLength={1000} rows={3} value={examination} onChange={(event) => setExamination(event.target.value)} placeholder="Exames ou observações para o atendimento" /></label>
      <div className="outpatient-activity-fields">
        <div className="outpatient-subheading"><strong>Atividade profissional e procedimento</strong></div>
        {activityRows.map((row, index) => <div className="field-grid field-grid-two" key={index}>
          <label className="field"><span className="field-label">Atividade profissional {index + 1}</span><input maxLength={120} value={row.professional_activity} onChange={(event) => setActivityRows((current) => current.map((item, rowIndex) => rowIndex === index ? { ...item, professional_activity: event.target.value } : item))} /></label>
          <label className="field"><span className="field-label">Procedimento {index + 1}</span><input maxLength={120} value={row.procedure} onChange={(event) => setActivityRows((current) => current.map((item, rowIndex) => rowIndex === index ? { ...item, procedure: event.target.value } : item))} /></label>
          {index >= 3 && <button className="button button-secondary outpatient-remove-activity" type="button" onClick={() => setActivityRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={15} /> Remover linha {index + 1}</button>}
        </div>)}
        <button className="button button-secondary outpatient-add-activity" type="button" disabled={activityRows.length >= 20} onClick={() => setActivityRows((current) => [...current, emptyActivityRow()])}><Plus size={15} /> Adicionar linha</button>
      </div>
      <div className="field-grid field-grid-two">
        <label className="field"><span className="field-label">Grupo</span><input maxLength={120} value={groupName} onChange={(event) => setGroupName(event.target.value)} /></label>
        <fieldset className="outpatient-programs"><legend>Programa</legend>{programOptions.map(([value, label]) => <label className="checkbox-label" key={value}><input type="checkbox" checked={programs.includes(value)} onChange={(event) => setPrograms((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value))} />{label}</label>)}</fieldset>
      </div>
      <label className="field"><span className="field-label">Hipótese diagnóstica</span><textarea maxLength={2000} rows={4} value={diagnosticHypothesis} onChange={(event) => setDiagnosticHypothesis(event.target.value)} /></label>
      <label className="field"><span className="field-label">Prescrição de antibiótico</span><textarea maxLength={2000} rows={4} value={antibioticPrescription} onChange={(event) => setAntibioticPrescription(event.target.value)} /></label>
      <label className="field"><span className="field-label">Encaminhamento</span><select value={referral} onChange={(event) => setReferral(event.target.value as Referral)}>{referralOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="outpatient-form-actions"><button className="button button-primary" type="submit" disabled={saving || !canCreate || (!newPatientMode && !patientReference)}><Save size={16} />{saving ? 'Salvando ficha…' : 'Salvar atendimento'}</button></div>
    </form>
    <section className="outpatient-history-panel">
      <div className="section-heading"><div><p className="eyebrow">HISTÓRICO DA RECEPÇÃO</p><h2>Fichas ambulatoriais salvas</h2></div><button className="button button-secondary" type="button" disabled={loading} onClick={() => { setLoading(true); void loadEncounters().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Não foi possível atualizar o histórico.')).finally(() => setLoading(false)) }}>{loading ? 'Atualizando…' : 'Atualizar'}</button></div>
      {loading ? <div className="history-empty">Carregando fichas…</div> : encounters.length ? <div className="outpatient-encounter-list">{encounters.map((encounter) => <article className="outpatient-encounter-card" key={encounter.id}>
        <div><h3>{encounter.patient_snapshot.name || 'Paciente'}</h3><p>{encounterLabel(encounter.encounter_type)} · Atendimento Nº {encounter.id}</p></div>
        <span>{dateTime(encounter.created_at)}</span>
        <button className="button button-secondary" type="button" onClick={() => setPrintingEncounter(encounter)}><Printer size={15} /> Imprimir ficha</button>
      </article>)}</div> : <div className="history-empty">Nenhuma ficha ambulatorial registrada.</div>}
    </section>
    {printEncounter && createPortal(<OutpatientPrintSheet encounter={printEncounter} />, document.body)}
  </section>
}

function OutpatientPrintSheet({ encounter }: { encounter: OutpatientEncounter }) {
  const patient = encounter.patient_snapshot
  const selectedPrograms = new Set(encounter.programs)
  const address = [patient.address, patient.address_number, patient.neighborhood].filter(Boolean).join(', ')
  const city = [patient.city, patient.state].filter(Boolean).join(' / ')
  const createdAt = new Date(encounter.created_at)
  const printedDate = Number.isNaN(createdAt.getTime()) ? 'Não informado' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(createdAt)
  const printedTime = Number.isNaN(createdAt.getTime()) ? 'Não informado' : new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(createdAt)
  return <article className="outpatient-print-sheet">
    <header className="outpatient-print-masthead">
      {patient.photo_data && <img src={patient.photo_data} alt="Foto do paciente" />}
      <div><div className="outpatient-print-topline"><strong>SIA/SUS - RS</strong><span>FICHA DE ATENDIMENTO AMBULATORIAL</span></div><h1>SANTA CASA DE PEDRO OSÓRIO</h1></div>
    </header>
    <div className="outpatient-print-record"><span><strong>Atendimento Nº:</strong> {encounter.id}</span><span><strong>Data:</strong> {printedDate}</span><span><strong>Horário:</strong> {printedTime}</span><span><strong>Recepcionista:</strong> {encounter.created_by}</span></div>
    <section className="outpatient-print-section">
      <div className="outpatient-print-grid outpatient-print-grid-two"><span><strong>Paciente:</strong> {patient.name}</span><span><strong>Nº do cadastro:</strong> {patient.reference}</span></div>
      <div className="outpatient-print-grid outpatient-print-grid-two"><span><strong>Nascimento:</strong> {dateOnly(patient.birth_date)} · <strong>Idade:</strong> {ageLabel(patient)}</span><span><strong>Mãe:</strong> {patient.mother_name || 'Não informado'} · <strong>Sexo:</strong> {patient.sex || 'Não informado'}</span></div>
      <div className="outpatient-print-grid outpatient-print-grid-two"><span><strong>CPF:</strong> {patient.cpf || 'Não informado'}</span><span><strong>CNS:</strong> {patient.sus_card || 'Não informado'} · <strong>SAME:</strong> {patient.same_number || 'Não informado'}</span></div>
    </section>
    <section className="outpatient-print-section">
      <strong>Endereço</strong>
      <div className="outpatient-print-grid outpatient-print-grid-address"><span><strong>Rua:</strong> {address || 'Não informado'}</span><span><strong>Bairro:</strong> {patient.neighborhood || 'Não informado'}</span><span><strong>Município:</strong> {city || 'Não informado'}</span><span><strong>Convênio:</strong> {patient.health_plan || 'SUS'}</span></div>
      <div className="outpatient-print-grid outpatient-print-grid-two"><span><strong>Médico:</strong> {encounter.physician_name || 'Não informado'}</span><span><strong>Exame:</strong> {encounter.examination || ' '}</span></div>
    </section>
    <section className="outpatient-print-section">
      <strong>Tipo de atendimento</strong>
      <div className="outpatient-print-options">{encounterTypes.map(([value, label]) => <span key={value}>{marked(encounter.encounter_type === value)} {label}</span>)}</div>
    </section>
    <table className="outpatient-print-activities"><thead><tr><th>Atividade profissional</th><th>Procedimento</th></tr></thead><tbody>
      {Array.from({ length: Math.max(3, encounter.activity_rows.length) }, (_, index) => <tr key={index}><td>{encounter.activity_rows[index]?.professional_activity || ''}</td><td>{encounter.activity_rows[index]?.procedure || ''}</td></tr>)}
    </tbody></table>
    <div className="outpatient-print-stamp"><span>Assinatura / carimbo</span><i /></div>
    <section className="outpatient-print-section outpatient-print-programs"><span><strong>Grupo:</strong> {encounter.group_name || ' '}</span><span><strong>Programa:</strong> {programOptions.map(([value, label]) => `${marked(selectedPrograms.has(value))} ${label}`).join('    ')}</span></section>
    <section className="outpatient-print-writing"><strong>Hipótese diagnóstica:</strong><p>{encounter.diagnostic_hypothesis || ''}</p></section>
    <section className="outpatient-print-writing"><strong>Prescrição de antibiótico:</strong><p>{encounter.antibiotic_prescription || ''}</p></section>
    <section className="outpatient-print-section"><strong>Encaminhamento</strong><div className="outpatient-print-options">{referralOptions.map(([value, label]) => <span key={value}>{marked(encounter.referral === value)} {label}</span>)}</div></section>
    <div className="outpatient-print-signatures"><div><span>Assinatura do paciente ou responsável</span></div><div><span>Carimbo e assinatura do médico</span></div></div>
  </article>
}

export default OutpatientEncounterPage
