const databaseName = 'scpo-connect-offline-vault'
const objectStoreName = 'user-vaults'
const databaseVersion = 1

type VaultRecord = {
  userId: string
  key: CryptoKey
  iv: ArrayBuffer
  ciphertext: ArrayBuffer
  updatedAt: number
}

export type OfflineVault<T> = {
  payload: T
  updatedAt: number
}

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in window) || !('crypto' in window) || !crypto.subtle) {
    return Promise.reject(new Error('Este aparelho ou navegador não oferece armazenamento offline cifrado compatível.'))
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(objectStoreName, { keyPath: 'userId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o armazenamento offline.'))
    request.onblocked = () => reject(new Error('Feche outras janelas do SCPO Connect para atualizar o armazenamento offline.'))
  })
}

function readRecord(db: IDBDatabase, userId: string): Promise<VaultRecord | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(objectStoreName, 'readonly').objectStore(objectStoreName).get(userId)
    request.onsuccess = () => resolve(request.result as VaultRecord | undefined)
    request.onerror = () => reject(request.error ?? new Error('Não foi possível ler a fila offline.'))
  })
}

function writeRecord(db: IDBDatabase, record: VaultRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(objectStoreName, 'readwrite')
    transaction.objectStore(objectStoreName).put(record)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível proteger os dados offline.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('O armazenamento offline foi interrompido.'))
  })
}

export async function readOfflineVault<T>(userId: string): Promise<OfflineVault<T> | null> {
  const db = await openDatabase()
  try {
    const record = await readRecord(db, userId)
    if (!record) return null
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv, additionalData: new TextEncoder().encode(userId) },
      record.key,
      record.ciphertext,
    )
    return { payload: JSON.parse(new TextDecoder().decode(plaintext)) as T, updatedAt: record.updatedAt }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'OperationError') {
      throw new Error('A fila offline não pôde ser decifrada. Reconecte ao servidor e entre novamente com sua conta.', { cause: error })
    }
    throw error
  } finally {
    db.close()
  }
}

export async function writeOfflineVault<T>(userId: string, payload: T): Promise<void> {
  const db = await openDatabase()
  try {
    const previous = await readRecord(db, userId)
    const key = previous?.key ?? await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const plaintext = new TextEncoder().encode(JSON.stringify(payload))
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(userId) },
      key,
      plaintext,
    )
    await writeRecord(db, {
      userId,
      key,
      iv: iv.buffer,
      ciphertext,
      updatedAt: Date.now(),
    })
  } finally {
    db.close()
  }
}

export async function removeOfflineVault(userId: string): Promise<void> {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(objectStoreName, 'readwrite')
      transaction.objectStore(objectStoreName).delete(userId)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível apagar os dados offline.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('A exclusão do armazenamento offline foi interrompida.'))
    })
  } finally {
    db.close()
  }
}
