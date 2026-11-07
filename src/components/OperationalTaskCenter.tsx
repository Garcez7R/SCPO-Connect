import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, ClipboardList, RefreshCw } from 'lucide-react'
import { readApiResponse } from '../api'
import ToastMessage from './ToastMessage'
import { hygieneAreaLabels, hygieneRequestTypeLabels, type HygieneArea, type HygieneRequestType } from '../operationsLabels'
import { formatDateDmy } from '../dateFormatting'

type ModuleId = 'reception' | 'nursing' | 'pharmacy' | 'maintenance' | 'hygiene'
type TaskFilter = 'all' | 'urgent'
type Task = { id: string; title: string; detail: string; priority: 'urgent' | 'high' | 'normal' }
type TaskCard = { module: ModuleId; label: string; count: number; tasks: Task[] }
type AuthUser = { id: string; modules: string[]; permissions: Record<string, string[]> }

const moduleLabels: Record<ModuleId, string> = {
  reception: 'Recepção',
  nursing: 'Enfermagem',
  pharmacy: 'Farmácia',
  maintenance: 'Manutenção',
  hygiene: 'Higienização',
}

function canRead(user: AuthUser, module: ModuleId) {
  return user.permissions[module]?.includes('consultar') ?? false
}

async function loadPagedRecords<T>(endpoint: string, collectionKey: string, pageSize: number): Promise<T[]> {
  const records: T[] = []
  let offset = 0
  let total = Number.POSITIVE_INFINITY
  while (offset < total) {
    const url = new URL(endpoint, window.location.origin)
    url.searchParams.set('limit', String(pageSize))
    url.searchParams.set('offset', String(offset))
    const data = await readApiResponse<Record<string, unknown>>(await fetch(`${url.pathname}${url.search}`))
    const page = data[collectionKey]
    if (!Array.isArray(page) || !page.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))) {
      throw new Error(`A resposta de ${endpoint} não contém uma lista válida de ${collectionKey}.`)
    }
    records.push(...page as T[])
    total = typeof data.total === 'number' ? data.total : records.length
    if (page.length === 0) {
      if (offset < total) throw new Error(`A consulta de ${endpoint} retornou apenas ${records.length} de ${total} registros.`)
      break
    }
    offset += page.length
  }
  return records
}

function localDateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export default function OperationalTaskCenter({
  user,
  onNavigate,
}: {
  user: AuthUser
  onNavigate: (module: ModuleId) => void
}) {
  const preferenceKey = `scpo-task-filter:${user.id}`
  const [filter, setFilter] = useState<TaskFilter>(() => {
    try {
      return window.localStorage.getItem(preferenceKey) === 'urgent' ? 'urgent' : 'all'
    } catch {
      return 'all'
    }
  })
  const [preferenceError, setPreferenceError] = useState('')
  const [cards, setCards] = useState<TaskCard[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  function saveFilter(value: TaskFilter) {
    setFilter(value)
    try {
      window.localStorage.setItem(preferenceKey, value)
      setPreferenceError('')
    } catch {
      setPreferenceError('O navegador não permitiu salvar o filtro neste dispositivo.')
    }
  }

  const refresh = useCallback(async () => {
    type Arrival = { id: string; patient_name: string; reason: string; status: 'waiting' | 'called' | 'in_service'; clinical_priority: string; created_at: string }
    type Dispensation = { id: string; patient_reference: string; medication_name: string; quantity: string; unit: string; created_at: string }
    type Administration = { dispensation_id: string; dose: string; status: 'administered' | 'refused' | 'held' }
    type StockAlert = { item_id: number; item_name: string; balance: string; unit: string; expiry_date: string; days_to_expiry: number; alert_types: string[] }
    type WorkOrder = { id: string; title: string; location: string; priority: 'normal' | 'high' | 'urgent'; status: 'open' | 'in_progress' | 'completed' | 'cancelled' }
    type HygieneRequest = { id: string; request_type: HygieneRequestType; custom_type: string; unit: string; area: HygieneArea; location: string; priority: 'normal' | 'high' | 'urgent'; status: 'open' | 'in_progress' | 'completed' | 'cancelled'; created_at: string }

    const loaders: { module: ModuleId; load: () => Promise<TaskCard> }[] = []

    if (user.modules.includes('reception') && canRead(user, 'reception')) {
      loaders.push({
        module: 'reception',
        load: async () => {
          const [waiting, called, inService] = await Promise.all(
            (['waiting', 'called', 'in_service'] as const).map((status) =>
              loadPagedRecords<Arrival>(`/api/v1/reception/arrivals?status=${status}`, 'arrivals', 100),
            ),
          )
          const arrivals = [...waiting, ...called, ...inService]
          return {
            module: 'reception',
            label: moduleLabels.reception,
            count: arrivals.length,
            tasks: arrivals.map((arrival) => ({
              id: arrival.id,
              title: arrival.patient_name,
              detail: `${arrival.status === 'waiting' ? 'Aguardando' : arrival.status === 'called' ? 'Chamado' : 'Em atendimento'} · ${localDateTime(arrival.created_at)} · ${arrival.reason}`,
              priority: arrival.clinical_priority === 'urgent' ? 'urgent' : arrival.clinical_priority === 'priority' ? 'high' : 'normal',
            })),
          }
        },
      })
    }

    if (user.modules.includes('nursing') && canRead(user, 'nursing')) {
      loaders.push({
        module: 'nursing',
        load: async () => {
          const [dispensations, administrationRecords] = await Promise.all([
            loadPagedRecords<Dispensation>('/api/v1/pharmacy/dispensations?status=dispensed', 'dispensations', 500),
            loadPagedRecords<Administration>('/api/v1/nursing/medication-administrations', 'administrations', 500),
          ])
          const pending = dispensations.map((item) => {
            const administered = administrationRecords
              .filter((record) => record.dispensation_id === item.id && record.status === 'administered')
              .reduce((total, record) => total + Number(record.dose.replace(',', '.')), 0)
            const remaining = Number(item.quantity.replace(',', '.')) - administered
            return { ...item, remaining: Number.isFinite(remaining) && remaining > 0.000001 ? remaining : 0 }
          }).filter((item) => Number.isFinite(item.remaining) && item.remaining > 0)
          return {
            module: 'nursing',
            label: 'Enfermagem · registros de medicação',
            count: pending.length,
            tasks: pending.map((item) => ({
              id: item.id,
              title: item.medication_name,
              detail: `${item.remaining} de ${item.quantity} ${item.unit} restantes · dispensação ${localDateTime(item.created_at)}`,
              priority: 'normal',
            })),
          }
        },
      })
    }

    if (user.modules.includes('pharmacy') && canRead(user, 'pharmacy')) {
      loaders.push({
        module: 'pharmacy',
        load: async () => {
          const response = await fetch('/api/v1/pharmacy/stock-alerts')
          const data = await readApiResponse<{ alerts?: StockAlert[] }>(response)
          const alerts = data.alerts ?? []
          return {
            module: 'pharmacy',
            label: moduleLabels.pharmacy,
            count: alerts.length,
            tasks: alerts.map((alert) => ({
              id: String(alert.item_id),
              title: alert.item_name,
              detail: `${alert.balance} ${alert.unit} · ${alert.alert_types.includes('expired') ? 'lote vencido' : alert.alert_types.includes('expiring') ? `vence em ${Math.max(0, alert.days_to_expiry)} dias` : 'abaixo do mínimo'} · validade ${formatDateDmy(alert.expiry_date)}`,
              priority: alert.alert_types.includes('expired') || alert.alert_types.includes('critical_stock') ? 'urgent' : alert.alert_types.includes('below_minimum') || alert.alert_types.includes('expiring') ? 'high' : 'normal',
            })),
          }
        },
      })
    }

    if (user.modules.includes('maintenance') && canRead(user, 'maintenance')) {
      loaders.push({
        module: 'maintenance',
        load: async () => {
          const response = await fetch('/api/v1/maintenance/queue')
          const data = await readApiResponse<{ orders?: WorkOrder[] }>(response)
          const openOrders = (data.orders ?? []).filter((order) => order.status === 'open' || order.status === 'in_progress')
          return {
            module: 'maintenance',
            label: moduleLabels.maintenance,
            count: openOrders.length,
            tasks: openOrders.map((order) => ({
              id: order.id,
              title: order.title,
              detail: `${order.status === 'open' ? 'Aberta' : 'Em execução'} · ${order.location}`,
              priority: order.priority,
            })),
          }
        },
      })
    }

    if (user.modules.includes('hygiene') && canRead(user, 'hygiene')) {
      loaders.push({
        module: 'hygiene',
        load: async () => {
          const requests = await loadPagedRecords<HygieneRequest>('/api/v1/hygiene/requests', 'requests', 500)
          const openRequests = requests.filter((request) => request.status === 'open' || request.status === 'in_progress')
          return {
            module: 'hygiene',
            label: moduleLabels.hygiene,
            count: openRequests.length,
            tasks: openRequests.map((request) => ({
              id: request.id,
              title: request.custom_type || hygieneRequestTypeLabels[request.request_type],
              detail: `${request.status === 'open' ? 'Aberta' : 'Em execução'} · ${[request.unit, hygieneAreaLabels[request.area], request.location].filter(Boolean).join(' · ')} · ${localDateTime(request.created_at)}`,
              priority: request.priority,
            })),
          }
        },
      })
    }

    const results = await Promise.allSettled(loaders.map((loader) => loader.load()))
    setCards(results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []))
    setErrors(results.flatMap((result, index) => result.status === 'rejected'
      ? [`${moduleLabels[loaders[index].module]}: ${result.reason instanceof Error ? result.reason.message : 'Não foi possível carregar as pendências.'}`]
      : []))
    setLoading(false)
  }, [user])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  const visibleCards = cards.map((card) => ({
    ...card,
    tasks: filter === 'urgent' ? card.tasks.filter((task) => task.priority === 'urgent') : card.tasks,
  })).filter((card) => card.tasks.length > 0)
  const visibleCount = visibleCards.reduce((sum, card) => sum + (filter === 'urgent'
    ? card.tasks.length
    : card.count), 0)

  return <section className="task-center patient-list-panel" aria-labelledby="task-center-title">
    <div className="section-heading">
      <div><p className="eyebrow">PRÓXIMAS AÇÕES · ACESSO POR PERFIL</p><h2 id="task-center-title">Caixa de tarefas</h2><p className="welcome-copy">Pendências operacionais dos módulos que você pode consultar.</p></div>
      <button className="button button-secondary" type="button" onClick={() => { setLoading(true); void refresh() }} disabled={loading}><RefreshCw size={15} /> {loading ? 'Atualizando…' : 'Atualizar'}</button>
    </div>
    <div className="task-center-controls">
      <label className="field"><span className="field-label">Filtro</span><select value={filter} onChange={(event) => saveFilter(event.target.value as TaskFilter)}><option value="all">Todas as pendências</option><option value="urgent">Somente prioridade urgente</option></select></label>
      <span className="module-total">{loading ? '…' : visibleCount} pendência(s)</span>
    </div>
    <details className="task-center-source-details">
      <summary>De onde vêm as pendências?</summary>
      <ul>
        <li><strong>Recepção:</strong> chegadas aguardando chamada ou em atendimento; usa situação, prioridade, motivo e horário.</li>
        <li><strong>Enfermagem:</strong> dispensações ativas cuja quantidade ainda não foi coberta por doses marcadas como administradas. Não avalia horários, indicação nem decisão clínica.</li>
        <li><strong>Farmácia:</strong> lotes vencidos ou próximos do vencimento e produtos abaixo das metas de estoque; usa saldo, validade e tipo de alerta.</li>
        <li><strong>Manutenção:</strong> ordens abertas ou em andamento, com assunto, local e prioridade.</li>
        <li><strong>Higienização:</strong> solicitações abertas ou em andamento, com tipo, unidade, área, local, prioridade e horário.</li>
      </ul>
      <p className="field-hint">Cada fila só aparece para módulos em que sua conta tem permissão de consulta. O filtro urgente depende da prioridade registrada na origem.</p>
    </details>
    {preferenceError && <p className="field-hint" role="status">{preferenceError}</p>}
    {errors.map((message) => <ToastMessage variant="error" key={message}>{message}</ToastMessage>)}
    {loading && !cards.length ? <div className="history-empty">Carregando filas autorizadas…</div>
      : visibleCards.length ? <div className="task-center-grid">{visibleCards.map((card) => <article className="task-center-card" key={card.module}>
        <div className="task-center-card-heading"><div><p className="eyebrow">{card.label}</p><strong>{filter === 'urgent' ? card.tasks.length : card.count} pendência(s)</strong></div><button className="button button-secondary" type="button" onClick={() => onNavigate(card.module)}>Abrir fila <ArrowRight size={15} /></button></div>
        <ul>{card.tasks.slice(0, 5).map((task) => <li key={task.id}><span className={`task-priority task-priority-${task.priority}`}>{task.priority === 'urgent' ? <><AlertTriangle size={13} /> Urgente</> : task.priority === 'high' ? 'Alta' : 'Rotina'}</span><div><strong>{task.title}</strong><small>{task.detail}</small></div></li>)}</ul>
      </article>)}</div>
      : loading ? null : <div className="history-empty"><ClipboardList size={18} />{filter === 'urgent' ? 'Não há pendências com prioridade urgente nos itens carregados.' : 'Nenhuma pendência operacional nas filas disponíveis.'}</div>}
    {cards.some((card) => card.count > Math.min(5, card.tasks.length)) && filter === 'all' && <p className="field-hint">A caixa destaca até cinco itens de cada fila; use o relatório ou abra o módulo para consultar a lista completa.</p>}
    <p className="field-hint">A prioridade exibida reflete apenas o valor registrado na fila. Pendências de medicação não incluem horário ou indicação clínica de dose.</p>
  </section>
}
