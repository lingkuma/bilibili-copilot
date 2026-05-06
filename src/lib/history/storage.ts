import type { HistoryThread, HistoryThreadSummary } from './types'
import type { ResolvedVideo } from '../types'

const DB_NAME = 'bilibili-copilot-history'
const DB_VERSION = 1
const THREAD_STORE = 'threads'

let dbPromise: Promise<IDBDatabase> | null = null

export const createHistoryThreadId = (video: ResolvedVideo) => {
  return `${video.bvid}:p${video.page}:cid${video.cid}`
}

export const saveHistoryThread = async (thread: HistoryThread) => {
  const db = await openHistoryDb()
  await runTransaction(db, THREAD_STORE, 'readwrite', store => {
    store.put(thread)
  })
}

export const getHistoryThread = async (id: string) => {
  const db = await openHistoryDb()
  return new Promise<HistoryThread | null>((resolve, reject) => {
    const request = db
      .transaction(THREAD_STORE, 'readonly')
      .objectStore(THREAD_STORE)
      .get(id)

    request.onsuccess = () => {
      resolve((request.result as HistoryThread | undefined) ?? null)
    }
    request.onerror = () => {
      reject(request.error)
    }
  })
}

export const listHistoryThreads = async () => {
  const db = await openHistoryDb()
  return new Promise<HistoryThreadSummary[]>((resolve, reject) => {
    const request = db
      .transaction(THREAD_STORE, 'readonly')
      .objectStore(THREAD_STORE)
      .getAll()

    request.onsuccess = () => {
      const threads = (request.result as HistoryThread[])
        .map(thread => ({
          id: thread.id,
          video: thread.video,
          entryCount: thread.entries.length,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
        }))
        .sort((left, right) => right.updatedAt - left.updatedAt)
      resolve(threads)
    }
    request.onerror = () => {
      reject(request.error)
    }
  })
}

export const deleteHistoryThread = async (id: string) => {
  const db = await openHistoryDb()
  await runTransaction(db, THREAD_STORE, 'readwrite', store => {
    store.delete(id)
  })
}

const openHistoryDb = () => {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(THREAD_STORE)) {
        db.createObjectStore(THREAD_STORE, {
          keyPath: 'id',
        })
      }
    }

    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(request.error)
    }
  })

  return dbPromise
}

const runTransaction = (
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => void,
) => {
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    action(transaction.objectStore(storeName))

    transaction.oncomplete = () => {
      resolve()
    }
    transaction.onerror = () => {
      reject(transaction.error)
    }
    transaction.onabort = () => {
      reject(transaction.error)
    }
  })
}

