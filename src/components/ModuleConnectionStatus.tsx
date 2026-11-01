import { useEffect, useState } from 'react'
import { LoaderCircle, Wifi, WifiOff } from 'lucide-react'

export type ModuleService = 'access' | 'audit' | 'backup' | 'maintenance' | 'nursing' | 'pharmacy' | 'social' | 'therapy' | 'xray'

type ConnectionState = 'checking' | 'connected' | 'unavailable'

export default function ModuleConnectionStatus({ service }: { service: ModuleService }) {
  const [state, setState] = useState<ConnectionState>('checking')

  useEffect(() => {
    let active = true
    let controller: AbortController | null = null

    async function checkConnection() {
      controller?.abort()
      const requestController = new AbortController()
      controller = requestController
      setState('checking')
      try {
        const response = await fetch(`/api/v1/health/${service}`, {
          cache: 'no-store',
          signal: requestController.signal,
        })
        if (!response.ok) throw new Error(`Health check retornou HTTP ${response.status}`)
        const result: unknown = await response.json()
        if (
          !result
          || typeof result !== 'object'
          || !('service' in result)
          || result.service !== service
          || !('status' in result)
          || result.status !== 'ok'
        ) {
          throw new Error('Health check retornou estado inesperado')
        }
        if (active) setState('connected')
      } catch {
        if (active && !requestController.signal.aborted) setState('unavailable')
      }
    }

    const timer = window.setTimeout(() => void checkConnection(), 0)
    const interval = window.setInterval(() => void checkConnection(), 30_000)
    const reconnect = () => void checkConnection()
    const disconnect = () => setState('unavailable')
    window.addEventListener('online', reconnect)
    window.addEventListener('offline', disconnect)
    return () => {
      active = false
      window.clearTimeout(timer)
      window.clearInterval(interval)
      window.removeEventListener('online', reconnect)
      window.removeEventListener('offline', disconnect)
      controller?.abort()
    }
  }, [service])

  const label = state === 'checking'
    ? 'Verificando serviço'
    : state === 'connected'
      ? 'Serviço conectado'
      : 'Serviço indisponível'
  const Icon = state === 'checking' ? LoaderCircle : state === 'connected' ? Wifi : WifiOff

  return <span className={`module-connection-status is-${state}`} role="status" aria-live="polite">
    <Icon size={15} aria-hidden="true" />
    <span>{label}</span>
  </span>
}
