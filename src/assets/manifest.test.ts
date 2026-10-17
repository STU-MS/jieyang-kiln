import { describe, expect, it } from 'vitest'
import { collectProblems } from './check'

describe('资产与文案清单校验', () => {
  it('清单、名称和禁用词全部对齐', () => {
    expect(collectProblems()).toEqual([])
  })
})
