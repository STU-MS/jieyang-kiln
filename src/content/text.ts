import ui from '../content/ui.json'
import lines from '../content/master-lines.json'
import cards from '../content/knowledge-cards.json'
import events from '../content/events.json'
import glossary from '../content/glossary.json'

export interface KnowledgeCard {
  id: string
  hidden: boolean
  title: string
  body: string
  source: string
  quiz: string
  choices: string[]
  answer: number
}

function flatten(prefix: string, value: unknown, into: Map<string, string>): void {
  if (typeof value === 'string') {
    into.set(prefix, value)
    return
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(`${prefix}.${k}`, v, into)
  }
}

const dict = new Map<string, string>()
flatten('ui', ui, dict)
flatten('lines', lines, dict)

export function t(id: string): string {
  return dict.get(id) ?? id
}

export function f(id: string, vars: Record<string, string | number>): string {
  return t(id).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

export function hasText(id: string): boolean {
  return dict.has(id)
}

export function allTextIds(): string[] {
  return [...dict.keys()]
}

export function masterLine(stage: string): string {
  return t(`lines.${stage}`)
}

export function allCards(): KnowledgeCard[] {
  return cards.cards as KnowledgeCard[]
}

export function visibleCards(): KnowledgeCard[] {
  return allCards().filter((c) => !c.hidden)
}

export function cardById(id: string): KnowledgeCard | undefined {
  return allCards().find((c) => c.id === id)
}

export interface GameEvent {
  id: string
  phase: 'dry' | 'bisque' | 'fire'
  playerTriggered: boolean
  action: string
  title: string
  omen: string
  actionLabel: string
  cause: string
  successEffect: string
  failEffect: string
  avoid: string
  weight: number
  boostWeather: string[]
  boostSeason: string[]
}

export function allEvents(): GameEvent[] {
  return events.events as GameEvent[]
}

export function eventById(id: string): GameEvent | undefined {
  return allEvents().find((e) => e.id === id)
}

export function verses(): { id: string; text: string }[] {
  return glossary.verses
}

export function glossaryClays(): Record<string, string> {
  return glossary.clays
}

export function glossaryGlazes(): Record<string, string> {
  return glossary.glazes
}
