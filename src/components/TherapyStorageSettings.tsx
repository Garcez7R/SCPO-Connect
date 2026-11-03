import { useCallback, useEffect, useState } from 'react'
import { FolderCog, Save } from 'lucide-react'
import { readApiResponse, readableApiError } from '../api'
import { useAppDialogs } from './appDialogContext'
import ToastMessage from './ToastMessage'

type StorageResource = 'library' | 'album'

type TherapyStorageStatus = {
  library_directory: string
  album_directory: string
  image_count: number
  album_image_count: number
  volume_available: boolean
  library_destination_available: boolean
  album_destination_available: boolean
  library_destination_display: string
  album_destination_display: string
}

const storageResources: {
  id: StorageResource
  label: string
  directoryField: 'library_directory' | 'album_directory'
  destinationAvailableField: 'library_destination_available' | 'album_destination_available'
  destinationDisplayField: 'library_destination_display' | 'album_destination_display'
  countField: 'image_count' | 'album_image_count'
  placeholder: string
  article: 'da' | 'do'
}[] = [
  {
    id: 'library',
    label: 'Biblioteca de imagens',
    directoryField: 'library_directory',
    destinationAvailableField: 'library_destination_available',
    destinationDisplayField: 'library_destination_display',
    countField: 'image_count',
    placeholder: 'biblioteca',
    article: 'da',
  },
  {
    id: 'album',
    label: 'Álbum de fotos',
    directoryField: 'album_directory',
    destinationAvailableField: 'album_destination_available',
    destinationDisplayField: 'album_destination_display',
    countField: 'album_image_count',
    placeholder: 'album',
    article: 'do',
  },
]

export default function TherapyStorageSettings() {
  const { confirm } = useAppDialogs()
  const [status, setStatus] = useState<TherapyStorageStatus | null>(null)
  const [directories, setDirectories] = useState<Record<StorageResource, string>>({ library: '', album: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<StorageResource | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const current = await readApiResponse<TherapyStorageStatus>(
        await fetch('/api/v1/therapy/storage-location'),
      )
      setStatus(current)
      setDirectories({
        library: current.library_directory,
        album: current.album_directory,
      })
      setError('')
    } catch (loadError) {
      setError(readableApiError(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadStatus(), 0)
    return () => window.clearTimeout(timer)
  }, [loadStatus])

  async function saveLocation(resource: StorageResource) {
    const nextDirectory = directories[resource]
    if (nextDirectory !== nextDirectory.trim()) {
      setError('Remova espaços no início ou no fim do caminho.')
      return
    }
    if (resource === 'album' && !nextDirectory) {
      setError('O Álbum precisa ficar em uma subpasta do volume.')
      return
    }
    const currentDirectory = status?.[resource === 'library' ? 'library_directory' : 'album_directory']
    if (nextDirectory === currentDirectory) {
      setNotice('Este já é o local configurado.')
      return
    }
    const itemCount = status?.[resource === 'library' ? 'image_count' : 'album_image_count'] ?? 0
    const resourceLabel = resource === 'library' ? 'Biblioteca de imagens' : 'Álbum de fotos'
    const resourceArticle = resource === 'library' ? 'da' : 'do'
    const imageMessage = itemCount === 1
      ? ' A imagem cadastrada será movida para a nova subpasta.'
      : itemCount > 1
        ? ` As ${itemCount} imagens cadastradas serão movidas para a nova subpasta.`
        : ''
    const destinationDescription = nextDirectory || 'raiz do volume'
    if (!await confirm(`Alterar o local ${resourceArticle} ${resourceLabel} para "${destinationDescription}"?${imageMessage} A outra pasta não será alterada. O caminho precisa estar dentro do volume disponibilizado à aplicação; esta operação não monta discos nem compartilhamentos.`)) return

    setSaving(resource)
    setError('')
    setNotice('')
    try {
      const updated = await readApiResponse<TherapyStorageStatus>(
        await fetch('/api/v1/therapy/storage-location', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [`${resource}_directory`]: nextDirectory }),
        }),
      )
      setStatus(updated)
      setDirectories({
        library: updated.library_directory,
        album: updated.album_directory,
      })
      setNotice(`Local ${resourceArticle} ${resourceLabel} atualizado.`)
    } catch (saveError) {
      setError(readableApiError(saveError))
    } finally {
      setSaving(null)
    }
  }

  return <section className="patient-list-panel therapy-storage-settings">
    <div className="section-heading">
      <div>
        <p className="eyebrow">ARMAZENAMENTO DA OFICINA</p>
        <h3><FolderCog size={20} /> Pastas da Biblioteca e do Álbum</h3>
        <p className="welcome-copy">Escolha subpastas independentes dentro do volume disponibilizado à aplicação. Os arquivos cadastrados são movidos automaticamente e continuam vinculados aos seus registros.</p>
      </div>
    </div>
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    {!loading && status && <>
      {!status.volume_available && <ToastMessage variant="error">O volume de imagens não está montado ou não permite gravação ao serviço da Oficina. Solicite à TI a montagem e a permissão no host.</ToastMessage>}
      <div className="therapy-storage-resource-grid">
        {storageResources.map((resource) => {
          const currentDirectory = status[resource.directoryField]
          const destinationAvailable = status[resource.destinationAvailableField]
          const destinationDisplay = status[resource.destinationDisplayField]
          const imageCount = status[resource.countField]
          return <div className="therapy-storage-resource" key={resource.id}>
            <p className="field-hint">Local atual: <code>{destinationDisplay}</code> · {imageCount} {imageCount === 1 ? 'imagem cadastrada' : 'imagens cadastradas'}.</p>
            {status.volume_available && !destinationAvailable && <ToastMessage variant="error">{`A subpasta atual ${resource.article} ${resource.label} não está disponível para gravação.`}</ToastMessage>}
            <label className="field">
              <span className="field-label">Subpasta {resource.article} {resource.label}</span>
              <input
                maxLength={200}
                value={directories[resource.id]}
                onChange={(event) => setDirectories((current) => ({ ...current, [resource.id]: event.target.value }))}
                placeholder={resource.placeholder}
                autoComplete="off"
                disabled={Boolean(saving)}
              />
              <span className="field-hint">
                Informe um caminho relativo, como <code>{resource.placeholder}</code>.
                {resource.id === 'library' && ' Deixe vazio para usar a raiz do volume.'}
                {' '}Caminhos absolutos e saídas do volume não são aceitos. Biblioteca e Álbum não podem usar a mesma pasta.
              </span>
            </label>
            <button className="button button-secondary" type="button" onClick={() => void saveLocation(resource.id)} disabled={loading || Boolean(saving) || !status.volume_available || directories[resource.id] === currentDirectory}>
              <Save size={16} /> {saving === resource.id ? 'Movendo arquivos…' : `Salvar local ${resource.article} ${resource.label}`}
            </button>
          </div>
        })}
      </div>
    </>}
  </section>
}
