import { SCHEMA_VERSION } from './schema'
import type { CupSnapshot } from './types'

export function encodeCup(snapshot: CupSnapshot): string {
  const json = JSON.stringify(snapshot)
  const bytes = new TextEncoder().encode(json)
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function decodeCup(code: string): CupSnapshot | null {
  try {
    const padded = code.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((code.length + 3) % 4)
    const bin = atob(padded)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as CupSnapshot
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) return null
    if (!parsed.result?.uniqueId || !Array.isArray(parsed.radii) || parsed.radii.length < 8) return null
    if (!parsed.clay || !parsed.glaze || !parsed.fire) return null
    return parsed
  } catch {
    return null
  }
}
