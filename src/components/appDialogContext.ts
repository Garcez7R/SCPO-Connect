import { createContext, useContext } from 'react'

export type AppDialogActions = {
  alert: (message: string, title?: string) => Promise<void>
  confirm: (message: string, title?: string) => Promise<boolean>
  prompt: (message: string, title?: string, inputLabel?: string) => Promise<string | null>
}

export const AppDialogContext = createContext<AppDialogActions | null>(null)

export function useAppDialogs() {
  const context = useContext(AppDialogContext)
  if (!context) throw new Error('useAppDialogs deve ser usado dentro de AppDialogProvider.')
  return context
}
