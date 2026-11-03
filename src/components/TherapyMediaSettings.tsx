import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Camera, HardDrive, Images, RefreshCw, Save } from 'lucide-react'
import { readApiResponse, readableApiError } from '../api'
import { useAppDialogs } from './appDialogContext'
import TherapyStorageSettings from './TherapyStorageSettings'
import ToastMessage from './ToastMessage'

type MediaResourceSettings = {
  enabled: boolean
  quota_bytes: number | null
  used_bytes: number
}

type TherapyMediaSettingsState = {
  library: MediaResourceSettings
  album: MediaResourceSettings
  updated_at: string
  updated_by_name: string
}

type MediaResource = 'library' | 'album'

const bytesPerMebibyte = 1024 * 1024

function formatStorage(bytes: number) {
  const mebibytes = bytes / bytesPerMebibyte
  return mebibytes >= 1024
    ? `${(mebibytes / 1024).toFixed(2)} GiB`
    : `${mebibytes.toFixed(2)} MiB`
}

function formatQuotaInput(bytes: number | null) {
  if (bytes === null) return ''
  return String(Number((bytes / bytesPerMebibyte).toFixed(2)))
}

export default function TherapyMediaSettings() {
  const { confirm } = useAppDialogs()
  const [settings, setSettings] = useState<TherapyMediaSettingsState | null>(null)
  const [quotaInputs, setQuotaInputs] = useState<Record<MediaResource, string>>({ library: '', album: '' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadSettings = useCallback(async () => {
    setLoading(true)
    try {
      const current = await readApiResponse<TherapyMediaSettingsState>(
        await fetch('/api/v1/therapy/media-settings', { cache: 'no-store' }),
      )
      setSettings(current)
      setQuotaInputs({
        library: formatQuotaInput(current.library.quota_bytes),
        album: formatQuotaInput(current.album.quota_bytes),
      })
      setError('')
    } catch (loadError) {
      setError(readableApiError(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSettings(), 0)
    return () => window.clearTimeout(timer)
  }, [loadSettings])

  async function toggleResource(resource: MediaResource, enabled: boolean) {
    const label = resource === 'album' ? 'Álbum de fotos' : 'Biblioteca de imagens'
    if (!enabled && !await confirm(`Desativar ${label}? As pessoas perderão o acesso aos arquivos desse recurso, mas nenhuma foto ou pasta será apagada.`)) return
    setBusy(resource)
    setError('')
    setNotice('')
    try {
      const updated = await readApiResponse<TherapyMediaSettingsState>(
        await fetch('/api/v1/therapy/media-settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [`${resource}_enabled`]: enabled }),
        }),
      )
      setSettings(updated)
      setNotice(`${label} ${enabled ? 'ativado' : 'desativado'}.`)
    } catch (updateError) {
      setError(readableApiError(updateError))
    } finally {
      setBusy('')
    }
  }

  async function saveQuota(event: FormEvent<HTMLFormElement>, resource: MediaResource) {
    event.preventDefault()
    const rawValue = quotaInputs[resource].trim()
    const mebibytes = rawValue ? Number(rawValue) : null
    const quotaBytes = mebibytes === null ? null : Math.round(mebibytes * bytesPerMebibyte)
    if (mebibytes !== null && (!Number.isFinite(mebibytes) || mebibytes <= 0 || !Number.isSafeInteger(quotaBytes))) {
      setError('Informe uma cota maior que zero em MiB ou deixe o campo vazio para não limitar.')
      return
    }
    setBusy(`${resource}-quota`)
    setError('')
    setNotice('')
    try {
      const updated = await readApiResponse<TherapyMediaSettingsState>(
        await fetch('/api/v1/therapy/media-settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [`${resource}_quota_bytes`]: quotaBytes }),
        }),
      )
      setSettings(updated)
      setQuotaInputs({
        library: formatQuotaInput(updated.library.quota_bytes),
        album: formatQuotaInput(updated.album.quota_bytes),
      })
      setNotice(`Cota da ${resource === 'album' ? 'Álbum' : 'Biblioteca'} atualizada.`)
    } catch (updateError) {
      setError(readableApiError(updateError))
    } finally {
      setBusy('')
    }
  }

  const resources: { id: MediaResource; label: string; Icon: typeof Camera }[] = [
    { id: 'library', label: 'Biblioteca de imagens', Icon: Camera },
    { id: 'album', label: 'Álbum de fotos', Icon: Images },
  ]

  return <>
    <section className="patient-list-panel therapy-media-settings">
      <div className="section-heading">
        <div>
          <p className="eyebrow">RECURSOS DA OFICINA</p>
          <h2><HardDrive size={19} /> Biblioteca e Álbum de fotos</h2>
          <p className="welcome-copy">Ative cada recurso e configure cotas independentes. Reduzir uma cota não apaga arquivos: novos envios ficam bloqueados até haver espaço livre.</p>
        </div>
        <button className="button button-secondary" type="button" onClick={() => void loadSettings()} disabled={loading || Boolean(busy)}><RefreshCw size={15} /> Atualizar</button>
      </div>
      {error && <ToastMessage variant="error">{error}</ToastMessage>}
      {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
      {loading && !settings && <div className="history-empty" role="status">Carregando configurações de armazenamento…</div>}
      {error && !settings && <button className="button button-secondary" type="button" onClick={() => void loadSettings()} disabled={loading}><RefreshCw size={15} /> Tentar novamente</button>}
      {settings && <div className="therapy-media-resource-grid">
        {resources.map(({ id, label, Icon }) => {
          const resourceSettings = settings[id]
          const usageExceedsQuota = resourceSettings.quota_bytes !== null && resourceSettings.used_bytes > resourceSettings.quota_bytes
          return <article className="therapy-media-resource" key={id}>
            <label className={`system-module-control ${resourceSettings.enabled ? '' : 'system-module-control-disabled'}`}>
              <span><strong><Icon size={16} /> {label}</strong><small>{resourceSettings.enabled ? 'Disponível para contas autorizadas' : 'Desativado; os arquivos permanecem armazenados'}</small></span>
              <input type="checkbox" role="switch" checked={resourceSettings.enabled} disabled={loading || Boolean(busy)} aria-label={`${resourceSettings.enabled ? 'Desativar' : 'Ativar'} ${label}`} onChange={(event) => void toggleResource(id, event.target.checked)} />
            </label>
            <p className="therapy-media-usage">Uso cadastrado: <strong>{formatStorage(resourceSettings.used_bytes)}</strong>{resourceSettings.quota_bytes === null ? ' · sem limite configurado' : ` de ${formatStorage(resourceSettings.quota_bytes)}`}</p>
            {usageExceedsQuota && <p className="therapy-media-quota-warning" role="status">O uso atual supera a nova cota. Os arquivos foram preservados e novos envios estão bloqueados.</p>}
            <form className="therapy-media-quota-form" onSubmit={(event) => void saveQuota(event, id)}>
              <label className="field"><span className="field-label">Cota de armazenamento (MiB)</span><input type="number" min="0.01" step="0.01" value={quotaInputs[id]} onChange={(event) => setQuotaInputs((current) => ({ ...current, [id]: event.target.value }))} placeholder="Sem limite" disabled={loading || Boolean(busy)} /><span className="field-hint">Deixe vazio para não limitar até configurar uma cota.</span></label>
              <button className="button button-secondary" type="submit" disabled={loading || Boolean(busy)}><Save size={15} /> {busy === `${id}-quota` ? 'Salvando…' : 'Salvar cota'}</button>
            </form>
          </article>
        })}
      </div>}
      {settings?.updated_at && <p className="field-hint">Última alteração: {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(settings.updated_at))} · {settings.updated_by_name}</p>}
    </section>
    <TherapyStorageSettings />
  </>
}
