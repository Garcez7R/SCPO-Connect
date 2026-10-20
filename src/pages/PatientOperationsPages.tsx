import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  HeartPulse,
  Info,
  LockKeyhole,
  Search,
  UsersRound,
} from 'lucide-react'
import { readApiResponse, readableApiError } from '../api'
import InterprofessionalSharePanel from '../components/InterprofessionalSharePanel'

type Patient = {
  reference: string
  name: string
  room: string
  bed: string
  allergies?: string
  allergies_status?: 'unknown' | 'none_known' | 'known'
}
type AuthUser = { permissions: Record<string, string[]> }

function dateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
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

type PatientOperationModule = 'xray' | 'social'
type PatientOperation = { id: number; patient_reference: string; exam_label?: string; referral_type?: string; status: string; created_at: string }

const socialReferralStatuses: Record<string, string> = {
  open: 'Aberto',
  scheduled: 'Agendado',
  in_progress: 'Em acompanhamento',
  completed: 'Concluído',
  cancelled: 'Cancelado',
}

export function PatientOperationsPage({ moduleId, user }: { moduleId: PatientOperationModule; user?: AuthUser }) {
  const isXray = moduleId === 'xray'
  const endpoint = isXray ? '/api/v1/xray/requests' : '/api/v1/social/referrals'
  const [patients, setPatients] = useState<Patient[]>([])
  const [items, setItems] = useState<PatientOperation[]>([])
  const [patientReference, setPatientReference] = useState('')
  const [description, setDescription] = useState('')
  const [socialQuery, setSocialQuery] = useState('')
  const [socialStatus, setSocialStatus] = useState<'all' | keyof typeof socialReferralStatuses>('all')
  const [socialTab, setSocialTab] = useState<'referrals' | 'sharing'>('referrals')
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let current = true
    Promise.all([fetch('/api/v1/nursing/patients'), fetch(endpoint)]).then(async ([patientResponse, itemResponse]) => {
      const patientData = await patientResponse.json() as { patients?: Patient[]; detail?: string }
      const itemData = await itemResponse.json() as { requests?: PatientOperation[]; referrals?: PatientOperation[]; detail?: string }
      if (!patientResponse.ok) throw new Error(patientData.detail ?? 'Não foi possível carregar o cadastro de pacientes.')
      if (!itemResponse.ok) throw new Error(itemData.detail ?? 'Não foi possível carregar os registros.')
      return { patients: patientData.patients ?? [], items: isXray ? itemData.requests ?? [] : itemData.referrals ?? [] }
    }).then((data) => { if (current) { setPatients(data.patients); setItems(data.items); setError('') } })
      .catch((loadError) => { if (current) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar os dados.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [endpoint, isXray])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patient_reference: patientReference, ...(isXray ? { exam_label: description.trim() } : { referral_type: description.trim() }) }) })
      const data = await response.json() as PatientOperation & { detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível registrar.')
      setItems((current) => [data, ...current]); setDescription(''); setPatientReference(''); setNotice(isXray ? 'Solicitação de exame registrada.' : 'Encaminhamento registrado.')
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : 'Falha ao registrar.') }
    finally { setSaving(false) }
  }
  async function updateSocialReferral(item: PatientOperation, status: keyof typeof socialReferralStatuses) {
    setUpdatingId(item.id); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/v1/social/referrals/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      const data = await readApiResponse<PatientOperation>(response)
      setItems((current) => current.map((entry) => entry.id === data.id ? data : entry))
      setNotice('Situação do encaminhamento atualizada.')
    } catch (updateError) { setError(updateError instanceof Error ? updateError.message : 'Falha ao atualizar o encaminhamento.') }
    finally { setUpdatingId(null) }
  }
  const patientName = (reference: string) => { const patient = patients.find((item) => item.reference === reference); return patient ? `${patient.name} · ${patient.room && patient.bed ? `Quarto ${patient.room}, leito ${patient.bed}` : 'sem acomodação'}` : 'Paciente não localizado' }
  const visibleItems = isXray ? items : items.filter((item) => (socialStatus === 'all' || item.status === socialStatus) && `${patientName(item.patient_reference)} ${item.referral_type}`.toLocaleLowerCase('pt-BR').includes(socialQuery.trim().toLocaleLowerCase('pt-BR')))
  const canUpdateSocial = user?.permissions.social?.includes('alterar') ?? false
  return <section className="module-page page-enter"><div className="page-title-row"><div><p className="eyebrow">MÓDULO · {isXray ? 'RAIO X' : 'SERVIÇO SOCIAL'}</p><h1>{isXray ? 'Solicitações de exame' : 'Encaminhamentos sociais'}</h1><p className="welcome-copy">Registros vinculados ao cadastro compartilhado de pacientes.</p></div><span className={`module-icon module-icon-${moduleId}`}>{isXray ? <Activity size={23} /> : <UsersRound size={23} />}</span></div>
    {error && <div className="form-message form-message-error" role="alert">{error}</div>}{notice && <div className="form-message form-message-success" role="status">{notice}</div>}
    {!isXray && <div className="admin-tabs module-tabs" role="tablist" aria-label="Áreas do Serviço Social"><button className={`button ${socialTab === 'referrals' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={socialTab === 'referrals'} onClick={() => setSocialTab('referrals')}>Encaminhamentos</button><button className={`button ${socialTab === 'sharing' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={socialTab === 'sharing'} onClick={() => setSocialTab('sharing')}>Compartilhamento seletivo</button></div>}
    {(isXray || socialTab === 'referrals') && <>
    <form className="work-order-form" onSubmit={(event) => void submit(event)}><div className="section-heading"><div><p className="eyebrow">NOVO REGISTRO</p><h2>{isXray ? 'Solicitar exame' : 'Registrar encaminhamento'}</h2></div></div><div className="field-grid field-grid-two"><label className="field"><span className="field-label">Paciente · quarto · leito</span><select required value={patientReference} onChange={(event) => setPatientReference(event.target.value)}><option value="">Selecione um paciente</option>{patients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patient.room && patient.bed ? `Qto ${patient.room} · Leito ${patient.bed}` : 'sem acomodação'}</option>)}</select></label><label className="field"><span className="field-label">{isXray ? 'Exame solicitado' : 'Tipo de encaminhamento'}</span><input required minLength={2} maxLength={80} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={isXray ? 'Ex.: radiografia de tórax' : 'Ex.: acompanhamento familiar'} /></label></div>{isXray && <PatientAllergyAlert patient={patients.find((patient) => patient.reference === patientReference)} />}<button className="button button-primary" type="submit" disabled={saving || !patients.length}>{saving ? 'Salvando…' : 'Registrar'}</button></form>
    <section className="patient-list-panel"><div className="section-heading"><div><p className="eyebrow">{isXray ? 'HISTÓRICO' : 'ACOMPANHAMENTO'}</p><h2>{isXray ? 'Solicitações recentes' : 'Encaminhamentos sociais'}</h2></div><span className="module-total">{isXray ? items.length : visibleItems.length}</span></div>{!isXray && <div className="psychology-filter-row"><label className="field"><span className="field-label">Buscar paciente ou encaminhamento</span><input value={socialQuery} onChange={(event) => setSocialQuery(event.target.value)} placeholder="Nome ou tipo de acompanhamento" /></label><label className="field"><span className="field-label">Situação</span><select value={socialStatus} onChange={(event) => setSocialStatus(event.target.value as typeof socialStatus)}><option value="all">Todas</option>{Object.entries(socialReferralStatuses).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label></div>}{loading ? <div className="history-empty">Carregando registros…</div> : visibleItems.length ? <div className="work-order-list">{visibleItems.map((item) => <article className="work-order-card" key={item.id}><div><h3>{patientName(item.patient_reference)}</h3><p>{isXray ? item.exam_label : item.referral_type}</p></div>{!isXray && canUpdateSocial ? <label className="field xray-status-control"><span className="field-label">Situação</span><select value={item.status} disabled={updatingId === item.id || item.status === 'completed' || item.status === 'cancelled'} onChange={(event) => void updateSocialReferral(item, event.target.value as keyof typeof socialReferralStatuses)}>{Object.entries(socialReferralStatuses).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label> : <span>{isXray ? (item.status === 'open' ? 'Aberto' : item.status) : socialReferralStatuses[item.status] ?? item.status}</span>}<time>{dateTime(item.created_at)}</time></article>)}</div> : <div className="history-empty">{items.length ? 'Nenhum encaminhamento corresponde aos filtros.' : 'Nenhum registro encontrado.'}</div>}</section>
    </>}
    {!isXray && socialTab === 'sharing' && <InterprofessionalSharePanel moduleId="social" patients={patients} />}
  </section>
}

type PsychologyTab = 'triage' | 'encounters' | 'sharing'
type PsychologyReferral = { id: number; patient_reference: string; referral_type: string; status: string; priority: 'routine' | 'priority'; created_at: string }
type PsychologyEncounter = { id: number; patient_reference: string; encounter_type: 'intake' | 'follow_up' | 'psychiatry'; objective: string; evolution: string; plan: string; actor_name: string; created_at: string }

const psychologyStatuses: Record<string, string> = {
  open: 'Aguardando triagem',
  scheduled: 'Agendado',
  in_progress: 'Em atendimento',
  completed: 'Concluído',
  cancelled: 'Cancelado',
}

const psychologyEncounterTypes: Record<PsychologyEncounter['encounter_type'], string> = {
  intake: 'Acolhimento inicial',
  follow_up: 'Acompanhamento',
  psychiatry: 'Atendimento psiquiátrico',
}

export function PsychologyPage() {
  const [tab, setTab] = useState<PsychologyTab>('triage')
  const [patients, setPatients] = useState<Patient[]>([])
  const [referrals, setReferrals] = useState<PsychologyReferral[]>([])
  const [encounters, setEncounters] = useState<PsychologyEncounter[]>([])
  const [encountersPatient, setEncountersPatient] = useState('')
  const [triagePatientQuery, setTriagePatientQuery] = useState('')
  const [recordPatientQuery, setRecordPatientQuery] = useState('')
  const [triageFilter, setTriageFilter] = useState('')
  const [triagePatient, setTriagePatient] = useState('')
  const [triageType, setTriageType] = useState('Acolhimento')
  const [customTriageType, setCustomTriageType] = useState('')
  const [triagePriority, setTriagePriority] = useState<'routine' | 'priority'>('routine')
  const [recordPatient, setRecordPatient] = useState('')
  const [recordType, setRecordType] = useState<PsychologyEncounter['encounter_type']>('intake')
  const [objective, setObjective] = useState('')
  const [evolution, setEvolution] = useState('')
  const [plan, setPlan] = useState('')
  const [loading, setLoading] = useState(true)
  const [encounterLoadError, setEncounterLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [updatingReferral, setUpdatingReferral] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let current = true
    Promise.all([fetch('/api/v1/nursing/patients'), fetch('/api/v1/psychology/referrals')])
      .then(async ([patientResponse, referralResponse]) => {
        const patientData = await patientResponse.json() as { patients?: Patient[]; detail?: unknown }
        const referralData = await referralResponse.json() as { referrals?: PsychologyReferral[]; detail?: unknown }
        if (!patientResponse.ok) throw new Error(readableApiError(patientData.detail))
        if (!referralResponse.ok) throw new Error(readableApiError(referralData.detail))
        return { patients: patientData.patients ?? [], referrals: referralData.referrals ?? [] }
      })
      .then((data) => {
        if (current) {
          setPatients(data.patients)
          setReferrals(data.referrals)
          setError('')
        }
      })
      .catch((loadError) => {
        if (current) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar a fila de atendimento.')
      })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [])

  useEffect(() => {
    if (tab !== 'encounters' || !recordPatient) return
    let current = true
    fetch(`/api/v1/psychology/encounters?patient_reference=${encodeURIComponent(recordPatient)}`)
      .then(async (response) => {
        const data = await response.json() as { encounters?: PsychologyEncounter[]; detail?: unknown }
        if (!response.ok) throw new Error(readableApiError(data.detail))
        return data.encounters ?? []
      })
      .then((records) => {
        if (current) {
          setEncounters(records)
          setEncountersPatient(recordPatient)
          setEncounterLoadError('')
        }
      })
      .catch((loadError) => {
        if (current) {
          setEncounterLoadError(loadError instanceof Error ? loadError.message : 'Falha ao carregar o histórico clínico.')
          setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar o histórico clínico.')
        }
      })
    return () => { current = false }
  }, [recordPatient, tab])
  const encountersLoading = Boolean(recordPatient && encountersPatient !== recordPatient && !encounterLoadError)

  const patientName = (reference: string) => {
    const patient = patients.find((patient) => patient.reference === reference)
    return patient ? `${patient.name} · ${patient.room && patient.bed ? `Quarto ${patient.room}, leito ${patient.bed}` : 'sem acomodação'}` : 'Paciente não localizado'
  }
  const filterPatients = (query: string) => patients.filter((patient) =>
    `${patient.name} ${patient.room} ${patient.bed}`.toLocaleLowerCase('pt-BR')
      .includes(query.trim().toLocaleLowerCase('pt-BR')),
  )
  const filteredTriagePatients = filterPatients(triagePatientQuery)
  const filteredRecordPatients = filterPatients(recordPatientQuery)
  const visibleReferrals = referrals.filter((referral) => {
    const patient = patientName(referral.patient_reference)
    const matchesSearch = `${patient} ${referral.referral_type}`.toLocaleLowerCase('pt-BR')
      .includes(triageFilter.trim().toLocaleLowerCase('pt-BR'))
    return matchesSearch
  })

  async function createReferral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    const referralType = triageType === 'Outro' ? customTriageType.trim() : triageType
    try {
      const response = await fetch('/api/v1/psychology/referrals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_reference: triagePatient, referral_type: referralType, priority: triagePriority }),
      })
      const data = await response.json() as PsychologyReferral & { detail?: unknown }
      if (!response.ok) throw new Error(readableApiError(data.detail))
      setReferrals((current) => [data, ...current])
      setTriagePatient('')
      setTriageType('Acolhimento')
      setCustomTriageType('')
      setTriagePriority('routine')
      setNotice('Encaminhamento incluído na fila.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao registrar o encaminhamento.')
    } finally {
      setSaving(false)
    }
  }

  async function updateReferral(referralId: number, changes: { status?: string; priority?: string }) {
    setUpdatingReferral(referralId)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/v1/psychology/referrals/${referralId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
      const data = await response.json() as PsychologyReferral & { detail?: unknown }
      if (!response.ok) throw new Error(readableApiError(data.detail))
      setReferrals((current) => current.map((referral) => referral.id === referralId ? data : referral))
      setNotice('Fila atualizada.')
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Falha ao atualizar o encaminhamento.')
    } finally {
      setUpdatingReferral(null)
    }
  }

  async function createEncounter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/v1/psychology/encounters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_reference: recordPatient,
          encounter_type: recordType,
          objective: objective.trim(),
          evolution: evolution.trim(),
          plan: plan.trim(),
        }),
      })
      const data = await response.json() as PsychologyEncounter & { detail?: unknown }
      if (!response.ok) throw new Error(readableApiError(data.detail))
      setEncounters((current) => [data, ...current])
      setObjective('')
      setEvolution('')
      setPlan('')
      setNotice('Registro clínico salvo com autoria e data/hora.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao salvar o registro clínico.')
    } finally {
      setSaving(false)
    }
  }

  return <section className="psychology-page page-enter">
    <div className="page-title-row">
      <div><p className="eyebrow">MÓDULO · PSICOLOGIA / PSIQUIATRIA</p><h1>Acompanhamento psicológico e psiquiátrico</h1><p className="welcome-copy">Organize encaminhamentos, atendimentos e registros clínicos em um único fluxo.</p></div>
      <span className="module-icon module-icon-psychology"><HeartPulse size={23} /></span>
    </div>
    <div className="psychology-privacy" role="note"><LockKeyhole size={18} /><span>Informações clínicas confidenciais: acesso restrito a contas autorizadas neste módulo. Registre apenas dados necessários ao atendimento.</span></div>
    {error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}
    <div className="admin-tabs module-tabs" role="tablist" aria-label="Áreas do módulo de Psicologia e Psiquiatria">
      <button type="button" role="tab" aria-selected={tab === 'triage'} className={`button ${tab === 'triage' ? 'button-primary' : 'button-secondary'}`} onClick={() => setTab('triage')}>Fila e triagem <span>{referrals.filter((item) => !['completed', 'cancelled'].includes(item.status)).length}</span></button>
      <button type="button" role="tab" aria-selected={tab === 'encounters'} className={`button ${tab === 'encounters' ? 'button-primary' : 'button-secondary'}`} onClick={() => { setEncountersPatient(''); setEncounterLoadError(''); setTab('encounters') }}>Atendimentos e registros</button>
      <button type="button" role="tab" aria-selected={tab === 'sharing'} className={`button ${tab === 'sharing' ? 'button-primary' : 'button-secondary'}`} onClick={() => setTab('sharing')}>Compartilhamento seletivo</button>
    </div>
    {tab === 'triage' && <>
      <form className="psychology-panel" onSubmit={(event) => void createReferral(event)}>
        <div className="section-heading"><div><p className="eyebrow">ENTRADA NA FILA</p><h2>Novo encaminhamento</h2></div></div>
        <div className="field-grid field-grid-two">
          <label className="field"><span className="field-label">Localizar paciente</span><span className="search-input-wrap"><Search size={17} /><input value={triagePatientQuery} onChange={(event) => setTriagePatientQuery(event.target.value)} placeholder="Nome, quarto ou leito" /></span></label>
          <label className="field"><span className="field-label">Paciente</span><select required value={triagePatient} onChange={(event) => { setTriagePatient(event.target.value); setTriagePatientQuery('') }}><option value="">Selecione o paciente</option>{filteredTriagePatients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patient.room && patient.bed ? `Qto ${patient.room} · Leito ${patient.bed}` : 'sem acomodação'}</option>)}</select></label>
          <PatientAllergyAlert patient={patients.find((patient) => patient.reference === triagePatient)} />
          <label className="field"><span className="field-label">Tipo de atendimento</span><select value={triageType} onChange={(event) => setTriageType(event.target.value)}><option>Acolhimento</option><option>Avaliação psicológica</option><option>Acompanhamento</option><option>Avaliação psiquiátrica</option><option>Outro</option></select></label>
          {triageType === 'Outro' && <label className="field"><span className="field-label">Descreva o tipo</span><input required minLength={2} maxLength={80} value={customTriageType} onChange={(event) => setCustomTriageType(event.target.value)} /></label>}
          <label className="field"><span className="field-label">Prioridade</span><select value={triagePriority} onChange={(event) => setTriagePriority(event.target.value as 'routine' | 'priority')}><option value="routine">Rotina</option><option value="priority">Prioritária · conforme protocolo institucional</option></select></label>
        </div>
        <p className="psychology-help">Use a prioridade institucionalmente definida. Não inclua relato clínico ou detalhes sensíveis no encaminhamento.</p>
        <button className="button button-primary" type="submit" disabled={saving || !patients.length}>{saving ? 'Registrando…' : 'Adicionar à fila'} <ArrowRight size={16} /></button>
      </form>
      <section className="psychology-panel">
        <div className="section-heading"><div><p className="eyebrow">ACOMPANHAMENTO</p><h2>Fila de atendimento</h2></div><span className="module-total">{referrals.length}</span></div>
        <div className="psychology-filter-row">
          <label className="field"><span className="field-label">Buscar encaminhamento</span><input value={triageFilter} onChange={(event) => setTriageFilter(event.target.value)} placeholder="Paciente ou tipo de atendimento" /></label>
          <p className="psychology-help">Atualize a situação conforme o fluxo da equipe.</p>
        </div>
        {loading ? <div className="history-empty">Carregando fila…</div> : visibleReferrals.length ? <div className="psychology-referral-list">{visibleReferrals.map((referral) => <article className="psychology-referral-card" key={referral.id}>
          <div className="psychology-referral-main"><div><h3>{patientName(referral.patient_reference)}</h3><p>{referral.referral_type}</p><small>{dateTime(referral.created_at)}</small></div><span className={`psychology-priority ${referral.priority === 'priority' ? 'is-priority' : ''}`}>{referral.priority === 'priority' ? 'Prioritária' : 'Rotina'}</span></div>
          <div className="psychology-referral-actions"><label className="field"><span className="field-label">Situação</span><select aria-label={`Situação do encaminhamento de ${patientName(referral.patient_reference)}`} disabled={updatingReferral === referral.id} value={referral.status} onChange={(event) => void updateReferral(referral.id, { status: event.target.value })}>{Object.entries(psychologyStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span className="field-label">Prioridade</span><select aria-label={`Prioridade do encaminhamento de ${patientName(referral.patient_reference)}`} disabled={updatingReferral === referral.id} value={referral.priority} onChange={(event) => void updateReferral(referral.id, { priority: event.target.value })}><option value="routine">Rotina</option><option value="priority">Prioritária</option></select></label></div>
        </article>)}</div> : <div className="history-empty">{referrals.length ? 'Nenhum encaminhamento corresponde à busca.' : 'A fila está vazia. Registre um encaminhamento para iniciar o acompanhamento.'}</div>}
      </section>
    </>}
    {tab === 'encounters' && <>
      <form className="psychology-panel" onSubmit={(event) => void createEncounter(event)}>
        <div className="section-heading"><div><p className="eyebrow">PRONTUÁRIO RESTRITO</p><h2>Novo registro de atendimento</h2></div></div>
        <div className="field-grid field-grid-two">
          <label className="field"><span className="field-label">Localizar paciente</span><span className="search-input-wrap"><Search size={17} /><input value={recordPatientQuery} onChange={(event) => setRecordPatientQuery(event.target.value)} placeholder="Nome, quarto ou leito" /></span></label>
          <label className="field"><span className="field-label">Paciente</span><select required value={recordPatient} onChange={(event) => { setRecordPatient(event.target.value); setRecordPatientQuery(''); setEncountersPatient(''); setEncounterLoadError(''); setEncounters([]) }}><option value="">Selecione o paciente</option>{filteredRecordPatients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patient.room && patient.bed ? `Qto ${patient.room} · Leito ${patient.bed}` : 'sem acomodação'}</option>)}</select></label>
          <PatientAllergyAlert patient={patients.find((patient) => patient.reference === recordPatient)} />
          <label className="field"><span className="field-label">Tipo de registro</span><select value={recordType} onChange={(event) => setRecordType(event.target.value as PsychologyEncounter['encounter_type'])}>{Object.entries(psychologyEncounterTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field psychology-field-wide"><span className="field-label">Objetivo do atendimento</span><textarea required minLength={3} maxLength={500} value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Finalidade do encontro, em termos objetivos" /></label>
          <label className="field psychology-field-wide"><span className="field-label">Evolução</span><textarea required minLength={3} maxLength={4000} value={evolution} onChange={(event) => setEvolution(event.target.value)} placeholder="Registre a evolução profissional pertinente ao atendimento" /></label>
          <label className="field psychology-field-wide"><span className="field-label">Plano e encaminhamentos</span><textarea maxLength={4000} value={plan} onChange={(event) => setPlan(event.target.value)} placeholder="Próximos passos e encaminhamentos acordados" /></label>
        </div>
        <p className="psychology-help">Autoria e horário são registrados automaticamente. Os registros são preservados no histórico; correções devem ser feitas como novo adendo, conforme protocolo da instituição.</p>
        <button className="button button-primary" type="submit" disabled={saving || !recordPatient}>{saving ? 'Salvando…' : 'Salvar registro clínico'} <CheckCircle2 size={16} /></button>
      </form>
      <section className="psychology-panel">
        <div className="section-heading"><div><p className="eyebrow">HISTÓRICO INDIVIDUAL</p><h2>Registros de atendimento</h2></div><span className="module-total">{encounters.length}</span></div>
        {!recordPatient ? <div className="history-empty">Selecione um paciente acima para consultar apenas o histórico individual autorizado.</div> : encounterLoadError ? <div className="form-message form-message-error" role="alert">{encounterLoadError}</div> : encountersLoading ? <div className="history-empty">Carregando histórico confidencial…</div> : encounters.length ? <div className="psychology-encounter-list">{encounters.map((encounter) => <article className="psychology-encounter-card" key={encounter.id}>
          <div className="psychology-encounter-heading"><div><h3>{psychologyEncounterTypes[encounter.encounter_type]}</h3><p>{patientName(encounter.patient_reference)}</p></div><div><time>{dateTime(encounter.created_at)}</time><small>{encounter.actor_name}</small></div></div>
          <div className="psychology-encounter-field"><strong>Objetivo</strong><p>{encounter.objective}</p></div>
          <div className="psychology-encounter-field"><strong>Evolução</strong><p>{encounter.evolution}</p></div>
          {encounter.plan && <div className="psychology-encounter-field"><strong>Plano e encaminhamentos</strong><p>{encounter.plan}</p></div>}
        </article>)}</div> : <div className="history-empty">Nenhum registro clínico para este paciente.</div>}
      </section>
    </>}
    {tab === 'sharing' && <InterprofessionalSharePanel moduleId="psychology" patients={patients} />}
  </section>
}
