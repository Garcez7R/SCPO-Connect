import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, ArrowRight, BadgeCheck, CheckCircle2, ClipboardList, ClipboardPlus, Printer, Search, ShieldCheck, Wrench } from 'lucide-react'
import { readApiResponse } from '../api'
import PrintSelectionPanel, { type PrintRow } from '../components/PrintSelectionPanel'
import { AssetMaintenancePanel } from './ManagementOperationsPage'

type AuthUser = { id: string; username: string; name: string; modules: string[]; permissions: Record<string, string[]> }
type Patient = { reference: string; name: string; room: string; bed: string }
type WorkOrderStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'
type WorkOrderPriority = 'normal' | 'high' | 'urgent'
type WorkOrder = { id: string; title: string; description: string; service_type: string; department: string; location: string; patient_reference?: string | null; asset_id?: string | null; priority: WorkOrderPriority; status: WorkOrderStatus; requester_id: string; requester_name: string; updated_by: string; created_at: string; updated_at: string }

function patientLocationLabel(patient: Pick<Patient, 'room' | 'bed'>) {
  return patient.room.trim() && patient.bed.trim() ? `Quarto ${patient.room} · leito ${patient.bed}` : 'Sem quarto/leito atribuído'
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

const workOrderStatuses: Record<WorkOrderStatus, string> = {
  open: 'Aberta', in_progress: 'Em curso', completed: 'Finalizada', cancelled: 'Cancelada',
}

const workOrderPriorities: Record<WorkOrderPriority, string> = {
  normal: 'Normal', high: 'Alta', urgent: 'Urgente',
}

export function WorkOrdersPage({ user }: { user: AuthUser }) {
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [serviceTab, setServiceTab] = useState<'maintenance' | 'hygiene'>('maintenance')
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
  const orderPrintRows: PrintRow[] = orders.map((order) => ({ id: order.id, date: order.created_at, title: order.title, fields: [['Status', workOrderStatuses[order.status]], ['Prioridade', workOrderPriorities[order.priority]], ['Tipo', order.service_type], ['Setor', order.department], ['Local', order.location], ['Solicitante', order.requester_name], ['Descrição', order.description]] }))

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
          {canLookupPatients && <label className="field"><span className="field-label">Paciente relacionado (opcional)</span><select value={form.patientReference} onChange={(event) => setForm({ ...form, patientReference: event.target.value })}><option value="">Sem vínculo com paciente</option>{patients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patientLocationLabel(patient)}</option>)}</select></label>}
          <label className="field"><span className="field-label">Número do patrimônio (opcional)</span><input maxLength={40} value={form.assetCode} onChange={(event) => setForm({ ...form, assetCode: event.target.value })} placeholder="Etiqueta do equipamento" /></label>
          <label className="field"><span className="field-label">Prioridade</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as WorkOrderPriority })}><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select><span className="field-hint">Use urgente quando houver impacto imediato no funcionamento ou na segurança.</span></label>
        </div>
        <label className="field"><span className="field-label">Descrição do serviço</span><textarea required minLength={5} maxLength={1450} rows={5} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Descreva o problema observado, quando começou e o resultado esperado." /><span className="field-hint">{form.description.length}/1.450 caracteres</span></label>
        <p className="work-order-privacy">Não inclua nome, diagnóstico ou outros dados de pacientes na descrição da ordem.</p>
      </> : <div className="work-order-review"><div><small>Categoria</small><strong>{form.category}</strong></div><div><small>Assunto</small><strong>{form.title}</strong></div><div><small>Setor solicitante</small><strong>{form.department === 'Outro' ? form.customDepartment : form.department}</strong></div><div><small>Localização</small><strong>{[form.unit && `Unidade: ${form.unit}`, form.location && `Local: ${form.location}`, form.assetCode && `Patrimônio: ${form.assetCode}`].filter(Boolean).join(' · ') || 'Não informado'}</strong></div>{form.patientReference && <div><small>Paciente</small><strong>{patients.find((patient) => patient.reference === form.patientReference)?.name ?? 'Paciente selecionado'}</strong></div>}<div><small>Prioridade</small><strong>{workOrderPriorities[form.priority]}</strong></div><div className="work-order-review-description"><small>Descrição</small><p>{form.description}</p></div></div>}
      {notice && <div className="form-message form-message-success" role="status">{notice}</div>}
      {error && <div className="form-message form-message-error" role="alert">{error}</div>}
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
type HygieneRequestType = 'routine' | 'spot' | 'after_procedure' | 'restock' | 'other'
type HygieneArea = 'room' | 'bathroom' | 'shared' | 'clinical' | 'circulation' | 'other'
type HygieneRequest = {
  id: string
  request_type: HygieneRequestType
  custom_type: string | null
  unit: string
  area: HygieneArea
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

const hygieneRequestTypes: Record<HygieneRequestType, string> = {
  routine: 'Higienização programada',
  spot: 'Limpeza pontual',
  after_procedure: 'Limpeza após procedimento',
  restock: 'Reposição de material',
  other: 'Outra solicitação',
}

const hygieneAreas: Record<HygieneArea, string> = {
  room: 'Quarto / leito',
  bathroom: 'Banheiro',
  shared: 'Área comum',
  clinical: 'Consultório / sala',
  circulation: 'Área de circulação',
  other: 'Outro local',
}

const hygieneStatuses: Record<HygieneStatus, string> = {
  open: 'Aguardando atendimento',
  in_progress: 'Em andamento',
  completed: 'Concluída',
  cancelled: 'Cancelada',
}

function HygieneRequestForm() {
  const [form, setForm] = useState({
    request_type: 'routine' as HygieneRequestType,
    custom_type: '',
    unit: '',
    area: '' as HygieneArea | '',
    location: '',
    description: '',
    priority: 'normal' as HygienePriority,
  })
  const [saving, setSaving] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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
      await readApiResponse<HygieneRequest>(response)
      setForm({ request_type: 'routine', custom_type: '', unit: '', area: '', location: '', description: '', priority: 'normal' })
      setReviewing(false)
      setNotice('Solicitação enviada à equipe de Higienização.')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Falha ao registrar a solicitação.')
    } finally {
      setSaving(false)
    }
  }

  return <form className="work-order-form" onSubmit={(event) => void submit(event)}>
      <div className="section-heading"><div><p className="eyebrow">NOVA SOLICITAÇÃO · HIGIENIZAÇÃO</p><h2>{reviewing ? 'Revise antes de enviar' : 'Descreva o serviço'}</h2><p className="welcome-copy">{reviewing ? 'Confira os dados do chamado e confirme o envio à equipe.' : 'Informe o serviço, a unidade e o local que precisa de atendimento.'}</p></div></div>
      {!reviewing ? <div className="field-grid field-grid-two">
        <label className="field"><span className="field-label">Tipo de solicitação</span><select required value={form.request_type} onChange={(event) => setForm({ ...form, request_type: event.target.value as HygieneRequestType, custom_type: '' })}>{Object.entries(hygieneRequestTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field"><span className="field-label">Unidade</span><select required value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })}><option value="">Selecione</option><option>Hospital</option><option>Pronto atendimento</option><option>Área externa</option><option>Outra unidade</option></select></label>
        <label className="field"><span className="field-label">Área</span><select required value={form.area} onChange={(event) => setForm({ ...form, area: event.target.value as HygieneArea })}><option value="">Selecione</option>{Object.entries(hygieneAreas).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field"><span className="field-label">Quarto, sala ou referência do local</span><input required minLength={2} maxLength={120} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Ex.: quarto 3, sala de espera" /></label>
        <label className="field"><span className="field-label">Prioridade</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as HygienePriority })}><option value="normal">Rotina</option><option value="high">Prioritária</option><option value="urgent">Urgente</option></select><span className="field-hint">Use urgente conforme os critérios e canais definidos pela instituição.</span></label>
        {form.request_type === 'other' && <label className="field"><span className="field-label">Tipo de solicitação</span><input required minLength={3} maxLength={80} value={form.custom_type} onChange={(event) => setForm({ ...form, custom_type: event.target.value })} placeholder="Descreva o serviço necessário" /></label>}
        <label className="field hygiene-field-wide"><span className="field-label">{form.request_type === 'restock' ? 'Material e quantidade' : 'Detalhes operacionais (opcional)'}</span><textarea maxLength={1000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder={form.request_type === 'restock' ? 'Informe o material e a quantidade necessária' : 'Descreva o serviço e condições relevantes do local'} /></label>
      </div> : <div className="work-order-review"><div><small>Tipo de solicitação</small><strong>{form.request_type === 'other' ? form.custom_type : hygieneRequestTypes[form.request_type]}</strong></div><div><small>Unidade e local</small><strong>{form.unit} · {form.location}</strong></div><div><small>Área e prioridade</small><strong>{hygieneAreas[form.area as HygieneArea]} · {workOrderPriorities[form.priority]}</strong></div><div className="work-order-review-description"><small>Detalhes</small><p>{form.description || 'Sem detalhes adicionais.'}</p></div></div>}
      {error && <div className="form-message form-message-error" role="alert">{error}</div>}
      {notice && <div className="form-message form-message-success" role="status">{notice}</div>}
      <p className="work-order-privacy">Não inclua nomes, diagnósticos ou outros dados de pacientes na descrição.</p>
      <div className="work-order-form-actions">{reviewing && <button className="button button-secondary" type="button" onClick={() => setReviewing(false)} disabled={saving}><ArrowLeft size={16} /> Editar solicitação</button>}<button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Enviando…' : reviewing ? 'Confirmar envio' : 'Revisar solicitação'} {reviewing ? <BadgeCheck size={16} /> : <ArrowRight size={16} />}</button></div>
  </form>
}

export function HygienePage({ user }: { user: AuthUser }) {
  const [requests, setRequests] = useState<HygieneRequest[]>([])
  const [drafts, setDrafts] = useState<Record<string, { status: HygieneStatus; assignee: string }>>({})
  const [filter, setFilter] = useState<'active' | 'all' | HygieneStatus>('active')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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

  const visibleRequests = requests.filter((request) => {
    const matchesStatus = filter === 'all' || (filter === 'active'
      ? request.status === 'open' || request.status === 'in_progress'
      : request.status === filter)
    const searchable = `${request.unit} ${request.location} ${request.description} ${request.custom_type ?? ''} ${request.requester_name} ${request.assignee} ${hygieneAreas[request.area]} ${hygieneRequestTypes[request.request_type]}`.toLocaleLowerCase('pt-BR')
    return matchesStatus && searchable.includes(query.trim().toLocaleLowerCase('pt-BR'))
  })
  const activeCount = requests.filter((request) => request.status === 'open' || request.status === 'in_progress').length

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
      setNotice('Solicitação atualizada.')
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Falha ao atualizar a solicitação.')
    } finally {
      setUpdating('')
    }
  }

  return <section className="hygiene-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">EQUIPE · HIGIENIZAÇÃO</p><h1>Higienização</h1><p className="welcome-copy">Receba, priorize, atribua e acompanhe as solicitações da equipe.</p></div><span className="module-icon module-icon-hygiene"><ShieldCheck size={23} /></span></div>
    <div className="hygiene-summary" aria-label="Resumo da fila"><article><strong>{activeCount}</strong><span>Solicitações ativas</span></article><article><strong>{requests.filter((request) => request.status === 'open').length}</strong><span>Aguardando atendimento</span></article><article><strong>{requests.filter((request) => request.status === 'in_progress').length}</strong><span>Em andamento</span></article></div>
    {error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}
    <section className="hygiene-panel">
      <div className="section-heading"><div><p className="eyebrow">PAINEL DA EQUIPE</p><h2>Fila de solicitações</h2></div><button className="button button-secondary" type="button" onClick={() => void loadRequests()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar fila'}</button></div>
      <div className="hygiene-filters"><label className="field"><span className="field-label">Situação</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="active">Ativas</option><option value="all">Todas</option>{Object.entries(hygieneStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span className="field-label">Buscar por local ou serviço</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Unidade, local, tipo ou responsável" /></label></div>
      {loading ? <div className="history-empty">Carregando fila…</div> : visibleRequests.length ? <div className="hygiene-request-list">{visibleRequests.map((request) => {
        const draft = drafts[request.id] ?? { status: request.status, assignee: request.assignee }
        return <article className="hygiene-request-card" key={request.id}>
          <div className="hygiene-request-heading"><div><span className={`work-order-priority priority-${request.priority}`}>{workOrderPriorities[request.priority]}</span><h3>{request.request_type === 'other' ? request.custom_type : hygieneRequestTypes[request.request_type]}</h3><p>{request.unit} · {hygieneAreas[request.area]} · {request.location}</p></div><span className={`work-order-status status-${request.status}`}>{hygieneStatuses[request.status]}</span></div>
          {request.description && <p className="hygiene-request-description">{request.description}</p>}
          <div className="hygiene-request-meta"><span>Solicitado por <strong>{request.requester_name}</strong></span><time>{dateTime(request.created_at)}</time></div>
          <div className="hygiene-request-controls"><label className="field"><span className="field-label">Responsável</span><input maxLength={120} value={draft.assignee} onChange={(event) => setDrafts((current) => ({ ...current, [request.id]: { ...draft, assignee: event.target.value } }))} placeholder="Atribuir membro da equipe" /></label><label className="field"><span className="field-label">Situação</span><select value={draft.status} onChange={(event) => setDrafts((current) => ({ ...current, [request.id]: { ...draft, status: event.target.value as HygieneStatus } }))}><option value="open">Aguardando atendimento</option><option value="in_progress">Em andamento</option><option value="completed">Concluída</option><option value="cancelled">Cancelada</option></select></label><button className="button button-secondary" type="button" onClick={() => void saveRequest(request)} disabled={updating === request.id || (draft.status === request.status && draft.assignee === request.assignee)}>{updating === request.id ? 'Salvando…' : 'Salvar atualização'}</button></div>
          <small className="hygiene-updated">Última atualização por {request.updated_by} · {dateTime(request.updated_at)}</small>
        </article>
      })}</div> : <div className="history-empty">Nenhuma solicitação corresponde a este filtro.</div>}
    </section>
  </section>
}

export function MaintenanceQueuePage() {
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [filters, setFilters] = useState({ from_date: '', to_date: '', service_type: '', department: '', status: '', priority: '', q: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [changes, setChanges] = useState<Record<string, { status: WorkOrderStatus; note: string }>>({})

  async function loadQueue(nextFilters = filters) {
    try {
      const params = new URLSearchParams(Object.entries(nextFilters).filter(([, value]) => value))
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
        const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value))
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

  function printResults() {
    document.body.classList.add('print-maintenance-queue')
    window.print()
    window.setTimeout(() => document.body.classList.remove('print-maintenance-queue'), 500)
  }

  const maintenancePrintRows: PrintRow[] = orders.map((order) => ({ id: order.id, date: order.created_at, title: order.title, fields: [['Status', workOrderStatuses[order.status]], ['Prioridade', workOrderPriorities[order.priority]], ['Tipo', order.service_type], ['Setor solicitante', order.department], ['Local', order.location], ['Solicitante', order.requester_name], ['Descrição', order.description]] }))
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
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao atualizar a ordem.')
    }
  }

  return <section className="work-orders-page page-enter maintenance-queue-page">
    <div className="page-title-row"><div><p className="eyebrow">EQUIPE · MANUTENÇÃO</p><h1>Manutenção</h1><p className="welcome-copy">Consulte solicitações de todos os setores e atualize o andamento dos serviços.</p></div><span className="module-icon module-icon-maintenance"><Wrench size={23} /></span></div>
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}{error && <div className="form-message form-message-error" role="alert">{error}</div>}
    <section className="work-order-list-panel"><div className="section-heading"><div><p className="eyebrow">PAINEL OPERACIONAL</p><h2>Solicitações recebidas <span className="module-total">{orders.length}</span></h2></div><div className="maintenance-actions"><button className="button button-secondary" type="button" onClick={printResults} disabled={loading || !orders.length}><Printer size={16} /> Imprimir lista</button><button className="button button-secondary" type="button" onClick={() => void loadQueue()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar fila'}</button></div></div>
      <form className="maintenance-filters" onSubmit={(event) => { event.preventDefault(); void loadQueue(filters) }}><label className="field"><span className="field-label">De</span><input type="date" value={filters.from_date} onChange={(event) => setFilters({ ...filters, from_date: event.target.value })} /></label><label className="field"><span className="field-label">Até</span><input type="date" value={filters.to_date} onChange={(event) => setFilters({ ...filters, to_date: event.target.value })} /></label><label className="field"><span className="field-label">Tipo de serviço</span><select value={filters.service_type} onChange={(event) => setFilters({ ...filters, service_type: event.target.value })}><option value="">Todos</option>{['Elétrica', 'Hidráulica', 'Climatização', 'Higienização', 'Equipamento', 'Estrutura e mobiliário', 'Rede e telefonia', 'Outro serviço'].map((type) => <option key={type}>{type}</option>)}</select></label><label className="field"><span className="field-label">Setor solicitante</span><input value={filters.department} onChange={(event) => setFilters({ ...filters, department: event.target.value })} placeholder="Todos os setores" /></label><label className="field"><span className="field-label">Status</span><select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option>{Object.entries(workOrderStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span className="field-label">Prioridade</span><select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}><option value="">Todas</option>{Object.entries(workOrderPriorities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field maintenance-query"><span className="field-label">Busca</span><input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Assunto, local ou solicitante" /></label><div className="maintenance-filter-actions"><button className="button button-primary" type="submit" disabled={loading}><Search size={16} /> Filtrar</button><button className="button button-secondary" type="button" onClick={() => { const empty = { from_date: '', to_date: '', service_type: '', department: '', status: '', priority: '', q: '' }; setFilters(empty); void loadQueue(empty) }}>Limpar</button></div></form>
      <div className="maintenance-report-summary" aria-label="Resumo dos resultados"><strong>{orders.length} ordens</strong>{Object.entries(workOrderStatuses).map(([status, label]) => <span key={status}>{label}: <b>{statusSummary[status] ?? 0}</b></span>)}</div>
      {loading ? <div className="history-empty">Carregando fila…</div> : orders.length ? <div className="work-order-list">{orders.map((order) => <WorkOrderCard key={order.id} order={order} editable onStatusChange={(status) => setChanges((current) => ({ ...current, [order.id]: { ...(current[order.id] ?? { status: order.status, note: '' }), status } }))} status={changes[order.id]?.status ?? order.status} note={changes[order.id]?.note ?? ''} onNoteChange={(note) => setChanges((current) => ({ ...current, [order.id]: { ...(current[order.id] ?? { status: order.status }), note } }))} onSave={() => void saveStatus(order)} saving={false} />)}</div> : <div className="history-empty"><CheckCircle2 size={20} /><span>Nenhuma ordem de serviço corresponde aos filtros.</span></div>}
    </section>
    <AssetMaintenancePanel />
    <PrintSelectionPanel title="Relatório de Manutenção" rows={maintenancePrintRows} />
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
  return <article className="work-order-card" data-order-id={order.id}><div className="work-order-card-heading"><div><span className={`work-order-priority priority-${order.priority}`}>{workOrderPriorities[order.priority]}</span><h3>{order.title}</h3></div><span className={`work-order-status status-${order.status}`}>{workOrderStatuses[order.status]}</span></div>
    <div className="work-order-meta"><span><strong>Tipo de serviço</strong>{order.service_type || 'Outro serviço'}</span><span><strong>Setor</strong>{order.department}</span>{order.location && <span><strong>Local</strong>{order.location}</span>}<span><strong>Solicitante</strong>{order.requester_name}</span><span><strong>Aberta em</strong>{dateTime(order.created_at)}</span><span><strong>Atualizada por</strong>{order.updated_by} · {dateTime(order.updated_at)}</span></div><p className="work-order-description">{order.description}</p>
    <div className="work-order-print-action"><button data-print-order={order.id} className="button button-secondary" type="button" onClick={printOrder}><Printer size={15} /> Imprimir OS</button></div>
    {editable && <div className="work-order-actions"><label className="field"><span className="field-label">Status</span><select value={status ?? order.status} onChange={(event) => onStatusChange?.(event.target.value as WorkOrderStatus)}><option value="open">Aberta</option><option value="in_progress">Em curso</option><option value="completed">Finalizada</option><option value="cancelled">Cancelada</option></select></label><label className="field"><span className="field-label">Nota da atualização (opcional)</span><input maxLength={500} value={note ?? ''} onChange={(event) => onNoteChange?.(event.target.value)} placeholder="Ex.: peça solicitada" /></label><button className="button button-primary" type="button" disabled={saving} onClick={onSave}>{saving ? 'Salvando…' : 'Salvar andamento'}</button></div>}
  </article>
}
