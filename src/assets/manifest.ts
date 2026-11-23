/** 资产清单：路径只在这里出现，玩法代码只认 id。 */
export type AssetId = 'studio.room'

export interface AssetEntry {
  readonly id: AssetId
  readonly url: string
  readonly license: string
  readonly source: string
}

export const assets: Record<AssetId, AssetEntry> = {
  'studio.room': {
    id: 'studio.room',
    url: 'assets/studio/basement-workshop.glb',
    license: 'CC0',
    source: 'https://grab3d.com/models/tools/basement-workshop/',
  },
}

export function assetId(id: AssetId): AssetEntry {
  const entry = assets[id]
  if (!entry) throw new Error(`未注册的资产：${id}`)
  return entry
}
