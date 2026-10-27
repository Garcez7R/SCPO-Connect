import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, ArrowRight, BadgeCheck, CheckCircle2, ClipboardList, ClipboardPlus, Printer, Search, ShieldCheck, SprayCan, Wrench } from 'lucide-react'
import { readApiResponse } from '../api'
import PatientSelect from '../components/PatientSelect'
import { usePersistentTab } from '../components/PageNavigationContext'
import ToastMessage from '../components/ToastMessage'
import PrintSelectionPanel from '../components/PrintSelectionPanel'
import { printRows, type PrintRow } from '../printReport'
import { AssetMaintenancePanel } from './ManagementOperationsPage'
import { triggerMobileFeedback } from '../mobileFeedback'
import { hygieneAreaLabels, hygieneRequestTypeLabels, type HygieneArea, type HygieneRequestType } from '../operationsLabels'

type AuthUser = { id: string; username: string; name: string; modules: string[]; permissions: Record<string, string[]> }
type Patient = { reference: string; name: string; room: string; bed: string }
type WorkOrderStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'
type WorkOrderPriority = 'normal' | 'high' | 'urgent'
type WorkOrder = { id: string; order_number?: string; title: string; description: string; service_type: string; department: string; location: string; patient_reference?: string | null; asset_id?: string | null; priority: WorkOrderPriority; status: WorkOrderStatus; requester_id: string; requester_name: string; updated_by: string; created_at: string; updated_at: string }
type StatusTone = 'neutral' | 'progress' | 'warning' | 'success' | 'critical'

function patientLocationLabel(patient: Pick<Patient, 'room' | 'bed'>) {
  return patient.room.trim() && patient.bed.trim() ? `Quarto ${patient.room} · leito ${patient.bed}` : 'Sem quarto/leito atribuído'
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function localDateKey(value: string) {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const workOrderStatuses: Record<WorkOrderStatus, string> = {
  open: 'Aberta', in_progress: 'Em curso', completed: 'Finalizada', cancelled: 'Cancelada',
}
const workOrderStatusTones: Record<WorkOrderStatus, StatusTone> = {
  open: 'warning', in_progress: 'progress', completed: 'success', cancelled: 'neutral',
}

const workOrderPriorities: Record<WorkOrderPriority, string> = {
  normal: 'Normal', high: 'Alta', urgent: 'Urgente',
}
const serviceTabs = ['maintenance', 'hygiene'] as const
const serviceTabLabels: Record<(typeof serviceTabs)[number], string> = { maintenance: 'Manutenção', hygiene: 'Higienização' }
const maintenanceQueueTabs = ['requests', 'assets'] as const
const maintenanceQueueTabLabels: Record<(typeof maintenanceQueueTabs)[number], string> = { requests: 'Solicitações', assets: 'Patrimônio' }

export function WorkOrdersPage({ user }: { user: AuthUser }) {
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [serviceTab, setServiceTab] = usePersistentTab(`scpo-tab-work-orders-${user.id}`, 'maintenance', serviceTabs, serviceTabLabels)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [form, setForm] = useState({ title: '', category: '', description: '', department: '', customDepartment: '', unit: '', location: '', assetCode: '', patientReference: '', priority: 'normal' as WorkOrderPriority })
  const canLookupPatients = user.modules.some((module) =>
    ['patients', 'nursing', 'reception', 'therapy', 'nutrition', 'social', 'xray', 'maintenance', 'psychology', 'management'].includes(module)
      && user.permissions[module]?.includes('consultar'),
  )

  async function loadOrders() {
    try {
      const response = await fetch('/api/v1/maintenance/orders')
      const data = await readApiResponse<{ orders?: WorkOrder[] }>(response)
      setOrders(data.orders ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar as solicitações.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    const loadOrdersForUser = async () => {
      try {
        const response = await fetch('/api/v1/maintenance/orders')
        const data = await readApiResponse<{ orders?: WorkOrder[] }>(response)
        if (active) {
          setOrders(data.orders ?? [])
          setError('')
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar as solicitações.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadOrdersForUser()
    return () => { active = false }
  }, [user.id])
  useEffect(() => {
    if (!canLookupPatients) return
    let active = true
    const loadPatients = async () => {
      try {
        const response = await fetch('/api/v1/nursing/patients')
        const data = await readApiResponse<{ patients?: Patient[] }>(response)
        if (active) setPatients(data.patients ?? [])
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar pacientes.')
      }
    }
    void loadPatients()
    return () => { active = false }
  }, [canLookupPatients, user.id])
  const orderPrintRows: PrintRow[] = orders.map((order) => ({ id: order.id, date: order.created_at, title: `${order.order_number ?? order.id} · ${order.title}`, fields: [['Número da OS', order.order_number ?? order.id], ['Status', workOrderStatuses[order.status]], ['Prioridade', workOrderPriorities[order.priority]], ['Tipo', order.service_type], ['Setor', order.department], ['Local', order.location], ['Solicitante', order.requester_name], ['Descrição', order.description]] }))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reviewing) { setReviewing(true); return }
    setSaving(true)
    setNotice('')
    setError('')
    try {
      const response = await fetch('/api/v1/maintenance/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          service_type: form.category,
          department: (form.department === 'Outro' ? form.customDepartment : form.department).trim(),
          location: [form.unit && `Unidade: ${form.unit}`, form.location && `Local: ${form.location.trim()}`, form.assetCode && `Patrimônio: ${form.assetCode.trim()}`].filter(Boolean).join(' · '),
          asset_tag: form.assetCode.trim() || null,
          patient_reference: form.patientReference || null,
          priority: form.priority,
        }),
      })
      const data = await readApiResponse<WorkOrder>(response)
      setOrders((current) => [data, ...current])
      setForm({ title: '', category: '', description: '', department: '', customDepartment: '', unit: '', location: '', assetCode: '', patientReference: '', priority: 'normal' })
      setReviewing(false)
      setNotice('Ordem de serviço aberta. A equipe de manutenção poderá acompanhar a solicitação.')
      triggerMobileFeedback()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Falha ao abrir a ordem de serviço.')
    } finally {
      setSaving(false)
    }
  }

  return <section className="work-orders-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">SERVIÇOS INTERNOS</p><h1>Ordens de serviço</h1><p className="welcome-copy">Escolha o serviço para encaminhar o pedido à equipe responsável.</p></div><span className="module-icon module-icon-maintenance"><ClipboardPlus size={23} /></span></div>
    <div className="service-tabs module-tabs" role="tablist" aria-label="Tipo de ordem de serviço">
      <button className={`button ${serviceTab === 'maintenance' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={serviceTab === 'maintenance'} onClick={() => { setServiceTab('maintenance'); setError(''); setNotice('') }}><Wrench size={16} /> Manutenção</button>
      <button className={`button ${serviceTab === 'hygiene' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={serviceTab === 'hygiene'} onClick={() => { setServiceTab('hygiene'); setError(''); setNotice('') }}><ShieldCheck size={16} /> Higienização</button>
    </div>
    {serviceTab === 'maintenance' ? <>
    <form className="work-order-form" onSubmit={(event) => void submit(event)}>
      <div className="section-heading"><div><p className="eyebrow">NOVA SOLICITAÇÃO</p><h2>{reviewing ? 'Revise antes de enviar' : 'Descreva o que precisa'}</h2><p className="welcome-copy">{reviewing ? 'Confira os dados do chamado e confirme a abertura.' : 'Informe o tipo de serviço, o local e o que precisa ser feito.'}</p></div></div>
      {!reviewing ? <>
        <div className="field-grid field-grid-two">
          <label className="field"><span className="field-label">Tipo de serviço</span><select required value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="">Selecione uma categoria</option><option>Elétrica</option><option>Hidráulica</option><option>Climatização</option><option>Equipamento</option><option>Estrutura e mobiliário</option><option>Rede e telefonia</option><option>Outro serviço</option></select></label>
          <label className="field"><span className="field-label">Assunto</span><input required minLength={5} maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: torneira com vazamento" /></label>
          <label className="field"><span className="field-label">Setor solicitante</span><select required value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value, customDepartment: '' })}><option value="">Selecione seu setor</option><option>Enfermagem</option><option>Farmácia</option><option>Raio X</option><option>Serviço Social</option><option>Nutrição</option><option>Higienização</option><option>Psicologia / Psiquiatria</option><option>Recepção</option><option>Administração</option><option>Outro</option></select></label>
          {form.department === 'Outro' && <label className="field"><span className="field-label">Informe o setor</span><input required minLength={2} maxLength={100} value={form.customDepartment} onChange={(event) => setForm({ ...form, customDepartment: event.target.value })} /></label>}
          <label className="field"><span className="field-label">Unidade</span><select value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })}><option value="">Selecione a unidade</option><option>Hospital</option><option>Pronto atendimento</option><option>Área externa</option><option>Outro</option></select></label>
          <label className="field"><span className="field-label">Quarto, sala ou local</span><input maxLength={120} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Ex.: quarto 3, sala de espera" /></label>
          {canLookupPatients && <PatientSelect label="Paciente relacionado (opcional)" patients={patients} value={form.patientReference} onChange={(reference) => setForm({ ...form, patientReference: reference })} emptyLabel="Sem vínculo com paciente" optionLabel={(patient) => `${patient.name} · ${patientLocationLabel(patient)}`} />}
          <label className="field"><span className="field-label">Número do patrimônio (opcional)</span><input maxLength={40} value={form.assetCode} onChange={(event) => setForm({ ...form, assetCode: event.target.value })} placeholder="Etiqueta do equipamento" /></label>
          <label className="field"><span className="field-label">Prioridade</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as WorkOrderPriority })}><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select><span className="field-hint">Use urgente quando houver impacto imediato no funcionamento ou na segurança.</span></label>
        </div>
        <label className="field"><span className="field-label">Descrição do serviço</span><textarea required minLength={5} maxLength={1450} rows={5} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Descreva o problema observado, quando começou e o resultado esperado." /><span className="field-hint">{form.description.length}/1.450 caracteres</span></label>
        <p className="work-order-privacy">Não inclua nome, diagnóstico ou outros dados de pacientes na descrição da ordem.</p>
      </> : <div className="work-order-review"><div><small>Categoria</small><strong>{form.category}</strong></div><div><small>Assunto</small><strong>{form.title}</strong></div><div><small>Setor solicitante</small><strong>{form.department === 'Outro' ? form.customDepartment : form.department}</strong></div><div><small>Localização</small><strong>{[form.unit && `Unidade: ${form.unit}`, form.location && `Local: ${form.location}`, form.assetCode && `Patrimônio: ${form.assetCode}`].filter(Boolean).join(' · ') || 'Não informado'}</strong></div>{form.patientReference && <div><small>Paciente</small><strong>{patients.find((patient) => patient.reference === form.patientReference)?.name ?? 'Paciente selecionado'}</strong></div>}<div><small>Prioridade</small><strong>{workOrderPriorities[form.priority]}</strong></div><div className="work-order-review-description"><small>Descrição</small><p>{form.description}</p></div></div>}
      {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
      {error && <ToastMessage variant="error">{error}</ToastMessage>}
      <div className="work-order-form-actions">{reviewing && <button className="button button-secondary" type="button" onClick={() => setReviewing(false)} disabled={saving}><ArrowLeft size={16} /> Editar solicitação</button>}<button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Enviando…' : reviewing ? 'Confirmar abertura' : 'Revisar solicitação'} {reviewing ? <BadgeCheck size={16} /> : <ArrowRight size={16} />}</button></div>
    </form>
    <section className="work-order-list-panel"><div className="section-heading"><div><p className="eyebrow">ACOMPANHAMENTO</p><h2>Minhas solicitações</h2></div><button className="button button-secondary" type="button" onClick={() => void loadOrders()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar'}</button></div>
      {loading ? <div className="history-empty">Carregando solicitações…</div> : orders.length ? <div className="work-order-list">{orders.map((order) => <WorkOrderCard key={order.id} order={order} />)}</div> : <div className="history-empty"><ClipboardList size={20} /><span>Você ainda não abriu ordens de serviço.</span></div>}
    </section>
    <PrintSelectionPanel title="Minhas ordens de serviço" rows={orderPrintRows} />
    </> : <HygieneRequestForm />}
  </section>
}

type HygieneStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'
type HygienePriority = 'normal' | 'high' | 'urgent'
type HygieneRequest = {
  id: string
  request_number?: string
  request_type: HygieneRequestType
  custom_type: string | null
  unit: string
  area: HygieneArea
  bed_id: string | null
  bed_status: 'none' | 'cleaning' | 'release_pending' | 'available'
  bed_release_error?: string
  location: string
  description: string
  priority: HygienePriority
  status: HygieneStatus
  assignee: string
  requester_name: string
  updated_by: string
  created_at: string
  updated_at: string
}
type HygieneBed = { id: string; unit_name: string; room: string; label: string; status: string; occupied: boolean }

const hygieneStatuses: Record<HygieneStatus, string> = {
  open: 'Aguardando atendimento',
  in_progress: 'Em andamento',
  completed: 'Concluída',
  cancelled: 'Cancelada',
}
const hygieneStatusTones: Record<HygieneStatus, StatusTone> = {
  open: 'warning', in_progress: 'progress', completed: 'success', cancelled: 'neutral',
}

function HygieneRequestForm() {
  const [beds, setBeds] = useState<HygieneBed[]>([])
  const [bedLoadError, setBedLoadError] = useState('')
  useEffect(() => {
    let active = true
    const loadBeds = async () => {
      try {
        const response = await fetch('/api/v1/nursing/beds')
        const data = await readApiResponse<{ beds?: HygieneBed[] }>(response)
        if (active) {
          setBeds(data.beds ?? [])
          setBedLoadError('')
        }
      } catch (loadError) {
        if (active) setBedLoadError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os leitos.')
      }
    }
    void loadBeds()
    return () => { active = false }
  }, [])
  const [form, setForm] = useState({
    request_type: 'routine' as HygieneRequestType,
    custom_type: '',
    unit: '',
    area: '' as HygieneArea | '',
    bed_id: '',
    location: '',
    description: '',
    priority: 'normal' as HygienePriority,
  })
  const [saving, setSaving] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const availableBeds = beds.filter((bed) => bed.status === 'available' && !bed.occupied)
  const selectedBed = beds.find((bed) => bed.id === form.bed_id)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reviewing) {
      setReviewing(true)
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/v1/hygiene/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, custom_type: form.custom_type.trim() || null }),
      })
      const created = await readApiResponse<HygieneRequest>(response)
      setForm({ request_type: 'routine', custom_type: '', unit: '', area: '', bed_id: '', location: '', description: '', priority: 'normal' })
      setReviewing(false)
      setNotice(created.bed_id
        ? 'Solicitação enviada; o leito foi bloqueado para higienização.'
        : 'Solicitação enviada à equipe de Higienização.')
      triggerMobileFeedback()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Falha ao registrar a solicitação.')
    } finally {
      setSaving(false)
    }
  }

  return <form className="work-order-form" onSubmit={(event) => void submit(event)}>
      <div className="section-heading"><div><p className="eyebrow">NOVA SOLICITAÇÃO · HIGIENIZAÇÃO</p><h2>{reviewing ? 'Revise antes de enviar' : 'Descreva o serviço'}</h2><p className="welcome-copy">{reviewing ? 'Confira os dados do chamado e confirme o envio à equipe.' : 'Informe o serviço, a unidade e o local que precisa de atendimento.'}</p></div></div>
      {!reviewing ? <div className="field-grid field-grid-two">
        <label className="field"><span className="field-label">Tipo de solicitação</span><select required value={form.request_type} onChange={(event) => setForm({ ...form, request_type: event.target.value as HygieneRequestType, custom_type: '' })}>{Object.entries(hygieneRequestTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field"><span className="field-label">Unidade</span><select required disabled={Boolean(form.bed_id)} value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })}><option value="">Selecione</option><option>Hospital</option><option>Pronto atendimento</option><option>Área externa</option><option>Outra unidade</option>{selectedBed && !['Hospital', 'Pronto atendimento', 'Área externa', 'Outra unidade'].includes(selectedBed.unit_name) && <option value={selectedBed.unit_name}>{selectedBed.unit_name}</option>}</select></label>
        <label className="field"><span className="field-label">Área</span><select required disabled={Boolean(form.bed_id)} value={form.area} onChange={(event) => setForm({ ...form, area: event.target.value as HygieneArea })}><option value="">Selecione</option>{Object.entries(hygieneAreaLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {form.area === 'room' && <label className="field"><span className="field-label">Vincular leito físico (opcional)</span><select value={form.bed_id} onChange={(event) => { const bedId = event.target.value; const bed = availableBeds.find((item) => item.id === bedId); setForm({ ...form, bed_id: bedId, unit: bed?.unit_name ?? form.unit, location: bed ? `Quarto ${bed.room} · Leito ${bed.label}` : form.location }) }}><option value="">Solicitação sem vínculo a leito</option>{availableBeds.map((bed) => <option key={bed.id} value={bed.id}>{bed.unit_name} · Quarto {bed.room} · Leito {bed.label}</option>)}</select>{bedLoadError && <span className="field-hint">Não foi possível carregar os leitos físicos: {bedLoadError}</span>}</label>}
        <label className="field"><span className="field-label">Quarto, sala ou referência do local</span><input required minLength={2} maxLength={120} value={form.location} readOnly={Boolean(form.bed_id)} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Ex.: quarto 3, sala de espera" /></label>
        <label className="field"><span className="field-label">Prioridade</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as HygienePriority })}><option value="normal">Rotina</option><option value="high">Prioritária</option><option value="urgent">Urgente</option></select><span className="field-hint">Use urgente conforme os critérios e canais definidos pela instituição.</span></label>
        {form.request_type === 'other' && <label className="field"><span className="field-label">Tipo de solicitação</span><input required minLength={3} maxLength={80} value={form.custom_type} onChange={(event) => setForm({ ...form, custom_type: event.target.value })} placeholder="Descreva o serviço necessário" /></label>}
        <label className="field hygiene-field-wide"><span className="field-label">{form.request_type === 'restock' ? 'Material e quantidade' : 'Detalhes operacionais (opcional)'}</span><textarea maxLength={1000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder={form.request_type === 'restock' ? 'Informe o material e a quantidade necessária' : 'Descreva o serviço e condições relevantes do local'} /></label>
      </div> : <div className="work-order-review"><div><small>Tipo de solicitação</small><strong>{form.request_type === 'other' ? form.custom_type : hygieneRequestTypeLabels[form.request_type]}</strong></div><div><small>Unidade e local</small><strong>{form.unit} · {form.location}</strong></div>{selectedBed && <div><small>Leito vinculado</small><strong>{selectedBed.unit_name} · Quarto {selectedBed.room} · Leito {selectedBed.label}</strong></div>}<div><small>Área e prioridade</small><strong>{hygieneAreaLabels[form.area as HygieneArea]} · {workOrderPriorities[form.priority]}</strong></div><div className="work-order-review-description"><small>Detalhes</small><p>{form.description || 'Sem detalhes adicionais.'}</p></div></div>}
      {error && <ToastMessage variant="error">{error}</ToastMessage>}
      {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
      <p className="work-order-privacy">Não inclua nomes, diagnósticos ou outros dados de pacientes na descrição.</p>
      <div className="work-order-form-actions">{reviewing && <button className="button button-secondary" type="button" onClick={() => setReviewing(false)} disabled={saving}><ArrowLeft size={16} /> Editar solicitação</button>}<button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Enviando…' : reviewing ? 'Confirmar envio' : 'Revisar solicitação'} {reviewing ? <BadgeCheck size={16} /> : <ArrowRight size={16} />}</button></div>
  </form>
}

export function HygienePage({ user }: { user: AuthUser }) {
  const [requests, setRequests] = useState<HygieneRequest[]>([])
  const [drafts, setDrafts] = useState<Record<string, { status: HygieneStatus; assignee: string }>>({})
  const [filter, setFilter] = useState<'active' | 'all' | HygieneStatus>('active')
  const [query, setQuery] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [alertsEnabled, setAlertsEnabled] = useState(false)
  const seenRequestIds = useRef(new Set<string>())
  const hasNotificationBaseline = useRef(false)
  const audioContextRef = useRef<AudioContext | null>(null)

  async function loadRequests() {
    try {
      const response = await fetch('/api/v1/hygiene/requests')
      const data = await readApiResponse<{ requests?: HygieneRequest[] }>(response)
      setRequests(data.requests ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar as solicitações de higienização.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    const loadRequestsForUser = async () => {
      try {
        const response = await fetch('/api/v1/hygiene/requests')
        const data = await readApiResponse<{ requests?: HygieneRequest[] }>(response)
        if (active) {
          setRequests(data.requests ?? [])
          setError('')
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar as solicitações de higienização.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadRequestsForUser()
    return () => { active = false }
  }, [user.id])

  useEffect(() => {
    let active = true
    const checkForNewRequests = async () => {
      try {
        const data = await readApiResponse<{ requests?: HygieneRequest[] }>(
          await fetch('/api/v1/hygiene/requests'),
        )
        if (!active) return
        const requests = data.requests ?? []
        const newRequests = requests.filter((request) => request.status === 'open' && !seenRequestIds.current.has(request.id))
        setRequests(requests)
        if (hasNotificationBaseline.current && alertsEnabled && newRequests.length) {
          setNotice(`${newRequests.length} nova(s) solicitação(ões) de higienização aguardam atendimento.`)
          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification('Nova solicitação de higienização', {
                body: 'Há uma nova solicitação aguardando a equipe.',
                icon: '/scpo-connect-icon.png',
              })
            } catch (notificationError) {
              setError(notificationError instanceof Error ? `Aviso do navegador indisponível: ${notificationError.message}` : 'Aviso do navegador indisponível.')
            }
          }
          try {
            const audio = audioContextRef.current
            if (!audio || audio.state !== 'running') throw new Error('Reative o áudio do navegador nesta tela.')
            const oscillator = audio.createOscillator()
            const gain = audio.createGain()
            oscillator.frequency.value = 880
            gain.gain.setValueAtTime(0.15, audio.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.35)
            oscillator.connect(gain)
            gain.connect(audio.destination)
            oscillator.start()
            oscillator.stop(audio.currentTime + 0.35)
          } catch (audioError) {
            setError(audioError instanceof Error ? `Alerta sonoro indisponível: ${audioError.message}` : 'Alerta sonoro indisponível.')
          }
        }
        for (const request of requests) seenRequestIds.current.add(request.id)
        hasNotificationBaseline.current = true
      } catch (pollError) {
        if (active) setError(pollError instanceof Error ? `Não foi possível verificar novas solicitações: ${pollError.message}` : 'Não foi possível verificar novas solicitações.')
      }
    }
    void checkForNewRequests()
    const interval = window.setInterval(() => void checkForNewRequests(), 20_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [alertsEnabled])

  useEffect(() => () => {
    if (audioContextRef.current) void audioContextRef.current.close()
  }, [])

  async function enableAlerts() {
    setError('')
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission()
      }
      if (typeof AudioContext !== 'undefined') {
        const audio = new AudioContext()
        await audio.resume()
        audioContextRef.current = audio
      }
      setAlertsEnabled(true)
      setNotice('Alertas ativos enquanto esta tela estiver aberta; a fila é verificada a cada 20 segundos. Som e notificações podem depender do suporte, das permissões e das configurações do dispositivo.')
    } catch (permissionError) {
      setError(permissionError instanceof Error ? `Não foi possível ativar os avisos: ${permissionError.message}` : 'Não foi possível ativar os avisos.')
    }
  }

  const visibleRequests = requests.filter((request) => {
    const matchesStatus = filter === 'all' || (filter === 'active'
      ? request.status === 'open' || request.status === 'in_progress'
      : request.status === filter)
    const requestTimestamp = new Date(request.created_at).getTime()
    const startTimestamp = fromDate ? new Date(fromDate).getTime() : null
    const endTimestamp = toDate ? new Date(toDate).getTime() : null
    const searchable = `${request.unit} ${request.location} ${request.description} ${request.custom_type ?? ''} ${request.requester_name} ${request.assignee} ${hygieneAreaLabels[request.area]} ${hygieneRequestTypeLabels[request.request_type]}`.toLocaleLowerCase('pt-BR')
    return matchesStatus && (!startTimestamp || requestTimestamp >= startTimestamp) && (!endTimestamp || requestTimestamp <= endTimestamp)
      && searchable.includes(query.trim().toLocaleLowerCase('pt-BR'))
  })
  const statusSummary = visibleRequests.reduce<Record<HygieneStatus, number>>((summary, request) => {
    summary[request.status] += 1
    return summary
  }, { open: 0, in_progress: 0, completed: 0, cancelled: 0 })
  const activeCount = visibleRequests.filter((request) => request.status === 'open' || request.status === 'in_progress').length
  const hygienePrintRows: PrintRow[] = visibleRequests.map((request) => ({
    id: request.id,
    date: localDateKey(request.created_at),
    title: `${request.request_number ?? request.id} · ${request.request_type === 'other' ? request.custom_type ?? hygieneRequestTypeLabels.other : hygieneRequestTypeLabels[request.request_type]}`,
    fields: [
      ['Número da solicitação', request.request_number ?? request.id],
      ['Status', hygieneStatuses[request.status]],
      ['Prioridade', workOrderPriorities[request.priority]],
      ['Unidade', request.unit],
      ['Área', hygieneAreaLabels[request.area]],
      ['Local', request.location],
      ['Responsável', request.assignee || 'Não atribuído'],
      ['Solicitante', request.requester_name],
      ['Descrição', request.description],
    ],
  }))

  function printHygieneRequests() {
    if (!printRows('Relatório de Higienização', hygienePrintRows, fromDate, toDate)) {
      setError('Permita a janela de impressão para este site e tente novamente.')
    }
  }

  async function saveRequest(request: HygieneRequest) {
    const draft = drafts[request.id] ?? { status: request.status, assignee: request.assignee }
    setUpdating(request.id)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/v1/hygiene/requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: draft.status, assignee: draft.assignee }),
      })
      const data = await readApiResponse<HygieneRequest>(response)
      setRequests((current) => current.map((item) => item.id === data.id ? data : item))
      setDrafts((current) => { const next = { ...current }; delete next[request.id]; return next })
      if (data.bed_release_error) {
        setError(`Higienização concluída, mas o leito permanece bloqueado: ${data.bed_release_error}`)
        setNotice('A liberação do leito pode ser tentada novamente após verificar a conexão.')
      } else {
        setNotice('Solicitação atualizada.')
      }
      triggerMobileFeedback()
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Falha ao atualizar a solicitação.')
    } finally {
      setUpdating('')
    }
  }

  async function retryBedRelease(request: HygieneRequest) {
    setUpdating(request.id)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/v1/hygiene/requests/${request.id}/bed-release`, { method: 'POST' })
      const data = await readApiResponse<HygieneRequest>(response)
      setRequests((current) => current.map((item) => item.id === data.id ? data : item))
      setNotice('Leito liberado após a confirmação da conclusão da higienização.')
    } catch (releaseError) {
      setError(releaseError instanceof Error ? releaseError.message : 'Não foi possível liberar o leito.')
    } finally {
      setUpdating('')
    }
  }

  return <section className="work-orders-page maintenance-queue-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">EQUIPE · HIGIENIZAÇÃO</p><h1>Higienização</h1><p className="welcome-copy">Receba, priorize, atribua e acompanhe as solicitações da equipe.</p></div><span className="module-icon module-icon-hygiene"><SprayCan size={23} /></span></div>
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    <section className="work-order-list-panel">
      <div className="section-heading"><div><p className="eyebrow">PAINEL OPERACIONAL</p><h2>Solicitações recebidas <span className="module-total">{visibleRequests.length}</span></h2></div><div className="maintenance-actions"><button className={`button ${alertsEnabled ? 'button-primary' : 'button-secondary'}`} type="button" onClick={() => void enableAlerts()} disabled={alertsEnabled}>{alertsEnabled ? <><CheckCircle2 size={16} /> Alertas ativos</> : 'Ativar alertas'}</button><button className="button button-secondary" type="button" onClick={printHygieneRequests} disabled={loading || !visibleRequests.length}><Printer size={16} /> Imprimir lista</button><button className="button button-secondary" type="button" onClick={() => void loadRequests()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar fila'}</button></div></div>
      <div className="hygiene-summary maintenance-report-summary" aria-label="Resumo dos resultados">
        <article className="status-tone-neutral"><strong>{visibleRequests.length}</strong><span>Solicitações</span></article>
        {Object.entries(hygieneStatuses).map(([status, label]) => <article className={`status-tone-${hygieneStatusTones[status as HygieneStatus]}`} key={status}><strong>{statusSummary[status as HygieneStatus]}</strong><span>{label}</span></article>)}
        <article className="status-tone-neutral"><strong>{activeCount}</strong><span>Ativas</span></article>
      </div>
      <div className="maintenance-filters hygiene-queue-filters"><label className="field"><span className="field-label">De (data e hora)</span><input type="datetime-local" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} /></label><label className="field"><span className="field-label">Até (data e hora)</span><input type="datetime-local" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} /></label><label className="field"><span className="field-label">Situação</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="active">Ativas</option><option value="all">Todas</option>{Object.entries(hygieneStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field maintenance-query"><span className="field-label">Busca</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Unidade, local, tipo ou responsável" /></label><div className="maintenance-filter-actions"><button className="button button-secondary" type="button" onClick={() => { setFromDate(''); setToDate(''); setFilter('active'); setQuery('') }}>Limpar filtros</button></div></div>
      {loading ? <div className="history-empty">Carregando fila…</div> : visibleRequests.length ? <div className="hygiene-request-list">{visibleRequests.map((request) => {
        const draft = drafts[request.id] ?? { status: request.status, assignee: request.assignee }
        return <details className="hygiene-request-card" key={request.id}>
          <summary className="hygiene-request-heading"><div><span className={`work-order-priority priority-${request.priority}`}>{workOrderPriorities[request.priority]}</span><small className="service-request-number">{request.request_number ?? request.id}</small><h3>{request.request_type === 'other' ? request.custom_type : hygieneRequestTypeLabels[request.request_type]}</h3><p>{request.unit} · {hygieneAreaLabels[request.area]} · {request.location}</p></div><span className={`work-order-status status-${request.status} status-tone-${hygieneStatusTones[request.status]}`}>{hygieneStatuses[request.status]}</span></summary>
          {request.bed_id && <div className={`hygiene-bed-link hygiene-bed-link-${request.bed_status}`}><strong>{request.bed_status === 'available' ? 'Leito liberado' : request.bed_status === 'release_pending' ? 'Higienização concluída · liberação pendente' : request.bed_status === 'cleaning' ? 'Leito em higienização' : 'Situação do leito não informada'}</strong>{request.bed_status !== 'available' && request.bed_status !== 'none' && <span>O leito não pode receber nova internação até a liberação confirmada.</span>}</div>}
          {request.description && <p className="hygiene-request-description">{request.description}</p>}
          <div className="hygiene-request-meta"><span>Solicitado por <strong>{request.requester_name}</strong></span><time>{dateTime(request.created_at)}</time></div>
          <div className="hygiene-request-controls"><label className="field"><span className="field-label">Responsável</span><input maxLength={120} value={draft.assignee} onChange={(event) => setDrafts((current) => ({ ...current, [request.id]: { ...draft, assignee: event.target.value } }))} placeholder="Atribuir membro da equipe" /></label><label className="field"><span className="field-label">Situação</span><select value={draft.status} onChange={(event) => setDrafts((current) => ({ ...current, [request.id]: { ...draft, status: event.target.value as HygieneStatus } }))}><option value="open">Aguardando atendimento</option><option value="in_progress">Em andamento</option><option value="completed">Concluída</option><option value="cancelled" disabled={Boolean(request.bed_id)}>Cancelada</option></select></label><button className="button button-secondary" type="button" onClick={() => void saveRequest(request)} disabled={updating === request.id || (draft.status === request.status && draft.assignee === request.assignee)}>{updating === request.id ? 'Salvando…' : 'Salvar atualização'}</button>{request.bed_id && request.status === 'completed' && request.bed_status !== 'available' && <button className="button button-primary" type="button" onClick={() => void retryBedRelease(request)} disabled={updating === request.id}>{updating === request.id ? 'Verificando…' : 'Tentar liberar leito'}</button>}</div>
          <small className="hygiene-updated">Última atualização por {request.updated_by} · {dateTime(request.updated_at)}</small>
        </details>
      })}</div> : <div className="history-empty">Nenhuma solicitação corresponde a este filtro.</div>}
    </section>
    <PrintSelectionPanel title="Relatório de Higienização" rows={hygienePrintRows} />
  </section>
}

export function MaintenanceQueuePage({ userId }: { userId: string }) {
  const [tab, setTab] = usePersistentTab(`scpo-tab-maintenance-queue-${userId}`, 'requests', maintenanceQueueTabs, maintenanceQueueTabLabels)
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [filters, setFilters] = useState({ from_at: '', to_at: '', service_type: '', department: '', status: '', priority: '', q: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [changes, setChanges] = useState<Record<string, { status: WorkOrderStatus; note: string }>>({})
  const [alertsEnabled, setAlertsEnabled] = useState(false)
  const seenOrderIds = useRef(new Set<string>())
  const hasNotificationBaseline = useRef(false)
  const audioContextRef = useRef<AudioContext | null>(null)

  async function loadQueue(nextFilters = filters) {
    try {
      const queryFilters = { ...nextFilters }
      if (queryFilters.from_at) queryFilters.from_at = new Date(queryFilters.from_at).toISOString()
      if (queryFilters.to_at) queryFilters.to_at = new Date(queryFilters.to_at).toISOString()
      const params = new URLSearchParams(Object.entries(queryFilters).filter(([, value]) => value))
      const response = await fetch(`/api/v1/maintenance/queue${params.size ? `?${params}` : ''}`)
      const data = await readApiResponse<{ orders?: WorkOrder[] }>(response)
      setOrders(data.orders ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar a fila.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    const loadFilteredQueue = async () => {
      try {
        const queryFilters = { ...filters }
        if (queryFilters.from_at) queryFilters.from_at = new Date(queryFilters.from_at).toISOString()
        if (queryFilters.to_at) queryFilters.to_at = new Date(queryFilters.to_at).toISOString()
        const params = new URLSearchParams(Object.entries(queryFilters).filter(([, value]) => value))
        const response = await fetch(`/api/v1/maintenance/queue${params.size ? `?${params}` : ''}`)
        const data = await readApiResponse<{ orders?: WorkOrder[] }>(response)
        if (active) {
          setOrders(data.orders ?? [])
          setError('')
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar a fila.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadFilteredQueue()
    return () => { active = false }
  }, [filters])

  useEffect(() => {
    let active = true
    const checkForNewOrders = async () => {
      try {
        const data = await readApiResponse<{ orders?: WorkOrder[] }>(
          await fetch('/api/v1/maintenance/queue'),
        )
        if (!active) return
        const openOrders = (data.orders ?? []).filter((order) => order.status === 'open')
        const newOrders = openOrders.filter((order) => !seenOrderIds.current.has(order.id))
        if (hasNotificationBaseline.current && alertsEnabled && newOrders.length) {
          const latest = newOrders[0]
          setNotice(`Nova solicitação de manutenção: ${latest.title} · ${latest.department}.`)
          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification('Nova solicitação de serviço', {
                body: 'Há um novo chamado aguardando a equipe de manutenção.',
                icon: '/scpo-connect-icon.png',
              })
            } catch (notificationError) {
              setError(notificationError instanceof Error ? `Aviso do navegador indisponível: ${notificationError.message}` : 'Aviso do navegador indisponível.')
            }
          }
          try {
            const audio = audioContextRef.current
            if (!audio || audio.state !== 'running') throw new Error('Reative o áudio do navegador nesta tela.')
            const oscillator = audio.createOscillator()
            const gain = audio.createGain()
            oscillator.frequency.value = 880
            gain.gain.setValueAtTime(0.15, audio.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.35)
            oscillator.connect(gain)
            gain.connect(audio.destination)
            oscillator.start()
            oscillator.stop(audio.currentTime + 0.35)
          } catch (audioError) {
            setError(audioError instanceof Error ? `Alerta sonoro indisponível: ${audioError.message}` : 'Alerta sonoro indisponível.')
          }
        }
        for (const order of data.orders ?? []) seenOrderIds.current.add(order.id)
        hasNotificationBaseline.current = true
      } catch (pollError) {
        if (active) setError(pollError instanceof Error ? `Não foi possível verificar novos chamados: ${pollError.message}` : 'Não foi possível verificar novos chamados.')
      }
    }
    void checkForNewOrders()
    const interval = window.setInterval(() => void checkForNewOrders(), 20_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [alertsEnabled])

  useEffect(() => () => {
    if (audioContextRef.current) void audioContextRef.current.close()
  }, [])

  async function enableAlerts() {
    setError('')
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission()
      }
      const audio = new AudioContext()
      await audio.resume()
      audioContextRef.current = audio
      setAlertsEnabled(true)
      setNotice('Alertas ativos enquanto esta tela estiver aberta; a fila é verificada a cada 20 segundos. Som e notificações podem depender do suporte, das permissões e das configurações do dispositivo.')
    } catch (permissionError) {
      setError(permissionError instanceof Error ? `Não foi possível ativar os avisos de áudio/navegador: ${permissionError.message}` : 'Não foi possível ativar os avisos de áudio/navegador.')
    }
  }

  function printResults() {
    document.body.classList.add('print-maintenance-queue')
    window.print()
    window.setTimeout(() => document.body.classList.remove('print-maintenance-queue'), 500)
  }

  const maintenancePrintRows: PrintRow[] = orders.map((order) => ({ id: order.id, date: order.created_at, title: `${order.order_number ?? order.id} · ${order.title}`, fields: [['Número da OS', order.order_number ?? order.id], ['Status', workOrderStatuses[order.status]], ['Prioridade', workOrderPriorities[order.priority]], ['Tipo', order.service_type], ['Setor solicitante', order.department], ['Local', order.location], ['Solicitante', order.requester_name], ['Descrição', order.description]] }))
  const statusSummary = orders.reduce<Record<string, number>>((summary, order) => ({ ...summary, [order.status]: (summary[order.status] ?? 0) + 1 }), {})

  async function saveStatus(order: WorkOrder) {
    const change = changes[order.id] ?? { status: order.status, note: '' }
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/v1/maintenance/orders/${order.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: change.status, note: change.note }),
      })
      const data = await readApiResponse<WorkOrder>(response)
      setOrders((current) => current.map((item) => item.id === data.id ? data : item))
      setChanges((current) => { const next = { ...current }; delete next[order.id]; return next })
      setNotice(`Ordem atualizada para “${workOrderStatuses[data.status]}”.`)
      triggerMobileFeedback()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao atualizar a ordem.')
    }
  }

  return <section className="work-orders-page page-enter maintenance-queue-page">
    <div className="page-title-row"><div><p className="eyebrow">EQUIPE · MANUTENÇÃO</p><h1>Manutenção</h1><p className="welcome-copy">Consulte solicitações de todos os setores e atualize o andamento dos serviços.</p></div><span className="module-icon module-icon-maintenance"><Wrench size={23} /></span></div>
    <div className="admin-tabs module-tabs" role="tablist" aria-label="Áreas da Manutenção">
      <button className={`button ${tab === 'requests' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'requests'} onClick={() => setTab('requests')}><ClipboardList size={16} /> Solicitações recebidas <span>{orders.filter((order) => order.status === 'open' || order.status === 'in_progress').length}</span></button>
      <button className={`button ${tab === 'assets' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'assets'} onClick={() => setTab('assets')}><Wrench size={16} /> Patrimônio e preventivas</button>
    </div>
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}{error && <ToastMessage variant="error">{error}</ToastMessage>}
    {tab === 'requests' ? <>
    <section className="work-order-list-panel"><div className="section-heading"><div><p className="eyebrow">PAINEL OPERACIONAL</p><h2>Solicitações recebidas <span className="module-total">{orders.length}</span></h2></div><div className="maintenance-actions">{alertsEnabled ? <span className="field-hint" role="status">Alertas ativos</span> : <button className="button button-secondary" type="button" onClick={() => void enableAlerts()}>Ativar alertas</button>}<button className="button button-secondary" type="button" onClick={printResults} disabled={loading || !orders.length}><Printer size={16} /> Imprimir lista</button><button className="button button-secondary" type="button" onClick={() => void loadQueue()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar fila'}</button></div></div>
      <div className="hygiene-summary maintenance-report-summary" aria-label="Resumo dos resultados">
        <article className="status-tone-neutral"><strong>{orders.length}</strong><span>Ordens</span></article>
        {(Object.entries(workOrderStatuses) as [WorkOrderStatus, string][]).map(([status, label]) => <article className={`status-tone-${workOrderStatusTones[status]}`} key={status}><strong>{statusSummary[status] ?? 0}</strong><span>{label}</span></article>)}
      </div>
      <form className="maintenance-filters" onSubmit={(event) => { event.preventDefault(); void loadQueue(filters) }}><label className="field"><span className="field-label">De (data e hora)</span><input type="datetime-local" value={filters.from_at} max={filters.to_at || undefined} onChange={(event) => setFilters({ ...filters, from_at: event.target.value })} /></label><label className="field"><span className="field-label">Até (data e hora)</span><input type="datetime-local" value={filters.to_at} min={filters.from_at || undefined} onChange={(event) => setFilters({ ...filters, to_at: event.target.value })} /></label><label className="field"><span className="field-label">Tipo de serviço</span><select value={filters.service_type} onChange={(event) => setFilters({ ...filters, service_type: event.target.value })}><option value="">Todos</option>{['Elétrica', 'Hidráulica', 'Climatização', 'Higienização', 'Equipamento', 'Estrutura e mobiliário', 'Rede e telefonia', 'Outro serviço'].map((type) => <option key={type}>{type}</option>)}</select></label><label className="field"><span className="field-label">Setor solicitante</span><input value={filters.department} onChange={(event) => setFilters({ ...filters, department: event.target.value })} placeholder="Todos os setores" /></label><label className="field"><span className="field-label">Status</span><select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option>{Object.entries(workOrderStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span className="field-label">Prioridade</span><select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}><option value="">Todas</option>{Object.entries(workOrderPriorities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field maintenance-query"><span className="field-label">Busca</span><input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Assunto, local ou solicitante" /></label><div className="maintenance-filter-actions"><button className="button button-primary" type="submit" disabled={loading}><Search size={16} /> Filtrar</button><button className="button button-secondary" type="button" onClick={() => { const empty = { from_at: '', to_at: '', service_type: '', department: '', status: '', priority: '', q: '' }; setFilters(empty); void loadQueue(empty) }}>Limpar</button></div></form>
      {loading ? <div className="history-empty">Carregando fila…</div> : orders.length ? <div className="work-order-list">{orders.map((order) => <WorkOrderCard key={order.id} order={order} editable onStatusChange={(status) => setChanges((current) => ({ ...current, [order.id]: { ...(current[order.id] ?? { status: order.status, note: '' }), status } }))} status={changes[order.id]?.status ?? order.status} note={changes[order.id]?.note ?? ''} onNoteChange={(note) => setChanges((current) => ({ ...current, [order.id]: { ...(current[order.id] ?? { status: order.status }), note } }))} onSave={() => void saveStatus(order)} saving={false} />)}</div> : <div className="history-empty"><CheckCircle2 size={20} /><span>Nenhuma ordem de serviço corresponde aos filtros.</span></div>}
    </section>
    <PrintSelectionPanel title="Relatório de Manutenção" rows={maintenancePrintRows} />
    </> : <AssetMaintenancePanel userId={userId} />}
  </section>
}

function WorkOrderCard({ order, editable = false, status, note, onStatusChange, onNoteChange, onSave, saving = false }: { order: WorkOrder; editable?: boolean; status?: WorkOrderStatus; note?: string; onStatusChange?: (status: WorkOrderStatus) => void; onNoteChange?: (note: string) => void; onSave?: () => void; saving?: boolean }) {
  function printOrder() {
    const cards = [...document.querySelectorAll('.work-order-card')]
    const target = cards.find((card) => card.querySelector(`[data-print-order="${order.id}"]`))
    cards.forEach((card) => card.classList.toggle('print-away', card !== target))
    document.body.classList.add('print-maintenance-order')
    window.print()
    window.setTimeout(() => { document.body.classList.remove('print-maintenance-order'); cards.forEach((card) => card.classList.remove('print-away')) }, 500)
  }
  return <details className="work-order-card" data-order-id={order.id}><summary className="work-order-card-heading"><div><span className={`work-order-priority priority-${order.priority}`}>{workOrderPriorities[order.priority]}</span><small className="service-request-number">{order.order_number ?? order.id}</small><h3>{order.title}</h3></div><span className={`work-order-status status-${order.status} status-tone-${workOrderStatusTones[order.status]}`}>{workOrderStatuses[order.status]}</span></summary>
    <div className="work-order-meta"><span><strong>Tipo de serviço</strong>{order.service_type || 'Outro serviço'}</span><span><strong>Setor</strong>{order.department}</span>{order.location && <span><strong>Local</strong>{order.location}</span>}<span><strong>Solicitante</strong>{order.requester_name}</span><span><strong>Aberta em</strong>{dateTime(order.created_at)}</span><span><strong>Atualizada por</strong>{order.updated_by} · {dateTime(order.updated_at)}</span></div><p className="work-order-description">{order.description}</p>
    <div className="work-order-print-action"><button data-print-order={order.id} className="button button-secondary" type="button" onClick={printOrder}><Printer size={15} /> Imprimir OS</button></div>
    {editable && <div className="work-order-actions"><label className="field"><span className="field-label">Status</span><select value={status ?? order.status} onChange={(event) => onStatusChange?.(event.target.value as WorkOrderStatus)}><option value="open">Aberta</option><option value="in_progress">Em curso</option><option value="completed">Finalizada</option><option value="cancelled">Cancelada</option></select></label><label className="field"><span className="field-label">Nota da atualização (opcional)</span><input maxLength={500} value={note ?? ''} onChange={(event) => onNoteChange?.(event.target.value)} placeholder="Ex.: peça solicitada" /></label><button className="button button-primary" type="button" disabled={saving} onClick={onSave}>{saving ? 'Salvando…' : 'Salvar andamento'}</button></div>}
  </details>
}
