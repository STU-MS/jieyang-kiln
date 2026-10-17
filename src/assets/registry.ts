import { getEntry, type ManifestEntry } from './manifest'

export interface ResolvedAsset {
  id: string
  type: ManifestEntry['placeholder']['type'] | 'image'
  value: string
  url?: string
  missing: boolean
}

const warned = new Set<string>()

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(message)
}

export function assetId(id: string): string {
  if (!getEntry(id)) warnOnce(`unknown:${id}`, `[assets] 未知资产 id：${id}`)
  return id
}

export function resolveSync(id: string): ResolvedAsset {
  const entry = getEntry(id)
  if (!entry) {
    warnOnce(`unknown:${id}`, `[assets] 未知资产 id：${id}`)
    return { id, type: 'color', value: '#C4B5A4', missing: true }
  }
  if (!entry.src) {
    warnOnce(`missing:${id}`, `[assets] 缺少正式文件，使用占位：${id}`)
    return { id, type: entry.placeholder.type, value: entry.placeholder.value, missing: true }
  }
  return { id, type: entry.placeholder.type, value: entry.placeholder.value, url: entry.src, missing: false }
}

export function colorOf(id: string): string {
  const resolved = resolveSync(id)
  return resolved.type === 'color' ? resolved.value : '#C4B5A4'
}

export function fontOf(id: string): string {
  const resolved = resolveSync(id)
  return resolved.type === 'font' ? resolved.value : 'system-ui, sans-serif'
}

export function svgOf(id: string): string {
  const resolved = resolveSync(id)
  return resolved.type === 'svg' ? resolved.value : ''
}

export async function resolveAsync(id: string): Promise<ResolvedAsset> {
  const sync = resolveSync(id)
  const entry = getEntry(id)
  if (!entry?.src) return sync
  try {
    const response = await fetch(entry.src)
    if (!response.ok) throw new Error(String(response.status))
    if (entry.kind === 'image' || entry.kind === 'texture' || entry.kind === 'decal') {
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      await checkSize(id, url, entry.expectedSize)
      return { id, type: 'image', value: url, url, missing: false }
    }
    return { ...sync, url: entry.src, missing: false }
  } catch {
    warnOnce(`load:${id}`, `[assets] 正式文件读取未成功，退回占位：${id}`)
    return { ...sync, missing: true }
  }
}

async function checkSize(id: string, url: string, expected?: [number, number]): Promise<void> {
  if (!expected) return
  const image = new Image()
  const size = await new Promise<{ w: number; h: number }>((resolve, reject) => {
    image.onload = () => resolve({ w: image.naturalWidth, h: image.naturalHeight })
    image.onerror = () => reject(new Error('image'))
    image.src = url
  })
  if (size.w !== expected[0] || size.h !== expected[1]) {
    warnOnce(`size:${id}`, `[assets] ${id} 分辨率为 ${size.w}×${size.h}，清单期望 ${expected[0]}×${expected[1]}，仍会显示`)
  }
}

export function touchAssetCatalog(): void {
  for (const entry of [getEntry('ui.bg.home'), getEntry('font.body'), getEntry('font.display')]) {
    if (entry) resolveSync(entry.id)
  }
}
