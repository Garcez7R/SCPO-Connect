import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ExternalLink, Megaphone, RefreshCw, Trash2 } from 'lucide-react'
import { readApiResponse } from '../api'
import ToastMessage from './ToastMessage'
import { useAppDialogs } from './appDialogContext'

export type AppAnnouncement = {
  id: string
  title: string
  url: string
  summary?: string | null
  active: boolean
  published_at: string
  expires_at?: string | null
  created_by_name: string
}

export function AppAnnouncementsFeed() {
  const [items, setItems] = useState<AppAnnouncement[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await readApiResponse<{ announcements?: AppAnnouncement[] }>(
        await fetch('/api/v1/app/announcements', { cache: 'no-store' }),
      )
      setItems(response.announcements ?? [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  if (loading || items.length === 0) return null
  return (
    <section className="app-announcements" aria-label="Informativos">
      <div className="section-heading">
        <div><p className="eyebrow">INFORMATIVOS</p><h2>Novidades e comunicados</h2></div>
      </div>
      <div className="app-announcement-list">
        {items.map((item) => (
          <a className="app-announcement-link" key={item.id} href={item.url} target="_blank" rel="noopener noreferrer">
            <span className="app-announcement-icon"><Megaphone size={18} /></span>
            <span><strong>{item.title}</strong>{item.summary && <small>{item.summary}</small>}</span>
            <ExternalLink size={16} aria-hidden="true" />
          </a>
        ))}
      </div>
    </section>
  )
}

export function AppAnnouncementsAdmin({ endpointPrefix = '/api/v1/system-admin' }: { endpointPrefix?: '/api/v1/system-admin' | '/api/v1/admin' }) {
  const { confirm } = useAppDialogs()
  const [items, setItems] = useState<AppAnnouncement[]>([])
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [summary, setSummary] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [active, setActive] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await readApiResponse<{ announcements?: AppAnnouncement[] }>(
        await fetch(`${endpointPrefix}/announcements`, { cache: 'no-store' }),
      )
      setItems(response.announcements ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os informativos.')
    } finally {
      setLoading(false)
    }
  }, [endpointPrefix])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await readApiResponse(
        await fetch(`${endpointPrefix}/announcements`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            url,
            summary: summary || null,
            expires_at: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
            active,
          }),
        }),
      )
      setTitle('')
      setUrl('')
      setSummary('')
      setExpiresAt('')
      setActive(true)
      setNotice('Informativo publicado.')
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível publicar o informativo.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(item: AppAnnouncement) {
    if (!await confirm(`Excluir o informativo "${item.title}"? Esta ação não pode ser desfeita.`)) return
    setBusy(true)
    setError('')
    try {
      await readApiResponse(await fetch(`${endpointPrefix}/announcements/${item.id}`, { method: 'DELETE' }))
      setNotice('Informativo excluído.')
      await load()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Não foi possível excluir o informativo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="patient-list-panel app-announcements-admin">
      <div className="section-heading">
        <div><p className="eyebrow">COMUNICAÇÃO INSTITUCIONAL</p><h2>Informativos do aplicativo</h2><p className="welcome-copy">Cadastre links internos ou externos para comunicar novidades, manuais, avisos e orientações.</p></div>
        <button className="button button-secondary" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Atualizar</button>
      </div>
      {error && <ToastMessage variant="error">{error}</ToastMessage>}
      {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
      <form className="app-announcement-form" onSubmit={submit}>
        <label className="field">Título<input value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={160} required /></label>
        <label className="field">Link<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} maxLength={2048} required /></label>
        <label className="field">Resumo opcional<textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={500} rows={3} /></label>
        <label className="field">Validade opcional<input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
        <label className="app-announcement-active"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Publicado</label>
        <button className="button button-primary" type="submit" disabled={busy || loading}>{busy ? 'Salvando…' : 'Publicar informativo'}</button>
      </form>
      <div className="app-announcement-admin-list">
        {loading ? <div className="history-empty">Carregando informativos…</div> : items.length ? items.map((item) => (
          <article key={item.id}>
            <span><strong>{item.title}</strong><small>{item.active ? 'Publicado' : 'Inativo'} · {item.url}</small></span>
            <a className="button button-secondary" href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> Abrir</a>
            <button className="button button-secondary" type="button" onClick={() => void remove(item)} disabled={busy}><Trash2 size={15} /> Excluir</button>
          </article>
        )) : <div className="history-empty">Nenhum informativo cadastrado.</div>}
      </div>
    </section>
  )
}
