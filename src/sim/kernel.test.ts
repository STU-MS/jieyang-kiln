import { describe, expect, it } from 'vitest'
import clayData from '../data/clay.json'
import climate from '../data/climate.json'
import difficulty from '../data/difficulty.json'
import { mixClay } from './clay'
import { createClock, registerFrame } from './clock'
import { bandWidth, dryingSeconds, seasonOf } from './drying'
import { applyEvent, catalogEvents, EVENT_ACTIONS, planStageEvents } from './events'
import { createRun, finishFire, finishThrow, retryStage, skipStage, withClay } from './flow'
import { beginFire, snapshotOf } from './flow'
import { generateTexture, textureHash } from './kilnTexture'
import { migrate } from './migrate'
import { emptyProfile } from './profile'
import { decodeCup, encodeCup } from './share'
import { contactPush, FINGER_RADIUS, fingerSectors, ghostRadii, matchesTarget, measuredWallVolume, pressProtrusion, shapeSector, shapeWall, smoothWall, stability, stepThrow, stepWall, THROW_SECTORS, touchFromOutside, wallFromRadii, wallShell, wallVolume } from './throwing'

describe('配泥公式', () => {
  it('开局偏硬，补三团高岭土后可塑性进区且其余指标仍达标', () => {
    expect(clayData.formula.P).toEqual({ kaolin: 0.9, aged: 0.35, water: 0.45, bias: -0.28 })
    expect(clayData.formula.H).toEqual({ diger: 0.5, water: -0.32, humidity: -0.05 })
    const start = clayData.initial
    const before = mixClay({ diger: start.diger, kaolin: start.kaolin, aged: start.aged }, start.water, 66, 0.5)
    expect(before.P).toBeLessThan(clayData.sweet.P[0])
    expect(before.H).toBeGreaterThanOrEqual(clayData.sweet.H[0])
    expect(before.H).toBeLessThanOrEqual(clayData.sweet.H[1])
    const after = mixClay({ diger: start.diger, kaolin: start.kaolin + 15, aged: start.aged }, start.water, 66, 0.5)
    expect(after.quality).toBe('excellent')
    expect(after.I).toBeGreaterThanOrEqual(0.25)
    expect(after.I).toBeLessThanOrEqual(0.5)
    expect(after.C).toBeGreaterThanOrEqual(180)
    expect(after.C).toBeLessThanOrEqual(280)
  })

  it('水量为 0 时判为勉强，但仍给出数值', () => {
    const clay = mixClay({ diger: 30, kaolin: 45, aged: 25 }, 0, 66, 0.5)
    expect(clay.waterZero).toBe(true)
    expect(clay.quality).toBe('poor')
    expect(clay.P).toBeGreaterThan(0)
  })

  it('推荐配方在秋季湿度下落在优', () => {
    const recipe = clayData.recommended
    const clay = mixClay(recipe, recipe.water, 66, 0.5)
    expect(clay.quality).toBe('excellent')
  })
})

describe('稳定性', () => {
  const com = { hCenter: 0.5, mouthRadius: 0.7, steady: 0 }

  it('高含水高速时 S 低于 -2', () => {
    const clay = mixClay({ diger: 10, kaolin: 10, aged: 10 }, 40, 66, 0.5)
    const s = stability({
      P: clay.P,
      rpm: 800,
      waterNorm: 1,
      ...com,
      poor: clay.quality === 'poor',
      waterZero: false,
    })
    expect(s).toBeLessThan(difficulty.totalCollapseS)
  })

  it('不加水又高速时 S 低于 0', () => {
    const clay = mixClay({ diger: 30, kaolin: 45, aged: 25 }, 0, 66, 0.5)
    const s = stability({
      P: clay.P,
      rpm: 800,
      waterNorm: 0,
      ...com,
      poor: true,
      waterZero: true,
    })
    expect(s).toBeLessThan(0)
  })

  it('合适配方低速时 S 为正', () => {
    const recipe = clayData.recommended
    const clay = mixClay(recipe, recipe.water, 66, 0.5)
    const s = stability({
      P: clay.P,
      rpm: 320,
      waterNorm: recipe.water / clayData.waterMax,
      ...com,
      poor: false,
      waterZero: false,
    })
    expect(s).toBeGreaterThan(0.2)
  })
})

describe('阴干耦合', () => {
  it('湿度每升高 10%，时长乘 1.08，带宽乘 0.85', () => {
    expect(dryingSeconds(100, 80, 70)).toBeCloseTo(108, 5)
    expect(dryingSeconds(100, 90, 70)).toBeCloseTo(100 * 1.08 * 1.08, 5)
    expect(bandWidth(100, 80, 70)).toBeCloseTo(85, 5)
    expect(climate.referenceHumidity).toBe(70)
  })

  it('月份落入揭阳季节', () => {
    expect(seasonOf(4)).toBe('spring')
    expect(seasonOf(6)).toBe('preFlood')
    expect(seasonOf(8)).toBe('summer')
    expect(seasonOf(10)).toBe('autumn')
    expect(seasonOf(1)).toBe('winter')
    expect(seasonOf(12)).toBe('winter')
  })
})

describe('事件', () => {
  it('十六条事件都落在封闭动作集合里', () => {
    const events = catalogEvents()
    expect(events).toHaveLength(16)
    const used = new Set(events.map((event) => event.action))
    for (const action of EVENT_ACTIONS) expect(used.has(action)).toBe(true)
    expect(events.filter((event) => event.playerTriggered).map((event) => event.id).sort()).toEqual(['e12', 'e5'])
  })

  it('随机事件次数不越界，且不含玩家误用', () => {
    for (let seed = 1; seed <= 80; seed++) {
      for (const phase of ['dry', 'bisque', 'fire'] as const) {
        for (const novice of [false, true]) {
          const planned = planStageEvents({
            seed,
            phase,
            season: 'autumn',
            weather: 'sunny',
            novice,
            practice: false,
            salt: `t${seed}`,
          })
          expect(planned.length).toBeLessThanOrEqual(difficulty.maxEvents[phase])
          expect(planned.every((event) => !event.playerTriggered)).toBe(true)
          expect(new Set(planned.map((event) => event.id)).size).toBe(planned.length)
        }
      }
    }
  })

  it('练习模式没有随机事件', () => {
    const planned = planStageEvents({
      seed: 3,
      phase: 'dry',
      season: 'summer',
      weather: 'rain',
      novice: false,
      practice: true,
      salt: 'p',
    })
    expect(planned).toEqual([])
  })

  it('同一事件的应对会写入操作盐', () => {
    const run = createRun(9, 10, false)
    const event = catalogEvents().find((item) => item.id === 'e1')
    expect(event).toBeTruthy()
    const next = applyEvent({ ...run, dry: emptyDry(run), bisque: emptyBisque() }, event!, false)
    expect(next.ops.at(-1)).toBe('e1:miss')
    expect(next.flaws.some((flaw) => flaw.id === 'wet-mouth')).toBe(true)
  })
})

describe('时钟与降档', () => {
  it('后台间隔不追帧', () => {
    let now = 0
    let hidden = false
    const clock = createClock({
      now: () => now,
      hidden: () => hidden,
    })
    now = 100
    expect(clock.delta().dt).toBeCloseTo(0.1, 5)
    hidden = true
    clock.sync()
    now = 10000
    expect(clock.delta().dt).toBe(0)
    hidden = false
    clock.sync()
    const resumed = clock.delta()
    expect(resumed.dt).toBe(0)
    expect(resumed.resumed).toBe(true)
    now = 10032
    expect(clock.delta().dt).toBeCloseTo(0.032, 3)
  })

  it('连续三帧超时就降一档', () => {
    let streak = 0
    let quality: 'high' | 'low' = 'high'
    for (let i = 0; i < 3; i++) {
      const next = registerFrame(streak, 60, quality, 50, 3)
      streak = next.streak
      quality = next.quality
    }
    expect(quality).toBe('low')
  })
})

describe('存档与分享', () => {
  it('坏存档降级并赠送三张知识卡', () => {
    const broken = migrate({ schemaVersion: 99, profile: emptyProfile(), run: null })
    expect(broken.gifted).toBe(true)
    expect(broken.save.run).toBeNull()
    expect(broken.save.profile.knowledgeCardIds).toHaveLength(3)
    expect(migrate('nope').gifted).toBe(true)
    expect(migrate(null).gifted).toBe(false)
  })

  it('同一链接还原同一只杯', () => {
    const state = scriptedCup(11)
    const shot = snapshotOf(state)
    expect(shot).toBeTruthy()
    const again = decodeCup(encodeCup(shot!))
    expect(again?.result.uniqueId).toBe(shot?.result.uniqueId)
    expect(again?.result.signature).toBe(shot?.result.signature)
    expect(again?.radii).toEqual(shot?.radii)
  })
})

describe('窑变唯一', () => {
  it('同一输入得到同一结果', () => {
    const a = scriptedCup(21)
    const b = scriptedCup(21)
    expect(a.result?.signature).toBe(b.result?.signature)
  })

  it('连续 1000 个种子没有完全同款', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 1000; seed++) {
      const cup = scriptedCup(seed)
      expect(cup.result?.stuck).toBe(false)
      expect(cup.result?.shattered).toBe(false)
      seen.add(cup.result!.signature)
    }
    expect(seen.size).toBe(1000)
  })

  it('不同种子的贴图像素不同，同一参数可复现', () => {
    const hashes = new Set<string>()
    for (let seed = 1; seed <= 40; seed++) {
      const cup = scriptedCup(seed)
      const painted = generateTexture(paint(cup.result!, seed), 24)
      const again = generateTexture(paint(cup.result!, seed), 24)
      expect(textureHash(painted.albedo)).toBe(textureHash(again.albedo))
      hashes.add(textureHash(painted.albedo))
    }
    expect(hashes.size).toBe(40)
  })

  it('1024 贴图在预算内生成', () => {
    const cup = scriptedCup(4)
    const started = Date.now()
    generateTexture(paint(cup.result!, 4), 1024)
    expect(Date.now() - started).toBeLessThan(difficulty.textureBudgetMs)
  })
})

describe('拉坯能完成，坏水土会垮', () => {
  it('推荐泥低速能在 60 秒内靠上目标', () => {
    const recipe = clayData.recommended
    const clay = mixClay(recipe, recipe.water, 66, 1)
    let radii = Array.from({ length: 64 }, () => 0.7)
    let steady = 0
    let localTime = 0
    let totalTime = 0
    let collapsed = false
    const rpm = 360
    for (let t = 0; t < 60; t += 0.05) {
      const step = stepThrow({
        radii,
        foot: 0.38,
        belly: 0.72,
        mouth: 1,
        rpm,
        rpmDelta: 0,
        dt: 0.05,
        waterNorm: recipe.water / 40,
        P: clay.P,
        poor: false,
        waterZero: false,
        steady,
        localTime,
        totalTime,
      })
      radii = step.radii
      steady = step.steady
      localTime = step.localTime
      totalTime = step.totalTime
      if (step.event === 'total') collapsed = true
      if (matchesTarget(radii)) break
    }
    expect(collapsed).toBe(false)
    expect(matchesTarget(radii)).toBe(true)
    expect(matchesTarget(ghostRadii())).toBe(true)
  })

  it('合适的泥低速放着不塌，太软又太快会当场塌', () => {
    const recipe = clayData.recommended
    const good = mixClay(recipe, recipe.water, 66, 1)
    const held = wallFromRadii(Array.from({ length: 64 }, () => 0.7))
    let collapsed = false
    for (let i = 0; i < 80; i++) {
      const step = stepWall(held, {
        dt: 0.05,
        rpm: 360,
        P: good.P,
        waterNorm: recipe.water / clayData.waterMax,
        poor: false,
        waterZero: false,
      })
      if (step.collapsed) collapsed = true
    }
    expect(collapsed).toBe(false)
    expect(held.y[held.y.length - 1]).toBeGreaterThan(0.95)
    expect(Math.max(...held.r)).toBeLessThan(0.78)

    const wet = mixClay({ diger: 10, kaolin: 10, aged: 10 }, 40, 66, 0.5)
    const soft = wallFromRadii(Array.from({ length: 64 }, () => 0.7))
    let failed = false
    for (let i = 0; i < 40; i++) {
      const step = stepWall(soft, {
        dt: 0.05,
        rpm: 800,
        P: wet.P,
        waterNorm: 1,
        poor: true,
        waterZero: false,
      })
      if (step.collapsed) failed = true
    }
    expect(failed).toBe(true)
  })

  it('形变和坍塌都不改变杯壁体积', () => {
    const recipe = clayData.recommended
    const good = mixClay(recipe, recipe.water, 66, 1)
    const wall = wallFromRadii(Array.from({ length: 64 }, () => 0.7))
    const before = wallVolume(wall)
    expect(measuredWallVolume(wall)).toBeCloseTo(before, 6)
    for (let i = 0; i < 30; i++) shapeWall(wall, 0.55, 0.012, 0.02)
    for (let i = 0; i < 40; i++) {
      stepWall(wall, {
        dt: 0.05,
        rpm: 800,
        P: good.P,
        waterNorm: recipe.water / clayData.waterMax,
        poor: false,
        waterZero: false,
      })
    }
    expect(wallVolume(wall)).toBeCloseTo(before, 8)
    expect(measuredWallVolume(wall)).toBeCloseTo(before, 6)
  })

  it('拖动把接触处的泥沿着手势带走', () => {
    const wall = wallFromRadii(Array.from({ length: 64 }, () => 0.7))
    const index = 40
    const r0 = wall.r[index]
    const y0 = wall.y[index]
    shapeWall(wall, y0, 0.05, 0.08)
    expect(wall.r[index]).toBeGreaterThan(r0 + 0.04)
    expect(wall.y[index]).toBeGreaterThan(y0 + 0.06)
    expect(wall.y[0]).toBe(0)
    for (let i = 1; i < wall.y.length; i++) expect(wall.y[i]).toBeGreaterThan(wall.y[i - 1])
  })

  it('向内向上托会抬高整段杯壁并收进半径', () => {
    const recipe = clayData.recommended
    const good = mixClay(recipe, recipe.water, 66, 1)
    const wall = wallFromRadii(Array.from({ length: 64 }, () => 0.7))
    const top0 = wall.y[wall.y.length - 1]
    const belly0 = wall.r[28]
    for (let i = 0; i < 6; i++) shapeWall(wall, 0.45, -0.012, 0.02)
    const upperOuter = () => Math.max(...wallShell(wall).outer.slice(28))
    expect(wall.y[wall.y.length - 1]).toBeGreaterThan(top0 + 0.1)
    expect(wall.r[28]).toBeLessThan(belly0 - 0.04)
    expect(upperOuter()).toBeLessThan(belly0)
    for (let i = 0; i < 30; i++) {
      stepWall(wall, {
        dt: 0.05,
        rpm: 360,
        P: good.P,
        waterNorm: recipe.water / clayData.waterMax,
        poor: false,
        waterZero: false,
      })
    }
    expect(wall.y[wall.y.length - 1]).toBeGreaterThan(top0)
    expect(upperOuter()).toBeLessThan(belly0 + 0.04)
  })

  it('同高只改接触的高度', () => {
    const wall = wallFromRadii(Array.from({ length: 64 }, () => 0.7))
    const topY = wall.y[wall.y.length - 1]
    const topR = wall.r[wall.r.length - 1]
    const y0 = wall.y[30]
    const r0 = wall.r[30]
    shapeWall(wall, y0, 0.05, 0.04, 'band')
    expect(wall.y[30]).toBeGreaterThan(y0 + 0.03)
    expect(wall.r[30]).toBeGreaterThan(r0 + 0.04)
    expect(wall.y[wall.y.length - 1]).toBeCloseTo(topY, 5)
    expect(wall.r[wall.r.length - 1]).toBeCloseTo(topR, 5)
    expect(wall.y[0]).toBe(0)
  })

  it('只有转到手指下的一瓣会变形', () => {
    const wall = wallFromRadii(Array.from({ length: 64 }, () => 0.7))
    const y0 = wall.y[40]
    const other = wall.sectorR[4][40]
    const otherY = wall.sectorY[4][40]
    shapeSector(wall, 0, y0, 0.08, 0.05, 'band')
    expect(wall.sectorR[0][40]).toBeGreaterThan(other + 0.06)
    expect(wall.sectorY[0][40]).toBeGreaterThan(otherY + 0.02)
    expect(wall.sectorY[0][40]).toBeLessThan(otherY + 0.055)
    expect(wall.sectorR[4][40]).toBeCloseTo(other, 6)
    expect(wall.sectorY[4][40]).toBeCloseTo(otherY, 6)
    expect(wall.sectorR[8][wall.sectorR[8].length - 1]).toBeCloseTo(0.7, 6)
  })

  it('长按只把鼓出挡板的那一瓣按回去', () => {
    const wall = wallFromRadii(Array.from({ length: 64 }, () => 0.7))
    const y = wall.y[40]
    wall.sectorR[0][40] = 0.9
    const rim = wall.sectorR[0][wall.sectorR[0].length - 1]
    pressProtrusion(wall, 0, y, 0.7, true, 'band', 0.05)
    expect(wall.sectorR[0][40]).toBeLessThan(0.86)
    expect(wall.sectorR[0][40]).toBeGreaterThan(0.84)
    expect(wall.sectorR[3][40]).toBeCloseTo(0.7, 5)
    expect(wall.sectorR[0][wall.sectorR[0].length - 1]).toBeCloseTo(rim, 5)
    pressProtrusion(wall, 3, y, 0.75, true, 'band', 0.05)
    expect(wall.sectorR[3][40]).toBeCloseTo(0.7, 5)
  })

  it('外推的肩是圆弧，不会在接触处收成直角', () => {
    const wall = wallFromRadii(Array.from({ length: 64 }, () => 0.7))
    const y0 = wall.y[32]
    shapeWall(wall, y0, 0.12, 0, 'band')
    const peak = wall.r[32]
    expect(peak).toBeGreaterThan(0.8)
    const reach = Math.min(Math.max(FINGER_RADIUS, peak - 0.7), FINGER_RADIUS * 2.2)
    let edge = 32
    for (let i = 33; i < wall.y.length; i++) {
      if (wall.y[i] - wall.y[32] >= reach - 1e-4) {
        edge = i
        break
      }
    }
    const mid = 32 + Math.max(1, Math.round((edge - 32) * 0.55))
    expect(wall.r[mid]).toBeGreaterThan(0.7)
    expect(wall.r[mid]).toBeLessThan(peak - 0.005)
    expect(wall.r[Math.min(63, edge + 1)]).toBeCloseTo(0.7, 2)
    const u = (wall.y[mid] - wall.y[32]) / (wall.y[edge] - wall.y[32])
    const curve = wall.r[edge] + (peak - wall.r[edge]) * Math.sqrt(Math.max(0, 1 - u * u))
    expect(wall.r[mid]).toBeCloseTo(curve, 2)
  })

  it('向下带时肩上的壁厚不会突然鼓起来', () => {
    const wall = wallFromRadii(Array.from({ length: 64 }, () => 0.7))
    const y0 = wall.y.slice()
    const pitch = y0[33] - y0[32]
    shapeWall(wall, y0[32], -0.01, -0.05)
    const shell = wallShell(wall)
    expect(Math.max(...shell.thickness)).toBeLessThan(0.16)
    expect(wall.y[wall.y.length - 1]).toBeLessThan(y0[y0.length - 1] - 0.03)
    expect(wall.y[wall.y.length - 1]).toBeGreaterThan(0.9)
    for (let i = 1; i < wall.y.length; i++) {
      expect(wall.y[i]).toBeGreaterThan(wall.y[i - 1])
      expect(wall.y[i] - wall.y[i - 1]).toBeGreaterThan(pitch * 0.65)
    }
  })

  it('一小步收腰不会把肩上的半径拽出一大截', () => {
    const wall = wallFromRadii(Array.from({ length: 64 }, () => 0.7))
    let prev = wall.r.slice()
    for (let k = 0; k < 25; k++) {
      shapeWall(wall, wall.y[32], -0.012, 0)
      for (let i = 0; i < wall.r.length; i++) expect(Math.abs((wall.r[i] ?? 0) - (prev[i] ?? 0))).toBeLessThan(0.014)
      prev = wall.r.slice()
    }
  })

  it('内外只改半径，接触以上一起收放，高度不动', () => {
    const wall = wallFromRadii(Array.from({ length: 64 }, () => 0.7))
    const yBefore = wall.y.slice()
    const y0 = wall.y[32]
    shapeWall(wall, y0, -0.06, 0, 'column')
    expect(wall.r[32]).toBeLessThan(0.66)
    expect(wall.r[48]).toBeLessThan(0.66)
    expect(wall.r[4]).toBeCloseTo(0.7, 2)
    expect(wall.y[48]).toBeCloseTo(yBefore[48], 5)
    expect(wall.y[32]).toBeCloseTo(yBefore[32], 5)
    const narrowed = wall.r[48]
    shapeWall(wall, y0, 0.04, 0, 'column')
    expect(wall.r[48]).toBeGreaterThan(narrowed + 0.03)
    expect(wall.y[48]).toBeCloseTo(yBefore[48], 5)
  })

  it('上下抹过的壁只轻轻变平，多抹几次更顺', () => {
    const wall = wallFromRadii(Array.from({ length: 64 }, () => 0.7))
    wall.r[32] = 0.9
    wall.restR[32] = 0.9
    const y = wall.y[32]
    const pitch = wall.y[33] - wall.y[32]
    smoothWall(wall, y, y)
    expect(wall.r[32]).toBeCloseTo(0.9, 5)
    smoothWall(wall, y - pitch, y + pitch)
    const once = wall.r[32]
    expect(once).toBeLessThan(0.88)
    expect(once).toBeGreaterThan(0.8)
    expect(wall.r[8]).toBeCloseTo(0.7, 5)
    for (let k = 0; k < 12; k++) smoothWall(wall, y - pitch * 2, y + pitch * 2)
    expect(wall.r[32]).toBeLessThan(once - 0.04)
    expect(wall.sectorR[4][32]).toBeCloseTo(wall.r[32], 5)
    expect(wall.sectorR[21][32]).toBeCloseTo(wall.r[32], 5)
  })

  it('一推整圈一起变', () => {
    const wall = wallFromRadii(Array.from({ length: 64 }, () => 0.7))
    const y0 = wall.y[32]
    shapeWall(wall, y0, 0.1, 0, 'band')
    expect(wall.r[32]).toBeGreaterThan(0.78)
    for (let s = 0; s < THROW_SECTORS; s++) expect(wall.sectorR[s][32]).toBeCloseTo(wall.r[32], 5)
  })

  it('小球离开杯壁时泥不追，只有挤进去才推', () => {
    expect(contactPush(true, -0.04, 0.02)).toEqual({ dr: -0.04, dy: 0.02 })
    expect(contactPush(true, 0.05, 0.03)).toEqual({ dr: 0, dy: 0 })
    expect(contactPush(false, 0.04, 0.01)).toEqual({ dr: 0.04, dy: 0.01 })
    expect(contactPush(false, -0.05, -0.02)).toEqual({ dr: 0, dy: 0 })
    expect(contactPush(true, 0.01, 0.08)).toEqual({ dr: 0, dy: 0.08 })
    const cylinder = wallFromRadii(Array.from({ length: 64 }, () => 0.7))
    expect(touchFromOutside(cylinder, 0, 0.5, 0.9)).toBe(true)
    expect(touchFromOutside(cylinder, 0, 0.5, 0.45)).toBe(false)
    const wall = wallFromRadii(Array.from({ length: 64 }, () => 0.7))
    const y0 = wall.y[32]
    const before = wall.r[32]
    shapeWall(wall, y0, contactPush(true, 0.08, 0).dr, 0, 'band')
    expect(wall.r[32]).toBeCloseTo(before, 5)
    expect(wall.sectorR[10][32]).toBeCloseTo(before, 5)
    shapeWall(wall, y0, contactPush(true, -0.06, 0).dr, 0, 'band')
    expect(wall.r[32]).toBeLessThan(before - 0.04)
    expect(wall.sectorR[17][32]).toBeCloseTo(wall.r[32], 5)
  })

  it('手指只覆盖接触角附近的几瓣', () => {
    const still = fingerSectors(null, 0.05)
    expect(still).toContain(0)
    expect(still.length).toBeLessThan(6)
    expect(still).not.toContain(8)
    const step = (Math.PI * 2) / THROW_SECTORS
    const swept = fingerSectors(0.05, 0.05 + step * 3)
    expect(swept).toContain(0)
    expect(swept).toContain(3)
    expect(swept).not.toContain(20)
  })
})

function emptyDry(run: ReturnType<typeof createRun>) {
  return {
    placement: 'shade' as const,
    flipped: false,
    covered: false,
    fanMisused: false,
    wetBody: false,
    crackOpen: false,
    raised: false,
    wrapped: false,
    duration: 10,
    humidityCurve: [run.humidity],
    scheduled: [],
    sunCrack: false,
    winterCrack: false,
  }
}

function emptyBisque() {
  return { deviation: 0, brittle: false, wetExtra: 0, exploded: false, scheduled: [], maxTemp: 0 }
}

function paint(result: NonNullable<ReturnType<typeof scriptedCup>['result']>, seed: number) {
  return {
    seed,
    iron: 0.22,
    colors: [
      [126, 139, 134],
      [198, 163, 106],
    ] as [number, number, number][],
    hueShift: result.hueShift,
    pattern: result.pattern,
    density: result.density,
    gloss: result.gloss,
    flow: result.flow,
    flawVisuals: result.flaws.map((flaw) => flaw.visual),
  }
}

function scriptedCup(seed: number) {
  const recipe = clayData.recommended
  let state = createRun(seed, 10, true)
  state = withClay(state, mixClay(recipe, recipe.water, state.humidity, 1))
  state = finishThrow({ ...state, stage: 'throw' }, ghostRadii(), state.thickness, true, true)
  state = {
    ...state,
    stage: 'glaze',
    bisque: { deviation: 0, brittle: false, wetExtra: 0, exploded: false, scheduled: [], maxTemp: 500 },
  }
  state = beginFire(
    state,
    [
      { id: 'qinghui', layers: 1, concentration: 0.7 },
      { id: 'mihuang', layers: 1, concentration: 0.6 },
    ],
    [],
    0,
    true,
    true,
  )
  state = { ...state, fire: { ...state.fire!, peakTemp: 1120, holdHours: 2, heldExtra: true } }
  const done = finishFire(state)
  expect(done.fail).toBeNull()
  return done.state
}

describe('跳过这步用刚好达标的数值', () => {
  it('五步都贴着及格线往下走', () => {
    const [p0, p1] = clayData.sweet.P
    const [h0, h1] = clayData.sweet.H
    let state = createRun(11, 10, true)
    state = skipStage(state, true)
    expect(state.stage).toBe('throw')
    expect(state.clay?.quality).toBe('excellent')
    expect(state.clay?.knead).toBe(1)
    expect(state.clay?.water).toBeGreaterThan(0)
    expect(state.clay?.P).toBeGreaterThanOrEqual(p0)
    expect(state.clay?.P).toBeLessThanOrEqual((p0 + p1) / 2)
    expect(state.clay?.H).toBeGreaterThanOrEqual(h0)
    expect(state.clay?.H).toBeLessThanOrEqual((h0 + h1) / 2)
    const spun = wallFromRadii(state.radii)
    let fell = false
    for (let i = 0; i < 40 && !fell; i++) {
      fell = stepWall(spun, {
        dt: 0.05,
        rpm: 360,
        P: state.clay!.P,
        waterNorm: state.clay!.water / clayData.waterMax,
        poor: false,
        waterZero: false,
      }).collapsed
    }
    expect(fell).toBe(false)
    expect(Math.max(...spun.r)).toBeLessThan(1.05)
    state = skipStage(state, true)
    expect(state.stage).toBe('dry')
    expect(state.radii).toHaveLength(64)
    state = skipStage(state, true)
    expect(state.stage).toBe('glaze')
    expect(state.bisque?.deviation).toBe(difficulty.bisqueDeviationLimit)
    expect(state.bisque?.maxTemp).toBe(difficulty.bisqueCeiling)
    expect(state.bisque?.brittle).toBe(false)
    expect(state.flaws.some((flaw) => flaw.from === 'bisque')).toBe(false)
    state = skipStage(state, true)
    expect(state.stage).toBe('fire')
    expect(state.glaze?.picks).toHaveLength(2)
    expect(state.glaze?.picks.every((pick) => pick.layers === 1 && pick.concentration === 0.3)).toBe(true)
    expect(state.glaze?.footRisk).toBe(false)
    expect(state.fire?.holdHours).toBe(1)
    expect(state.fire?.peakTemp).toBe(1080)
    state = skipStage(state, true)
    expect(state.result?.stuck).toBe(false)
    expect(state.result?.shattered).toBe(false)
    expect(state.result?.glazeWord).not.toBe('thin')
    expect(snapshotOf(state)).not.toBeNull()
  })
})

describe('重试不会丢整局种子', () => {
  it('拉坯重做仍是同一局', () => {
    const run = beginThrowReady(3)
    const next = retryStage(run, true, true, false)
    expect(next.seed).toBe(run.seed)
    expect(next.retries).toBe(1)
    expect(next.stage).toBe('throw')
  })
})

function beginThrowReady(seed: number) {
  const recipe = clayData.recommended
  const state = withClay(createRun(seed, 10, false), mixClay(recipe, recipe.water, 66, 1))
  return { ...state, stage: 'throw' as const, radii: ghostRadii(), thickness: state.thickness }
}
