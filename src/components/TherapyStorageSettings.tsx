import { useCallback, useEffect, useState } from 'react'
import { FolderCog, Save } from 'lucide-react'
import { readApiResponse, readableApiError } from '../api'
import { useAppDialogs } from './appDialogContext'
import ToastMessage from './ToastMessage'

type TherapyStorageStatus = {
  directory: string
  image_count: number
  volume_available: boolean
  destination_available: boolean
  destination_display: string
}

export default function TherapyStorageSettings() {
  const { confirm } = useAppDialogs()
  const [status, setStatus] = useState<TherapyStorageStatus | null>(null)
  const [directory, setDirectory] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const current = await readApiResponse<TherapyStorageStatus>(
        await fetch('/api/v1/therapy/storage-location'),
      )
      setStatus(current)
      setDirectory(current.directory)
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

  async function saveLocation() {
    const nextDirectory = directory.trim()
    if (nextDirectory !== directory) {
      setError('Remova espaços no início ou no fim do caminho.')
      return
    }
    if (nextDirectory === status?.directory) {
      setNotice('Este já é o local configurado.')
      return
    }
    const imageMessage = status?.image_count
      ? ` As ${status.image_count} imagem(ns) cadastradas serão movidas para a nova subpasta.`
      : ''
    if (!await confirm(`Alterar o local da biblioteca de imagens?${imageMessage} A operação não monta discos nem compartilhamentos.`)) return

    setSaving(true)
    setError('')
    setNotice('')
    try {
      const updated = await readApiResponse<TherapyStorageStatus>(
        await fetch('/api/v1/therapy/storage-location', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ directory: nextDirectory }),
        }),
      )
      setStatus(updated)
      setDirectory(updated.directory)
      setNotice('Local da biblioteca atualizado.')
    } catch (saveError) {
      setError(readableApiError(saveError))
    } finally {
      setSaving(false)
    }
  }

  return <section className="patient-list-panel therapy-storage-settings">
    <div className="section-heading">
      <div>
        <p className="eyebrow">ARMAZENAMENTO DA OFICINA</p>
        <h3><FolderCog size={20} /> Biblioteca de imagens</h3>
        <p className="welcome-copy">Escolha uma subpasta dentro do volume disponibilizado à aplicação. As imagens cadastradas são movidas automaticamente e continuam vinculadas aos seus registros.</p>
      </div>
    </div>
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    {!loading && status && <>
      {!status.volume_available && <ToastMessage variant="error">O volume de imagens não está montado ou não permite gravação ao serviço da Oficina. Solicite à TI a montagem e a permissão no host.</ToastMessage>}
      {status.volume_available && !status.destination_available && <ToastMessage variant="error">A subpasta atual não está disponível para gravação.</ToastMessage>}
      <p className="field-hint">Local atual: <code>{status.destination_display}</code> · {status.image_count} imagem(ns) cadastradas.</p>
      <label className="field">
        <span className="field-label">Subpasta da biblioteca</span>
        <input
          maxLength={200}
          value={directory}
          onChange={(event) => setDirectory(event.target.value)}
          placeholder="imagens/oficina"
          autoComplete="off"
          disabled={saving}
        />
        <span className="field-hint">Informe um caminho relativo, como <code>imagens/oficina</code>. Deixe vazio para usar a raiz do volume. O volume pode estar em disco local ou compartilhamento de rede já montado pela TI; caminhos absolutos e saídas do volume não são aceitos.</span>
      </label>
      <button className="button button-primary" type="button" onClick={() => void saveLocation()} disabled={loading || saving || !status.volume_available}>
        <Save size={16} /> {saving ? 'Movendo imagens…' : 'Salvar local da biblioteca'}
      </button>
    </>}
  </section>
}
