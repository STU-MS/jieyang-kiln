import { iconSvg } from './icons'

export type AssetKind = 'image' | 'texture' | 'model' | 'icon' | 'font' | 'audio' | 'decal' | 'sky'
export type PlaceholderType = 'color' | 'primitive' | 'svg' | 'font' | 'silent' | 'shader'

export interface ManifestEntry {
  id: string
  kind: AssetKind
  src?: string
  placeholder: { type: PlaceholderType; value: string }
  expectedSize?: [number, number]
}

function color(id: string, kind: AssetKind, value: string, expectedSize?: [number, number]): ManifestEntry {
  return { id, kind, placeholder: { type: 'color', value }, expectedSize }
}

function icon(id: string): ManifestEntry {
  return { id, kind: 'icon', placeholder: { type: 'svg', value: iconSvg[id] ?? '' } }
}

export const manifest: ManifestEntry[] = [
  color('ui.clay.diger', 'image', '#8C4030', [512, 512]),
  color('ui.clay.kaolin', 'image', '#C4B5A4', [512, 512]),
  color('ui.clay.aged', 'image', '#6E5344', [512, 512]),
  color('ui.glaze.qinghui', 'image', '#7E8B86', [256, 256]),
  color('ui.glaze.jianghe', 'image', '#6B3E2E', [256, 256]),
  color('ui.glaze.mihuang', 'image', '#C6A36A', [256, 256]),
  color('ui.glaze.tiexiu', 'image', '#8A4A32', [256, 256]),
  color('ui.glaze.caomu', 'image', '#9A8F78', [256, 256]),
  color('ui.glaze.wuguang', 'image', '#E6E0D6', [256, 256]),
  color('tex.clay.albedo', 'texture', '#8C4030', [1024, 1024]),
  color('tex.clay.normal', 'texture', '#8080FF', [1024, 1024]),
  color('tex.clay.roughness', 'texture', '#D9D0C4', [1024, 1024]),
  color('tex.bisque.albedo', 'texture', '#C4B5A4', [1024, 1024]),
  color('tex.bisque.normal', 'texture', '#8080FF', [1024, 1024]),
  color('tex.bisque.roughness', 'texture', '#E6E0D6', [1024, 1024]),
  { id: 'ui.portrait.master', kind: 'image', placeholder: { type: 'primitive', value: 'silhouette' }, expectedSize: [512, 768] },
  color('ui.bg.home', 'image', '#F3EEE6', [1600, 1000]),
  { id: 'font.body', kind: 'font', placeholder: { type: 'font', value: 'system-ui, "Segoe UI", sans-serif' } },
  { id: 'font.display', kind: 'font', placeholder: { type: 'font', value: '"Songti SC", "STSong", "SimSun", serif' } },
  { id: 'model.wheel', kind: 'model', placeholder: { type: 'primitive', value: 'cylinder' } },
  { id: 'model.rack', kind: 'model', placeholder: { type: 'primitive', value: 'rods' } },
  { id: 'model.kiln', kind: 'model', placeholder: { type: 'primitive', value: 'box' } },
  color('ui.share.frame', 'image', '#F3EEE6', [1080, 1440]),
  { id: 'decal.crack', kind: 'decal', placeholder: { type: 'shader', value: 'crack' } },
  { id: 'decal.chip', kind: 'decal', placeholder: { type: 'shader', value: 'chip' } },
  { id: 'decal.crazing', kind: 'decal', placeholder: { type: 'shader', value: 'crazing' } },
  { id: 'decal.smoke', kind: 'decal', placeholder: { type: 'shader', value: 'smoke' } },
  { id: 'decal.pinhole', kind: 'decal', placeholder: { type: 'shader', value: 'pinhole' } },
  icon('icon.place.vent'),
  icon('icon.place.shade'),
  icon('icon.place.sun'),
  icon('icon.action.flip'),
  icon('icon.action.cover'),
  icon('icon.action.cloth'),
  icon('icon.action.rack'),
  icon('icon.action.fan'),
  icon('icon.action.cotton'),
  icon('icon.action.damper'),
  icon('icon.weather.sunny'),
  icon('icon.weather.cloudy'),
  icon('icon.weather.overcast'),
  icon('icon.weather.rain'),
  icon('icon.weather.returningSouth'),
  icon('icon.weather.coldAir'),
  icon('icon.lock'),
  color('env.sky.sunny', 'sky', '#E7D3B0'),
  color('env.sky.cloudy', 'sky', '#D9D0C4'),
  color('env.sky.overcast', 'sky', '#C9C1B6'),
  color('env.sky.rain', 'sky', '#B7B8B4'),
  color('env.sky.returningSouth', 'sky', '#C4C8C0'),
  color('env.sky.coldAir', 'sky', '#D5D8DC'),
  { id: 'audio.sfx.knead', kind: 'audio', placeholder: { type: 'silent', value: 'silent' } },
  { id: 'audio.sfx.wheel', kind: 'audio', placeholder: { type: 'silent', value: 'silent' } },
  { id: 'audio.sfx.tool', kind: 'audio', placeholder: { type: 'silent', value: 'silent' } },
  { id: 'audio.sfx.kiln', kind: 'audio', placeholder: { type: 'silent', value: 'silent' } },
  { id: 'audio.sfx.open', kind: 'audio', placeholder: { type: 'silent', value: 'silent' } },
  { id: 'audio.sfx.warn', kind: 'audio', placeholder: { type: 'silent', value: 'silent' } },
  { id: 'audio.voice.master', kind: 'audio', placeholder: { type: 'silent', value: 'silent' } },
]

export const referencedAssetIds = manifest.map((entry) => entry.id)

const byId = new Map(manifest.map((entry) => [entry.id, entry]))

export function getEntry(id: string): ManifestEntry | undefined {
  return byId.get(id)
}
