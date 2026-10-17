const memory = new Map<string, { albedo: HTMLCanvasElement; roughness: HTMLCanvasElement; used: number }>()
const LIMIT = 32

export function getMemoryTexture(id: string): { albedo: HTMLCanvasElement; roughness: HTMLCanvasElement } | null {
  const found = memory.get(id)
  if (!found) return null
  found.used = Date.now()
  return found
}

export function rememberTexture(id: string, albedo: HTMLCanvasElement, roughness: HTMLCanvasElement): void {
  memory.set(id, { albedo, roughness, used: Date.now() })
  if (memory.size <= LIMIT) {
    void persist(id, albedo, roughness)
    return
  }
  let oldest = ''
  let time = Infinity
  for (const [key, value] of memory) {
    if (value.used < time) {
      time = value.used
      oldest = key
    }
  }
  if (oldest) memory.delete(oldest)
  void persist(id, albedo, roughness)
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('jieyang-ceramic', 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('textures')) db.createObjectStore('textures')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function persist(id: string, albedo: HTMLCanvasElement, roughness: HTMLCanvasElement): Promise<void> {
  const db = await openDb()
  if (!db) return
  const albedoBlob = await blobOf(albedo)
  const roughBlob = await blobOf(roughness)
  if (!albedoBlob || !roughBlob) return
  await new Promise<void>((resolve) => {
    const tx = db.transaction('textures', 'readwrite')
    tx.objectStore('textures').put({ albedoBlob, roughBlob, used: Date.now() }, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
  await trimDb(db)
}

function blobOf(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
}

async function trimDb(db: IDBDatabase): Promise<void> {
  const rows = await new Promise<{ id: string; used: number }[]>((resolve) => {
    const tx = db.transaction('textures', 'readonly')
    const req = tx.objectStore('textures').openCursor()
    const list: { id: string; used: number }[] = []
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) {
        resolve(list)
        return
      }
      const value = cursor.value as { used?: number }
      list.push({ id: String(cursor.key), used: value.used ?? 0 })
      cursor.continue()
    }
    req.onerror = () => resolve(list)
  })
  if (rows.length <= LIMIT) return
  rows.sort((a, b) => a.used - b.used)
  const extra = rows.slice(0, rows.length - LIMIT)
  await new Promise<void>((resolve) => {
    const tx = db.transaction('textures', 'readwrite')
    const store = tx.objectStore('textures')
    for (const row of extra) store.delete(row.id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export async function loadTexture(id: string): Promise<{ albedo: HTMLCanvasElement; roughness: HTMLCanvasElement } | null> {
  const cached = getMemoryTexture(id)
  if (cached) return cached
  const db = await openDb()
  if (!db) return null
  const row = await new Promise<{ albedoBlob: Blob; roughBlob: Blob } | null>((resolve) => {
    const tx = db.transaction('textures', 'readonly')
    const req = tx.objectStore('textures').get(id)
    req.onsuccess = () => resolve((req.result as { albedoBlob: Blob; roughBlob: Blob } | undefined) ?? null)
    req.onerror = () => resolve(null)
  })
  if (!row) return null
  const albedo = await blobToCanvas(row.albedoBlob)
  const roughness = await blobToCanvas(row.roughBlob)
  if (!albedo || !roughness) return null
  rememberTexture(id, albedo, roughness)
  return { albedo, roughness }
}

function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')
      ctx?.drawImage(image, 0, 0)
      URL.revokeObjectURL(url)
      resolve(canvas)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    image.src = url
  })
}
