/**
 * 离线裁剪人物基础网格（issue #19）。
 *
 * 输入：kblood/CharacterCreator 仓库 output/base_body.glb（CC0-1.0，源全为 MakeHuman CC0 资产，
 * 依据该仓库 LICENSE-NOTES.md；下载地址见 src/assets/manifest.ts 的 source）。
 * 输出：只含骨架 + 身体网格 + 滑杆用到的 morph 的 GLB，湿泥材质、贴图、五官小件、多余 morph 全部去掉。
 *
 * 用法：node tools/build-body.mjs <输入.glb> <输出.glb>
 * 保留哪些 morph 从 src/data/shape.json 的滑杆通道里读（gen_* 是运行时生成的，不在 GLB 里）。
 */
import { NodeIO } from '@gltf-transform/core'
import { KHRMeshQuantization } from '@gltf-transform/extensions'
import { prune, dedup } from '@gltf-transform/functions'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('用法：node tools/build-body.mjs <输入.glb> <输出.glb>')
  process.exit(1)
}

const shape = JSON.parse(readFileSync(resolve(root, 'src/data/shape.json'), 'utf8'))
/** GLB 里需要保留的原生 morph（gen_* 由运行时按骨骼权重生成） */
const KEEP = new Set(
  Object.values(shape.parts)
    .flatMap((part) => part.sliders)
    .flatMap((slider) => slider.channels)
    .map((channel) => channel.morph)
    .filter((name) => !name.startsWith('gen_')),
)

const BODY_MESH = 'base'

const doc = await new NodeIO().registerExtensions([KHRMeshQuantization]).read(input)
const scene = doc.getRoot()

// ① 只留身体网格；眼睛 / 眉毛 / 睫毛 / 牙齿 / 舌头都不做（陶塑的脸是捏出来的，本阶段也用不到）
for (const mesh of scene.listMeshes()) {
  if (mesh.getName() !== BODY_MESH) mesh.dispose()
}
for (const node of scene.listNodes()) {
  const mesh = node.getMesh()
  if (mesh && mesh.getName() !== BODY_MESH) node.dispose()
  // 节点上的 weights 覆盖同理，长度对不上会再次把 influences 撑长
  if (node.getWeights().length > 0) node.setWeights([])
}

// ② 贴图 / 材质全部去掉：湿泥材质在运行时给（一张 CC0 泥贴图），泥稿阶段不需要皮肤贴图
for (const material of scene.listMaterials()) material.dispose()
for (const texture of scene.listTextures()) texture.dispose()

// ③ morph 只留滑杆用到的，名字顺序写进 mesh.extras.targetNames（three.js 靠它建 dictionary）
for (const mesh of scene.listMeshes()) {
  const names = mesh.getExtras().targetNames ?? []
  const keepIdx = names.map((name, i) => (KEEP.has(name) ? i : -1)).filter((i) => i >= 0)
  for (const prim of mesh.listPrimitives()) {
    const targets = prim.listTargets()
    // 多余的顶点属性（kblood 的 _CCZONE / 用不到的 TEXCOORD 之外的语义）一并清掉
    for (const semantic of prim.listSemantics()) {
      if (!['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'].includes(semantic)) {
        prim.setAttribute(semantic, null)
      }
    }
    if (targets.length !== names.length) {
      throw new Error(`morph 数量对不上：targets ${targets.length} / targetNames ${names.length}`)
    }
    targets.forEach((target, i) => {
      if (!keepIdx.includes(i)) prim.removeTarget(target)
    })
  }
  mesh.setExtras({ ...mesh.getExtras(), targetNames: keepIdx.map((i) => names[i]) })
  // 默认权重数组也要跟着裁：three 会按它写 morphTargetInfluences，长度对不上就丢掉所有 target 名
  const weights = mesh.getWeights()
  if (weights.length !== keepIdx.length) mesh.setWeights(keepIdx.map((i) => weights[i] ?? 0))
}

await doc.transform(prune(), dedup())

const io = new NodeIO().registerExtensions([KHRMeshQuantization])
const glb = await io.writeBinary(doc)
writeFileSync(output, glb)
console.log(`输入 ${input} → 输出 ${output}`)
console.log(`保留 morph：${[...KEEP].join(', ')}`)
console.log(`输出体积：${glb.byteLength} 字节`)
