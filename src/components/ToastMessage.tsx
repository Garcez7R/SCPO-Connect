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

export default function ToastMessage({ children, variant }: { children: string; variant: ToastVariant }) {
  const [root] = useState(getToastRoot)
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null)

  useEffect(() => {
    if (variant === 'error') return
    const timeout = window.setTimeout(() => setDismissedMessage(children), 6000)
    return () => window.clearTimeout(timeout)
  }, [children, variant])

  if (dismissedMessage === children) return null
  return createPortal(
    <div className={`toast-message toast-message-${variant}`} role={variant === 'error' ? 'alert' : 'status'}>
      <div>{children}</div>
      <button type="button" aria-label="Fechar notificação" onClick={() => setDismissedMessage(children)}>Fechar</button>
    </div>,
    root,
  )
}
