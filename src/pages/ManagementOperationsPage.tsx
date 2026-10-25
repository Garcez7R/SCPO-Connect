import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, BadgeCheck, Building2, FileText, Wrench } from 'lucide-react'
import { readApiResponse } from '../api'
import PatientSelect from '../components/PatientSelect'
import { usePersistentTab } from '../components/PageNavigationContext'
import ToastMessage from '../components/ToastMessage'
import { triggerMobileFeedback } from '../mobileFeedback'

type Asset = { id: string; asset_tag: string; name: string; category: string; unit: string; location: string; manufacturer: string; model: string; serial_number: string; status: string }
type PreventivePlan = { id: string; asset_id: string; asset_tag: string; asset_name: string; procedure: string; interval_days: number; due_date: string; responsible: string; status: string; last_completed_at: string | null }
type SafetyIncident = { id: string; incident_type: string; severity: string; occurred_at: string; unit: string; location: string; patient_reference: string | null; description: string; status: 'open' | 'investigating' | 'action_required' | 'closed'; investigation: string; corrective_action: string; reported_by: string; updated_by: string }
type PatientReference = { reference: string; name: string; room: string; bed: string }
type InstitutionalDocument = { id: string; title: string; document_type: string; version: string; content: string; status: 'draft' | 'in_review' | 'approved' | 'archived'; valid_until: string | null; created_by: string; approved_by: string; approved_at: string | null }
type PanelTab = 'safety' | 'documents'
const roadmapTabs: PanelTab[] = ['safety', 'documents']
const roadmapTabLabels: Record<PanelTab, string> = { safety: 'Segurança do paciente', documents: 'Documentos e aprovações' }
type AssetTab = 'assets' | 'preventive' | 'inventory' | 'calendar'
const assetTabs: AssetTab[] = ['assets', 'preventive', 'inventory', 'calendar']
const assetTabLabels: Record<AssetTab, string> = { assets: 'Patrimônio', preventive: 'Manutenção preventiva', inventory: 'Inventário', calendar: 'Calendário' }

function localDateTime() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function dateLabel(value: string | null) {
  if (!value) return 'Não informado'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(`${value.slice(0, 10)}T00:00:00`))
}

export function AdministrativeRoadmapPanel({ userId }: { userId: string }) {
  const [tab, setTab] = usePersistentTab(`scpo-tab-administrative-roadmap-${userId}`, 'safety', roadmapTabs, roadmapTabLabels, false)
  return <section className="patient-list-panel">
    <div className="section-heading"><div><p className="eyebrow">ROADMAP ADMINISTRATIVO · MVP</p><h2>Operações e governança</h2><p className="welcome-copy">Compras estão integradas ao módulo Farmácia; esta área reúne patrimônio, segurança e documentos institucionais.</p></div></div>
    <div className="admin-tabs module-tabs" role="tablist" aria-label="Frentes administrativas">
      <button className={`button ${tab === 'safety' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'safety'} onClick={() => setTab('safety')}><AlertTriangle size={16} /> Segurança do paciente</button>
      <button className={`button ${tab === 'documents' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'documents'} onClick={() => setTab('documents')}><FileText size={16} /> Documentos e aprovações</button>
    </div>
    {tab === 'safety' && <SafetyIncidentPanel />}
    {tab === 'documents' && <InstitutionalDocumentsPanel />}
  </section>
}

export function AssetMaintenancePanel({ userId }: { userId: string }) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [plans, setPlans] = useState<PreventivePlan[]>([])
  const [tab, setTab] = usePersistentTab(`scpo-tab-asset-maintenance-${userId}`, 'assets', assetTabs, assetTabLabels, false)
  const [assetForm, setAssetForm] = useState({ asset_tag: '', name: '', category: '', unit: '', location: '', manufacturer: '', model: '', serial_number: '' })
  const [planForm, setPlanForm] = useState({ asset_id: '', procedure: '', interval_days: '90', due_date: '', responsible: '' })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    try {
      const [assetData, planData] = await Promise.all([
        readApiResponse<{ assets?: Asset[] }>(await fetch('/api/v1/maintenance/assets')),
        readApiResponse<{ plans?: PreventivePlan[] }>(await fetch('/api/v1/maintenance/preventive-plans')),
      ])
      setAssets(assetData.assets ?? [])
      setPlans(planData.plans ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar patrimônio e manutenção preventiva.')
    } finally { setLoading(false) }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function createAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      const asset = await readApiResponse<Asset>(await fetch('/api/v1/maintenance/assets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(assetForm),
      }))
      setAssets((current) => [...current, asset].sort((a, b) => a.asset_tag.localeCompare(b.asset_tag)))
      setAssetForm({ asset_tag: '', name: '', category: '', unit: '', location: '', manufacturer: '', model: '', serial_number: '' })
      setNotice('Ativo patrimonial cadastrado.')
      triggerMobileFeedback()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível cadastrar o ativo.')
    } finally { setSaving(false) }
  }

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      const plan = await readApiResponse<PreventivePlan>(await fetch('/api/v1/maintenance/preventive-plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...planForm, interval_days: Number(planForm.interval_days) }),
      }))
      setPlans((current) => [...current, plan].sort((a, b) => a.due_date.localeCompare(b.due_date)))
      setPlanForm({ asset_id: '', procedure: '', interval_days: '90', due_date: '', responsible: '' })
      setNotice('Plano preventivo agendado.')
      triggerMobileFeedback()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível agendar a manutenção.')
    } finally { setSaving(false) }
  }

  async function completePlan(plan: PreventivePlan) {
    setSaving(true); setError(''); setNotice('')
    try {
      const updated = await readApiResponse<PreventivePlan>(await fetch(`/api/v1/maintenance/preventive-plans/${encodeURIComponent(plan.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }),
      }))
      setPlans((current) => current.map((item) => item.id === updated.id ? updated : item).sort((a, b) => a.due_date.localeCompare(b.due_date)))
      setNotice(`Manutenção concluída. Próxima revisão em ${dateLabel(updated.due_date)}.`)
      triggerMobileFeedback()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível concluir a rotina preventiva.')
    } finally { setSaving(false) }
  }

  const activePlans = plans.filter((plan) => plan.status !== 'completed')

  return <div className="management-operations-grid asset-maintenance-grid">
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    <div className="admin-tabs module-tabs" role="tablist" aria-label="Gestão de manutenção">
      <button className={`button ${tab === 'assets' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'assets'} onClick={() => setTab('assets')}><Building2 size={16} /> Bens e equipamentos</button>
      <button className={`button ${tab === 'preventive' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'preventive'} onClick={() => setTab('preventive')}><Wrench size={16} /> Manutenção preventiva</button>
      <button className={`button ${tab === 'inventory' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'inventory'} onClick={() => setTab('inventory')}>Inventário <span>{assets.length}</span></button>
      <button className={`button ${tab === 'calendar' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'calendar'} onClick={() => setTab('calendar')}>Calendário <span>{activePlans.length}</span></button>
    </div>
    {tab === 'assets' && <form className="account-create-panel asset-maintenance-form" onSubmit={(event) => void createAsset(event)}>
      <div className="section-heading"><div><p className="eyebrow">PATRIMÔNIO</p><h3><Building2 size={17} /> Cadastrar bem ou equipamento</h3><p className="welcome-copy">Identifique o ativo e informe sua unidade e localização para facilitar o acompanhamento.</p></div></div>
      <div className="field-grid field-grid-two">
        <label className="field"><span className="field-label">Número patrimonial</span><input required minLength={2} maxLength={40} value={assetForm.asset_tag} onChange={(event) => setAssetForm({ ...assetForm, asset_tag: event.target.value })} /></label>
        <label className="field"><span className="field-label">Nome do ativo</span><input required minLength={2} maxLength={120} value={assetForm.name} onChange={(event) => setAssetForm({ ...assetForm, name: event.target.value })} /></label>
        <label className="field"><span className="field-label">Categoria</span><input required minLength={2} maxLength={60} value={assetForm.category} onChange={(event) => setAssetForm({ ...assetForm, category: event.target.value })} placeholder="Equipamento clínico, mobiliário..." /></label>
        <label className="field"><span className="field-label">Unidade</span><input required minLength={2} maxLength={100} value={assetForm.unit} onChange={(event) => setAssetForm({ ...assetForm, unit: event.target.value })} /></label>
        <label className="field"><span className="field-label">Localização</span><input maxLength={120} value={assetForm.location} onChange={(event) => setAssetForm({ ...assetForm, location: event.target.value })} /></label>
        <label className="field"><span className="field-label">Fabricante (opcional)</span><input maxLength={100} value={assetForm.manufacturer} onChange={(event) => setAssetForm({ ...assetForm, manufacturer: event.target.value })} /></label>
        <label className="field"><span className="field-label">Modelo (opcional)</span><input maxLength={100} value={assetForm.model} onChange={(event) => setAssetForm({ ...assetForm, model: event.target.value })} /></label>
        <label className="field"><span className="field-label">Número de série (opcional)</span><input maxLength={100} value={assetForm.serial_number} onChange={(event) => setAssetForm({ ...assetForm, serial_number: event.target.value })} /></label>
      </div>
      <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Cadastrar ativo'}</button>
    </form>}
    {tab === 'preventive' && <form className="account-create-panel" onSubmit={(event) => void createPlan(event)}>
      <h3>Programar manutenção preventiva</h3>
      <div className="field-grid field-grid-two">
        <label className="field"><span className="field-label">Ativo</span><select required value={planForm.asset_id} onChange={(event) => setPlanForm({ ...planForm, asset_id: event.target.value })}><option value="">Selecione um ativo</option>{assets.filter((asset) => asset.status === 'active').map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_tag} · {asset.name}</option>)}</select></label>
        <label className="field"><span className="field-label">Procedimento</span><input required minLength={3} maxLength={300} value={planForm.procedure} onChange={(event) => setPlanForm({ ...planForm, procedure: event.target.value })} /></label>
        <label className="field"><span className="field-label">Periodicidade (dias)</span><input required type="number" min={1} max={3650} value={planForm.interval_days} onChange={(event) => setPlanForm({ ...planForm, interval_days: event.target.value })} /></label>
        <label className="field"><span className="field-label">Próxima data</span><input required type="date" value={planForm.due_date} onChange={(event) => setPlanForm({ ...planForm, due_date: event.target.value })} /></label>
        <label className="field"><span className="field-label">Responsável</span><input maxLength={120} value={planForm.responsible} onChange={(event) => setPlanForm({ ...planForm, responsible: event.target.value })} /></label>
      </div>
      <button className="button button-primary" type="submit" disabled={saving || !assets.length}>{saving ? 'Agendando…' : 'Agendar manutenção'}</button>
    </form>}
    {tab === 'inventory' && <section className="patient-list-panel">
      <div className="section-heading"><div><p className="eyebrow">PATRIMÔNIO</p><h3>Inventário de bens e equipamentos</h3></div><span className="module-total">{assets.length} ativos</span></div>
      {loading ? <div className="history-empty">Carregando inventário…</div> : assets.length ? <div className="collection-list">
        {assets.map((asset) => <article className="collection-row" key={asset.id}><div className="collection-row-heading"><strong>{asset.asset_tag} · {asset.name}</strong><span className="work-order-status status-completed">Ativo</span></div><small>{asset.category} · {asset.unit}{asset.location ? ` · ${asset.location}` : ''}{asset.manufacturer ? ` · ${asset.manufacturer}` : ''}{asset.model ? ` · Modelo ${asset.model}` : ''}{asset.serial_number ? ` · Série ${asset.serial_number}` : ''}</small></article>)}
      </div> : <div className="history-empty">Nenhum ativo patrimonial cadastrado.</div>}
    </section>}
    {tab === 'calendar' && <section className="patient-list-panel">
      <div className="section-heading"><div><p className="eyebrow">AGENDA PREVENTIVA</p><h3>Próximas manutenções</h3></div><span className="module-total">{activePlans.length} rotinas</span></div>
      {loading ? <div className="history-empty">Carregando calendário…</div> : activePlans.length ? <div className="collection-list">
        {activePlans.map((plan) => <article className="collection-row" key={plan.id}><div className="collection-row-heading"><strong>{plan.asset_tag} · {plan.procedure}</strong><span className={`work-order-status ${plan.due_date < new Date().toISOString().slice(0, 10) ? 'status-cancelled' : 'status-open'}`}>Próxima: {dateLabel(plan.due_date)}</span></div><small>A cada {plan.interval_days} dias · Responsável: {plan.responsible || 'Não definido'}{plan.last_completed_at ? ` · Última conclusão ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(plan.last_completed_at))}` : ''}</small><button className="button button-secondary" type="button" disabled={saving} onClick={() => void completePlan(plan)}><BadgeCheck size={15} /> Registrar conclusão</button></article>)}
      </div> : <div className="history-empty">Não há manutenções preventivas programadas.</div>}
    </section>}
  </div>
}

function SafetyIncidentPanel() {
  const [incidents, setIncidents] = useState<SafetyIncident[]>([])
  const [patients, setPatients] = useState<PatientReference[]>([])
  const [form, setForm] = useState({ incident_type: 'medication', severity: 'near_miss', occurred_at: localDateTime(), unit: '', location: '', patient_reference: '', description: '' })
  const [followups, setFollowups] = useState<Record<string, { status: SafetyIncident['status']; investigation: string; corrective_action: string }>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    try {
      const [data, patientData] = await Promise.all([
        readApiResponse<{ incidents?: SafetyIncident[] }>(await fetch('/api/v1/nursing/safety-incidents')),
        readApiResponse<{ patients?: PatientReference[] }>(await fetch('/api/v1/nursing/patients')),
      ])
      setIncidents(data.incidents ?? [])
      setPatients(patientData.patients ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar o registro de segurança.')
    } finally { setLoading(false) }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function createIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      const incident = await readApiResponse<SafetyIncident>(await fetch('/api/v1/nursing/safety-incidents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, occurred_at: new Date(form.occurred_at).toISOString(), patient_reference: form.patient_reference.trim() || null }),
      }))
      setIncidents((current) => [incident, ...current])
      setForm({ incident_type: 'medication', severity: 'near_miss', occurred_at: localDateTime(), unit: '', location: '', patient_reference: '', description: '' })
      setNotice('Incidente registrado para investigação.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível registrar o incidente.')
    } finally { setSaving(false) }
  }

  async function updateIncident(incident: SafetyIncident) {
    const update = followups[incident.id] ?? { status: incident.status === 'open' ? 'investigating' : incident.status, investigation: incident.investigation, corrective_action: incident.corrective_action }
    setSaving(true); setError(''); setNotice('')
    try {
      const updated = await readApiResponse<SafetyIncident>(await fetch(`/api/v1/nursing/safety-incidents/${encodeURIComponent(incident.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update),
      }))
      setIncidents((current) => current.map((item) => item.id === updated.id ? updated : item))
      setNotice('Investigação e plano de ação atualizados.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível atualizar o incidente.')
    } finally { setSaving(false) }
  }

  return <div className="management-operations-grid">
    <div className="form-message form-message-warning" role="note">Acesso restrito à Gestão e Enfermagem. Não registre dados pessoais desnecessários; o identificador do paciente é opcional. O sistema não substitui o fluxo regulatório oficial de notificação.</div>
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    <form className="account-create-panel" onSubmit={(event) => void createIncident(event)}>
      <h3>Notificar evento, incidente ou quase falha</h3>
      <div className="field-grid field-grid-two">
        <label className="field"><span className="field-label">Tipo</span><select value={form.incident_type} onChange={(event) => setForm({ ...form, incident_type: event.target.value })}><option value="medication">Medicação</option><option value="fall">Queda</option><option value="identification">Identificação</option><option value="infection">Infecção</option><option value="equipment">Equipamento</option><option value="other">Outro</option></select></label>
        <label className="field"><span className="field-label">Gravidade</span><select value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value })}><option value="near_miss">Quase falha</option><option value="mild">Leve</option><option value="moderate">Moderada</option><option value="severe">Grave</option><option value="critical">Crítica</option></select></label>
        <label className="field"><span className="field-label">Data e hora</span><input required type="datetime-local" value={form.occurred_at} onChange={(event) => setForm({ ...form, occurred_at: event.target.value })} /></label>
        <label className="field"><span className="field-label">Unidade</span><input required minLength={2} maxLength={100} value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} /></label>
        <label className="field"><span className="field-label">Local</span><input required minLength={2} maxLength={120} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label>
        <PatientSelect label="Paciente relacionado (opcional)" patients={patients} value={form.patient_reference} onChange={(reference) => setForm({ ...form, patient_reference: reference })} emptyLabel="Sem paciente relacionado" optionLabel={(patient) => `${patient.name}${patient.room && patient.bed ? ` · Quarto ${patient.room}, leito ${patient.bed}` : ''}`} />
        <label className="field"><span className="field-label">Descrição objetiva</span><textarea required minLength={5} maxLength={2000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
      </div>
      <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Registrando…' : 'Registrar incidente confidencial'}</button>
    </form>
    <section className="patient-list-panel">
      <div className="section-heading"><div><p className="eyebrow">INVESTIGAÇÃO E MELHORIA</p><h3>Incidentes registrados</h3></div><span className="module-total">{incidents.filter((item) => item.status !== 'closed').length} abertos</span></div>
      {loading ? <div className="history-empty">Carregando ocorrências…</div> : incidents.length ? <div className="collection-list">{incidents.map((incident) => {
        const update = followups[incident.id] ?? { status: incident.status === 'open' ? 'investigating' as const : incident.status, investigation: incident.investigation, corrective_action: incident.corrective_action }
        const requiresInvestigation = update.status === 'action_required' || update.status === 'closed'
        return <article className="collection-row" key={incident.id}><div className="collection-row-heading"><strong>{incidentTypeLabels[incident.incident_type] ?? incident.incident_type} · {incidentSeverityLabels[incident.severity] ?? incident.severity}</strong><span className={`work-order-status ${incident.status === 'closed' ? 'status-completed' : incident.status === 'open' ? 'status-open' : 'status-in_progress'}`}>{incident.status === 'open' ? 'Aberto' : incident.status === 'investigating' ? 'Em investigação' : incident.status === 'action_required' ? 'Ação necessária' : 'Encerrado'}</span></div><p>{incident.description}</p><small>{incident.unit} · {incident.location} · {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(incident.occurred_at))} · Notificado por {incident.reported_by}</small>{incident.status !== 'closed' && <><div className="field-grid field-grid-two"><label className="field"><span className="field-label">Situação</span><select value={update.status} onChange={(event) => setFollowups((current) => ({ ...current, [incident.id]: { ...update, status: event.target.value as SafetyIncident['status'] } }))}><option value="investigating">Em investigação</option><option value="action_required">Ação necessária</option><option value="closed">Encerrado</option></select></label><label className="field"><span className="field-label">Investigação / causa{requiresInvestigation ? ' (obrigatória)' : ''}</span><textarea required={requiresInvestigation} minLength={requiresInvestigation ? 5 : undefined} maxLength={2000} value={update.investigation} onChange={(event) => setFollowups((current) => ({ ...current, [incident.id]: { ...update, investigation: event.target.value } }))} /></label><label className="field"><span className="field-label">Ação corretiva{update.status === 'closed' ? ' (obrigatória)' : ''}</span><textarea required={update.status === 'closed'} minLength={update.status === 'closed' ? 5 : undefined} maxLength={2000} value={update.corrective_action} onChange={(event) => setFollowups((current) => ({ ...current, [incident.id]: { ...update, corrective_action: event.target.value } }))} /></label></div><button className="button button-secondary" type="button" disabled={saving} onClick={() => void updateIncident(incident)}>Salvar acompanhamento</button></>}</article>
      })}</div> : <div className="history-empty">Nenhum incidente registrado.</div>}
    </section>
  </div>
}

function InstitutionalDocumentsPanel() {
  const [documents, setDocuments] = useState<InstitutionalDocument[]>([])
  const [form, setForm] = useState({ title: '', document_type: 'protocol', version: '1.0', content: '', valid_until: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    try {
      const data = await readApiResponse<{ documents?: InstitutionalDocument[] }>(await fetch('/api/v1/nursing/institutional-documents'))
      setDocuments(data.documents ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar documentos institucionais.')
    } finally { setLoading(false) }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function createDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      const document = await readApiResponse<InstitutionalDocument>(await fetch('/api/v1/nursing/institutional-documents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, valid_until: form.valid_until || null }),
      }))
      setDocuments((current) => [document, ...current])
      setForm({ title: '', document_type: 'protocol', version: '1.0', content: '', valid_until: '' })
      setNotice('Nova versão criada como rascunho.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível registrar o documento.')
    } finally { setSaving(false) }
  }

  async function setStatus(document: InstitutionalDocument, status: InstitutionalDocument['status']) {
    setSaving(true); setError(''); setNotice('')
    try {
      const updated = await readApiResponse<InstitutionalDocument>(await fetch(`/api/v1/nursing/institutional-documents/${encodeURIComponent(document.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      }))
      setDocuments((current) => current.map((item) => item.id === updated.id ? updated : item))
      setNotice(`Documento atualizado: ${documentStatusLabels[updated.status]}.`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível atualizar o fluxo documental.')
    } finally { setSaving(false) }
  }

  return <div className="management-operations-grid">
    <div className="form-message form-message-warning" role="note">Este cadastro mantém conteúdo textual, versão, validade e aprovação. Não faz assinatura digital certificada nem armazena anexos.</div>
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    <form className="account-create-panel" onSubmit={(event) => void createDocument(event)}>
      <h3>Criar rascunho institucional</h3>
      <div className="field-grid field-grid-two">
        <label className="field"><span className="field-label">Título</span><input required minLength={3} maxLength={160} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
        <label className="field"><span className="field-label">Tipo</span><select value={form.document_type} onChange={(event) => setForm({ ...form, document_type: event.target.value })}><option value="protocol">Protocolo</option><option value="policy">Política</option><option value="form">Formulário</option><option value="procedure">Procedimento</option><option value="other">Outro</option></select></label>
        <label className="field"><span className="field-label">Versão</span><input required maxLength={24} value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} /></label>
        <label className="field"><span className="field-label">Validade</span><input type="date" value={form.valid_until} onChange={(event) => setForm({ ...form, valid_until: event.target.value })} /></label>
        <label className="field"><span className="field-label">Conteúdo textual</span><textarea required minLength={1} maxLength={10000} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} /></label>
      </div>
      <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Criar rascunho'}</button>
    </form>
    <section className="patient-list-panel">
      <div className="section-heading"><div><p className="eyebrow">VERSÕES E VALIDADE</p><h3>Documentos institucionais</h3></div><span className="module-total">{documents.filter((item) => item.status === 'in_review').length} em revisão</span></div>
      {loading ? <div className="history-empty">Carregando documentos…</div> : documents.length ? <div className="collection-list">{documents.map((document) => <article className="collection-row" key={document.id}><div className="collection-row-heading"><strong>{document.title} · v{document.version}</strong><span className={`work-order-status ${document.status === 'approved' ? 'status-completed' : document.status === 'archived' ? 'status-cancelled' : document.status === 'draft' ? 'status-open' : 'status-in_progress'}`}>{documentStatusLabels[document.status]}</span></div><p>{document.content}</p><small>{documentTypeLabels[document.document_type] ?? document.document_type} · válido até {dateLabel(document.valid_until)} · criado por {document.created_by}{document.approved_by ? ` · aprovado por ${document.approved_by}` : ''}</small><div className="patient-detail-actions">{document.status === 'draft' && <button className="button button-secondary" type="button" disabled={saving} onClick={() => void setStatus(document, 'in_review')}>Enviar para revisão</button>}{document.status === 'in_review' && <button className="button button-primary" type="button" disabled={saving} onClick={() => void setStatus(document, 'approved')}>Aprovar versão</button>}{document.status !== 'archived' && <button className="button button-secondary" type="button" disabled={saving} onClick={() => void setStatus(document, 'archived')}>Arquivar versão</button>}</div></article>)}</div> : <div className="history-empty">Nenhum documento cadastrado.</div>}
    </section>
  </div>
}

const documentStatusLabels: Record<InstitutionalDocument['status'], string> = {
  draft: 'Rascunho',
  in_review: 'Em revisão',
  approved: 'Aprovado',
  archived: 'Arquivado',
}

const documentTypeLabels: Record<string, string> = {
  protocol: 'Protocolo',
  policy: 'Política',
  form: 'Formulário',
  procedure: 'Procedimento',
  other: 'Outro',
}

const incidentTypeLabels: Record<string, string> = {
  medication: 'Medicação',
  fall: 'Queda',
  identification: 'Identificação',
  infection: 'Infecção',
  equipment: 'Equipamento',
  other: 'Outro',
}

const incidentSeverityLabels: Record<string, string> = {
  near_miss: 'Quase falha',
  mild: 'Leve',
  moderate: 'Moderada',
  severe: 'Grave',
  critical: 'Crítica',
}
