import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Archive, Download, Folder, FolderOpen, FolderPlus, History, ImagePlus, Package, Pencil, Plus, Save, Search, Trash2, X } from 'lucide-react'
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
  folder_id: string | null
  folder_name: string
  size_bytes: number
  uploaded_by: string
  uploaded_at: string
  url: string
}

type MaterialImageFolder = {
  id: string
  name: string
  image_count: number
  created_by: string
  created_at: string
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
  const [folders, setFolders] = useState<MaterialImageFolder[]>([])
  const [activeFolderId, setActiveFolderId] = useState('all')
  const [folderName, setFolderName] = useState('')
  const [editingFolderId, setEditingFolderId] = useState('')
  const [editingFolderName, setEditingFolderName] = useState('')
  const [deleteFolderId, setDeleteFolderId] = useState('')
  const [editingImageId, setEditingImageId] = useState('')
  const [editingImageTitle, setEditingImageTitle] = useState('')
  const [imageSearch, setImageSearch] = useState('')
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
  const visibleImages = images.filter((image) =>
    (activeFolderId === 'all'
      || (activeFolderId === 'root' ? !image.folder_id : image.folder_id === activeFolderId))
    && (!imageSearch.trim() || `${image.title} ${image.folder_name}`.toLocaleLowerCase('pt-BR').includes(imageSearch.trim().toLocaleLowerCase('pt-BR'))),
  )

  const loadData = useCallback(async () => {
    const [materialResponse, imageResponse] = await Promise.all([
      fetch('/api/v1/therapy/materials?include_archived=true'),
      fetch('/api/v1/therapy/material-images'),
    ])
    const [materialData, imageData] = await Promise.all([
      readApiResponse<{ materials: TherapyMaterial[] }>(materialResponse),
      readApiResponse<{ images: MaterialImage[]; folders: MaterialImageFolder[] }>(imageResponse),
    ])
    setMaterials(materialData.materials)
    setImages(imageData.images)
    setFolders(imageData.folders)
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([
      fetch('/api/v1/therapy/materials?include_archived=true').then((response) =>
        readApiResponse<{ materials: TherapyMaterial[] }>(response),
      ),
      fetch('/api/v1/therapy/material-images').then((response) =>
        readApiResponse<{ images: MaterialImage[]; folders: MaterialImageFolder[] }>(response),
      ),
    ]).then(([materialData, imageData]) => {
      if (!active) return
      setMaterials(materialData.materials)
      setImages(imageData.images)
      setFolders(imageData.folders)
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
      const uploadParams = new URLSearchParams({ title: imageTitle.trim() })
      if (activeFolderId !== 'all' && activeFolderId !== 'root') uploadParams.set('folder_id', activeFolderId)
      await readApiResponse<MaterialImage>(await fetch(`/api/v1/therapy/material-images?${uploadParams}`, {
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

  async function createImageFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setError(''); setNotice('')
    try {
      const folder = await readApiResponse<MaterialImageFolder>(await fetch('/api/v1/therapy/material-images/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderName }),
      }))
      setFolderName('')
      setActiveFolderId(folder.id)
      await loadData()
      setNotice(`Pasta “${folder.name}” criada.`)
    } catch (saveError) {
      setError(readableApiError(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function renameImageFolder(folder: MaterialImageFolder) {
    setSaving(true); setError(''); setNotice('')
    try {
      await readApiResponse<MaterialImageFolder>(await fetch(`/api/v1/therapy/material-images/folders/${encodeURIComponent(folder.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingFolderName }),
      }))
      setEditingFolderId('')
      await loadData()
      setNotice('Pasta renomeada.')
    } catch (saveError) {
      setError(readableApiError(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function deleteImageFolder(folder: MaterialImageFolder) {
    setSaving(true); setError(''); setNotice('')
    try {
      await readApiResponse<void>(await fetch(`/api/v1/therapy/material-images/folders/${encodeURIComponent(folder.id)}`, {
        method: 'DELETE',
      }))
      setDeleteFolderId('')
      setActiveFolderId('all')
      await loadData()
      setNotice(`Pasta “${folder.name}” excluída.`)
    } catch (deleteError) {
      setError(readableApiError(deleteError))
    } finally {
      setSaving(false)
    }
  }

  async function updateImage(image: MaterialImage, update: { title?: string; folder_id?: string | null }) {
    setSaving(true); setError(''); setNotice('')
    try {
      await readApiResponse<MaterialImage>(await fetch(`/api/v1/therapy/material-images/${encodeURIComponent(image.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      }))
      setEditingImageId('')
      await loadData()
      setNotice(update.title !== undefined ? 'Imagem renomeada.' : 'Imagem movida.')
    } catch (updateError) {
      setError(readableApiError(updateError))
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
      <div className="therapy-image-manager">
        <aside className="therapy-image-sidebar" aria-label="Pastas da biblioteca">
          <div className="therapy-image-sidebar-heading"><strong>Pastas</strong><span>{folders.length}</span></div>
          <button className={`therapy-image-folder ${activeFolderId === 'all' ? 'is-selected' : ''}`} type="button" onClick={() => setActiveFolderId('all')}><FolderOpen size={16} /><span>Todas as imagens</span><b>{images.length}</b></button>
          <button className={`therapy-image-folder ${activeFolderId === 'root' ? 'is-selected' : ''}`} type="button" onClick={() => setActiveFolderId('root')}><ImagePlus size={16} /><span>Sem pasta</span><b>{images.filter((image) => !image.folder_id).length}</b></button>
          {folders.map((folder) => <div className={`therapy-image-folder-row ${activeFolderId === folder.id ? 'is-selected' : ''}`} key={folder.id}>
            {editingFolderId === folder.id
              ? <form className="therapy-image-folder-rename" onSubmit={(event) => { event.preventDefault(); void renameImageFolder(folder) }}><input aria-label="Novo nome da pasta" required maxLength={80} value={editingFolderName} onChange={(event) => setEditingFolderName(event.target.value)} /><button className="button button-secondary" type="submit" disabled={saving} aria-label="Salvar nome da pasta"><Save size={14} /></button><button className="button button-secondary" type="button" onClick={() => setEditingFolderId('')} aria-label="Cancelar renomeação"><X size={14} /></button></form>
              : <button className={`therapy-image-folder ${activeFolderId === folder.id ? 'is-selected' : ''}`} type="button" onClick={() => setActiveFolderId(folder.id)}><Folder size={16} /><span>{folder.name}</span><b>{folder.image_count}</b></button>}
            {canEdit && editingFolderId !== folder.id && <div className="therapy-image-folder-actions">{deleteFolderId === folder.id ? <><button className="therapy-image-icon-button" type="button" aria-label={`Confirmar exclusão da pasta ${folder.name}`} disabled={saving || folder.image_count > 0} onClick={() => void deleteImageFolder(folder)}><Save size={14} /></button><button className="therapy-image-icon-button" type="button" aria-label="Cancelar exclusão da pasta" onClick={() => setDeleteFolderId('')}><X size={14} /></button></> : <><button className="therapy-image-icon-button" type="button" aria-label={`Renomear pasta ${folder.name}`} onClick={() => { setEditingFolderId(folder.id); setEditingFolderName(folder.name) }}><Pencil size={14} /></button><button className="therapy-image-icon-button" type="button" aria-label={`Excluir pasta ${folder.name}`} title={folder.image_count ? 'Mova ou exclua as imagens antes de excluir a pasta' : 'Excluir pasta vazia'} disabled={saving || folder.image_count > 0} onClick={() => setDeleteFolderId(folder.id)}><Trash2 size={14} /></button></>}</div>}
          </div>)}
          {canEdit && <form className="therapy-image-new-folder" onSubmit={(event) => void createImageFolder(event)}><label className="field"><span className="field-label">Criar pasta</span><input required maxLength={80} value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="Nome da pasta" /></label><button className="button button-secondary" type="submit" disabled={saving || !folderName.trim()}><FolderPlus size={15} /> Nova pasta</button></form>}
        </aside>
        <div className="therapy-image-browser">
          <div className="therapy-image-browser-header"><div><p className="eyebrow">ACERVO DA OFICINA</p><h2><ImagePlus size={19} /> Biblioteca de imagens</h2><p className="welcome-copy">Organize, renomeie, mova, baixe ou exclua arquivos. Imagens ficam no armazenamento próprio da Oficina Terapêutica.</p></div><span className="module-total">{visibleImages.length} {visibleImages.length === 1 ? 'imagem' : 'imagens'}</span></div>
          <div className="therapy-image-toolbar"><label className="therapy-image-search"><Search size={16} /><input type="search" value={imageSearch} onChange={(event) => setImageSearch(event.target.value)} placeholder="Buscar imagem nesta pasta" aria-label="Buscar imagens" /></label><span>{activeFolderId === 'all' ? 'Todas as pastas' : activeFolderId === 'root' ? 'Sem pasta' : folders.find((folder) => folder.id === activeFolderId)?.name}</span></div>
          {canEdit && <form className="therapy-material-form therapy-image-upload" onSubmit={(event) => void uploadImage(event)}>
            <label className="field"><span className="field-label">Título da imagem</span><input required minLength={2} maxLength={120} value={imageTitle} onChange={(event) => setImageTitle(event.target.value)} placeholder="Ex.: formas geométricas para pintura" /></label>
            <div className="field"><span className="field-label">Arquivo (JPG, PNG ou WebP, até 12 MB)</span><div className="therapy-image-file-picker"><input className="therapy-image-file-input" id="therapy-material-image-file" type="file" accept="image/jpeg,image/png,image/webp" required aria-label="Escolher imagem para a biblioteca da Oficina Terapêutica" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} /><label className="button button-secondary" htmlFor="therapy-material-image-file"><ImagePlus size={15} /> Escolher arquivo</label><span title={imageFile?.name}>{imageFile?.name ?? 'Nenhum arquivo selecionado'}</span></div></div>
            <button className="button button-primary" type="submit" disabled={saving || !imageFile}><ImagePlus size={16} /> Enviar imagem</button>
          </form>}
          {visibleImages.length ? <div className="therapy-image-grid">{visibleImages.map((image) => <article className="therapy-image-card" key={image.id}>
            <img src={image.url} alt={image.title} loading="lazy" />
            <div className="therapy-image-card-details">
              {editingImageId === image.id
                ? <form className="therapy-image-rename" onSubmit={(event) => { event.preventDefault(); void updateImage(image, { title: editingImageTitle }) }}><label className="field"><span className="field-label">Nome do arquivo</span><input required minLength={2} maxLength={120} value={editingImageTitle} onChange={(event) => setEditingImageTitle(event.target.value)} /></label><button className="button button-primary" type="submit" disabled={saving}><Save size={14} /> Salvar</button><button className="button button-secondary" type="button" onClick={() => setEditingImageId('')}><X size={14} /> Cancelar</button></form>
                : <><h3>{image.title}</h3><p>{image.folder_name || 'Sem pasta'} · {(image.size_bytes / 1024 / 1024).toFixed(2)} MB</p><small>{image.uploaded_by} · {formatTimestamp(image.uploaded_at)}</small></>}
            </div>
            <div className="therapy-material-actions"><a className="button button-secondary" href={image.url} download><Download size={15} /> Baixar</a>{canEdit && <>
              {editingImageId !== image.id && <button className="button button-secondary" type="button" disabled={saving} onClick={() => { setEditingImageId(image.id); setEditingImageTitle(image.title) }}><Pencil size={15} /> Renomear</button>}
              <label className="therapy-image-move"><span className="field-label">Mover para</span><select aria-label={`Mover ${image.title} para uma pasta`} value={image.folder_id ?? ''} disabled={saving} onChange={(event) => void updateImage(image, { folder_id: event.target.value || null })}><option value="">Sem pasta</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
              {deleteImageId === image.id ? <><button className="button button-secondary" type="button" disabled={saving} onClick={() => void deleteImage(image)}><Trash2 size={15} /> Confirmar exclusão</button><button className="button button-secondary" type="button" onClick={() => setDeleteImageId('')}><X size={15} /> Cancelar</button></> : <button className="button button-secondary" type="button" disabled={saving} onClick={() => setDeleteImageId(image.id)}><Trash2 size={15} /> Excluir</button>}
            </>}</div>
          </article>)}</div> : <div className="history-empty">{imageSearch ? 'Nenhuma imagem corresponde à busca.' : 'Nenhuma imagem disponível nesta pasta.'}</div>}
        </div>
      </div>
    </section>
  </section>
}
