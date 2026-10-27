import { createContext, useContext, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

export type BreadcrumbUpdate = (id: string, label: string | null, depth?: number) => void

export const PageNavigationContext = createContext<BreadcrumbUpdate>(() => {})

export function useBreadcrumb(id: string, label: string | null, depth = 1): void {
  const setBreadcrumb = useContext(PageNavigationContext)
  useEffect(() => {
    setBreadcrumb(id, label, depth)
    return () => setBreadcrumb(id, null, depth)
  }, [depth, id, label, setBreadcrumb])
}

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
  breadcrumbDepth = 1,
): [T, Dispatch<SetStateAction<T>>] {
  const [storedTab, setTab] = useState<T>(() => readStoredTab(storageKey, values, defaultValue))
  const tab = values.includes(storedTab) ? storedTab : defaultValue

  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey, tab)
    } catch (error) {
      console.warn('A preferência da aba não pôde ser salva nesta sessão.', error)
    }
  }, [storageKey, tab])
  useBreadcrumb(storageKey, showInBreadcrumb ? labels[tab] : null, breadcrumbDepth)

  return [tab, setTab]
}
