import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Archive, Download, History, ImagePlus, Package, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { readApiResponse, readableApiError } from '../api'

type TherapyMaterial = {
  id: string
  name: string
  category: string
  unit: string
  quantity: string
  color_name: string
  color_code: string
  active: boolean
}

type MaterialImage = {
  id: string
  title: string
  size_bytes: number
  uploaded_by: string
  uploaded_at: string
  url: string
}

type MaterialMovement = {
  id: string
  direction: 'entrada' | 'consumo'
  quantity: string
  balance_after: string
  reason: string
  actor_name: string
  created_at: string
}

type MaterialDraft = Pick<TherapyMaterial, 'name' | 'category' | 'unit' | 'color_name' | 'color_code'>

const emptyDraft: MaterialDraft = { name: '', category: '', unit: '', color_name: '', color_code: '' }

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export default function TherapyMaterialsPanel({ canEdit }: { canEdit: boolean }) {
  const [materials, setMaterials] = useState<TherapyMaterial[]>([])
  const [images, setImages] = useState<MaterialImage[]>([])
  const [movements, setMovements] = useState<MaterialMovement[]>([])
  const [movementsTotal, setMovementsTotal] = useState(0)
  const [movementMaterialId, setMovementMaterialId] = useState('')
  const [historyMaterialId, setHistoryMaterialId] = useState('')
  const [editingMaterialId, setEditingMaterialId] = useState('')
  const [deleteImageId, setDeleteImageId] = useState('')
  const [editDraft, setEditDraft] = useState<MaterialDraft>(emptyDraft)
  const [newMaterial, setNewMaterial] = useState({ ...emptyDraft, initial_quantity: '0' })
  const [adjustment, setAdjustment] = useState({ direction: 'entrada' as 'entrada' | 'consumo', quantity: '', reason: '' })
  const [imageTitle, setImageTitle] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadingMovements, setLoadingMovements] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadData = useCallback(async () => {
    const [materialResponse, imageResponse] = await Promise.all([
      fetch('/api/v1/therapy/materials?include_archived=true'),
      fetch('/api/v1/therapy/material-images'),
    ])
    const [materialData, imageData] = await Promise.all([
      readApiResponse<{ materials: TherapyMaterial[] }>(materialResponse),
      readApiResponse<{ images: MaterialImage[] }>(imageResponse),
    ])
    setMaterials(materialData.materials)
    setImages(imageData.images)
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([
      fetch('/api/v1/therapy/materials?include_archived=true').then((response) =>
        readApiResponse<{ materials: TherapyMaterial[] }>(response),
      ),
      fetch('/api/v1/therapy/material-images').then((response) =>
        readApiResponse<{ images: MaterialImage[] }>(response),
      ),
    ]).then(([materialData, imageData]) => {
      if (!active) return
      setMaterials(materialData.materials)
      setImages(imageData.images)
    }).catch((loadError: unknown) => {
      if (active) setError(readableApiError(loadError))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  async function createMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setError(''); setNotice('')
    try {
      await readApiResponse<TherapyMaterial>(await fetch('/api/v1/therapy/materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMaterial),
      }))
      setNewMaterial({ ...emptyDraft, initial_quantity: '0' })
      await loadData()
      setNotice('Material cadastrado e saldo inicial registrado.')
    } catch (saveError) {
      setError(readableApiError(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function saveMaterial(material: TherapyMaterial) {
    setSaving(true); setError(''); setNotice('')
    try {
      await readApiResponse<TherapyMaterial>(await fetch(`/api/v1/therapy/materials/${encodeURIComponent(material.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editDraft, active: material.active }),
      }))
      setEditingMaterialId('')
      await loadData()
      setNotice('Cadastro do material atualizado.')
    } catch (saveError) {
      setError(readableApiError(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function setMaterialActive(material: TherapyMaterial, active: boolean) {
    setSaving(true); setError(''); setNotice('')
    try {
      await readApiResponse<TherapyMaterial>(await fetch(`/api/v1/therapy/materials/${encodeURIComponent(material.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: material.name,
          category: material.category,
          unit: material.unit,
          color_name: material.color_name,
          color_code: material.color_code,
          active,
        }),
      }))
      await loadData()
      setNotice(active ? 'Material reativado.' : 'Material arquivado. O histórico de estoque foi preservado.')
    } catch (saveError) {
      setError(readableApiError(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function submitMovement(event: FormEvent<HTMLFormElement>, materialId: string) {
    event.preventDefault()
    setSaving(true); setError(''); setNotice('')
    try {
      await readApiResponse<{ material: TherapyMaterial }>(await fetch(`/api/v1/therapy/materials/${encodeURIComponent(materialId)}/movements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(adjustment),
      }))
      setAdjustment({ direction: 'entrada', quantity: '', reason: '' })
      setMovementMaterialId('')
      await loadData()
      setNotice('Movimentação de estoque registrada.')
    } catch (saveError) {
      setError(readableApiError(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function toggleMovementHistory(materialId: string) {
    setError(''); setNotice('')
    if (historyMaterialId === materialId) {
      setHistoryMaterialId('')
      return
    }
    try {
      const data = await readApiResponse<{ movements: MaterialMovement[]; total: number }>(
        await fetch(`/api/v1/therapy/materials/${encodeURIComponent(materialId)}/movements`),
      )
      setMovements(data.movements)
      setMovementsTotal(data.total)
      setHistoryMaterialId(materialId)
    } catch (loadError) {
      setError(readableApiError(loadError))
    }
  }

  async function loadMoreMovements(materialId: string) {
    setLoadingMovements(true)
    try {
      const data = await readApiResponse<{ movements: MaterialMovement[]; total: number }>(
        await fetch(`/api/v1/therapy/materials/${encodeURIComponent(materialId)}/movements?offset=${movements.length}`),
      )
      setMovements((current) => [...current, ...data.movements])
      setMovementsTotal(data.total)
    } catch (loadError) {
      setError(readableApiError(loadError))
    } finally {
      setLoadingMovements(false)
    }
  }

  async function uploadImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!imageFile) { setError('Selecione uma imagem para enviar.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      await readApiResponse<MaterialImage>(await fetch(`/api/v1/therapy/material-images?title=${encodeURIComponent(imageTitle.trim())}`, {
        method: 'POST',
        headers: { 'Content-Type': imageFile.type },
        body: imageFile,
      }))
      setImageTitle('')
      setImageFile(null)
      const input = document.getElementById('therapy-material-image-file')
      if (input instanceof HTMLInputElement) input.value = ''
      await loadData()
      setNotice('Imagem adicionada à biblioteca.')
    } catch (saveError) {
      setError(readableApiError(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function deleteImage(image: MaterialImage) {
    setSaving(true); setError(''); setNotice('')
    try {
      await readApiResponse<void>(await fetch(`/api/v1/therapy/material-images/${encodeURIComponent(image.id)}`, {
        method: 'DELETE',
      }))
      setDeleteImageId('')
      await loadData()
      setNotice('Imagem removida da biblioteca.')
    } catch (deleteError) {
      setError(readableApiError(deleteError))
    } finally {
      setSaving(false)
    }
  }

  return <section className="therapy-materials-panel">
    {notice && <p className="therapy-material-message" role="status">{notice}</p>}
    {error && <p className="therapy-material-message therapy-material-error" role="alert">{error}</p>}
    {canEdit && <form className="therapy-material-form" onSubmit={(event) => void createMaterial(event)}>
      <div className="section-heading"><div><p className="eyebrow">NOVO CADASTRO</p><h2>Adicionar material</h2><p className="welcome-copy">Cadastre materiais, ferramentas e tintas. A quantidade inicial também entra no histórico.</p></div></div>
      <div className="therapy-material-fields">
        <label className="field"><span className="field-label">Nome</span><input required minLength={2} maxLength={120} value={newMaterial.name} onChange={(event) => setNewMaterial({ ...newMaterial, name: event.target.value })} placeholder="Ex.: Tinta acrílica" /></label>
        <label className="field"><span className="field-label">Categoria</span><input required minLength={2} maxLength={40} value={newMaterial.category} onChange={(event) => setNewMaterial({ ...newMaterial, category: event.target.value })} placeholder="Ex.: Pintura" /></label>
        <label className="field"><span className="field-label">Unidade de controle</span><input required maxLength={24} value={newMaterial.unit} onChange={(event) => setNewMaterial({ ...newMaterial, unit: event.target.value })} placeholder="unidade, tubo, litro…" /></label>
        <label className="field"><span className="field-label">Quantidade inicial</span><input required type="number" min="0" step="0.001" value={newMaterial.initial_quantity} onChange={(event) => setNewMaterial({ ...newMaterial, initial_quantity: event.target.value })} /></label>
        <label className="field"><span className="field-label">Nome da cor (opcional)</span><input maxLength={60} value={newMaterial.color_name} onChange={(event) => setNewMaterial({ ...newMaterial, color_name: event.target.value })} placeholder="Ex.: Azul cobalto" /></label>
        <label className="field"><span className="field-label">Código da cor (opcional)</span><input maxLength={32} value={newMaterial.color_code} onChange={(event) => setNewMaterial({ ...newMaterial, color_code: event.target.value })} placeholder="Ex.: #0047AB" /></label>
      </div>
      <button className="button button-primary" type="submit" disabled={saving}><Plus size={16} /> Cadastrar material</button>
    </form>}

    <section className="therapy-material-section">
      <div className="section-heading"><div><p className="eyebrow">CONTROLE DE ESTOQUE</p><h2><Package size={19} /> Materiais cadastrados</h2></div><span className="module-total">{materials.filter((material) => material.active).length} ativos</span></div>
      {loading ? <div className="history-empty">Carregando materiais…</div> : materials.length ? <div className="therapy-material-list">{materials.map((material) => <article className={`therapy-material-card ${material.active ? '' : 'therapy-material-card-archived'}`} key={material.id}>
        <div className="therapy-material-card-heading"><div><span className="therapy-material-category">{material.category}</span><h3>{material.name}</h3>{(material.color_name || material.color_code) && <p className="therapy-material-color">{material.color_name}{material.color_name && material.color_code ? ' · ' : ''}{material.color_code}</p>}</div><div className="therapy-material-stock"><strong>{material.quantity}</strong><span>{material.unit}</span></div></div>
        {!material.active && <span className="therapy-material-archived-label">Arquivado</span>}
        {canEdit && <div className="therapy-material-actions">
          <button className="button button-secondary" type="button" onClick={() => { setEditingMaterialId(editingMaterialId === material.id ? '' : material.id); setEditDraft({ name: material.name, category: material.category, unit: material.unit, color_name: material.color_name, color_code: material.color_code }) }}><Pencil size={15} /> Editar</button>
          <button className="button button-secondary" type="button" onClick={() => void setMaterialActive(material, !material.active)} disabled={saving}><Archive size={15} /> {material.active ? 'Arquivar' : 'Reativar'}</button>
          {material.active && <button className="button button-secondary" type="button" onClick={() => setMovementMaterialId(movementMaterialId === material.id ? '' : material.id)}><Plus size={15} /> Movimentar</button>}
        </div>}
        <button className="therapy-material-history-toggle" type="button" onClick={() => void toggleMovementHistory(material.id)}><History size={15} /> {historyMaterialId === material.id ? 'Ocultar últimas movimentações' : 'Ver últimas movimentações'}</button>
        {editingMaterialId === material.id && <form className="therapy-material-edit" onSubmit={(event) => { event.preventDefault(); void saveMaterial(material) }}>
          {(['name', 'category', 'unit', 'color_name', 'color_code'] as const).map((field) => <label className="field" key={field}><span className="field-label">{({ name: 'Nome', category: 'Categoria', unit: 'Unidade', color_name: 'Nome da cor', color_code: 'Código da cor' })[field]}</span><input required={field === 'name' || field === 'category' || field === 'unit'} maxLength={field === 'name' ? 120 : field === 'category' ? 40 : field === 'unit' ? 24 : field === 'color_name' ? 60 : 32} value={editDraft[field]} onChange={(event) => setEditDraft({ ...editDraft, [field]: event.target.value })} /></label>)}
          <button className="button button-primary" type="submit" disabled={saving}><Save size={15} /> Salvar cadastro</button>
        </form>}
        {movementMaterialId === material.id && material.active && <form className="therapy-material-edit" onSubmit={(event) => void submitMovement(event, material.id)}>
          <label className="field"><span className="field-label">Tipo de movimentação</span><select value={adjustment.direction} onChange={(event) => setAdjustment({ ...adjustment, direction: event.target.value as 'entrada' | 'consumo' })}><option value="entrada">Entrada</option><option value="consumo">Consumo</option></select></label>
          <label className="field"><span className="field-label">Quantidade ({material.unit})</span><input required type="number" min="0.001" step="0.001" value={adjustment.quantity} onChange={(event) => setAdjustment({ ...adjustment, quantity: event.target.value })} /></label>
          <label className="field"><span className="field-label">Motivo / observação</span><input required minLength={3} maxLength={300} value={adjustment.reason} onChange={(event) => setAdjustment({ ...adjustment, reason: event.target.value })} placeholder="Ex.: reposição de materiais" /></label>
          <button className="button button-primary" type="submit" disabled={saving}><Save size={15} /> Registrar movimentação</button>
        </form>}
        {historyMaterialId === material.id && <ol className="therapy-material-history">{movements.length ? movements.map((movement) => <li key={movement.id}><span className={`therapy-movement-direction therapy-movement-${movement.direction}`}>{movement.direction === 'entrada' ? 'Entrada' : 'Consumo'} · {movement.quantity} {material.unit}</span><span>{movement.reason}</span><small>Saldo após movimentação: {movement.balance_after} {material.unit} · {movement.actor_name} · {formatTimestamp(movement.created_at)}</small></li>) : <li className="history-empty">Ainda não há movimentações registradas.</li>}{movements.length < movementsTotal && <li><button className="therapy-material-history-toggle" type="button" disabled={loadingMovements} onClick={() => void loadMoreMovements(material.id)}>{loadingMovements ? 'Carregando…' : `Carregar movimentações anteriores (${movementsTotal - movements.length})`}</button></li>}</ol>}
      </article>)}</div> : <div className="history-empty">Nenhum material cadastrado.</div>}
    </section>

    <section className="therapy-material-section">
      <div className="section-heading"><div><p className="eyebrow">ACERVO DA OFICINA</p><h2><ImagePlus size={19} /> Biblioteca de imagens imprimíveis</h2><p className="welcome-copy">Imagens ficam no armazenamento próprio da Oficina Terapêutica, não no banco de dados.</p></div><span className="module-total">{images.length} imagens</span></div>
      {canEdit && <form className="therapy-material-form therapy-image-upload" onSubmit={(event) => void uploadImage(event)}>
        <label className="field"><span className="field-label">Título da imagem</span><input required minLength={2} maxLength={120} value={imageTitle} onChange={(event) => setImageTitle(event.target.value)} placeholder="Ex.: formas geométricas para pintura" /></label>
        <label className="field"><span className="field-label">Arquivo (JPG, PNG ou WebP, até 12 MB)</span><input id="therapy-material-image-file" type="file" accept="image/jpeg,image/png,image/webp" required onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} /></label>
        <button className="button button-primary" type="submit" disabled={saving || !imageFile}><ImagePlus size={16} /> Enviar imagem</button>
      </form>}
      {images.length ? <div className="therapy-image-grid">{images.map((image) => <article className="therapy-image-card" key={image.id}>
        <img src={image.url} alt={image.title} loading="lazy" />
        <div><h3>{image.title}</h3><p>{(image.size_bytes / 1024 / 1024).toFixed(2)} MB · {image.uploaded_by}</p><small>{formatTimestamp(image.uploaded_at)}</small></div>
        <div className="therapy-material-actions"><a className="button button-secondary" href={image.url} download><Download size={15} /> Baixar</a>{canEdit && (deleteImageId === image.id ? <><button className="button button-secondary" type="button" disabled={saving} onClick={() => void deleteImage(image)}><Trash2 size={15} /> Confirmar exclusão</button><button className="button button-secondary" type="button" onClick={() => setDeleteImageId('')}><X size={15} /> Cancelar</button></> : <button className="button button-secondary" type="button" disabled={saving} onClick={() => setDeleteImageId(image.id)}><Trash2 size={15} /> Excluir</button>)}</div>
      </article>)}</div> : <div className="history-empty">Nenhuma imagem disponível na biblioteca.</div>}
    </section>
  </section>
}
