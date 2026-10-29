import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ClipboardList, LogOut, RefreshCw, SprayCan, Wifi, WifiOff, Wrench } from 'lucide-react'
import { ApiResponseError, readApiResponse, readableApiError } from '../api'
import { readOfflineVault, removeOfflineVault, writeOfflineVault } from '../offline/encryptedVault'

type OperationsMobileUser = {
  id: string
  name: string
  display_name?: string
  role: string
  modules: string[]
  permissions: Record<string, string[]>
}

type WorkOrder = {
  id: string
  order_number?: string
  title: string
  description: string
  service_type: string
  department: string
  location: string
  priority: 'normal' | 'high' | 'urgent'
  status: 'open' | 'in_progress' | 'completed' | 'cancelled'
  requester_name?: string
  created_at: string
  updated_at: string
}

type HygieneRequest = {
  id: string
  request_number: string
  request_type: string
  custom_type: string | null
  unit: string
  area: string
  bed_id: string | null
  bed_status: 'none' | 'cleaning' | 'release_pending' | 'available'
  location: string
  description: string
  priority: 'normal' | 'high' | 'urgent'
  status: 'open' | 'in_progress' | 'completed' | 'cancelled'
  assignee: string
  updated_by: string
  bed_release_error?: string
  created_at: string
  updated_at: string
}

type ServiceCache<T> = {
  cached_at: string
  records: T[]
}

type OperationsVault = {
  version: 1
  maintenance?: ServiceCache<WorkOrder>
  hygiene?: ServiceCache<HygieneRequest>
}

type ServiceTab = 'maintenance' | 'hygiene'
const offlineRetentionMs = 24 * 60 * 60 * 1000
const statusLabels = { open: 'Aberta', in_progress: 'Em andamento', completed: 'Concluída', cancelled: 'Cancelada' }
const priorityLabels = { normal: 'Rotina', high: 'Prioritária', urgent: 'Urgente' }
const hygieneTypes: Record<string, string> = {
  routine: 'Rotina',
  spot: 'Limpeza localizada',
  after_procedure: 'Pós-procedimento',
  restock: 'Reposição de materiais',
  other: 'Outro serviço',
}
const hygieneAreas: Record<string, string> = {
  room: 'Quarto',
  bathroom: 'Banheiro',
  shared: 'Área compartilhada',
  clinical: 'Área clínica',
  circulation: 'Circulação',
  other: 'Outra área',
}

function isTemporaryConnectionError(error: unknown) {
  return error instanceof TypeError
    || (error instanceof ApiResponseError && error.status >= 500)
    || (error instanceof Error && /HTTP 5\d\d|serviço está indisponível/i.test(error.message))
}

function freshCache(cache?: ServiceCache<unknown>) {
  if (!cache) return false
  const cachedAt = Date.parse(cache.cached_at)
  const age = Date.now() - cachedAt
  return Number.isFinite(cachedAt) && age >= 0 && age <= offlineRetentionMs
}

function formatTime(value: string) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function statusLabel(status: WorkOrder['status']) {
  return statusLabels[status]
}

export default function OperationsMobilePage({
  user,
  onLogout,
}: {
  user: OperationsMobileUser
  onLogout: () => void
}) {
  const canSeeMaintenance = user.modules.includes('maintenance')
    && (user.permissions.maintenance?.includes('consultar') ?? false)
  const canSeeHygiene = user.modules.includes('hygiene')
    && (user.permissions.hygiene?.includes('consultar') ?? false)
  const canUpdateMaintenance = user.role === 'maintenance'
    && (user.permissions.maintenance?.includes('alterar') ?? false)
  const canUpdateHygiene = user.role === 'hygiene'
    && (user.permissions.hygiene?.includes('alterar') ?? false)
  const showMaintenance = (user.role === 'maintenance' || user.role === 'management' || user.role === 'admin')
    && canSeeMaintenance
  const showHygiene = (user.role === 'hygiene' || user.role === 'management' || user.role === 'admin')
    && canSeeHygiene
  const availableTabs = useMemo<ServiceTab[]>(() => [
    ...(showMaintenance ? ['maintenance' as const] : []),
    ...(showHygiene ? ['hygiene' as const] : []),
  ], [showHygiene, showMaintenance])
  const [tab, setTab] = useState<ServiceTab>(availableTabs[0] ?? 'maintenance')
  const [maintenanceOrders, setMaintenanceOrders] = useState<WorkOrder[]>([])
  const [hygieneRequests, setHygieneRequests] = useState<HygieneRequest[]>([])
  const [maintenanceCacheAt, setMaintenanceCacheAt] = useState('')
  const [hygieneCacheAt, setHygieneCacheAt] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [serverAvailable, setServerAvailable] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [filter, setFilter] = useState<'active' | 'all' | WorkOrder['status']>('active')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [updatingId, setUpdatingId] = useState('')
  const [statusDrafts, setStatusDrafts] = useState<Record<string, WorkOrder['status']>>({})
  const vaultId = `operations:${user.id}`

  const loadData = useCallback(async () => {
    setRefreshing(true)
    setError('')
    let cached: OperationsVault | null = null
    let cacheReadError: unknown = null
    try {
      cached = (await readOfflineVault<OperationsVault>(vaultId))?.payload ?? null
    } catch (readError) {
      cacheReadError = readError
    }
    let nextVault = cached ?? { version: 1 as const }
    if (!showMaintenance) {
      delete nextVault.maintenance
      setMaintenanceOrders([])
    }
    if (!showHygiene) {
      delete nextVault.hygiene
      setHygieneRequests([])
    }
    const failures: { service: ServiceTab; error: unknown }[] = []
    let serverSuccess = false

    const loadMaintenance = async () => {
      try {
        const result = await readApiResponse<{ orders: WorkOrder[] }>(
          await fetch('/api/v1/maintenance/queue'),
        )
        const records = result.orders.map(({ id, order_number, title, description, service_type, department, location, priority, status, requester_name, created_at, updated_at }) =>
          ({ id, order_number, title, description, service_type, department, location, priority, status, requester_name, created_at, updated_at }))
        const snapshot = { cached_at: new Date().toISOString(), records }
        nextVault = { ...nextVault, maintenance: snapshot }
        setMaintenanceOrders(records)
        setMaintenanceCacheAt(snapshot.cached_at)
        serverSuccess = true
      } catch (loadError) {
        failures.push({ service: 'maintenance', error: loadError })
      }
    }

    const loadHygiene = async () => {
      try {
        const firstPage = await readApiResponse<{ requests: HygieneRequest[]; total: number; limit: number }>(
          await fetch('/api/v1/hygiene/requests?limit=500&offset=0'),
        )
        const requests = [...firstPage.requests]
        const pageSize = Math.max(1, firstPage.limit)
        for (let offset = pageSize; offset < firstPage.total; offset += pageSize) {
          const page = await readApiResponse<{ requests: HygieneRequest[] }>(
            await fetch(`/api/v1/hygiene/requests?limit=${pageSize}&offset=${offset}`),
          )
          requests.push(...page.requests)
        }
        const records = requests.map(({ id, request_number, request_type, custom_type, unit, area, bed_id, bed_status, location, description, priority, status, assignee, updated_by, bed_release_error, created_at, updated_at }) =>
          ({ id, request_number, request_type, custom_type, unit, area, bed_id, bed_status, location, description, priority, status, assignee, updated_by, bed_release_error, created_at, updated_at }))
        const snapshot = { cached_at: new Date().toISOString(), records }
        nextVault = { ...nextVault, hygiene: snapshot }
        setHygieneRequests(records)
        setHygieneCacheAt(snapshot.cached_at)
        serverSuccess = true
      } catch (loadError) {
        failures.push({ service: 'hygiene', error: loadError })
      }
    }

    try {
      await Promise.all([
        ...(showMaintenance ? [loadMaintenance()] : []),
        ...(showHygiene ? [loadHygiene()] : []),
      ])
      const unauthorized = failures.find((failure) =>
        failure.error instanceof ApiResponseError && failure.error.status === 401,
      )
      if (unauthorized) {
        setError('Sua sessão expirou. Entre novamente para consultar a fila.')
        setMaintenanceOrders([])
        setHygieneRequests([])
        await removeOfflineVault(vaultId)
        onLogout()
        return
      }
      const forbidden = failures.find((failure) =>
        failure.error instanceof ApiResponseError && failure.error.status === 403,
      )
      if (forbidden) {
        setError('Seu perfil não tem permissão para consultar essas ordens.')
        setServerAvailable(false)
        if (forbidden.service === 'maintenance') {
          setMaintenanceOrders([])
          delete nextVault.maintenance
        } else {
          setHygieneRequests([])
          delete nextVault.hygiene
        }
        await writeOfflineVault(vaultId, nextVault)
        return
      }

      const staleServices: ServiceTab[] = []
      for (const failure of failures) {
        if (!isTemporaryConnectionError(failure.error)) throw failure.error
        if (failure.service === 'maintenance') {
          if (freshCache(cached?.maintenance)) {
            setMaintenanceOrders(cached!.maintenance!.records)
            setMaintenanceCacheAt(cached!.maintenance!.cached_at)
          } else {
            setMaintenanceOrders([])
            delete nextVault.maintenance
            staleServices.push('maintenance')
          }
        } else if (freshCache(cached?.hygiene)) {
          setHygieneRequests(cached!.hygiene!.records)
          setHygieneCacheAt(cached!.hygiene!.cached_at)
        } else {
          setHygieneRequests([])
          delete nextVault.hygiene
          staleServices.push('hygiene')
        }
      }
      setServerAvailable(failures.length === 0)
      if (serverSuccess || staleServices.length) {
        try {
          await writeOfflineVault(vaultId, nextVault)
        } catch (writeError) {
          setError(`Dados carregados do servidor, mas não foi possível salvar o cache cifrado neste aparelho. ${readableApiError(writeError)}`)
        }
      } else if (cacheReadError && !cached) {
        setError(`Não foi possível abrir o cache cifrado do aparelho. ${readableApiError(cacheReadError)}`)
      }
      if (staleServices.length) {
        const labels = staleServices.map((service) => service === 'maintenance' ? 'Manutenção' : 'Higienização')
        setError(`Sem conexão com o servidor e sem cópia offline válida para: ${labels.join(', ')}. Os dados locais expiram após 24 horas.`)
      }
    } catch (loadError) {
      setServerAvailable(false)
      setError(readableApiError(loadError))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [onLogout, showHygiene, showMaintenance, vaultId])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0)
    return () => window.clearTimeout(timer)
  }, [loadData])

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true)
      void loadData()
    }
    const handleOffline = () => {
      setOnline(false)
      setServerAvailable(false)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [loadData])

  const visibleWorkOrders = maintenanceOrders.filter((order) => {
    const isActive = order.status === 'open' || order.status === 'in_progress'
    const matchesStatus = filter === 'all' || (filter === 'active' ? isActive : order.status === filter)
    const searchable = `${order.order_number ?? ''} ${order.title} ${order.description} ${order.service_type} ${order.department} ${order.location}`.toLocaleLowerCase('pt-BR')
    return matchesStatus && searchable.includes(search.trim().toLocaleLowerCase('pt-BR'))
  })
  const visibleHygieneRequests = hygieneRequests.filter((request) => {
    const isActive = request.status === 'open' || request.status === 'in_progress'
    const matchesStatus = filter === 'all' || (filter === 'active' ? isActive : request.status === filter)
    const searchable = `${request.request_number} ${request.custom_type ?? ''} ${request.unit} ${request.location} ${request.description} ${request.assignee} ${hygieneTypes[request.request_type] ?? request.request_type} ${hygieneAreas[request.area] ?? request.area}`.toLocaleLowerCase('pt-BR')
    return matchesStatus && searchable.includes(search.trim().toLocaleLowerCase('pt-BR'))
  })

  async function logout() {
    try {
      await removeOfflineVault(vaultId)
    } catch (logoutError) {
      setError(`Não foi possível apagar a cópia offline deste aparelho. ${readableApiError(logoutError)}`)
      return
    }
    void fetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined)
    onLogout()
  }

  async function cacheUpdatedRecords(service: ServiceTab, records: WorkOrder[] | HygieneRequest[]) {
    try {
      const currentVault = await readOfflineVault<OperationsVault>(vaultId)
      if (!currentVault) return
      const cachedAt = new Date().toISOString()
      await writeOfflineVault(vaultId, {
        ...currentVault.payload,
        [service]: { cached_at: cachedAt, records },
      })
      if (service === 'maintenance') setMaintenanceCacheAt(cachedAt)
      else setHygieneCacheAt(cachedAt)
    } catch (cacheError) {
      setError(`A alteração foi confirmada pelo servidor, mas não foi possível atualizar o cache deste aparelho. ${readableApiError(cacheError)}`)
    }
  }

  async function updateMaintenanceStatus(order: WorkOrder) {
    const status = statusDrafts[order.id] ?? order.status
    if (!canUpdateMaintenance || !serverAvailable || status === order.status) return
    setUpdatingId(order.id)
    setError('')
    setNotice('')
    try {
      const updated = await readApiResponse<WorkOrder>(
        await fetch(`/api/v1/maintenance/orders/${encodeURIComponent(order.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        }),
      )
      const records = maintenanceOrders.map((item) => item.id === updated.id ? updated : item)
      setMaintenanceOrders(records)
      setStatusDrafts((current) => {
        const next = { ...current }
        delete next[order.id]
        return next
      })
      setNotice(`OS ${updated.order_number ?? updated.id} atualizada para ${statusLabels[updated.status]}.`)
      await cacheUpdatedRecords('maintenance', records)
    } catch (updateError) {
      setError(`Não foi possível atualizar a ordem. ${readableApiError(updateError)}`)
    } finally {
      setUpdatingId('')
    }
  }

  async function updateHygieneStatus(request: HygieneRequest, status: HygieneRequest['status']) {
    if (!canUpdateHygiene || !serverAvailable || status === request.status) return
    setUpdatingId(request.id)
    setError('')
    setNotice('')
    try {
      const updated = await readApiResponse<HygieneRequest>(
        await fetch(`/api/v1/hygiene/requests/${encodeURIComponent(request.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        }),
      )
      const records = hygieneRequests.map((item) => item.id === updated.id ? updated : item)
      setHygieneRequests(records)
      if (updated.status === 'completed' && updated.bed_status === 'release_pending') {
        setFilter('completed')
      }
      setStatusDrafts((current) => {
        const next = { ...current }
        delete next[request.id]
        return next
      })
      setNotice(updated.bed_release_error
        ? `Solicitação concluída, mas o leito ainda não foi liberado pelo servidor: ${updated.bed_release_error}`
        : updated.bed_status === 'available'
          ? 'Higienização concluída e liberação do leito confirmada pelo servidor.'
          : `Solicitação atualizada para ${statusLabels[updated.status]}.`)
      await cacheUpdatedRecords('hygiene', records)
    } catch (updateError) {
      setError(`Não foi possível atualizar a solicitação. ${readableApiError(updateError)}`)
    } finally {
      setUpdatingId('')
    }
  }

  async function retryHygieneBedRelease(request: HygieneRequest) {
    if (!canUpdateHygiene || !serverAvailable) return
    setUpdatingId(request.id)
    setError('')
    setNotice('')
    try {
      const updated = await readApiResponse<HygieneRequest>(
        await fetch(`/api/v1/hygiene/requests/${encodeURIComponent(request.id)}/bed-release`, { method: 'POST' }),
      )
      const records = hygieneRequests.map((item) => item.id === updated.id ? updated : item)
      setHygieneRequests(records)
      setNotice('Liberação do leito confirmada pelo servidor.')
      await cacheUpdatedRecords('hygiene', records)
    } catch (releaseError) {
      setError(`A solicitação está concluída, mas o leito continua bloqueado. ${readableApiError(releaseError)}`)
    } finally {
      setUpdatingId('')
    }
  }

  if (!availableTabs.length) {
    return <main className="nursing-mobile-page nursing-mobile-denied">
      <img src="/scpo-connect-icon.png" alt="" />
      <h1>Acesso operacional necessário</h1>
      <p>Esta interface exige permissão de consulta na fila operacional correspondente ao seu perfil.</p>
      <a className="button button-secondary" href="/">Voltar ao SCPO Connect</a>
      <button className="button button-secondary" type="button" onClick={() => void logout()}>Sair</button>
    </main>
  }

  return <main className="nursing-mobile-page operations-mobile-page">
    <header className="nursing-mobile-header">
      <div className="nursing-mobile-brand"><img src="/scpo-connect-icon.png" alt="" /><div><span>SCPO CONNECT</span><strong>Serviços operacionais</strong></div></div>
      <button className="nursing-mobile-logout" type="button" onClick={() => void logout()} aria-label="Sair"><LogOut size={18} /></button>
    </header>
    <section className="nursing-mobile-identity">
      <div><p className="eyebrow">CONSULTA DE ORDENS</p><h1>Olá, {(user.display_name || user.name).split(/\s+/)[0]}</h1></div>
      <span className={`nursing-mobile-connection ${serverAvailable ? 'is-online' : 'is-offline'}`}><i />{serverAvailable ? <><Wifi size={14} /> Servidor conectado</> : <><WifiOff size={14} /> {online ? 'Servidor indisponível' : 'Sem conexão'}</>}</span>
    </section>
    {!serverAvailable && <div className="nursing-mobile-connectivity-warning" role="status"><WifiOff size={17} /><span>Consulta offline somente leitura com dados salvos em cache. Para alterar status ou concluir uma ordem, conecte ao servidor.</span></div>}
    {error && <div className="nursing-mobile-message nursing-mobile-error" role="alert"><AlertTriangle size={17} /><span>{error}</span></div>}
    {notice && <div className="nursing-mobile-message nursing-mobile-success" role="status">{notice}</div>}
    <nav className="nursing-mobile-tabs" aria-label="Filas operacionais">
      {availableTabs.map((service) => <button key={service} type="button" aria-pressed={tab === service} className={tab === service ? 'is-active' : ''} onClick={() => { setTab(service); setFilter('active'); setSearch('') }}>
        {service === 'maintenance' ? <Wrench size={17} /> : <SprayCan size={17} />}
        {service === 'maintenance' ? 'Manutenção' : 'Higienização'}
      </button>)}
    </nav>
    <section className="nursing-mobile-panel operations-mobile-panel">
      <div className="nursing-mobile-section-title"><div><p className="eyebrow">{serverAvailable ? 'ATUALIZADA DO SERVIDOR' : 'CÓPIA SOMENTE PARA CONSULTA'}</p><h2>{tab === 'maintenance' ? <><Wrench size={19} /> Ordens de serviço</> : <><SprayCan size={19} /> Higienização</>}</h2><small>Atualizada: {formatTime(tab === 'maintenance' ? maintenanceCacheAt : hygieneCacheAt) || 'sem cache'}</small></div><button className="nursing-mobile-refresh" type="button" onClick={() => void loadData()} disabled={refreshing} aria-label="Atualizar ordens"><RefreshCw size={17} /></button></div>
      <label className="field"><span className="field-label">Situação</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="active">Ativas</option><option value="all">Todas</option><option value="open">Abertas</option><option value="in_progress">Em andamento</option><option value="completed">Concluídas</option><option value="cancelled">Canceladas</option></select></label>
      <label className="field"><span className="field-label">Buscar</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Local, tipo ou descrição" /></label>
      {loading ? <div className="nursing-mobile-loading" role="status"><span className="spinner" /> Carregando ordens…</div> : tab === 'maintenance' ? visibleWorkOrders.length ? <div className="operations-mobile-list">{visibleWorkOrders.map((order) => <article className="operations-mobile-card" key={order.id}>
        <div className="operations-mobile-card-heading"><span className={`work-order-status status-${order.status}`}>{statusLabel(order.status)}</span><span className={`work-order-priority priority-${order.priority}`}>{priorityLabels[order.priority]}</span></div>
        <strong>{order.order_number ? `OS ${order.order_number} · ` : ''}{order.title}</strong>
        <span>{order.service_type} · {order.department}</span>
        <span><ClipboardList size={14} /> {order.location || 'Local não informado'}</span>
        {order.description && <p>{order.description}</p>}
        {canUpdateMaintenance && order.status !== 'completed' && order.status !== 'cancelled' && <div className="operations-mobile-update">
          <label className="field"><span className="field-label">Atualizar situação</span><select value={statusDrafts[order.id] ?? order.status} disabled={!serverAvailable || updatingId === order.id} onChange={(event) => setStatusDrafts((current) => ({ ...current, [order.id]: event.target.value as WorkOrder['status'] }))}><option value="open">Aberta</option><option value="in_progress">Em andamento</option><option value="completed">Concluída</option><option value="cancelled">Cancelada</option></select></label>
          <button className="button button-primary" type="button" disabled={!serverAvailable || updatingId === order.id || (statusDrafts[order.id] ?? order.status) === order.status} onClick={() => void updateMaintenanceStatus(order)}>{updatingId === order.id ? 'Salvando…' : (statusDrafts[order.id] ?? order.status) === 'completed' ? 'Concluir OS' : 'Salvar situação'}</button>
        </div>}
        <time>{formatTime(order.created_at)}</time>
      </article>)}</div> : <p className="nursing-mobile-empty"><ClipboardList size={18} /> Nenhuma ordem corresponde aos filtros.</p> : visibleHygieneRequests.length ? <div className="operations-mobile-list">{visibleHygieneRequests.map((request) => <article className="operations-mobile-card" key={request.id}>
        <div className="operations-mobile-card-heading"><span className={`work-order-status status-${request.status}`}>{statusLabel(request.status)}</span><span className={`work-order-priority priority-${request.priority}`}>{priorityLabels[request.priority]}</span></div>
        <strong>{request.request_number ? `Solicitação ${request.request_number} · ` : ''}{request.request_type === 'other' ? request.custom_type : hygieneTypes[request.request_type] ?? request.request_type}</strong>
        <span>{request.unit} · {hygieneAreas[request.area] ?? request.area}</span>
        <span><ClipboardList size={14} /> {request.location}</span>
        {request.description && <p>{request.description}</p>}
        {request.assignee && <span>Responsável: {request.assignee}</span>}
        {request.bed_id && <span className={`operations-mobile-bed-state status-${request.bed_status}`}>{request.bed_status === 'available' ? 'Leito liberado pelo servidor' : request.bed_status === 'release_pending' ? 'Conclusão registrada; liberação do leito pendente' : request.bed_status === 'cleaning' ? 'Leito em higienização' : 'Sem vínculo com leito'}</span>}
        {canUpdateHygiene && request.status !== 'completed' && request.status !== 'cancelled' && <div className="operations-mobile-update">
          <label className="field"><span className="field-label">Atualizar situação</span><select value={statusDrafts[request.id] ?? request.status} disabled={!serverAvailable || updatingId === request.id} onChange={(event) => setStatusDrafts((current) => ({ ...current, [request.id]: event.target.value as WorkOrder['status'] }))}><option value="open">Aguardando atendimento</option><option value="in_progress">Em andamento</option><option value="completed">Concluída</option><option value="cancelled" disabled={Boolean(request.bed_id)}>Cancelada</option></select></label>
          <button className="button button-primary" type="button" disabled={!serverAvailable || updatingId === request.id || (statusDrafts[request.id] ?? request.status) === request.status} onClick={() => void updateHygieneStatus(request, statusDrafts[request.id] ?? request.status)}>{updatingId === request.id ? 'Salvando…' : (statusDrafts[request.id] ?? request.status) === 'completed' ? 'Concluir serviço' : 'Salvar situação'}</button>
        </div>}
        {canUpdateHygiene && request.status === 'completed' && request.bed_id && request.bed_status === 'release_pending' && <button className="button button-secondary operations-mobile-release" type="button" disabled={!serverAvailable || updatingId === request.id} onClick={() => void retryHygieneBedRelease(request)}>{updatingId === request.id ? 'Verificando…' : 'Tentar liberar leito'}</button>}
        <time>{formatTime(request.created_at)}</time>
      </article>)}</div> : <p className="nursing-mobile-empty"><ClipboardList size={18} /> Nenhuma solicitação corresponde aos filtros.</p>}
      <p className="nursing-mobile-footnote">Alterações e encerramentos exigem conexão e confirmação do servidor. A Higienização só libera o leito após essa confirmação.</p>
    </section>
    <footer className="nursing-mobile-footer"><span><ClipboardList size={15} /> Cache cifrado no aparelho · validade máxima de 24 horas</span><a href="/">Sistema completo</a></footer>
  </main>
}
