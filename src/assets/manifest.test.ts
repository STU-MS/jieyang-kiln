import { describe, expect, it } from 'vitest'
import { assets, assetId, type AssetId } from './manifest'

describe('资产清单', () => {
  it('每个 id 都能取到，且 url 以 assets/ 开头', () => {
    for (const id of Object.keys(assets) as AssetId[]) {
      const entry = assetId(id)
      expect(entry.url.startsWith('assets/')).toBe(true)
    }
  })

  it('未注册的 id 抛错', () => {
    expect(() => assetId('no.such' as AssetId)).toThrow()
  })
})
