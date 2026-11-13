// Messages and own files in IndexedDB. The core keeps its state in localStorage (WebStorage); the web app
// keeps the history itself, like the app its MessageStore. Under `blobs` lies content that the browser
// sent itself (attachments, own picture), so that it stays visible without the relays and can be sent again.
// Under `core` lie the files of the core (WebBlobStore: alerts, pending uploads), only encrypted.
import type { WebBlobStore } from 'anmp-core'
import type { Msg, PendingDelete } from './messages'

const DB = 'web'
const MESSAGES = 'messages'
const BLOBS = 'blobs'
const CORE = 'core'
/** Deletions whose message is still missing (ADR 0068), 30 days. */
const DELETES = 'deletes'

export interface MessageDb {
  all(): Promise<Msg[]>
  put(list: Msg[]): Promise<void>
  remove(ids: string[]): Promise<void>
  clear(): Promise<void>
  getBlob(key: string): Promise<Uint8Array | undefined>
  putBlob(key: string, bytes: Uint8Array): Promise<void>
  removeBlob(key: string): Promise<void>
  pendingDeletes(): Promise<PendingDelete[]>
  putPendingDelete(p: PendingDelete): Promise<void>
  removePendingDeletes(ids: string[]): Promise<void>
  /** Files of the core; without them e.g. the alerts would be gone after a reload. */
  core: WebBlobStore
}

export function openMessageDb(factory: IDBFactory = indexedDB): Promise<MessageDb> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB, 4)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(MESSAGES)) db.createObjectStore(MESSAGES, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS)
      if (!db.objectStoreNames.contains(CORE)) db.createObjectStore(CORE)
      if (!db.objectStoreNames.contains(DELETES)) db.createObjectStore(DELETES, { keyPath: 'id' })
    }
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(wrap(req.result))
  })
}

function wrap(db: IDBDatabase): MessageDb {
  function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode)
      const r = run(t.objectStore(store))
      t.oncomplete = () => resolve(r ? r.result : undefined)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  }
  return {
    all: async () => ((await tx(MESSAGES, 'readonly', (s) => s.getAll())) as Msg[] | undefined) ?? [],
    put: async (list) => {
      if (list.length) await tx(MESSAGES, 'readwrite', (s) => void list.forEach((m) => s.put(m)))
    },
    remove: async (ids) => {
      if (ids.length) await tx(MESSAGES, 'readwrite', (s) => void ids.forEach((id) => s.delete(id)))
    },
    clear: async () => {
      await tx(MESSAGES, 'readwrite', (s) => s.clear())
      await tx(BLOBS, 'readwrite', (s) => s.clear())
      await tx(DELETES, 'readwrite', (s) => s.clear())
    },
    getBlob: async (key) => (await tx(BLOBS, 'readonly', (s) => s.get(key))) as Uint8Array | undefined,
    putBlob: async (key, bytes) => void (await tx(BLOBS, 'readwrite', (s) => s.put(bytes, key))),
    removeBlob: async (key) => void (await tx(BLOBS, 'readwrite', (s) => s.delete(key))),
    pendingDeletes: async () => ((await tx(DELETES, 'readonly', (s) => s.getAll())) as PendingDelete[] | undefined) ?? [],
    putPendingDelete: async (p) => void (await tx(DELETES, 'readwrite', (s) => s.put(p))),
    removePendingDeletes: async (ids) => {
      if (ids.length) await tx(DELETES, 'readwrite', (s) => void ids.forEach((id) => s.delete(id)))
    },
    core: {
      read: async (name: string) => {
        const bytes = (await tx(CORE, 'readonly', (s) => s.get(name))) as Uint8Array | undefined
        return bytes ? new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null
      },
      write: async (name: string, bytes: Int8Array) => void (await tx(CORE, 'readwrite', (s) => s.put(new Uint8Array(bytes), name))),
      delete: async (name: string) => void (await tx(CORE, 'readwrite', (s) => s.delete(name))),
    } as unknown as WebBlobStore,
  }
}

/** Deletes the database entirely (delete anynear in this browser). */
export function deleteMessageDb(factory: IDBFactory = indexedDB): Promise<void> {
  return new Promise((resolve) => {
    const req = factory.deleteDatabase(DB)
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
}
