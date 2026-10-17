import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import clay from '../src/data/clay.json'
import glaze from '../src/data/glaze.json'
import climate from '../src/data/climate.json'
import lines from '../src/content/master-lines.json'
import glossary from '../src/content/glossary.json'
import { manifest, referencedAssetIds } from '../src/assets/manifest'
import { hasText } from '../src/content/text'

const root = fileURLToPath(new URL('..', import.meta.url))
const srcDir = join(root, 'src')
const contentDir = join(srcDir, 'content')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx|js|jsx|css|json)$/.test(name)) out.push(full)
  }
  return out
}

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

export function collectProblems(): string[] {
  const problems: string[] = []
  const ids = new Set(manifest.map((entry) => entry.id))
  if (ids.size !== manifest.length) problems.push('资产 id 有重复')
  const referenced = new Set(referencedAssetIds)
  if (referenced.size !== ids.size || [...ids].some((id) => !referenced.has(id))) problems.push('referencedAssetIds 与清单不一致')
  for (const entry of manifest) {
    if (!entry.placeholder?.type || !entry.placeholder.value) problems.push(`占位为空：${entry.id}`)
  }
  for (const item of clay.clays) if (!ids.has(item.card)) problems.push(`陶土卡不在清单：${item.card}`)
  for (const item of glaze.glazes) if (!ids.has(item.card)) problems.push(`釉卡不在清单：${item.card}`)
  for (const item of climate.weathers) if (!ids.has(item.sky)) problems.push(`天空不在清单：${item.sky}`)

  const glossaryClay = glossary.clays as Record<string, string>
  const glossaryGlaze = glossary.glazes as Record<string, string>
  for (const item of clay.clays) {
    if (glossaryClay[item.id] !== item.name) problems.push(`泥名不一致：${item.id}`)
  }
  for (const item of glaze.glazes) {
    if (glossaryGlaze[item.id] !== item.name) problems.push(`釉名不一致：${item.id}`)
  }

  const banned = /你错了|失败|笨/
  for (const file of walk(contentDir)) {
    if (banned.test(read(file))) problems.push(`文案含禁用词：${relative(root, file)}`)
  }

  const stages = ['mix', 'throw', 'dry', 'glaze', 'fire'] as const
  const length = stages.reduce((sum, key) => sum + lines[key].length, 0)
  if (length < 300 || length > 440) problems.push(`五道师傅话长度为 ${length}，期望大约 400 字`)

  const parts = ['png', 'glb', 'mp3', 'jpg', 'jpeg', 'woff2']
  const fileRef = new RegExp(`['"\`][^'"\`\\n]*\\.(?:${parts.join('|')})['"\`]`, 'i')
  const assetCall = /assetId\(\s*['"]([^'"]+)['"]\s*\)/g
  const textCall = /\b[tf]\(\s*['"]([^'"]+)['"]/g
  const dynamicOk = /^(ui\.(stage|quality|note|season|weather|place|tool|shapeWord|glazeWord|grade|flaw|cost)\.|lines\.)/
  for (const file of walk(srcDir)) {
    const text = read(file)
    if (fileRef.test(text)) problems.push(`源码写死了资源后缀：${relative(root, file)}`)
    for (const match of text.matchAll(assetCall)) {
      if (!ids.has(match[1])) problems.push(`未知资产：${match[1]} @ ${relative(root, file)}`)
    }
    for (const match of text.matchAll(textCall)) {
      if (!hasText(match[1])) problems.push(`缺少文案：${match[1]} @ ${relative(root, file)}`)
    }
    for (const match of text.matchAll(/\b[tf]\(\s*`([^`$]+)`/g)) {
      if (!hasText(match[1])) problems.push(`缺少文案：${match[1]} @ ${relative(root, file)}`)
    }
    for (const match of text.matchAll(/\b[tf]\(\s*`([^`]*\$\{[^`]*)`/g)) {
      const head = match[1].split('${')[0]
      if (head && !dynamicOk.test(head) && !hasText(head)) problems.push(`动态文案前缀未登记：${head} @ ${relative(root, file)}`)
    }
  }
  return problems
}

const invoked = process.argv[1]?.replace(/\\/g, '/').includes('scripts/check-assets')
if (invoked) {
  const problems = collectProblems()
  if (problems.length) {
    for (const problem of problems) console.error(problem)
    process.exit(1)
  }
  console.log(`资产与文案检查通过，清单 ${manifest.length} 条`)
}
