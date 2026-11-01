import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, ClipboardList, ExternalLink, Plus, Shirt, Trash2, WashingMachine } from 'lucide-react'
import { readApiResponse } from '../api'
import ToastMessage from '../components/ToastMessage'
import { useAppDialogs } from '../components/appDialogContext'

type LaundryUser = {
  id: string
  name: string
  display_name?: string
  modules: string[]
  permissions: Record<string, string[]>
  is_superuser?: boolean
}
type LaundryUnit = 'unidade' | 'kg' | 'pacote'
type LaundryStatus = 'open' | 'collected' | 'washing' | 'ready' | 'delivered' | 'cancelled'
type LaundryItem = {
  id: string
  name: string
  category: string
  unit: LaundryUnit
  clean_balance?: string
  soiled_balance?: string
}
type LaundryRequestLine = {
  item_id: string
  name: string
  category: string
  unit: LaundryUnit
  quantity: string
}
type LaundryRequest = {
  id: string
  request_number: string
  unit: string
  area: string
  description: string
  priority: 'normal' | 'high' | 'urgent'
  status: LaundryStatus
  assignee: string
  requester_name: string
  updated_by: string
  created_at: string
  updated_at: string
  items: LaundryRequestLine[]
}
type LaundryMovement = {
  id: number
  item_name: string
  item_id: string
  unit: string
  movement_type: 'soiled_received' | 'soiled_processed' | 'clean_received' | 'clean_delivered'
  quantity: string
  actor_name: string
  created_at: string
}
type LaundryReports = {
  items: LaundryItem[]
  status_counts: Record<LaundryStatus, number>
  movements: LaundryMovement[]
}
type LaundryTab = 'requests' | 'catalog' | 'reports'

const tabLabels: Record<LaundryTab, string> = {
  requests: 'Solicitações',
  catalog: 'Itens da lavanderia',
  reports: 'Estoque e relatórios',
}
const statusLabels: Record<LaundryStatus, string> = {
  open: 'Aguardando coleta',
  collected: 'Coletado',
  washing: 'Em lavagem',
  ready: 'Pronto para devolução',
  delivered: 'Devolvido',
  cancelled: 'Cancelado',
}
const nextStatus: Partial<Record<LaundryStatus, LaundryStatus>> = {
  open: 'collected',
  collected: 'washing',
  washing: 'ready',
  ready: 'delivered',
}
const nextAction: Partial<Record<LaundryStatus, string>> = {
  open: 'Registrar coleta',
  collected: 'Iniciar lavagem',
  washing: 'Marcar como pronto',
  ready: 'Registrar devolução',
}
const movementLabels: Record<LaundryMovement['movement_type'], string> = {
  soiled_received: 'Coleta de peças sujas',
  soiled_processed: 'Peças encaminhadas à lavagem',
  clean_received: 'Peças limpas recebidas',
  clean_delivered: 'Peças limpas devolvidas',
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function formatQuantity(value: string, unit: LaundryUnit) {
  return `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unit}`
}

export default function LaundryPage({
  user,
  mobileMode = false,
  onLogout,
}: {
  user: LaundryUser
  mobileMode?: boolean
  onLogout?: () => void
}) {
  const { confirm } = useAppDialogs()
  const [tab, setTab] = useState<LaundryTab>('requests')
  const [items, setItems] = useState<LaundryItem[]>([])
  const [requests, setRequests] = useState<LaundryRequest[]>([])
  const [reports, setReports] = useState<LaundryReports | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [updating, setUpdating] = useState('')
  const [mobileRequestFormOpen, setMobileRequestFormOpen] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editingItemId, setEditingItemId] = useState('')
  const [itemForm, setItemForm] = useState({ name: '', category: '', unit: 'unidade' as LaundryUnit })
  const [requestForm, setRequestForm] = useState({
    unit: '',
    area: '',
    description: '',
    priority: 'normal' as LaundryRequest['priority'],
    lines: [{ item_id: '', quantity: '1' }],
  })
  const [assignees, setAssignees] = useState<Record<string, string>>({})
  const can = (action: string) => user.is_superuser || ['laundry', 'management', 'admin'].some(
    (module) => user.modules.includes(module) && user.permissions[module]?.includes(action) === true,
  )
  const canCreate = can('criar')
  const canEdit = can('alterar')
  const canDelete = can('excluir')
  const availableItems = items

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [itemResult, requestResult, reportResult] = await Promise.all([
        fetch('/api/v1/laundry/items').then((response) => readApiResponse<{ items: LaundryItem[] }>(response)),
        fetch('/api/v1/laundry/requests?limit=100').then((response) => readApiResponse<{ requests: LaundryRequest[] }>(response)),
        fetch('/api/v1/laundry/reports').then((response) => readApiResponse<LaundryReports>(response)),
      ])
      setItems(itemResult.items)
      setRequests(requestResult.requests)
      setReports(reportResult)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os dados da Lavanderia/Rouparia.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0)
    return () => window.clearTimeout(timer)
  }, [loadData])

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(editingItemId ? `/api/v1/laundry/items/${encodeURIComponent(editingItemId)}` : '/api/v1/laundry/items', {
        method: editingItemId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(itemForm),
      })
      await readApiResponse<LaundryItem>(response)
      setItemForm({ name: '', category: '', unit: 'unidade' })
      setEditingItemId('')
      setNotice(editingItemId ? 'Item atualizado.' : 'Item cadastrado.')
      await loadData()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar o item.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteItem(item: LaundryItem) {
    if (!await confirm(`Excluir o item "${item.name}"? Itens vinculados a solicitações ou movimentações não podem ser excluídos.`)) return
    setError('')
    setNotice('')
    try {
      await readApiResponse<void>(await fetch(`/api/v1/laundry/items/${encodeURIComponent(item.id)}`, { method: 'DELETE' }))
      setNotice('Item excluído.')
      await loadData()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Não foi possível excluir o item.')
    }
  }

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/v1/laundry/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit: requestForm.unit,
          area: requestForm.area,
          description: requestForm.description,
          priority: requestForm.priority,
          items: requestForm.lines.map(({ item_id, quantity }) => ({ item_id, quantity })),
        }),
      })
      await readApiResponse<LaundryRequest>(response)
      setRequestForm({ unit: '', area: '', description: '', priority: 'normal', lines: [{ item_id: '', quantity: '1' }] })
      setNotice('Solicitação registrada na fila da Lavanderia/Rouparia.')
      setTab('requests')
      setMobileRequestFormOpen(false)
      await loadData()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível registrar a solicitação.')
    } finally {
      setSaving(false)
    }
  }

  async function updateRequest(request: LaundryRequest, status?: LaundryStatus) {
    setUpdating(request.id)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/v1/laundry/requests/${encodeURIComponent(request.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(status ? { status } : {}),
          ...(assignees[request.id] !== undefined ? { assignee: assignees[request.id] } : {}),
        }),
      })
      await readApiResponse<LaundryRequest>(response)
      setNotice(status ? `Solicitação atualizada: ${statusLabels[status].toLocaleLowerCase('pt-BR')}.` : 'Responsável atualizado.')
      await loadData()
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Não foi possível atualizar a solicitação.')
    } finally {
      setUpdating('')
    }
  }

  const counts = reports?.status_counts
  const summary = reports ? {
    dirtyItems: reports.items.filter((item) => Number(item.soiled_balance ?? 0) > 0).length,
    cleanItems: reports.items.filter((item) => Number(item.clean_balance ?? 0) > 0).length,
    processing: (counts?.collected ?? 0) + (counts?.washing ?? 0),
    active: (counts?.open ?? 0) + (counts?.collected ?? 0) + (counts?.washing ?? 0) + (counts?.ready ?? 0),
  } : null

  return <section className={`laundry-page work-orders-page page-enter${mobileMode ? ' laundry-page-mobile' : ''}`}>
    <header className="laundry-header">
      <span className="module-icon module-icon-laundry"><Shirt size={23} /></span>
      <div><p className="eyebrow">{mobileMode ? 'PAINEL DE TRABALHO · LAVANDERIA' : 'MÓDULO · LAVANDERIA/ROUPARIA'}</p><h1>Lavanderia/Rouparia</h1><p className="welcome-copy">{mobileMode ? 'Acompanhe solicitações e atualize cada etapa do enxoval.' : 'Organize o enxoval, acompanhe coleta, lavagem e devolução e consulte o estoque limpo e sujo.'}</p></div>
      {mobileMode ? <div className="laundry-header-actions"><a className="button button-secondary" href="/">Sistema completo</a>{onLogout && <button className="button button-secondary" type="button" onClick={onLogout}>Sair</button>}</div> : <a className="button button-secondary" href="/laundry.html" target="_blank" rel="noreferrer"><ExternalLink size={16} /> Abrir Lavanderia no celular</a>}
    </header>
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    {summary && <div className="laundry-summary" aria-label="Indicadores da Lavanderia/Rouparia">
      <article><strong>{summary.active}</strong><span>Solicitações ativas</span></article>
      <article><strong>{summary.processing}</strong><span>Em processamento</span></article>
      <article><strong>{summary.dirtyItems}</strong><span>Tipos com peças sujas no ciclo</span></article>
      <article><strong>{summary.cleanItems}</strong><span>Tipos com peças limpas disponíveis</span></article>
    </div>}
    <nav className="laundry-tabs admin-tabs module-tabs" role="tablist" aria-label="Áreas da Lavanderia e Rouparia">
      {(Object.keys(tabLabels) as LaundryTab[]).map((value) => <button key={value} className={`button ${tab === value ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{tabLabels[value]}</button>)}
    </nav>
    {tab === 'requests' && <div className="laundry-content">
      {canCreate && mobileMode && <button className="button button-primary laundry-mobile-new-request" type="button" aria-expanded={mobileRequestFormOpen} aria-controls="laundry-request-form-panel" onClick={() => { setMobileRequestFormOpen((open) => !open); setError(''); setNotice('') }}>
        <Plus size={17} /> {mobileRequestFormOpen ? 'Fechar solicitação' : 'Nova solicitação de enxoval'}
      </button>}
      {canCreate && (!mobileMode || mobileRequestFormOpen) && <section className="patient-list-panel laundry-form-panel" id={mobileMode ? 'laundry-request-form-panel' : undefined}>
        <div className="section-heading"><div><p className="eyebrow">COLETA E PROCESSAMENTO</p><h2>Nova solicitação de enxoval</h2><p className="welcome-copy">Informe a unidade e as peças sujas para acompanhar coleta, lavagem e devolução.</p></div></div>
        {!items.length ? <p className="history-empty">Cadastre os tipos de itens na aba Itens da lavanderia antes de abrir solicitações.</p> : <form className="field-grid" onSubmit={(event) => void createRequest(event)}>
          <label className="field"><span className="field-label">Unidade solicitante</span><input required minLength={2} maxLength={80} value={requestForm.unit} onChange={(event) => setRequestForm((current) => ({ ...current, unit: event.target.value }))} /></label>
          <label className="field"><span className="field-label">Área / localização</span><input required minLength={2} maxLength={120} value={requestForm.area} onChange={(event) => setRequestForm((current) => ({ ...current, area: event.target.value }))} /></label>
          <label className="field"><span className="field-label">Prioridade</span><select value={requestForm.priority} onChange={(event) => setRequestForm((current) => ({ ...current, priority: event.target.value as LaundryRequest['priority'] }))}><option value="normal">Rotina</option><option value="high">Prioritária</option><option value="urgent">Urgente</option></select></label>
          <label className="field"><span className="field-label">Observação (opcional)</span><input maxLength={500} value={requestForm.description} onChange={(event) => setRequestForm((current) => ({ ...current, description: event.target.value }))} /></label>
          <fieldset className="laundry-lines-fieldset"><legend>Itens e quantidades</legend>{requestForm.lines.map((line, index) => <div className="laundry-line" key={index}>
            <label className="field"><span className="field-label">Tipo de item</span><select required value={line.item_id} onChange={(event) => setRequestForm((current) => ({ ...current, lines: current.lines.map((row, rowIndex) => rowIndex === index ? { ...row, item_id: event.target.value } : row) }))}><option value="">Selecione</option>{availableItems.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.category} ({item.unit})</option>)}</select></label>
            <label className="field"><span className="field-label">Quantidade</span><input required type="number" min="0.001" max="999999999" step="0.001" value={line.quantity} onChange={(event) => setRequestForm((current) => ({ ...current, lines: current.lines.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row) }))} /></label>
            {requestForm.lines.length > 1 && <button className="icon-button" type="button" aria-label="Remover item da solicitação" onClick={() => setRequestForm((current) => ({ ...current, lines: current.lines.filter((_, rowIndex) => rowIndex !== index) }))}><Trash2 size={16} /></button>}
          </div>)}<button className="button button-secondary" type="button" onClick={() => setRequestForm((current) => ({ ...current, lines: [...current.lines, { item_id: '', quantity: '1' }] }))}><Plus size={16} /> Adicionar outro item</button></fieldset>
          <button className="button button-primary laundry-submit" type="submit" disabled={saving}>{saving ? 'Registrando…' : 'Abrir solicitação'}</button>
        </form>}
      </section>}
      <section className="patient-list-panel laundry-request-panel">
        <div className="section-heading"><div><p className="eyebrow">FLUXO OPERACIONAL</p><h2>Solicitações <span className="module-total">{requests.length}</span></h2></div><button className="button button-secondary" type="button" onClick={() => void loadData()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar'}</button></div>
        {loading ? <div className="history-empty" role="status">Carregando solicitações…</div> : requests.length ? <div className="laundry-request-list">{requests.map((request) => <article className="laundry-request-card" key={request.id}>
          <div className="laundry-request-heading"><div><span className={`work-order-priority priority-${request.priority}`}>{request.priority === 'urgent' ? 'Urgente' : request.priority === 'high' ? 'Prioritária' : 'Rotina'}</span><small className="service-request-number">{request.request_number}</small><h3>{request.unit} · {request.area}</h3></div><span className={`work-order-status status-${request.status === 'ready' || request.status === 'collected' || request.status === 'washing' ? 'in_progress' : request.status === 'delivered' ? 'completed' : request.status}`}>{statusLabels[request.status]}</span></div>
          <ul className="laundry-request-items">{request.items.map((line) => <li key={line.item_id}>{line.name} · {formatQuantity(line.quantity, line.unit)}</li>)}</ul>
          {request.description && <p>{request.description}</p>}
          <small>Solicitado por {request.requester_name} · {formatDate(request.created_at)}{request.assignee ? ` · Responsável: ${request.assignee}` : ''}</small>
          {canEdit && request.status !== 'cancelled' && request.status !== 'delivered' && <div className="laundry-request-actions">
            <label className="field"><span className="field-label">Responsável</span><input maxLength={120} value={assignees[request.id] ?? request.assignee} onChange={(event) => setAssignees((current) => ({ ...current, [request.id]: event.target.value }))} /></label>
            <button className="button button-secondary" type="button" disabled={updating === request.id || assignees[request.id] === undefined || assignees[request.id] === request.assignee} onClick={() => void updateRequest(request)}>{updating === request.id ? 'Salvando…' : 'Salvar responsável'}</button>
            {nextStatus[request.status] && <button className="button button-primary" type="button" disabled={updating === request.id} onClick={() => void updateRequest(request, nextStatus[request.status])}>{nextAction[request.status]} <ArrowRight size={16} /></button>}
            {request.status === 'open' && <button className="button button-secondary" type="button" disabled={updating === request.id} onClick={() => void updateRequest(request, 'cancelled')}>Cancelar</button>}
          </div>}
          <small>Última atualização por {request.updated_by} · {formatDate(request.updated_at)}</small>
        </article>)}</div> : <div className="history-empty"><ClipboardList size={20} /> Nenhuma solicitação registrada.</div>}
      </section>
    </div>}
    {tab === 'catalog' && <section className="patient-list-panel laundry-catalog-panel">
      <div className="section-heading"><div><p className="eyebrow">CADASTRO DE ITENS</p><h2>Tipos de enxoval</h2><p className="welcome-copy">Os itens cadastrados ficam disponíveis nas solicitações e nos relatórios de estoque.</p></div></div>
      {(canCreate || (Boolean(editingItemId) && canEdit)) && <form className="laundry-catalog-form" onSubmit={(event) => void saveItem(event)}>
        <label className="field"><span className="field-label">Nome do item</span><input required minLength={2} maxLength={120} value={itemForm.name} onChange={(event) => setItemForm((current) => ({ ...current, name: event.target.value }))} /></label>
        <label className="field"><span className="field-label">Categoria</span><input required minLength={2} maxLength={80} value={itemForm.category} onChange={(event) => setItemForm((current) => ({ ...current, category: event.target.value }))} placeholder="Ex.: cama, banho, uniforme" /></label>
        <label className="field"><span className="field-label">Unidade de controle</span><select value={itemForm.unit} onChange={(event) => setItemForm((current) => ({ ...current, unit: event.target.value as LaundryUnit }))}><option value="unidade">Unidade</option><option value="kg">Quilograma</option><option value="pacote">Pacote</option></select></label>
        <div className="laundry-catalog-actions"><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : editingItemId ? 'Salvar alterações' : 'Cadastrar item'}</button>{editingItemId && <button className="button button-secondary" type="button" onClick={() => { setEditingItemId(''); setItemForm({ name: '', category: '', unit: 'unidade' }) }}>Cancelar edição</button>}</div>
      </form>}
      {loading ? <div className="history-empty" role="status">Carregando itens…</div> : items.length ? <div className="laundry-catalog-list">{items.map((item) => <article key={item.id}><div><strong>{item.name}</strong><span>{item.category} · controle em {item.unit}</span></div>{canEdit && <button className="button button-secondary" type="button" onClick={() => { setEditingItemId(item.id); setItemForm({ name: item.name, category: item.category, unit: item.unit }) }}>Editar</button>}{canDelete && <button className="button button-secondary" type="button" onClick={() => void deleteItem(item)}><Trash2 size={15} /> Excluir</button>}</article>)}</div> : <div className="history-empty"><Shirt size={20} /> Nenhum item cadastrado.</div>}
    </section>}
    {tab === 'reports' && <section className="patient-list-panel laundry-reports-panel">
      <div className="section-heading"><div><p className="eyebrow">SALDOS E MOVIMENTAÇÕES</p><h2>Estoque da Lavanderia/Rouparia</h2><p className="welcome-copy">Os saldos são calculados pelas etapas registradas nas solicitações; o sistema não estima quantidades.</p></div></div>
      {loading ? <div className="history-empty" role="status">Carregando estoque…</div> : reports?.items.length ? <div className="laundry-stock-list">{reports.items.map((item) => <article key={item.id}><div><strong>{item.name}</strong><span>{item.category}</span></div><span><small>Sujo no ciclo</small><strong>{formatQuantity(item.soiled_balance ?? '0', item.unit)}</strong></span><span><small>Limpo disponível</small><strong>{formatQuantity(item.clean_balance ?? '0', item.unit)}</strong></span></article>)}</div> : <div className="history-empty"><WashingMachine size={20} /> Cadastre itens para acompanhar o estoque.</div>}
      <div className="section-heading laundry-report-heading"><div><p className="eyebrow">RASTREABILIDADE</p><h2>Movimentações recentes</h2></div><span className="module-total">{reports?.movements.length ?? 0}</span></div>
      {reports?.movements.length ? <div className="laundry-movement-list">{reports.movements.map((movement) => {
        const item = reports.items.find((candidate) => candidate.id === movement.item_id)
        return <article key={movement.id}><div><strong>{movement.item_name} · {item?.unit ?? 'unidade'}</strong><span>{movementLabels[movement.movement_type]}</span></div><strong>{formatQuantity(movement.quantity, item?.unit ?? 'unidade')}</strong><small>Unidade solicitante: {movement.unit} · {movement.actor_name} · {formatDate(movement.created_at)}</small></article>
      })}</div> : <p className="history-empty">Nenhuma movimentação de estoque registrada.</p>}
    </section>}
    {!mobileMode && <p className="laundry-access-note">Esta área registra somente itens, unidades e movimentações da Lavanderia/Rouparia. Acesso e alterações seguem as permissões atribuídas à conta.</p>}
  </section>
}
