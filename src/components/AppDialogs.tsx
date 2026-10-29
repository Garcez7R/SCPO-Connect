import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AppDialogContext } from './appDialogContext'

type DialogKind = 'alert' | 'confirm' | 'prompt'
type DialogJob = {
  id: number
  kind: DialogKind
  title: string
  message: string
  inputLabel?: string
  confirmLabel: string
  resolve: (result: string | boolean | null) => void
}

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<DialogJob[]>([])
  const nextId = useRef(0)
  const active = queue[0]

  const enqueue = useCallback((kind: DialogKind, message: string, title: string, inputLabel?: string, confirmLabel?: string) => new Promise<string | boolean | null>((resolve) => {
    const id = ++nextId.current
    setQueue((current) => [...current, { id, kind, message, title, inputLabel, confirmLabel: confirmLabel ?? (kind === 'confirm' ? 'Confirmar' : 'Entendi'), resolve }])
  }), [])

  const alert = useCallback(async (message: string, title = 'Aviso') => {
    await enqueue('alert', message, title)
  }, [enqueue])
  const confirm = useCallback(async (message: string, title = 'Confirmar ação') => {
    return await enqueue('confirm', message, title) === true
  }, [enqueue])
  const prompt = useCallback(async (message: string, title = 'Informe os dados', inputLabel = 'Motivo') => {
    const result = await enqueue('prompt', message, title, inputLabel, 'Continuar')
    return typeof result === 'string' ? result : null
  }, [enqueue])

  useEffect(() => {
    if (active?.kind !== 'prompt') return
    const timer = window.setTimeout(() => {
      document.getElementById(`app-dialog-input-${active.id}`)?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [active?.id, active?.kind])

  useEffect(() => {
    if (!active) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        active.resolve(active.kind === 'confirm' ? false : null)
        setQueue((current) => current.filter((job) => job.id !== active.id))
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [active])

  function finish(result: string | boolean | null) {
    if (!active) return
    active.resolve(result)
    setQueue((current) => current.filter((job) => job.id !== active.id))
  }

  return <AppDialogContext.Provider value={{ alert, confirm, prompt }}>
    {children}
    {active && <div className="app-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && active.kind !== 'alert') finish(active.kind === 'confirm' ? false : null) }}>
      <section className="app-dialog" role={active.kind === 'alert' ? 'dialog' : 'alertdialog'} aria-modal="true" aria-labelledby={`app-dialog-title-${active.id}`} aria-describedby={`app-dialog-message-${active.id}`}>
        <div><p className="eyebrow">SCPO CONNECT</p><h2 id={`app-dialog-title-${active.id}`}>{active.title}</h2></div>
        <p id={`app-dialog-message-${active.id}`}>{active.message}</p>
        {active.kind === 'prompt' ? <form onSubmit={(event) => { event.preventDefault(); const value = new FormData(event.currentTarget).get('app-dialog-input'); if (typeof value === 'string' && value.trim()) finish(value) }}>
          <label className="field"><span className="field-label">{active.inputLabel}</span><input id={`app-dialog-input-${active.id}`} name="app-dialog-input" required /></label>
          <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => finish(null)}>Cancelar</button><button className="button button-primary" type="submit">{active.confirmLabel}</button></div>
        </form> : <div className="form-actions">
          {active.kind === 'confirm' && <button className="button button-secondary" type="button" onClick={() => finish(false)}>Cancelar</button>}
          <button className="button button-primary" type="button" autoFocus onClick={() => finish(active.kind === 'confirm')}>{active.confirmLabel}</button>
        </div>}
      </section>
    </div>}
  </AppDialogContext.Provider>
}
