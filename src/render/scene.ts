import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  NoToneMapping,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Raycaster,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { assetId, colorOf, resolveSync } from '../assets/registry'
import clayData from '../data/clay.json'
import { ghostRadii, sectorOf, thicknessFromRadii } from '../sim/throwing'
import { createCupGeometry, createWheelGeometry } from './cupGeometry'
import { applyCupLook, createCupMaterial, type CupLook } from './cupMaterial'

const SKY = {
  sunny: assetId('env.sky.sunny'),
  cloudy: assetId('env.sky.cloudy'),
  overcast: assetId('env.sky.overcast'),
  rain: assetId('env.sky.rain'),
  returningSouth: assetId('env.sky.returningSouth'),
  coldAir: assetId('env.sky.coldAir'),
}

export function skyColor(weather: string): string {
  const id = SKY[weather as keyof typeof SKY] ?? SKY.cloudy
  return colorOf(id)
}

/** 与杯壁着色器同一套位移：足部不动，口沿绕中心慢慢晃，半径不变。 */
export function swayOffset(height: number, amp: number, time: number): { x: number; z: number } {
  const u = Math.min(1, Math.max(0, (height - 0.05) / 0.95))
  const s = u * u * (3 - 2 * u)
  const a = amp * 0.13 * s * s
  return {
    x: a * Math.sin(time) + a * 0.28 * Math.sin(time * 0.55 + 1.3),
    z: a * Math.cos(time),
  }
}

function sampleAt(values: number[], heights: number[], y: number): number {
  if (values.length === 0) return 0
  if (heights.length !== values.length) return sampleRing(values, y)
  if (y <= heights[0]) return values[0]
  const last = heights.length - 1
  if (y >= heights[last]) return values[last]
  for (let i = 0; i < last; i++) {
    if (y <= heights[i + 1]) {
      const span = heights[i + 1] - heights[i] || 1
      const u = (y - heights[i]) / span
      return values[i] + (values[i + 1] - values[i]) * u
    }
  }
  return values[last]
}

function sampleRing(values: number[], t: number): number {
  if (values.length === 0) return 0
  if (values.length === 1) return values[0]
  const f = Math.min(1, Math.max(0, t)) * (values.length - 1)
  const i = Math.floor(f)
  const j = Math.min(values.length - 1, i + 1)
  return values[i] + (values[j] - values[i]) * (f - i)
}

function profileTurn(r: number[], y: number[], i: number): number {
  const n = r.length
  if (i <= 0 || i >= n - 1) return 1.2
  const ax = r[i] - r[i - 1]
  const ay = y[i] - y[i - 1]
  const bx = r[i + 1] - r[i]
  const by = y[i + 1] - y[i]
  const al = Math.hypot(ax, ay) || 1
  const bl = Math.hypot(bx, by) || 1
  return 1 - (ax * bx + ay * by) / (al * bl)
}

/** 指针落在尖角邻接的斜面上时，沿斜面把环吸到尖端。陡尖的半径差得大，用直线距离会够不着。 */
export function snapCorner(radial: number, y: number, radii: number[], heights: number[]): { r: number; y: number } | null {
  const n = Math.min(radii.length, heights.length)
  if (n < 3) return null
  let best = -1
  let bestScore = Infinity
  for (let i = 0; i < n; i++) {
    const turn = profileTurn(radii, heights, i)
    if (turn < 0.2) continue
    const cr = Math.max(0.02, radii[i] ?? 0)
    const cy = heights[i] ?? 0
    let along = Infinity
    let perp = Infinity
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= n) continue
      const dx = Math.max(0.02, radii[j] ?? 0) - cr
      const dy = (heights[j] ?? 0) - cy
      const len = Math.hypot(dx, dy)
      if (len < 1e-5) continue
      const t = Math.max(0, Math.min(1, ((radial - cr) * dx + (y - cy) * dy) / (len * len)))
      const off = Math.hypot(radial - (cr + dx * t), y - (cy + dy * t))
      const walked = t * len
      if (off < perp - 1e-4 || (Math.abs(off - perp) <= 1e-4 && walked < along)) {
        perp = off
        along = walked
      }
    }
    const direct = Math.hypot(radial - cr, y - cy)
    if (direct < along) {
      along = direct
      perp = 0
    }
    const reach = Math.min(0.16, Math.max(0.05, 0.04 + turn * 0.08))
    if (perp > 0.04 || along > reach) continue
    const score = along - turn * 0.08
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  }
  if (best < 0) return null
  return { r: Math.max(0.02, radii[best] ?? 0), y: heights[best] ?? 0 }
}

export interface SurfaceHit {
  x: number
  y: number
  z: number
  nx: number
  ny: number
  nz: number
  t: number
  radial: number
  inner: boolean
  ang: number
  snapped: boolean
  center?: boolean
}

export interface ScenePatch {
  mode?: 'mix' | 'throw' | 'dry' | 'glaze' | 'fire' | 'reveal'
  radii?: number[]
  heights?: number[]
  thickness?: number[]
  sectors?: { outer: number[][]; thickness: number[][]; heights: number[][] }
  color?: string
  glaze?: string
  glazeMix?: number
  wet?: number
  rpm?: number
  shake?: boolean
  sway?: number
  lean?: number
  sky?: string
  kilnOpen?: number
  orbit?: number
  cotton?: number
  crack?: boolean
  pinhole?: boolean
  crazing?: boolean
  map?: HTMLCanvasElement | null
  quality?: 'high' | 'low'
  bench?: {
    water: number
    parts: { diger: number; kaolin: number; aged: number }
    colors: { diger: string; kaolin: string; aged: string }
    selected?: string
  }
  jars?: { id: string; color: string; on: boolean; concentration: number }[]
  glazeBrush?: number
  kneading?: boolean
  deposits?: { key: number; id: string; color: string; fly: number; absorb: number; slot: number }[]
  pours?: { key: number; fly: number }[]
  ballAct?: { kind: 'rest' | 'toss' | 'rise'; t: number }
}

export class WorkshopScene {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(38, 1, 0.1, 40)
  private cup: Mesh
  private ghost: Mesh
  private ball: Mesh
  private wheel: Group
  private rack: Group
  private kiln: Group
  private door: Mesh
  private cotton: Mesh
  private points: Points
  private material: ShaderMaterial
  private mapTexture: CanvasTexture | null = null
  private spin = 0
  private rpm = 0
  private shake = 0
  private sway = 0
  private swayTarget = 0
  private swayTime = 0
  private orbit = 0
  private cottonLift = 1
  private mode: ScenePatch['mode'] = 'mix'
  private noted = new Set<string>()
  private quality: 'high' | 'low' = 'high'
  private disposed = false
  private kneading = false
  private kneadTime = 0
  private ringTime = 0
  private bench = new Group()
  private basin!: Group
  private bin!: Group
  private basinShell!: Mesh
  private waterMesh!: Mesh
  private piles = new Map<string, Mesh>()
  private plates: Group[] = []
  private plateTextures: CanvasTexture[] = []
  private depositState: NonNullable<ScenePatch['deposits']> = []
  private depositMeshes = new Map<number, Mesh>()
  private depositStart = new Vector3()
  private depositEnd = new Vector3()
  private depositPoint = new Vector3()
  private pourState: NonNullable<ScenePatch['pours']> = []
  private pourGroups = new Map<number, Group>()
  private selectRing!: Mesh
  private ringBase = 1
  private ballMotion: { kind: 'rest' | 'toss' | 'rise'; t: number } = { kind: 'rest', t: 1 }
  private jarRoot = new Group()
  private jarGroups: Group[] = []
  private jarLiquids: Mesh[] = []
  private brushRing: Mesh
  private finger: Mesh
  private ringRadius = 0.7
  private throwYaw = Math.atan2(1.45, 1.85)
  private throwPitch = Math.asin(0.67 / Math.hypot(1.45, 0.67, 1.85))
  private throwDist = Math.hypot(1.45, 0.67, 1.85)
  private hitNormal = new Vector3()
  private camRight = new Vector3()
  private camUp = new Vector3()
  private camBack = new Vector3()
  private strokeMotion = new Vector3()
  private planeNormal = new Vector3()
  private planePoint = new Vector3()
  private wallRadii: number[] = []
  private wallHeights: number[] = []
  private wallThick: number[] = []
  private sectorOuter: number[][] = []
  private sectorHeights: number[][] = []
  private sectorThick: number[][] = []
  private pickables: Object3D[] = []
  private raycaster = new Raycaster()
  private ndc = new Vector2()
  private look: CupLook = {
    color: '#8C4030',
    glaze: '#7E8B86',
    glazeMix: 0,
    wet: 0.15,
    crack: false,
    pinhole: false,
    crazing: false,
  }

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = NoToneMapping
    this.scene.background = new Color('#E7D3B0')
    this.scene.add(new AmbientLight('#F3EEE6', 0.85))
    const sun = new DirectionalLight('#FFF6EA', 1.15)
    sun.position.set(2.2, 3.4, 2)
    this.scene.add(sun)
    const ground = new Mesh(
      new PlaneGeometry(8, 8),
      new MeshStandardMaterial({ color: '#CDBBA8', roughness: 1 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.02
    this.scene.add(ground)

    this.material = createCupMaterial()
    this.material.side = DoubleSide
    this.cup = new Mesh(createCupGeometry([0.7], [0.08]), this.material)
    this.cup.position.y = 0.12
    this.cup.name = 'cup'
    this.scene.add(this.cup)
    const ghostMat = new MeshStandardMaterial({ color: '#6E5344', transparent: true, opacity: 0.14, depthWrite: false, roughness: 1 })
    this.ghost = new Mesh(createCupGeometry(ghostRadii(), thicknessFromRadii(ghostRadii())), ghostMat)
    this.ghost.position.y = 0.12
    this.scene.add(this.ghost)
    this.ball = new Mesh(new SphereGeometry(0.34, 32, 24), new MeshStandardMaterial({ color: '#8C4030', roughness: 0.85 }))
    this.ball.position.y = 0.42
    this.ball.userData.pickId = 'ball'
    this.scene.add(this.ball)
    this.finger = new Mesh(
      new TorusGeometry(this.ringRadius, 0.013, 12, 72),
      new MeshStandardMaterial({
        color: '#F6D34D',
        emissive: '#E0B43A',
        emissiveIntensity: 0.35,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        roughness: 0.28,
        side: DoubleSide,
      }),
    )
    this.finger.rotation.x = Math.PI / 2
    this.finger.visible = false
    this.finger.name = 'finger'
    this.scene.add(this.finger)
    this.wheel = this.makeWheel()
    this.rack = this.makeRack()
    this.kiln = this.makeKiln()
    this.kiln.userData.pickId = 'kiln'
    this.door = this.kiln.getObjectByName('kiln_door') as Mesh
    this.cotton = this.kiln.getObjectByName('kiln_cotton') as Mesh
    this.cup.userData.pickId = 'cup'
    this.makeBench()
    this.makeJars()
    this.brushRing = new Mesh(
      new TorusGeometry(0.62, 0.012, 8, 40),
      new MeshStandardMaterial({ color: '#E7D3B0', roughness: 0.4, metalness: 0.1 }),
    )
    this.brushRing.rotation.x = Math.PI / 2
    this.brushRing.position.y = 0.45
    this.brushRing.visible = false
    this.cup.add(this.brushRing)
    this.scene.add(this.wheel, this.rack, this.kiln, this.bench, this.jarRoot)
    this.pickables = [this.ball, this.basin, this.bin, ...this.piles.values(), ...this.plates, ...this.jarGroups, this.cup, this.kiln]
    this.points = this.makePoints(160)
    this.scene.add(this.points)
    this.camera.position.set(1.45, 1.15, 1.85)
    this.camera.lookAt(0, 0.48, 0)
    this.apply({ mode: 'mix' })
    assetId('decal.crack')
    assetId('decal.chip')
    assetId('decal.crazing')
    assetId('decal.smoke')
    assetId('decal.pinhole')
    assetId('tex.clay.normal')
    assetId('tex.clay.roughness')
    assetId('tex.bisque.albedo')
    assetId('tex.bisque.normal')
    assetId('tex.bisque.roughness')
  }

  private note(id: string): void {
    if (this.noted.has(id)) return
    this.noted.add(id)
    resolveSync(id)
  }

  private makeWheel(): Group {
    const group = new Group()
    const wood = new MeshStandardMaterial({ color: '#6E5344', roughness: 0.8 })
    wood.name = 'wood'
    const metal = new MeshStandardMaterial({ color: '#8A8078', roughness: 0.45, metalness: 0.35 })
    metal.name = 'metal'
    const head = new Mesh(new CylinderGeometry(0.95, 0.95, 0.08, 40), wood)
    head.name = 'wheel_head'
    head.position.y = 0.08
    const shaft = new Mesh(new CylinderGeometry(0.12, 0.16, 0.28, 20), metal)
    shaft.position.y = -0.08
    group.add(head, shaft)
    return group
  }

  private makeRack(): Group {
    const group = new Group()
    const wood = new MeshStandardMaterial({ color: '#6E5344', roughness: 0.85 })
    wood.name = 'wood'
    const rack = new Group()
    rack.name = 'rack'
    for (const x of [-0.7, 0.7]) {
      const post = new Mesh(new BoxGeometry(0.06, 1.3, 0.06), wood)
      post.position.set(x, 0.65, 0)
      rack.add(post)
    }
    for (const y of [0.45, 0.9]) {
      const bar = new Mesh(new BoxGeometry(1.5, 0.05, 0.05), wood)
      bar.position.set(0, y, 0)
      rack.add(bar)
    }
    group.add(rack)
    return group
  }

  private makeKiln(): Group {
    const group = new Group()
    const brick = new MeshStandardMaterial({ color: '#8C4030', roughness: 0.92 })
    brick.name = 'brick'
    const doorMat = new MeshStandardMaterial({ color: '#4E433C', roughness: 0.8 })
    doorMat.name = 'door'
    const cottonMat = new MeshStandardMaterial({ color: '#E6E0D6', roughness: 1 })
    cottonMat.name = 'cotton'
    const shell = new Mesh(new BoxGeometry(1.7, 1.5, 1.35), brick)
    shell.name = 'kiln_shell'
    shell.position.y = 0.85
    const door = new Mesh(new BoxGeometry(0.08, 1.15, 0.9), doorMat)
    door.name = 'kiln_door'
    door.position.set(0.82, 0.78, 0)
    const cotton = new Mesh(new BoxGeometry(0.7, 0.08, 0.7), cottonMat)
    cotton.name = 'kiln_cotton'
    cotton.position.set(0, 1.55, 0)
    group.add(shell, door, cotton)
    return group
  }

  private makeBench(): void {
    const wood = new MeshStandardMaterial({ color: '#6E5344', roughness: 0.78, side: DoubleSide })
    this.basin = new Group()
    this.basin.userData.pickId = 'water'
    this.basin.position.set(-1.35, 0, -0.58)
    this.basinShell = new Mesh(new CylinderGeometry(0.34, 0.28, 0.16, 32, 1, true), wood)
    this.basinShell.position.y = 0.12
    const floor = new Mesh(new CircleGeometry(0.27, 32), wood)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0.045
    const rim = new Mesh(new TorusGeometry(0.33, 0.028, 8, 32), wood)
    rim.rotation.x = Math.PI / 2
    rim.position.y = 0.2
    this.waterMesh = new Mesh(
      new CircleGeometry(0.29, 40),
      new MeshStandardMaterial({
        color: '#2E94B5',
        emissive: '#14556C',
        emissiveIntensity: 0.45,
        roughness: 0.12,
        metalness: 0.08,
        side: DoubleSide,
      }),
    )
    this.waterMesh.rotation.x = -Math.PI / 2
    this.waterMesh.position.y = 0.16
    this.basin.add(floor, this.waterMesh, this.basinShell, rim)
    const names = new Map(clayData.clays.map((clay) => [clay.id, clay.name]))
    const spots: { id: 'diger' | 'kaolin' | 'aged'; x: number; z: number; color: string }[] = [
      { id: 'diger', x: 1.2, z: -1.02, color: '#8C4030' },
      { id: 'kaolin', x: 1.7, z: -0.36, color: '#C4B5A4' },
      { id: 'aged', x: 1.2, z: 0.32, color: '#6E5344' },
    ]
    for (const spot of spots) {
      const pile = new Mesh(new SphereGeometry(0.22, 24, 16), new MeshStandardMaterial({ color: spot.color, roughness: 0.92 }))
      pile.userData.pickId = spot.id
      pile.position.set(spot.x, 0.22 * 0.62 - 0.02, spot.z)
      pile.scale.set(0.9, 0.62, 0.9)
      this.piles.set(spot.id, pile)
      this.bench.add(pile)
      const plate = this.makePlate(names.get(spot.id) ?? spot.id, spot.id)
      plate.position.set(spot.x, 0, spot.z + 0.44)
      this.plates.push(plate)
      this.bench.add(plate)
    }
    this.selectRing = new Mesh(
      new RingGeometry(0.4, 0.48, 64),
      new MeshStandardMaterial({
        color: '#E2B44A',
        emissive: '#8A6A1E',
        emissiveIntensity: 0.35,
        metalness: 0.72,
        roughness: 0.28,
        side: DoubleSide,
      }),
    )
    this.selectRing.rotation.x = -Math.PI / 2
    this.selectRing.position.y = 0.03
    this.selectRing.visible = false
    this.bin = this.makeBin()
    this.bench.add(this.basin, this.bin, this.selectRing)
  }

  private makeBin(): Group {
    const group = new Group()
    group.userData.pickId = 'bin'
    group.position.set(-1.35, 0, -1.62)
    const metal = new MeshStandardMaterial({ color: '#3A3330', roughness: 0.55, metalness: 0.35 })
    const body = new Mesh(new CylinderGeometry(0.28, 0.24, 0.48, 24, 1, true), metal)
    body.position.y = 0.26
    const inside = new Mesh(
      new CircleGeometry(0.24, 24),
      new MeshStandardMaterial({ color: '#241E1C', roughness: 0.92 }),
    )
    inside.rotation.x = -Math.PI / 2
    inside.position.y = 0.48
    const floor = new Mesh(new CircleGeometry(0.22, 24), metal)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0.04
    const rim = new Mesh(new TorusGeometry(0.28, 0.028, 8, 28), metal)
    rim.rotation.x = Math.PI / 2
    rim.position.y = 0.5
    const lid = new Mesh(new CylinderGeometry(0.3, 0.3, 0.034, 24), metal)
    lid.position.set(0.12, 0.66, -0.02)
    lid.rotation.z = -0.9
    const knob = new Mesh(new SphereGeometry(0.046, 12, 10), metal)
    knob.position.y = 0.04
    lid.add(knob)
    group.add(body, inside, floor, rim, lid)
    return group
  }

  private makePlate(label: string, id: string): Group {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 160
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#F4E7D4'
      ctx.fillRect(0, 0, 512, 160)
      ctx.strokeStyle = '#6E5344'
      ctx.lineWidth = 14
      ctx.strokeRect(10, 10, 492, 140)
      ctx.fillStyle = '#3C2A22'
      ctx.font = '64px "Songti SC", "STSong", SimSun, serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, 256, 84)
    }
    const tex = new CanvasTexture(canvas)
    tex.colorSpace = SRGBColorSpace
    tex.needsUpdate = true
    this.plateTextures.push(tex)
    const group = new Group()
    group.userData.pickId = id
    const wood = new MeshStandardMaterial({ color: '#B08968', roughness: 0.82 })
    const board = new Mesh(new BoxGeometry(0.5, 0.16, 0.02), wood)
    board.rotation.x = -0.5
    board.position.y = 0.084
    const face = new Mesh(
      new PlaneGeometry(0.46, 0.128),
      new MeshStandardMaterial({ map: tex, roughness: 0.9 }),
    )
    face.position.z = 0.012
    board.add(face)
    group.add(board)
    return group
  }

  private makeJars(): void {
    const slots = [
      [-1.18, 0.22],
      [-1.12, -0.18],
      [-0.95, -0.52],
      [0.95, -0.52],
      [1.12, -0.18],
      [1.18, 0.22],
    ]
    slots.forEach(([x, z], index) => {
      const group = new Group()
      group.position.set(x, 0, z)
      group.userData.pickId = `jar-${index}`
      const pot = new Mesh(
        new CylinderGeometry(0.13, 0.11, 0.18, 18),
        new MeshStandardMaterial({ color: '#C4B5A4', roughness: 0.7 }),
      )
      pot.position.y = 0.09
      const liquid = new Mesh(
        new CylinderGeometry(0.09, 0.08, 1, 16),
        new MeshStandardMaterial({ color: '#7E8B86', roughness: 0.35 }),
      )
      liquid.scale.y = 0.06
      liquid.position.y = 0.08
      group.add(pot, liquid)
      this.jarGroups.push(group)
      this.jarLiquids.push(liquid)
      this.jarRoot.add(group)
    })
  }

  private makePoints(count: number): Points {
    const positions = new Float32Array(count * 3)
    const seeds = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 1.2
      positions[i * 3 + 1] = Math.random() * 0.2
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.8
      seeds[i] = Math.random()
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geo.setAttribute('aSeed', new Float32BufferAttribute(seeds, 1))
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uColor: { value: new Color('#C4B5A4') } },
      vertexShader: `
        uniform float uTime;
        attribute float aSeed;
        void main() {
          vec3 p = position;
          p.y += mod(uTime * 0.12 + aSeed, 1.2);
          p.x += sin(uTime + aSeed * 6.283) * 0.04;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = 18.0 / max(0.2, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        void main() {
          if (length(gl_PointCoord - vec2(0.5)) > 0.5) discard;
          gl_FragColor = vec4(uColor, 0.45);
        }
      `,
    })
    return new Points(geo, mat)
  }

  resize(): void {
    const canvas = this.renderer.domElement
    const width = canvas.clientWidth || 640
    const height = canvas.clientHeight || 480
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
  }

  apply(patch: ScenePatch): void {
    if (patch.mode) this.mode = patch.mode
    if (patch.sky) this.scene.background = new Color(patch.sky)
    if (patch.rpm != null) this.rpm = patch.rpm
    if (patch.shake != null) this.shake = patch.shake ? 0.28 : this.shake
    if (patch.sway != null) this.swayTarget = Math.max(0, Math.min(1, patch.sway))
    if (patch.orbit != null) this.orbit = patch.orbit
    if (patch.lean != null) this.cup.rotation.z = patch.lean
    if (patch.kilnOpen != null && this.door) this.door.rotation.y = -patch.kilnOpen * 1.15
    if (patch.cotton != null && this.cotton) {
      this.cottonLift = patch.cotton
      this.cotton.position.y = 1.55 + patch.cotton * 0.55
    }
    if (patch.quality && patch.quality !== this.quality) {
      this.quality = patch.quality
      this.renderer.setPixelRatio(patch.quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 1.5))
      this.points.geometry.setDrawRange(0, patch.quality === 'low' ? 36 : 160)
    }
    const mode = this.mode ?? 'mix'
    const forming = mode === 'throw'
    this.wheel.visible = forming
    this.rack.visible = mode === 'dry'
    this.kiln.visible = mode === 'fire' || (mode === 'reveal' && this.cottonLift > 0.25)
    this.ball.visible = mode === 'mix'
    this.bench.visible = mode === 'mix'
    this.jarRoot.visible = mode === 'glaze'
    this.brushRing.visible = mode === 'glaze'
    this.cup.visible = mode !== 'mix'
    this.ghost.visible = mode === 'throw'
    if (patch.kneading != null && patch.kneading !== this.kneading) {
      this.kneading = patch.kneading
      if (patch.kneading) this.kneadTime = 0
    }
    if (patch.deposits) {
      this.depositState = patch.deposits
      this.syncDeposits()
    }
    if (patch.pours) {
      this.pourState = patch.pours
      this.syncPours()
    }
    if (patch.ballAct) this.ballMotion = { kind: patch.ballAct.kind, t: patch.ballAct.t }
    if (patch.bench && mode === 'mix') this.applyBench(patch.bench)
    if (patch.jars && mode === 'glaze') this.applyJars(patch.jars)
    if (patch.glazeBrush != null && mode === 'glaze') this.brushRing.position.y = 0.12 + patch.glazeBrush * 0.72
    this.points.visible = mode === 'dry' || mode === 'fire' || (mode === 'reveal' && this.cottonLift > 0.25)
    if (forming) this.note(assetId('model.wheel'))
    if (mode === 'dry') this.note(assetId('model.rack'))
    if (mode === 'fire' || mode === 'reveal') this.note(assetId('model.kiln'))
    const turned = patch.sectors
    if (turned && turned.outer.length > 2 && (turned.outer[0]?.length ?? 0) > 2) {
      this.sectorOuter = turned.outer
      this.sectorHeights = turned.heights
      this.sectorThick = turned.thickness
      if (patch.radii && patch.radii.length > 2) {
        const thickness = patch.thickness && patch.thickness.length === patch.radii.length ? patch.thickness : patch.radii.map(() => 0.08)
        this.wallRadii = patch.radii.slice()
        this.wallHeights = patch.heights && patch.heights.length === patch.radii.length ? patch.heights.slice() : []
        this.wallThick = thickness.slice()
      }
      const next = createWheelGeometry(turned.outer, turned.thickness, turned.heights)
      this.cup.geometry.dispose()
      this.cup.geometry = next
    } else if (patch.radii && patch.radii.length > 2) {
      this.sectorOuter = []
      this.sectorHeights = []
      this.sectorThick = []
      const thickness = patch.thickness && patch.thickness.length === patch.radii.length ? patch.thickness : patch.radii.map(() => 0.08)
      this.wallRadii = patch.radii.slice()
      this.wallHeights = patch.heights && patch.heights.length === patch.radii.length ? patch.heights.slice() : []
      this.wallThick = thickness.slice()
      const next = createCupGeometry(patch.radii, thickness, this.wallHeights)
      this.cup.geometry.dispose()
      this.cup.geometry = next
    }
    if (patch.color && mode === 'mix') {
      const mat = this.ball.material
      if (!Array.isArray(mat) && mat instanceof MeshStandardMaterial) mat.color = new Color(patch.color)
    }
    if (patch.color) this.look.color = patch.color
    if (patch.glaze) this.look.glaze = patch.glaze
    if (patch.glazeMix != null) this.look.glazeMix = patch.glazeMix
    if (patch.wet != null) this.look.wet = patch.wet
    if (patch.crack != null) this.look.crack = patch.crack
    if (patch.pinhole != null) this.look.pinhole = patch.pinhole
    if (patch.crazing != null) this.look.crazing = patch.crazing
    applyCupLook(this.material, this.look)
    if (patch.map) {
      this.mapTexture?.dispose()
      this.mapTexture = new CanvasTexture(patch.map)
      this.mapTexture.colorSpace = SRGBColorSpace
      this.mapTexture.needsUpdate = true
      this.material.uniforms.uMap.value = this.mapTexture
      this.material.uniforms.uHasMap.value = 1
    }
    const dust = this.points.material as ShaderMaterial
    const dustColor = dust.uniforms.uColor.value as Color
    if (mode === 'fire' || mode === 'reveal') dustColor.set('#C46A3A')
    else dustColor.set('#C4B5A4')
  }

  frame(dt: number): void {
    if (this.disposed) return
    this.spin += (this.rpm / 60) * dt * 0.9
    const head = this.wheel.getObjectByName('wheel_head')
    if (head) head.rotation.y = this.spin
    if (this.mode !== 'reveal') this.cup.rotation.y = this.spin * 0.15
    if (this.mode === 'throw') {
      const rate = this.swayTarget > this.sway ? 1.6 : 1.1
      this.sway += (this.swayTarget - this.sway) * (1 - Math.exp(-rate * dt))
      if (this.sway < 0.0008 && this.swayTarget === 0) this.sway = 0
      this.swayTime += dt * 2.8
    } else {
      this.sway = 0
      this.swayTarget = 0
    }
    this.material.uniforms.uSway.value = this.sway
    this.material.uniforms.uSwayTime.value = this.swayTime
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt)
      this.cup.position.x = Math.sin(this.shake * 40) * 0.015
    } else this.cup.position.x = 0
    if (this.mode === 'reveal') {
      const ang = this.orbit * Math.PI * 2
      this.camera.position.set(Math.sin(ang) * 2.85, 0.92, Math.cos(ang) * 2.85)
      this.camera.lookAt(0, 0.5, 0)
    } else if (this.mode === 'fire') {
      this.camera.position.set(2.1, 1.2, 1.6)
      this.camera.lookAt(0, 0.7, 0)
    } else if (this.mode === 'mix') {
      this.camera.position.set(0, 1.78, 2.95)
      this.camera.lookAt(0, 0.2, -0.2)
    } else if (this.mode === 'glaze') {
      this.camera.position.set(0.02, 1.42, 2.55)
      this.camera.lookAt(0, 0.42, 0)
    } else if (this.mode === 'throw') {
      this.placeThrowCamera()
    } else {
      this.camera.position.set(1.45, 1.15, 1.85)
      this.camera.lookAt(0, 0.48, 0)
    }
    this.ringTime += dt
    if (this.selectRing.visible) {
      const breath = 0.86 + (Math.sin(this.ringTime * 2.8) * 0.5 + 0.5) * 0.22
      const size = this.ringBase * breath
      this.selectRing.scale.set(size, size, size)
    }
    if (this.mode === 'mix' && this.ballMotion.kind === 'toss') this.poseToss(this.ballMotion.t)
    else if (this.mode === 'mix' && this.ballMotion.kind === 'rise') this.poseRise(this.ballMotion.t)
    else if (this.mode === 'mix' && this.kneading) this.poseBall(dt)
    else if (this.mode === 'mix') this.restBall()
    if (this.mode === 'mix') {
      this.placeDeposits()
      this.placePours()
    } else {
      this.depositMeshes.forEach((mesh) => { mesh.visible = false })
      this.pourGroups.forEach((group) => { group.visible = false })
    }
    const dust = this.points.material as ShaderMaterial
    dust.uniforms.uTime.value += dt
    this.renderer.render(this.scene, this.camera)
  }

  private ballHalfY(sx: number, sy: number, sz: number, rx: number, rz: number): number {
    const cx = Math.cos(rx)
    const sxr = Math.sin(rx)
    const cz = Math.cos(rz)
    const szr = Math.sin(rz)
    return 0.34 * Math.hypot(sx * szr, sy * cz * cx, sz * cz * sxr)
  }

  private poseBall(dt: number): void {
    this.kneadTime += dt
    const t = (this.kneadTime % 1.6) / 1.6
    let x = 0
    let z = 0
    let sx = 1
    let sy = 1
    let sz = 1
    let rx = 0
    let rz = 0
    let lift = 0
    if (t < 0.14) {
      const u = t / 0.14
      lift = Math.sin(u * Math.PI) * 0.7
      z = -Math.sin(u * Math.PI) * 0.06
    } else if (t < 0.26) {
      const u = (t - 0.14) / 0.12
      sy = 1 - u * 0.55
      sx = 1 + u * 0.62
      sz = 1 + u * 0.26
      rx = u * 0.48
    } else if (t < 0.42) {
      sy = 0.45
      sx = 1.62
      sz = 1.26
      rx = 0.48
    } else if (t < 0.78) {
      const u = (t - 0.42) / 0.36
      sy = 0.52
      sx = 1.42
      sz = 1.16
      x = Math.sin(u * Math.PI * 4) * 0.14
      z = Math.sin(u * Math.PI * 2) * 0.04
      rx = 0.36
      rz = Math.sin(u * Math.PI * 4) * 0.28
    } else {
      const u = (t - 0.78) / 0.22
      const ease = u * u * (3 - 2 * u)
      sy = 0.52 + (1 - 0.52) * ease
      sx = 1.42 + (1 - 1.42) * ease
      sz = 1.16 + (1 - 1.16) * ease
      rx = 0.36 * (1 - ease)
    }
    const y = this.ballHalfY(sx, sy, sz, rx, rz) + 0.045 + lift
    this.ball.position.set(x, y, z)
    this.ball.scale.set(sx, sy, sz)
    this.ball.rotation.set(rx, 0, rz)
  }

  private restBall(): void {
    this.ball.position.set(0, 0.42, 0)
    this.ball.scale.set(1, 1, 1)
    this.ball.rotation.set(0, 0, 0)
  }

  private poseToss(t: number): void {
    const u = t * t * (3 - 2 * t)
    this.depositStart.set(0, 0.42, 0)
    this.depositEnd.set(this.bin.position.x, 0.34, this.bin.position.z)
    this.ball.position.lerpVectors(this.depositStart, this.depositEnd, u)
    this.ball.position.y += Math.sin(u * Math.PI) * 0.72
    const s = Math.max(0.12, 1 - u * 0.86)
    this.ball.scale.set(s, s * (1 - u * 0.25), s)
    this.ball.rotation.set(u * 1.5, 0, -u * 0.9)
  }

  private poseRise(t: number): void {
    const u = t * t * (3 - 2 * t)
    this.depositStart.set(0, 0.06, 2.2)
    this.depositEnd.set(0, 0.42, 0)
    this.ball.position.lerpVectors(this.depositStart, this.depositEnd, u)
    this.ball.position.y += Math.sin(u * Math.PI) * 0.16
    const s = 0.42 + 0.58 * u
    this.ball.scale.set(s, s, s)
    this.ball.rotation.set(0, 0, 0)
  }

  orbitThrow(dx: number, dy: number): void {
    this.throwYaw -= dx * 0.005
    this.throwPitch = Math.min(1.05, Math.max(0.18, this.throwPitch + dy * 0.004))
  }

  wheelAngle(): number {
    return this.cup.rotation.y
  }

  probeCup(clientX: number, clientY: number, snap = true): SurfaceHit | null {
    if (this.mode !== 'throw' || !this.cup.visible) return null
    const canvas = this.renderer.domElement
    const rect = canvas.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const hits = this.raycaster.intersectObject(this.cup, false)
    const hit = hits.find((item) => item.object === this.cup && item.face)
    if (!hit?.face) return null
    this.hitNormal.copy(hit.face.normal).transformDirection(this.cup.matrixWorld).normalize()
    const rx = hit.point.x - this.cup.position.x
    const rz = hit.point.z - this.cup.position.z
    let radial = Math.hypot(rx, rz)
    const worldAng = Math.atan2(rx, rz)
    const localAng = worldAng - this.cup.rotation.y
    const sectorCount = this.sectorOuter.length
    const sector = sectorCount > 0 ? sectorOf(localAng, sectorCount) : -1
    const radii = sector >= 0 ? (this.sectorOuter[sector] ?? this.wallRadii) : this.wallRadii
    const heights = sector >= 0 ? (this.sectorHeights[sector] ?? this.wallHeights) : this.wallHeights
    const thicks = sector >= 0 ? (this.sectorThick[sector] ?? this.wallThick) : this.wallThick
    let t = Math.max(0, hit.point.y - this.cup.position.y)
    const outward = radial > 0.001 ? (this.hitNormal.x * rx + this.hitNormal.z * rz) / radial : 0
    let inner = outward < 0
    if (Math.abs(outward) < 0.2) {
      const outer = sampleAt(radii, heights, t)
      const thick = sampleAt(thicks, heights, t) || 0.08
      inner = radial < Math.max(0.02, outer - thick * 0.45)
    }
    const profile = inner
      ? radii.map((radius, i) => Math.max(0.004, (radius ?? 0) - (thicks[i] ?? thicks[thicks.length - 1] ?? 0.08)))
      : radii
    const corner = snap ? snapCorner(radial, t, profile, heights.length === profile.length ? heights : []) : null
    let x = hit.point.x
    let y = hit.point.y
    let z = hit.point.z
    let snapped = false
    if (corner) {
      snapped = true
      t = Math.max(0, corner.y)
      radial = corner.r
      x = this.cup.position.x + Math.sin(worldAng) * corner.r
      y = this.cup.position.y + corner.y
      z = this.cup.position.z + Math.cos(worldAng) * corner.r
    }
    return {
      x,
      y,
      z,
      nx: this.hitNormal.x,
      ny: this.hitNormal.y,
      nz: this.hitNormal.z,
      t,
      radial,
      inner,
      ang: worldAng,
      snapped,
    }
  }

  dragAt(x: number, y: number, z: number, dx: number, dy: number): { dr: number; dy: number } | null {
    if (dx === 0 && dy === 0) return null
    const canvas = this.renderer.domElement
    const rect = canvas.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    this.camera.updateMatrixWorld()
    const dist = this.camera.position.distanceTo(this.strokeMotion.set(x, y, z))
    const worldH = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * Math.max(dist, 0.2)
    const worldW = worldH * (rect.width / rect.height)
    const sx = (dx / rect.width) * worldW
    const sy = -(dy / rect.height) * worldH
    this.camera.matrixWorld.extractBasis(this.camRight, this.camUp, this.camBack)
    this.strokeMotion.copy(this.camRight).multiplyScalar(sx).addScaledVector(this.camUp, sy)
    const rx = x - this.cup.position.x
    const rz = z - this.cup.position.z
    const radial = Math.hypot(rx, rz) || 1
    return {
      dr: (this.strokeMotion.x * rx + this.strokeMotion.z * rz) / radial,
      dy: this.strokeMotion.y,
    }
  }

  strokeCup(clientX: number, clientY: number, dx: number, dy: number, snap = true): { t: number; dr: number; dy: number; ang: number } | null {
    const hit = this.probeCup(clientX, clientY, snap)
    if (!hit) return null
    const motion = this.dragAt(hit.x, hit.y, hit.z, dx, dy)
    if (!motion) return null
    return { t: hit.t, dr: motion.dr, dy: motion.dy, ang: hit.ang }
  }

  fingerCenter(hit: SurfaceHit): { x: number; y: number; z: number } {
    if (hit.snapped) {
      const rx = hit.x - this.cup.position.x
      const rz = hit.z - this.cup.position.z
      const radial = Math.hypot(rx, rz) || 1
      const sign = hit.inner ? -1 : 1
      const lift = 0.028
      return {
        x: hit.x + (rx / radial) * lift * sign,
        y: hit.y + 0.012,
        z: hit.z + (rz / radial) * lift * sign,
      }
    }
    return {
      x: hit.x + hit.nx * 0.072,
      y: hit.y + hit.ny * 0.072,
      z: hit.z + hit.nz * 0.072,
    }
  }

  pointOnCup(x: number, y: number, z: number): { radial: number; t: number; ang: number } {
    const rx = x - this.cup.position.x
    const rz = z - this.cup.position.z
    return { radial: Math.hypot(rx, rz), t: y - this.cup.position.y, ang: Math.atan2(rx, rz) }
  }

  /** 鼠标射线交在经过锚点、正对镜头的平面上。按住时圆球用它跟着手走，不再贴杯壁。 */
  cursorOnPlane(clientX: number, clientY: number, ax: number, ay: number, az: number): { x: number; y: number; z: number } | null {
    const canvas = this.renderer.domElement
    const rect = canvas.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.ndc, this.camera)
    this.camera.updateMatrixWorld()
    this.camera.getWorldDirection(this.planeNormal)
    this.planePoint.set(ax, ay, az).sub(this.raycaster.ray.origin)
    const denom = this.raycaster.ray.direction.dot(this.planeNormal)
    if (Math.abs(denom) < 1e-5) return null
    const depth = this.planePoint.dot(this.planeNormal) / denom
    if (depth < 0) return null
    this.planePoint.copy(this.raycaster.ray.origin).addScaledVector(this.raycaster.ray.direction, depth)
    return { x: this.planePoint.x, y: this.planePoint.y, z: this.planePoint.z }
  }

  placeFinger(hit: SurfaceHit | null): void {
    if (!hit || this.mode !== 'throw') {
      this.finger.visible = false
      return
    }
    const radius = Math.max(0.05, hit.radial)
    if (Math.abs(radius - this.ringRadius) > 0.002) {
      this.ringRadius = radius
      this.finger.geometry.dispose()
      this.finger.geometry = new TorusGeometry(radius, 0.013, 12, 72)
    }
    const shift = swayOffset(hit.t, this.sway, this.swayTime)
    const yaw = this.cup.rotation.y
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    this.finger.visible = true
    this.finger.position.set(
      this.cup.position.x + shift.x * cos + shift.z * sin,
      this.cup.position.y + hit.t,
      this.cup.position.z - shift.x * sin + shift.z * cos,
    )
  }

  private placeThrowCamera(): void {
    const cp = Math.cos(this.throwPitch)
    const dist = this.throwDist
    this.camera.position.set(
      Math.sin(this.throwYaw) * cp * dist,
      0.48 + Math.sin(this.throwPitch) * dist,
      Math.cos(this.throwYaw) * cp * dist,
    )
    this.camera.lookAt(0, 0.48, 0)
  }

  pick(clientX: number, clientY: number): string | null {
    const canvas = this.renderer.domElement
    const rect = canvas.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const hits = this.raycaster.intersectObjects(this.pickables, true)
    for (const hit of hits) {
      let node: Object3D | null = hit.object
      while (node) {
        const id = node.userData.pickId as string | undefined
        if (id && this.shown(node)) return id
        node = node.parent
      }
    }
    return null
  }

  private shown(obj: Object3D): boolean {
    let node: Object3D | null = obj
    while (node) {
      if (!node.visible) return false
      node = node.parent
    }
    return true
  }

  private syncDeposits(): void {
    const keep = new Set(this.depositState.map((item) => item.key))
    for (const [key, mesh] of this.depositMeshes) {
      if (keep.has(key)) continue
      this.scene.remove(mesh)
      mesh.geometry.dispose()
      const mat = mesh.material
      if (!Array.isArray(mat)) mat.dispose()
      this.depositMeshes.delete(key)
    }
    for (const item of this.depositState) {
      let mesh = this.depositMeshes.get(item.key)
      if (!mesh) {
        mesh = new Mesh(
          new SphereGeometry(0.075, 18, 14),
          new MeshStandardMaterial({ color: item.color, roughness: 0.78 }),
        )
        mesh.userData.key = item.key
        mesh.userData.seat = this.seatOnBall()
        this.scene.add(mesh)
        this.depositMeshes.set(item.key, mesh)
      }
      mesh.userData.deposit = item
      const mat = mesh.material
      if (!Array.isArray(mat) && mat instanceof MeshStandardMaterial) mat.color.set(item.color)
    }
  }

  private seatOnBall(): Vector3 {
    const yaw = (Math.random() - 0.5) * 1.7
    const pitch = 0.05 + Math.random() * 1.2
    const lift = Math.sin(pitch)
    const ring = Math.cos(pitch)
    return new Vector3(Math.sin(yaw) * ring, lift, Math.abs(Math.cos(yaw)) * ring).normalize()
  }

  private placeDeposits(): void {
    if (this.depositMeshes.size === 0) return
    this.ball.updateMatrixWorld(true)
    for (const mesh of this.depositMeshes.values()) {
      const data = mesh.userData.deposit as NonNullable<ScenePatch['deposits']>[number] | undefined
      const pile = data ? this.piles.get(data.id) : undefined
      if (!data || !pile) continue
      const seat = mesh.userData.seat as Vector3
      this.depositEnd.copy(seat).multiplyScalar(0.36)
      this.ball.localToWorld(this.depositEnd)
      pile.getWorldPosition(this.depositStart)
      this.depositStart.y += 0.22
      const fly = Math.max(0, Math.min(1, data.fly))
      const u = fly * fly * (3 - 2 * fly)
      this.depositPoint.lerpVectors(this.depositStart, this.depositEnd, u)
      this.depositPoint.y += Math.sin(fly * Math.PI) * 0.32
      mesh.position.copy(this.depositPoint)
      const absorb = Math.max(0, Math.min(1, data.absorb))
      mesh.scale.setScalar(Math.max(0.04, 1 - absorb))
      mesh.visible = absorb < 0.98
    }
  }

  private syncPours(): void {
    const keep = new Set(this.pourState.map((item) => item.key))
    for (const [key, group] of this.pourGroups) {
      if (keep.has(key)) continue
      this.scene.remove(group)
      const first = group.children[0] as Mesh | undefined
      const shared = first && !Array.isArray(first.material) ? first.material : null
      group.traverse((obj) => {
        const mesh = obj as Mesh
        if (mesh.geometry) mesh.geometry.dispose()
      })
      shared?.dispose()
      this.pourGroups.delete(key)
    }
    for (const item of this.pourState) {
      let group = this.pourGroups.get(item.key)
      if (!group) {
        group = new Group()
        group.userData.seat = this.seatOnBall()
        const dropMat = new MeshStandardMaterial({
          color: '#2E94B5',
          emissive: '#14556C',
          emissiveIntensity: 0.4,
          roughness: 0.12,
          transparent: true,
          opacity: 0.92,
        })
        for (let i = 0; i < 5; i++) {
          const drop = new Mesh(new SphereGeometry(i === 0 ? 0.045 : 0.03, 12, 10), dropMat)
          drop.userData.lag = i * 0.11
          group.add(drop)
        }
        this.scene.add(group)
        this.pourGroups.set(item.key, group)
      }
      group.userData.fly = item.fly
      group.visible = true
    }
  }

  private placePours(): void {
    if (this.pourGroups.size === 0) return
    this.ball.updateMatrixWorld(true)
    for (const group of this.pourGroups.values()) {
      const fly = Math.max(0, Number(group.userData.fly) || 0)
      const seat = group.userData.seat as Vector3
      this.depositEnd.copy(seat).multiplyScalar(0.34)
      this.ball.localToWorld(this.depositEnd)
      this.basin.getWorldPosition(this.depositStart)
      this.depositStart.y += 0.32
      for (const child of group.children) {
        const drop = child as Mesh
        const lag = Number(drop.userData.lag) || 0
        const t = fly - lag
        if (t <= 0.02 || t >= 1) {
          drop.visible = false
          continue
        }
        const u = Math.min(1, t)
        const ease = u * u * (3 - 2 * u)
        this.depositPoint.lerpVectors(this.depositStart, this.depositEnd, ease)
        this.depositPoint.y += Math.sin(u * Math.PI) * 0.46
        drop.position.copy(this.depositPoint)
        drop.visible = true
        drop.scale.setScalar(0.85 + (1 - u) * 0.35)
      }
    }
  }

  private applyBench(bench: NonNullable<ScenePatch['bench']>): void {
    const ids = ['diger', 'kaolin', 'aged'] as const
    for (const id of ids) {
      const mesh = this.piles.get(id)
      if (!mesh) continue
      mesh.scale.set(0.9, 0.62, 0.9)
      mesh.position.y = 0.22 * 0.62 - 0.02
      const mat = mesh.material
      if (!Array.isArray(mat) && mat instanceof MeshStandardMaterial) {
        mat.color.set(bench.colors[id] || '#8C4030')
        mat.emissive.set('#000000')
        mat.emissiveIntensity = 0
      }
    }
    const wt = Math.max(0, Math.min(1, bench.water / 40))
    const spread = 0.78 + wt * 0.22
    this.waterMesh.scale.set(spread, spread, 1)
    this.waterMesh.position.y = 0.09 + wt * 0.08
    const shellMat = this.basinShell.material
    if (!Array.isArray(shellMat) && shellMat instanceof MeshStandardMaterial) {
      shellMat.emissive.set('#000000')
      shellMat.emissiveIntensity = 0
    }
    const selected = bench.selected === 'water'
      ? this.basin
      : bench.selected
        ? this.piles.get(bench.selected)
        : undefined
    this.selectRing.visible = Boolean(selected)
    if (selected) {
      const footprint = selected === this.basin ? 0.38 : 0.22 * (selected as Mesh).scale.x
      this.ringBase = (footprint + 0.06) / 0.344
      this.selectRing.position.set(selected.position.x, 0.015, selected.position.z)
    }
  }

  private applyJars(jars: NonNullable<ScenePatch['jars']>): void {
    this.jarGroups.forEach((group, index) => {
      const jar = jars[index]
      const liquid = this.jarLiquids[index]
      group.visible = Boolean(jar)
      if (!jar || !liquid) return
      group.userData.pickId = `glaze:${jar.id}`
      const pot = group.children[0] as Mesh
      const potMat = pot.material
      if (!Array.isArray(potMat) && potMat instanceof MeshStandardMaterial) {
        potMat.color.set('#E6E0D6')
        potMat.emissive.set(jar.on ? jar.color : '#000000')
        potMat.emissiveIntensity = jar.on ? 0.55 : 0.08
      }
      const liquidMat = liquid.material
      if (!Array.isArray(liquidMat) && liquidMat instanceof MeshStandardMaterial) liquidMat.color.set(jar.color)
      const level = 0.03 + Math.max(0, Math.min(1, jar.concentration)) * 0.1
      liquid.scale.y = level
      liquid.position.y = 0.04 + level / 2
    })
  }

  capture(): string {
    try {
      return this.renderer.domElement.toDataURL('image/png')
    } catch {
      return ''
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.scene.traverse((obj) => {
      const mesh = obj as Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const mat = mesh.material
      if (Array.isArray(mat)) mat.forEach((item) => item.dispose())
      else mat?.dispose()
    })
    this.mapTexture?.dispose()
    this.plateTextures.forEach((tex) => tex.dispose())
    this.renderer.dispose()
  }
}
