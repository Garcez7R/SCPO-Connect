import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Package, Plus, History, ClipboardList } from 'lucide-react'
import { readApiResponse } from '../api'
import { formatDateDmy } from '../dateFormatting'

type Item = { id: string; name: string; category: string; unit: string; location: string; lot: string; expiry_date: string | null; balance: number; minimum_balance: number; active: boolean }
type Movement = { id: number; item_name: string; movement_type: string; quantity: number; balance_after: number; reason: string; destination: string; actor_name: string; created_at: string }
type Request = { id: string; item_name: string; item_unit: string; quantity: number; department: string; destination: string; justification: string; status: 'pending' | 'fulfilled' | 'cancelled'; requester_name: string }

export default function WarehousePage() {
  const [tab, setTab] = useState<'items' | 'requests' | 'movements'>('items')
  const [items, setItems] = useState<Item[]>([])
  const [requests, setRequests] = useState<Request[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [unit, setUnit] = useState('unidade')
  const [location, setLocation] = useState('')
  const [lot, setLot] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [balance, setBalance] = useState('0')
  const [minimum, setMinimum] = useState('0')
  const [requestItemId, setRequestItemId] = useState('')
  const [requestQuantity, setRequestQuantity] = useState('1')
  const [requestDepartment, setRequestDepartment] = useState('')
  const [requestDestination, setRequestDestination] = useState('')
  const [requestJustification, setRequestJustification] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    try {
      const [itemResponse, requestResponse, movementResponse] = await Promise.all([
        fetch('/api/v1/warehouse/items', { cache: 'no-store' }),
        fetch('/api/v1/warehouse/requests', { cache: 'no-store' }),
        fetch('/api/v1/warehouse/movements', { cache: 'no-store' }),
      ])
      const itemData = await readApiResponse<{ items: Item[] }>(itemResponse)
      const requestData = await readApiResponse<{ requests: Request[] }>(requestResponse)
      const movementData = await readApiResponse<{ movements: Movement[] }>(movementResponse)
      setItems(itemData.items)
      setRequests(requestData.requests)
      setMovements(movementData.movements)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o Almoxarifado')
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function createItem(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await readApiResponse(await fetch('/api/v1/warehouse/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category, unit, location, lot, expiry_date: expiryDate || null, serial_number: serialNumber, balance: Number(balance), minimum_balance: Number(minimum), active: true }),
      }))
      setName(''); setCategory(''); setLocation(''); setLot(''); setExpiryDate(''); setSerialNumber(''); setBalance('0'); setMinimum('0')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível cadastrar o item')
    } finally {
      setBusy(false)
    }
  }

  async function moveItem(itemId: string, movementType: 'entry' | 'issue', quantity: string, reason: string) {
    setBusy(true)
    try {
      await readApiResponse(await fetch(`/api/v1/warehouse/items/${itemId}/movements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movement_type: movementType, quantity: Number(quantity), reason }),
      }))
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível registrar a movimentação')
    } finally {
      setBusy(false)
    }
  }

  async function updateRequest(id: string, status: 'fulfilled' | 'cancelled') {
    setBusy(true)
    try {
      await readApiResponse(await fetch(`/api/v1/warehouse/requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }))
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar a solicitação')
    } finally {
      setBusy(false)
    }
  }

  async function createRequest(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const request = await readApiResponse<Request>(await fetch('/api/v1/warehouse/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: requestItemId,
          quantity: Number(requestQuantity),
          department: requestDepartment.trim(),
          destination: requestDestination.trim(),
          justification: requestJustification.trim(),
        }),
      }))
      setRequests((current) => [request, ...current])
      setRequestItemId('')
      setRequestQuantity('1')
      setRequestDepartment('')
      setRequestDestination('')
      setRequestJustification('')
      setNotice('Pedido enviado ao Almoxarifado e incluído na fila de solicitações.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível enviar o pedido ao Almoxarifado')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="warehouse-page page-section">
      <div className="warehouse-header page-title-row"><span className="module-icon module-icon-maintenance"><Package size={23} /></span><div><p className="eyebrow">MÓDULO · ALMOXARIFADO</p><h1>Materiais, estoque e movimentações</h1><p className="welcome-copy">Cadastro de itens, lotes, solicitações e histórico do almoxarifado.</p></div></div>
      <div className="module-tabs" role="tablist">
        <button className={`button ${tab === 'items' ? 'button-primary' : 'button-secondary'}`} type="button" onClick={() => setTab('items')}><Package size={16} /> Estoque e cadastro</button>
        <button className={`button ${tab === 'requests' ? 'button-primary' : 'button-secondary'}`} type="button" onClick={() => setTab('requests')}><ClipboardList size={16} /> Solicitações {requests.filter((request) => request.status === 'pending').length > 0 && <span>{requests.filter((request) => request.status === 'pending').length}</span>}</button>
        <button className={`button ${tab === 'movements' ? 'button-primary' : 'button-secondary'}`} type="button" onClick={() => setTab('movements')}><History size={16} /> Histórico</button>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {notice && <div className="warehouse-notice" role="status">{notice}</div>}
      {tab === 'items' && <>
        <form className="warehouse-item-form" onSubmit={createItem}>
          <div className="section-heading"><div><p className="eyebrow">NOVO CADASTRO</p><h2>Identificar item</h2></div></div>
          <div className="warehouse-form-grid">
            <label className="field"><span className="field-label">Material *</span><input value={name} onChange={(event) => setName(event.target.value)} required placeholder="Nome do item ou equipamento" /></label>
            <label className="field"><span className="field-label">Categoria *</span><input value={category} onChange={(event) => setCategory(event.target.value)} required placeholder="Ex.: limpeza, elétrica, EPI" /></label>
            <label className="field"><span className="field-label">Unidade</span><select value={unit} onChange={(event) => setUnit(event.target.value)}><option>unidade</option><option>caixa</option><option>pacote</option><option>litro</option><option>kg</option><option>metro</option></select></label>
            <label className="field"><span className="field-label">Localização</span><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Depósito, armário, prateleira" /></label>
            <label className="field"><span className="field-label">Lote</span><input value={lot} onChange={(event) => setLot(event.target.value)} /></label>
            <label className="field"><span className="field-label">Validade</span><input type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} /></label>
            <label className="field"><span className="field-label">Número de série / patrimônio</span><input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} /></label>
            <label className="field"><span className="field-label">Saldo inicial</span><input type="number" min="0" step="0.001" value={balance} onChange={(event) => setBalance(event.target.value)} /></label>
            <label className="field"><span className="field-label">Estoque mínimo</span><input type="number" min="0" step="0.001" value={minimum} onChange={(event) => setMinimum(event.target.value)} /></label>
          </div>
          <div className="warehouse-form-actions"><button className="button button-primary" type="submit" disabled={busy}><Plus size={16} /> {busy ? 'Salvando…' : 'Cadastrar item'}</button></div>
        </form>
        <section className="warehouse-panel"><div className="section-heading"><div><p className="eyebrow">INVENTÁRIO</p><h2>Itens cadastrados</h2></div><span className="warehouse-count">{items.length} {items.length === 1 ? 'item' : 'itens'}</span></div>
        {items.length === 0 ? <div className="warehouse-empty">Nenhum item cadastrado.</div> : <div className="warehouse-table-wrap"><table className="warehouse-table"><thead><tr><th>Material</th><th>Local</th><th>Lote / validade</th><th>Saldo</th><th>Movimentação rápida</th></tr></thead><tbody>
          {items.map((item) => <WarehouseItemRow key={item.id} item={item} busy={busy} onMove={moveItem} />)}
        </tbody></table></div>}</section>
      </>}
      {tab === 'requests' && <>
        <form className="warehouse-item-form warehouse-request-form" onSubmit={(event) => void createRequest(event)}>
          <div className="section-heading"><div><p className="eyebrow">PEDIDO DE MATERIAL</p><h2>Solicitar ao Almoxarifado</h2><p className="welcome-copy">Informe o setor, o item cadastrado e a quantidade necessária. O pedido ficará pendente até ser atendido ou cancelado.</p></div></div>
          <div className="warehouse-form-grid">
            <label className="field"><span className="field-label">Setor solicitante *</span><input required minLength={2} maxLength={120} value={requestDepartment} onChange={(event) => setRequestDepartment(event.target.value)} placeholder="Ex.: Enfermagem, Nutrição" /></label>
            <label className="field"><span className="field-label">Material *</span><select required value={requestItemId} onChange={(event) => setRequestItemId(event.target.value)}><option value="">Selecione um item disponível</option>{items.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name} · saldo {item.balance} {item.unit}</option>)}</select></label>
            <label className="field"><span className="field-label">Quantidade *</span><input required type="number" min="0.001" max="999999999" step="0.001" value={requestQuantity} onChange={(event) => setRequestQuantity(event.target.value)} /></label>
            <label className="field"><span className="field-label">Destino / local de uso</span><input maxLength={120} value={requestDestination} onChange={(event) => setRequestDestination(event.target.value)} placeholder="Unidade, sala ou localização" /></label>
            <label className="field warehouse-request-justification"><span className="field-label">Justificativa</span><textarea maxLength={500} value={requestJustification} onChange={(event) => setRequestJustification(event.target.value)} placeholder="Descreva a necessidade do setor" /></label>
          </div>
          <div className="warehouse-form-actions"><button className="button button-primary" type="submit" disabled={busy || !items.some((item) => item.id === requestItemId && item.active)}><ClipboardList size={16} /> {busy ? 'Enviando…' : 'Enviar pedido'}</button></div>
        </form>
        <section className="warehouse-panel"><div className="section-heading"><div><p className="eyebrow">FILA DE ATENDIMENTO</p><h2>Pedidos dos setores</h2></div></div>{requests.length === 0 ? <div className="warehouse-empty">Nenhuma solicitação registrada.</div> : <div className="warehouse-table-wrap"><table className="warehouse-table"><thead><tr><th>Material</th><th>Setor</th><th>Quantidade</th><th>Status</th><th>Ações</th></tr></thead><tbody>
          {requests.map((request) => <tr key={request.id}><td><strong>{request.item_name}</strong><small>{request.requester_name}</small>{request.justification && <small>{request.justification}</small>}</td><td><strong>{request.department}</strong><small>{request.destination || '-'}</small></td><td><strong>{request.quantity} {request.item_unit}</strong></td><td><span className={`warehouse-status warehouse-status-${request.status}`}>{request.status === 'pending' ? 'Pendente' : request.status === 'fulfilled' ? 'Atendida' : 'Cancelada'}</span></td><td>{request.status === 'pending' ? <div className="warehouse-request-actions"><button className="button button-primary" type="button" disabled={busy} onClick={() => void updateRequest(request.id, 'fulfilled')}>Atender</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => void updateRequest(request.id, 'cancelled')}>Cancelar</button></div> : '-'}</td></tr>)}
        </tbody></table></div>}</section>
      </>}
      {tab === 'movements' && <section className="warehouse-panel"><div className="section-heading"><div><p className="eyebrow">HISTÓRICO</p><h2>Movimentações registradas</h2></div></div>{movements.length === 0 ? <div className="warehouse-empty">Nenhuma movimentação registrada.</div> : <div className="warehouse-table-wrap"><table className="warehouse-table"><thead><tr><th>Data</th><th>Material</th><th>Movimento</th><th>Saldo após</th><th>Responsável</th></tr></thead><tbody>
        {movements.map((movement) => <tr key={movement.id}><td>{new Date(movement.created_at).toLocaleString('pt-BR')}</td><td><strong>{movement.item_name}</strong></td><td><strong>{movement.movement_type === 'entry' ? 'Entrada' : movement.movement_type === 'issue' ? 'Saída' : movement.movement_type === 'return' ? 'Devolução' : movement.movement_type === 'adjustment' ? 'Ajuste' : movement.movement_type}: {movement.quantity}</strong><small>{movement.reason}</small></td><td><strong>{movement.balance_after}</strong></td><td>{movement.actor_name}</td></tr>)}
      </tbody></table></div>}</section>}
    </section>
  )
}

function WarehouseItemRow({ item, busy, onMove }: { item: Item; busy: boolean; onMove: (id: string, type: 'entry' | 'issue', quantity: string, reason: string) => Promise<void> }) {
  const [quantity, setQuantity] = useState('1')
  const [reason, setReason] = useState('')
  return <tr><td><strong>{item.name}</strong><small>{item.category}</small></td><td>{item.location || '-'}</td><td><strong>{item.lot || '-'}</strong>{item.expiry_date && <small>Validade: {formatDateDmy(item.expiry_date)}</small>}</td><td><strong className={item.balance <= item.minimum_balance ? 'warehouse-low-stock' : ''}>{item.balance} {item.unit}</strong>{item.minimum_balance > 0 && <small>Mín. {item.minimum_balance}</small>}</td><td><div className="warehouse-movement-actions"><label><span>Quantidade</span><input aria-label={`Quantidade para ${item.name}`} type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label><span>Motivo</span><input aria-label={`Motivo da movimentação de ${item.name}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo" /></label><div><button className="button button-secondary" type="button" disabled={busy || !reason.trim() || Number(quantity) <= 0} onClick={() => void onMove(item.id, 'entry', quantity, reason)}>Entrada</button><button className="button button-secondary" type="button" disabled={busy || !reason.trim() || Number(quantity) <= 0} onClick={() => void onMove(item.id, 'issue', quantity, reason)}>Saída</button></div></div></td></tr>
}
