/** 资产清单：路径只在这里出现，玩法代码只认 id。 */
export type AssetId = 'studio.room' | 'clay.albedo'

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
  // 湿泥表面贴图：Poly Haven「clay_plaster」原图 1K 缩到 512，只取漫反射（18 KB）
  'clay.albedo': {
    id: 'clay.albedo',
    url: 'assets/clay/wet-clay-albedo.jpg',
    license: 'CC0',
    source: 'https://polyhaven.com/a/clay_plaster',
  },
}

export function assetId(id: AssetId): AssetEntry {
  const entry = assets[id]
  if (!entry) throw new Error(`未注册的资产：${id}`)
  return entry
}
