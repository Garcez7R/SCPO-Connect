import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { readApiResponse } from '../api'

type Item = { id: string; name: string; category: string; unit: string; location: string; lot: string; expiry_date: string | null; balance: number; minimum_balance: number }
type Movement = { id: number; item_name: string; movement_type: string; quantity: number; balance_after: number; reason: string; destination: string; actor_name: string; created_at: string }
type Request = { id: string; item_name: string; item_unit: string; quantity: number; department: string; destination: string; justification: string; status: string; requester_name: string }

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

  useEffect(() => { void load() }, [])

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

  return (
    <section className="page-section">
      <div className="module-header"><div><h1>Almoxarifado</h1><p>Materiais, estoque, lotes, validade e movimentações.</p></div></div>
      <div className="module-tabs" role="tablist">
        <button className={tab === 'items' ? 'active' : ''} type="button" onClick={() => setTab('items')}>Estoque e cadastro</button>
        <button className={tab === 'requests' ? 'active' : ''} type="button" onClick={() => setTab('requests')}>Solicitações</button>
        <button className={tab === 'movements' ? 'active' : ''} type="button" onClick={() => setTab('movements')}>Histórico</button>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {tab === 'items' && <>
        <form className="pharmacy-item-form" onSubmit={createItem}>
          <div className="form-grid pharmacy-grid">
            <label>Material<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
            <label>Categoria<input value={category} onChange={(event) => setCategory(event.target.value)} required /></label>
            <label>Unidade<select value={unit} onChange={(event) => setUnit(event.target.value)}><option>unidade</option><option>caixa</option><option>pacote</option><option>litro</option><option>kg</option><option>metro</option></select></label>
            <label>Localização<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Depósito, armário, prateleira" /></label>
            <label>Lote<input value={lot} onChange={(event) => setLot(event.target.value)} /></label>
            <label>Validade<input type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} /></label>
            <label>Número de série/patrimônio<input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} /></label>
            <label>Saldo inicial<input type="number" min="0" step="0.001" value={balance} onChange={(event) => setBalance(event.target.value)} /></label>
            <label>Estoque mínimo<input type="number" min="0" step="0.001" value={minimum} onChange={(event) => setMinimum(event.target.value)} /></label>
          </div>
          <button className="button button-primary" type="submit" disabled={busy}>Cadastrar item</button>
        </form>
        <div className="table-responsive"><table className="data-table"><thead><tr><th>Material</th><th>Local</th><th>Lote/validade</th><th>Saldo</th><th>Movimentação rápida</th></tr></thead><tbody>
          {items.map((item) => <WarehouseItemRow key={item.id} item={item} busy={busy} onMove={moveItem} />)}
        </tbody></table></div>
      </>}
      {tab === 'requests' && <div className="table-responsive"><table className="data-table"><thead><tr><th>Material</th><th>Setor</th><th>Quantidade</th><th>Status</th><th>Ações</th></tr></thead><tbody>
        {requests.map((request) => <tr key={request.id}><td><strong>{request.item_name}</strong><br /><small>{request.requester_name}</small></td><td>{request.department}<br /><small>{request.destination || request.justification || '-'}</small></td><td>{request.quantity} {request.item_unit}</td><td>{request.status === 'pending' ? 'Pendente' : request.status === 'fulfilled' ? 'Atendida' : 'Cancelada'}</td><td>{request.status === 'pending' && <><button className="button button-primary" type="button" disabled={busy} onClick={() => void updateRequest(request.id, 'fulfilled')}>Atender</button>{' '}<button className="button button-secondary" type="button" disabled={busy} onClick={() => void updateRequest(request.id, 'cancelled')}>Cancelar</button></>}</td></tr>)}
      </tbody></table></div>}
      {tab === 'movements' && <div className="table-responsive"><table className="data-table"><thead><tr><th>Data</th><th>Material</th><th>Movimento</th><th>Saldo</th><th>Responsável</th></tr></thead><tbody>
        {movements.map((movement) => <tr key={movement.id}><td>{new Date(movement.created_at).toLocaleString('pt-BR')}</td><td>{movement.item_name}</td><td>{movement.movement_type}: {movement.quantity}<br /><small>{movement.reason}</small></td><td>{movement.balance_after}</td><td>{movement.actor_name}</td></tr>)}
      </tbody></table></div>}
    </section>
  )
}

function WarehouseItemRow({ item, busy, onMove }: { item: Item; busy: boolean; onMove: (id: string, type: 'entry' | 'issue', quantity: string, reason: string) => Promise<void> }) {
  const [quantity, setQuantity] = useState('1')
  const [reason, setReason] = useState('')
  return <tr><td><strong>{item.name}</strong><br /><small>{item.category}</small></td><td>{item.location || '-'}</td><td>{item.lot || '-'}{item.expiry_date ? ` · ${item.expiry_date}` : ''}</td><td><strong className={item.balance <= item.minimum_balance ? 'danger-text' : ''}>{item.balance} {item.unit}</strong></td><td><div className="warehouse-movement-actions"><input aria-label="Quantidade" className="compact-number" type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} /><input aria-label="Motivo" className="compact-text" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo" /><button className="button button-secondary" type="button" disabled={busy || !reason.trim()} onClick={() => void onMove(item.id, 'entry', quantity, reason)}>Entrada</button><button className="button button-secondary" type="button" disabled={busy || !reason.trim()} onClick={() => void onMove(item.id, 'issue', quantity, reason)}>Saída</button></div></td></tr>
}
