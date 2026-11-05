import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type ToastVariant = 'error' | 'info' | 'success'

let toastRoot: HTMLDivElement | null = null

function getToastRoot() {
  if (!toastRoot || !toastRoot.isConnected) {
    toastRoot = document.createElement('div')
    toastRoot.id = 'toast-root'
    document.body.appendChild(toastRoot)
  }
  return toastRoot
}

export default function ToastMessage({
  children,
  variant,
  persistent = false,
  progress,
  progressLabel = 'Progresso da operação',
  actionLabel,
  onAction,
}: {
  children: string
  variant: ToastVariant
  persistent?: boolean
  progress?: number | null
  progressLabel?: string
  actionLabel?: string
  onAction?: () => void
}) {
  const [root] = useState(getToastRoot)
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null)

  useEffect(() => {
    if (persistent || variant === 'error') return
    const timeout = window.setTimeout(() => setDismissedMessage(children), 6000)
    return () => window.clearTimeout(timeout)
  }, [children, persistent, variant])

  if (dismissedMessage === children) return null
  return createPortal(
    <div className={`toast-message toast-message-${variant}`} role={variant === 'error' ? 'alert' : 'status'}>
      <img className="toast-message-icon" src="/scpo-connect-icon.png" alt="" aria-hidden="true" />
      <div className="toast-message-body">
        <div>{children}</div>
        {progress !== undefined && <div
          className={`backup-operation-progress ${progress === null ? 'is-indeterminate' : ''}`}
          role="progressbar"
          aria-label={progressLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress ?? undefined}
          aria-valuetext={progress === null ? children : `${progress}%`}
        >
          <span style={progress === null ? undefined : { width: `${progress}%` }} />
        </div>}
      </div>
      {actionLabel && onAction && <button type="button" onClick={onAction}>{actionLabel}</button>}
      {!persistent && !actionLabel && <button type="button" aria-label="Fechar notificação" onClick={() => setDismissedMessage(children)}>Fechar</button>}
    </div>,
    root,
  )
}
