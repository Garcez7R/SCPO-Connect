import { createContext, useContext, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

export const PageNavigationContext = createContext<(label: string | null) => void>(() => {})

function readStoredTab<T extends string>(storageKey: string, values: readonly T[], defaultValue: T): T {
  try {
    const storedValue = window.sessionStorage.getItem(storageKey)
    return values.find((value) => value === storedValue) ?? defaultValue
  } catch (error) {
    console.warn('A preferência da aba não pôde ser lida nesta sessão.', error)
    return defaultValue
  }
}

export function usePersistentTab<T extends string>(
  storageKey: string,
  defaultValue: T,
  values: readonly T[],
  labels: Record<T, string>,
  showInBreadcrumb = true,
): [T, Dispatch<SetStateAction<T>>] {
  const setActiveTabLabel = useContext(PageNavigationContext)
  const [storedTab, setTab] = useState<T>(() => readStoredTab(storageKey, values, defaultValue))
  const tab = values.includes(storedTab) ? storedTab : defaultValue

  useEffect(() => {
    if (showInBreadcrumb) setActiveTabLabel(labels[tab])
    try {
      window.sessionStorage.setItem(storageKey, tab)
    } catch (error) {
      console.warn('A preferência da aba não pôde ser salva nesta sessão.', error)
    }
  }, [labels, setActiveTabLabel, showInBreadcrumb, storageKey, tab])

  useEffect(() => {
    if (!showInBreadcrumb) return
    return () => setActiveTabLabel(null)
  }, [setActiveTabLabel, showInBreadcrumb])

  return [tab, setTab]
}
