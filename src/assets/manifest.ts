/** 资产清单：路径只在这里出现，玩法代码只认 id。 */
export type AssetId = 'studio.room' | 'clay.albedo' | 'body.clay'

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
  // 人物基础网格：kblood/CharacterCreator 的 MakeHuman CC0 导出，再用 tools/build-body.mjs 裁掉贴图、
  // 五官小件与用不到的 morph（裁剪后 1.6 MB / gzip 821 KB，20 个 morph、53 根骨、带 UV）。
  // 许可依据该仓库 LICENSE-NOTES.md：output/ 下 GLB 与 joints 侧车为 CC0-1.0，GPL 只覆盖代码，不取代码。
  'body.clay': {
    id: 'body.clay',
    url: 'assets/body/clay-body.glb',
    license: 'CC0-1.0',
    source: 'https://github.com/kblood/CharacterCreator/blob/852e48f316b90a0937234886630e4fb4cdfd1f78/output/base_body.glb',
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
