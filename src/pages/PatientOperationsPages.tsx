import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Brain,
  CheckCircle2,
  Handshake,
  Microscope,
  Info,
  LockKeyhole,
  Stethoscope,
} from 'lucide-react'
import { readApiResponse, readableApiError } from '../api'
import PatientSelect from '../components/PatientSelect'
import InterprofessionalSharePanel from '../components/InterprofessionalSharePanel'
import { useBreadcrumb, usePersistentTab } from '../components/PageNavigationContext'
import { PatientCareTrackBadge } from '../components/PatientCareTrackBadge'
import { BehavioralStatusBadge, type BehavioralStatus } from '../components/BehavioralStatusBadge'
import { patientCareTrackClass } from '../patientCareTrack'
import ToastMessage from '../components/ToastMessage'

type Patient = {
  reference: string
  name: string
  room: string
  bed: string
  treatment_track?: 'clinical' | 'psychiatric' | 'combined' | 'unclassified'
  allergies?: string
  allergies_status?: 'unknown' | 'none_known' | 'known'
}
type AuthUser = { id: string; permissions: Record<string, string[]> }

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
type PatientOperation = { id: number; patient_reference: string; exam_label?: string; referral_type?: string; status: string; priority?: 'routine' | 'priority'; assignee?: string; follow_up_due?: string | null; next_step?: string; created_at: string }
type SocialReferralDraft = { priority: 'routine' | 'priority'; assignee: string; follow_up_due: string; next_step: string }
const socialTabs = ['referrals', 'sharing'] as const
const socialTabLabels: Record<(typeof socialTabs)[number], string> = { referrals: 'Encaminhamentos', sharing: 'Compartilhamento' }

const socialReferralCategories = ['Acompanhamento familiar', 'Benefícios e documentação', 'Alta e continuidade do cuidado', 'Moradia e rede de apoio', 'Acesso a serviços', 'Outro']

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
  const [socialCategory, setSocialCategory] = useState(socialReferralCategories[0])
  const [socialNewReferral, setSocialNewReferral] = useState<SocialReferralDraft>({ priority: 'routine', assignee: '', follow_up_due: '', next_step: '' })
  const [socialDrafts, setSocialDrafts] = useState<Record<number, SocialReferralDraft>>({})
  const [socialQuery, setSocialQuery] = useState('')
  const [socialStatus, setSocialStatus] = useState<'all' | keyof typeof socialReferralStatuses>('all')
  const [socialTab, setSocialTab] = usePersistentTab(`scpo-tab-social-${user?.id ?? 'anonymous'}`, 'referrals', socialTabs, socialTabLabels)
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
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patient_reference: patientReference, ...(isXray ? { exam_label: description.trim() } : { referral_type: socialCategory, ...socialNewReferral, follow_up_due: socialNewReferral.follow_up_due || null }) }) })
      const data = await response.json() as PatientOperation & { detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível registrar.')
      setItems((current) => [data, ...current]); setDescription(''); setPatientReference(''); setSocialNewReferral({ priority: 'routine', assignee: '', follow_up_due: '', next_step: '' }); setNotice(isXray ? 'Solicitação de exame registrada.' : 'Encaminhamento registrado.')
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : 'Falha ao registrar.') }
    finally { setSaving(false) }
  }
  async function updateSocialReferral(item: PatientOperation, changes: Partial<Omit<SocialReferralDraft, 'follow_up_due'>> & { follow_up_due?: string | null; status?: keyof typeof socialReferralStatuses }) {
    setUpdatingId(item.id); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/v1/social/referrals/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) })
      const data = await readApiResponse<PatientOperation>(response)
      setItems((current) => current.map((entry) => entry.id === data.id ? data : entry))
      setSocialDrafts((current) => { const next = { ...current }; delete next[item.id]; return next })
      setNotice('Encaminhamento atualizado.')
    } catch (updateError) { setError(updateError instanceof Error ? updateError.message : 'Falha ao atualizar o encaminhamento.') }
    finally { setUpdatingId(null) }
  }
  const patientName = (reference: string) => { const patient = patients.find((item) => item.reference === reference); return patient ? `${patient.name} · ${patient.room && patient.bed ? `Quarto ${patient.room}, leito ${patient.bed}` : 'sem acomodação'}` : 'Paciente não localizado' }
  const socialDraft = (item: PatientOperation): SocialReferralDraft => socialDrafts[item.id] ?? {
    priority: item.priority ?? 'routine', assignee: item.assignee ?? '', follow_up_due: item.follow_up_due ?? '', next_step: item.next_step ?? '',
  }
  const visibleItems = isXray ? items : items.filter((item) => (socialStatus === 'all' || item.status === socialStatus) && `${patientName(item.patient_reference)} ${item.referral_type} ${item.assignee ?? ''} ${item.next_step ?? ''}`.toLocaleLowerCase('pt-BR').includes(socialQuery.trim().toLocaleLowerCase('pt-BR')))
  const canUpdateSocial = user?.permissions.social?.includes('alterar') ?? false
  return <section className="module-page page-enter"><div className="page-title-row"><div><p className="eyebrow">MÓDULO · {isXray ? 'RAIO X' : 'SERVIÇO SOCIAL'}</p><h1>{isXray ? 'Solicitações de exame' : 'Encaminhamentos sociais'}</h1><p className="welcome-copy">{isXray ? 'Registros vinculados ao cadastro compartilhado de pacientes.' : 'Este fluxo acompanha demandas do Serviço Social. Para compartilhar dados com Psicologia/Psiquiatria, use a aba de compartilhamento; isso não cria um encaminhamento na fila psicológica.'}</p></div><span className={`module-icon module-icon-${moduleId}`}>{isXray ? <Microscope size={23} /> : <Handshake size={23} />}</span></div>
    {error && <ToastMessage variant="error">{error}</ToastMessage>}{notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    {!isXray && <div className="admin-tabs module-tabs" role="tablist" aria-label="Áreas do Serviço Social"><button className={`button ${socialTab === 'referrals' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={socialTab === 'referrals'} onClick={() => setSocialTab('referrals')}>Encaminhamentos</button><button className={`button ${socialTab === 'sharing' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={socialTab === 'sharing'} onClick={() => setSocialTab('sharing')}>Compartilhamento seletivo</button></div>}
    {(isXray || socialTab === 'referrals') && <>
    <form className="work-order-form" onSubmit={(event) => void submit(event)}><div className="section-heading"><div><p className="eyebrow">NOVO REGISTRO</p><h2>{isXray ? 'Solicitar exame' : 'Registrar encaminhamento'}</h2></div></div><div className="field-grid field-grid-two"><PatientSelect label="Paciente · quarto · leito" patients={patients} value={patientReference} onChange={setPatientReference} required optionLabel={(patient) => `${patient.name} · ${patient.room && patient.bed ? `Qto ${patient.room} · Leito ${patient.bed}` : 'sem acomodação'}`} />{isXray ? <label className="field"><span className="field-label">Exame solicitado</span><input required minLength={2} maxLength={80} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ex.: radiografia de tórax" /></label> : <label className="field"><span className="field-label">Categoria da demanda</span><select value={socialCategory} onChange={(event) => setSocialCategory(event.target.value)}>{socialReferralCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>}</div>{!isXray && <div className="field-grid field-grid-two"><label className="field"><span className="field-label">Responsável pelo acompanhamento</span><input maxLength={120} value={socialNewReferral.assignee} onChange={(event) => setSocialNewReferral((current) => ({ ...current, assignee: event.target.value }))} placeholder="Nome ou função" /></label><label className="field"><span className="field-label">Prioridade</span><select value={socialNewReferral.priority} onChange={(event) => setSocialNewReferral((current) => ({ ...current, priority: event.target.value as SocialReferralDraft['priority'] }))}><option value="routine">Rotina</option><option value="priority">Prioritária</option></select></label><label className="field"><span className="field-label">Prazo para retorno</span><input type="date" value={socialNewReferral.follow_up_due} onChange={(event) => setSocialNewReferral((current) => ({ ...current, follow_up_due: event.target.value }))} /></label><label className="field"><span className="field-label">Próxima ação (sem dados clínicos)</span><input maxLength={300} value={socialNewReferral.next_step} onChange={(event) => setSocialNewReferral((current) => ({ ...current, next_step: event.target.value }))} placeholder="Ex.: confirmar contato com a rede de apoio" /></label></div>}{isXray && <PatientAllergyAlert patient={patients.find((patient) => patient.reference === patientReference)} />}<button className="button button-primary" type="submit" disabled={saving || !patients.length}>{saving ? 'Salvando…' : 'Registrar'}</button></form>
    <section className="patient-list-panel"><div className="section-heading"><div><p className="eyebrow">{isXray ? 'HISTÓRICO' : 'ACOMPANHAMENTO'}</p><h2>{isXray ? 'Solicitações recentes' : 'Encaminhamentos sociais'}</h2></div><span className="module-total">{isXray ? items.length : visibleItems.length}</span></div>{!isXray && <div className="psychology-filter-row"><label className="field"><span className="field-label">Buscar paciente, categoria ou ação</span><input value={socialQuery} onChange={(event) => setSocialQuery(event.target.value)} placeholder="Nome, categoria, responsável ou próxima ação" /></label><label className="field"><span className="field-label">Situação</span><select value={socialStatus} onChange={(event) => setSocialStatus(event.target.value as typeof socialStatus)}><option value="all">Todas</option>{Object.entries(socialReferralStatuses).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label></div>}{loading ? <div className="history-empty">Carregando registros…</div> : visibleItems.length ? <div className="work-order-list">{visibleItems.map((item) => { const draft = socialDraft(item); return <article className="work-order-card" key={item.id}><div><h3>{patientName(item.patient_reference)}</h3><p>{isXray ? item.exam_label : item.referral_type}</p>{!isXray && <div className="social-referral-meta"><span className={`work-order-priority priority-${draft.priority}`}>{draft.priority === 'priority' ? 'Prioritária' : 'Rotina'}</span><span>Responsável: {draft.assignee || 'Não atribuído'}</span><span>Retorno: {draft.follow_up_due || 'Sem prazo'}</span><span>Próxima ação: {draft.next_step || 'A definir'}</span></div>}</div>{!isXray && canUpdateSocial ? <div className="social-referral-controls"><label className="field xray-status-control"><span className="field-label">Situação</span><select value={item.status} disabled={updatingId === item.id || item.status === 'completed' || item.status === 'cancelled'} onChange={(event) => void updateSocialReferral(item, { status: event.target.value as keyof typeof socialReferralStatuses })}>{Object.entries(socialReferralStatuses).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label><label className="field"><span className="field-label">Responsável</span><input maxLength={120} value={draft.assignee} onChange={(event) => setSocialDrafts((current) => ({ ...current, [item.id]: { ...draft, assignee: event.target.value } }))} /></label><label className="field"><span className="field-label">Prioridade</span><select value={draft.priority} onChange={(event) => setSocialDrafts((current) => ({ ...current, [item.id]: { ...draft, priority: event.target.value as SocialReferralDraft['priority'] } }))}><option value="routine">Rotina</option><option value="priority">Prioritária</option></select></label><label className="field"><span className="field-label">Prazo</span><input type="date" value={draft.follow_up_due} onChange={(event) => setSocialDrafts((current) => ({ ...current, [item.id]: { ...draft, follow_up_due: event.target.value } }))} /></label><label className="field"><span className="field-label">Próxima ação</span><input maxLength={300} value={draft.next_step} onChange={(event) => setSocialDrafts((current) => ({ ...current, [item.id]: { ...draft, next_step: event.target.value } }))} /></label><button className="button button-secondary" type="button" disabled={updatingId === item.id} onClick={() => void updateSocialReferral(item, { priority: draft.priority, assignee: draft.assignee, follow_up_due: draft.follow_up_due || null, next_step: draft.next_step })}>{updatingId === item.id ? 'Salvando…' : 'Salvar acompanhamento'}</button></div> : <span>{isXray ? (item.status === 'open' ? 'Aberto' : item.status) : socialReferralStatuses[item.status] ?? item.status}</span>}<time>{dateTime(item.created_at)}</time></article> })}</div> : <div className="history-empty">{items.length ? 'Nenhum encaminhamento corresponde aos filtros.' : 'Nenhum registro encontrado.'}</div>}</section>
    </>}
    {!isXray && socialTab === 'sharing' && <InterprofessionalSharePanel moduleId="social" patients={patients} />}
  </section>
}

type PsychologyTab = 'triage' | 'encounters' | 'sharing'
const psychologyTabs: PsychologyTab[] = ['triage', 'encounters', 'sharing']
const psychologyTabLabels: Record<PsychologyTab, string> = { triage: 'Acolhimento', encounters: 'Evoluções', sharing: 'Compartilhamento' }
type PsychologyServiceArea = 'psychology' | 'psychiatry'
type PsychologyReferral = { id: number; patient_reference: string; referral_type: string; status: string; priority: 'routine' | 'priority'; created_at: string }
type PsychologyEncounter = { id: number; patient_reference: string; encounter_type: 'intake' | 'follow_up' | 'psychiatry'; objective: string; evolution: string; plan: string; actor_name: string; created_at: string }
type PatientBehavioralStatus = { patient_reference: string; status: BehavioralStatus | null; updated_at: string | null }

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

export function PsychologyPage({ userId, canPrescribe, onOpenPhysician, onOpenPatientHistory }: { userId: string; canPrescribe: boolean; onOpenPhysician: () => void; onOpenPatientHistory: (reference: string) => void }) {
  const [serviceArea, setServiceArea] = useState<PsychologyServiceArea>('psychology')
  const [tab, setTab] = usePersistentTab(`scpo-tab-psychology-${userId}`, 'triage', psychologyTabs, psychologyTabLabels, true, 2)
  const [patients, setPatients] = useState<Patient[]>([])
  const [referrals, setReferrals] = useState<PsychologyReferral[]>([])
  const [encounters, setEncounters] = useState<PsychologyEncounter[]>([])
  const [behavioralStatuses, setBehavioralStatuses] = useState<Record<string, PatientBehavioralStatus>>({})
  const [behavioralStatusError, setBehavioralStatusError] = useState('')
  const [behavioralStatusLoading, setBehavioralStatusLoading] = useState(true)
  const [encountersPatient, setEncountersPatient] = useState('')
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

  useBreadcrumb('psychology-service-area', serviceArea === 'psychology' ? 'Psicologia' : 'Psiquiatria', 1)
  useBreadcrumb('psychology-selected-patient', tab === 'encounters' && recordPatient ? patients.find((patient) => patient.reference === recordPatient)?.name ?? null : null, 3)

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
    let current = true
    fetch('/api/v1/nursing/behavioral-status')
      .then(readApiResponse<{ statuses?: PatientBehavioralStatus[] }>)
      .then((result) => {
      if (current) {
        setBehavioralStatuses(Object.fromEntries(
          (result.statuses ?? []).map((status) => [status.patient_reference, status]),
        ))
        setBehavioralStatusError('')
      }
    }).catch((statusError) => {
      if (current) setBehavioralStatusError(statusError instanceof Error ? statusError.message : 'Não foi possível carregar o semáforo comportamental.')
    }).finally(() => {
      if (current) setBehavioralStatusLoading(false)
    })
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
  const visibleReferrals = referrals.filter((referral) => {
    const patient = patientName(referral.patient_reference)
    const matchesSearch = `${patient} ${referral.referral_type}`.toLocaleLowerCase('pt-BR')
      .includes(triageFilter.trim().toLocaleLowerCase('pt-BR'))
    const isPsychiatry = /psiquiatr/i.test(referral.referral_type)
    return matchesSearch && (serviceArea === 'psychiatry' ? isPsychiatry : !isPsychiatry)
  })
  const visibleEncounters = encounters.filter((encounter) =>
    serviceArea === 'psychiatry'
      ? encounter.encounter_type === 'psychiatry'
      : encounter.encounter_type !== 'psychiatry',
  )

  function selectServiceArea(area: PsychologyServiceArea) {
    setServiceArea(area)
    setTriageType(area === 'psychiatry' ? 'Avaliação psiquiátrica' : 'Acolhimento')
    setRecordType(area === 'psychiatry' ? 'psychiatry' : 'intake')
  }

  async function createReferral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    const referralType = (triageType === 'Outro'
      ? `${serviceArea === 'psychiatry' ? 'Psiquiatria' : 'Psicologia'}: ${customTriageType.trim()}`
      : triageType).slice(0, 80)
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
      <div><p className="eyebrow">MÓDULO · PSICOLOGIA / PSIQUIATRIA</p><h1>Acompanhamento psicológico e psiquiátrico</h1><p className="welcome-copy">Organize encaminhamentos, atendimentos e registros clínicos. Resumos compartilhados são consultados em outra aba e não entram automaticamente na fila.</p></div>
      <span className="module-icon module-icon-psychology"><Brain size={23} /></span>
    </div>
    <div className="psychology-privacy" role="note"><LockKeyhole size={18} /><span>Informações clínicas confidenciais: acesso restrito a contas autorizadas neste módulo. Registre apenas dados necessários ao atendimento.</span></div>
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {behavioralStatusError && <ToastMessage variant="error">{`Falha ao carregar o semáforo comportamental: ${behavioralStatusError}`}</ToastMessage>}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    <div className="admin-tabs module-tabs psychology-service-tabs" role="tablist" aria-label="Área profissional">
      <button type="button" role="tab" aria-selected={serviceArea === 'psychology'} className={`button ${serviceArea === 'psychology' ? 'button-primary' : 'button-secondary'}`} onClick={() => selectServiceArea('psychology')}><Brain size={16} /> Psicologia</button>
      <button type="button" role="tab" aria-selected={serviceArea === 'psychiatry'} className={`button ${serviceArea === 'psychiatry' ? 'button-primary' : 'button-secondary'}`} onClick={() => selectServiceArea('psychiatry')}><Stethoscope size={16} /> Psiquiatria</button>
    </div>
    {serviceArea === 'psychiatry' && <div className="psychology-prescription-guidance" role="note"><Stethoscope size={17} /><span>Para prescrever, o psiquiatra deve receber também o acesso ao módulo Médico. As prescrições ficam no fluxo médico compartilhado com Farmácia e Enfermagem, sem duplicar formulários aqui.</span>{canPrescribe && <button className="button button-secondary" type="button" onClick={onOpenPhysician}>Abrir módulo Médico</button>}</div>}
    <div className="admin-tabs module-tabs" role="tablist" aria-label="Áreas do módulo de Psicologia e Psiquiatria">
      <button type="button" role="tab" aria-selected={tab === 'triage'} className={`button ${tab === 'triage' ? 'button-primary' : 'button-secondary'}`} onClick={() => setTab('triage')}>Fila e triagem <span>{visibleReferrals.filter((item) => !['completed', 'cancelled'].includes(item.status)).length}</span></button>
      <button type="button" role="tab" aria-selected={tab === 'encounters'} className={`button ${tab === 'encounters' ? 'button-primary' : 'button-secondary'}`} onClick={() => { setEncountersPatient(''); setEncounterLoadError(''); setTab('encounters') }}>Atendimentos e registros</button>
      <button type="button" role="tab" aria-selected={tab === 'sharing'} className={`button ${tab === 'sharing' ? 'button-primary' : 'button-secondary'}`} onClick={() => setTab('sharing')}>Compartilhamento seletivo</button>
    </div>
    {tab === 'triage' && <>
      <form className="psychology-panel" onSubmit={(event) => void createReferral(event)}>
        <div className="section-heading"><div><p className="eyebrow">ENTRADA NA FILA</p><h2>Novo encaminhamento</h2></div></div>
        <div className="field-grid field-grid-two">
          <PatientSelect label="Paciente" patients={patients} value={triagePatient} onChange={setTriagePatient} required placeholder="Digite nome, quarto ou leito" optionLabel={(patient) => `${patient.name} · ${patient.room && patient.bed ? `Qto ${patient.room} · Leito ${patient.bed}` : 'sem acomodação'}`} />
          <PatientAllergyAlert patient={patients.find((patient) => patient.reference === triagePatient)} />
          <label className="field"><span className="field-label">Tipo de atendimento</span><select value={triageType} onChange={(event) => setTriageType(event.target.value)}>{serviceArea === 'psychiatry' ? <><option>Avaliação psiquiátrica</option><option>Consulta psiquiátrica</option><option>Acompanhamento psiquiátrico</option><option>Outro</option></> : <><option>Acolhimento</option><option>Avaliação psicológica</option><option>Acompanhamento psicológico</option><option>Outro</option></>}</select></label>
          {triageType === 'Outro' && <label className="field"><span className="field-label">Descreva o tipo</span><input required minLength={2} maxLength={68} value={customTriageType} onChange={(event) => setCustomTriageType(event.target.value)} /></label>}
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
        {loading ? <div className="history-empty">Carregando fila…</div> : visibleReferrals.length ? <div className="psychology-referral-list">{visibleReferrals.map((referral) => {
          const patient = patients.find((item) => item.reference === referral.patient_reference)
          return <article className={`psychology-referral-card patient-care-track-card ${patientCareTrackClass(patient?.treatment_track)}`} key={referral.id}>
          <div className="psychology-referral-main"><div><h3>{patientName(referral.patient_reference)}</h3><PatientCareTrackBadge track={patient?.treatment_track} />{patient?.room && patient.bed && !behavioralStatusLoading && !behavioralStatusError && <BehavioralStatusBadge status={behavioralStatuses[patient.reference]?.status ?? null} />}<p>{referral.referral_type}</p><small>{dateTime(referral.created_at)}</small></div><span className={`psychology-priority ${referral.priority === 'priority' ? 'is-priority' : ''}`}>{referral.priority === 'priority' ? 'Prioritária' : 'Rotina'}</span></div>
          <div className="psychology-referral-actions"><label className="field"><span className="field-label">Situação</span><select aria-label={`Situação do encaminhamento de ${patientName(referral.patient_reference)}`} disabled={updatingReferral === referral.id} value={referral.status} onChange={(event) => void updateReferral(referral.id, { status: event.target.value })}>{Object.entries(psychologyStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span className="field-label">Prioridade</span><select aria-label={`Prioridade do encaminhamento de ${patientName(referral.patient_reference)}`} disabled={updatingReferral === referral.id} value={referral.priority} onChange={(event) => void updateReferral(referral.id, { priority: event.target.value })}><option value="routine">Rotina</option><option value="priority">Prioritária</option></select></label></div>
        </article>
        })}</div> : <div className="history-empty">{referrals.length ? 'Nenhum encaminhamento corresponde à busca.' : 'A fila está vazia. Registre um encaminhamento para iniciar o acompanhamento.'}</div>}
      </section>
    </>}
    {tab === 'encounters' && <>
      <form className="psychology-panel" onSubmit={(event) => void createEncounter(event)}>
        <div className="section-heading"><div><p className="eyebrow">PRONTUÁRIO RESTRITO</p><h2>Novo registro de atendimento</h2></div></div>
        <div className="field-grid field-grid-two">
          <PatientSelect label="Paciente" patients={patients} value={recordPatient} onChange={(reference) => { setRecordPatient(reference); setEncountersPatient(''); setEncounterLoadError(''); setEncounters([]) }} required placeholder="Digite nome, quarto ou leito" optionLabel={(patient) => `${patient.name} · ${patient.room && patient.bed ? `Qto ${patient.room} · Leito ${patient.bed}` : 'sem acomodação'}`} />
          {recordPatient && <button className="button button-secondary" type="button" onClick={() => onOpenPatientHistory(recordPatient)}>Histórico assistencial completo</button>}
          <PatientAllergyAlert patient={patients.find((patient) => patient.reference === recordPatient)} />
          <label className="field"><span className="field-label">Tipo de registro</span><select value={recordType} onChange={(event) => setRecordType(event.target.value as PsychologyEncounter['encounter_type'])}>{Object.entries(psychologyEncounterTypes).filter(([value]) => serviceArea === 'psychiatry' ? value === 'psychiatry' : value !== 'psychiatry').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field psychology-field-wide"><span className="field-label">Objetivo do atendimento</span><textarea required minLength={3} maxLength={500} value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Finalidade do encontro, em termos objetivos" /></label>
          <label className="field psychology-field-wide"><span className="field-label">Evolução</span><textarea required minLength={3} maxLength={4000} value={evolution} onChange={(event) => setEvolution(event.target.value)} placeholder="Registre a evolução profissional pertinente ao atendimento" /></label>
          <label className="field psychology-field-wide"><span className="field-label">Plano e encaminhamentos</span><textarea maxLength={4000} value={plan} onChange={(event) => setPlan(event.target.value)} placeholder="Próximos passos e encaminhamentos acordados" /></label>
        </div>
        <p className="psychology-help">Autoria e horário são registrados automaticamente. Os registros são preservados no histórico; correções devem ser feitas como novo adendo, conforme protocolo da instituição.</p>
        <button className="button button-primary" type="submit" disabled={saving || !recordPatient}>{saving ? 'Salvando…' : 'Salvar registro clínico'} <CheckCircle2 size={16} /></button>
      </form>
      <section className="psychology-panel">
        <div className="section-heading"><div><p className="eyebrow">HISTÓRICO INDIVIDUAL</p><h2>Registros de {serviceArea === 'psychiatry' ? 'Psiquiatria' : 'Psicologia'}</h2></div><span className="module-total">{visibleEncounters.length}</span></div>
        {!recordPatient ? <div className="history-empty">Selecione um paciente acima para consultar apenas o histórico individual autorizado.</div> : encounterLoadError ? <ToastMessage variant="error">{encounterLoadError}</ToastMessage> : encountersLoading ? <div className="history-empty">Carregando histórico confidencial…</div> : visibleEncounters.length ? <div className="psychology-encounter-list">{visibleEncounters.map((encounter) => <article className="psychology-encounter-card" key={encounter.id}>
          <div className="psychology-encounter-heading"><div><h3>{psychologyEncounterTypes[encounter.encounter_type]}</h3><p>{patientName(encounter.patient_reference)}</p>{patients.find((patient) => patient.reference === encounter.patient_reference)?.room && patients.find((patient) => patient.reference === encounter.patient_reference)?.bed && !behavioralStatusLoading && !behavioralStatusError && <BehavioralStatusBadge status={behavioralStatuses[encounter.patient_reference]?.status ?? null} />}</div><div><time>{dateTime(encounter.created_at)}</time><small>{encounter.actor_name}</small></div></div>
          <div className="psychology-encounter-field"><strong>Objetivo</strong><p>{encounter.objective}</p></div>
          <div className="psychology-encounter-field"><strong>Evolução</strong><p>{encounter.evolution}</p></div>
          {encounter.plan && <div className="psychology-encounter-field"><strong>Plano e encaminhamentos</strong><p>{encounter.plan}</p></div>}
        </article>)}</div> : <div className="history-empty">Nenhum registro clínico para este paciente.</div>}
      </section>
    </>}
    {tab === 'sharing' && <InterprofessionalSharePanel moduleId="psychology" patients={patients} />}
  </section>
}
