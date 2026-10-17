import { allCards, cardById, visibleCards, type KnowledgeCard } from '../content/text'
import { hashString } from './rng'
import type { Grade, Profile } from './types'
import { emptyProfile } from './types'

export function localDate(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function giftCards(profile: Profile = emptyProfile()): Profile {
  const owned = new Set(profile.knowledgeCardIds)
  let given = 0
  for (const card of visibleCards()) {
    if (given >= 3) break
    if (owned.has(card.id)) continue
    owned.add(card.id)
    given += 1
  }
  return { ...profile, knowledgeCardIds: [...owned], giftNoted: true }
}

export function awardCards(profile: Profile, grade: Grade, today: string): { profile: Profile; gained: string[] } {
  const owned = new Set(profile.knowledgeCardIds)
  const gained: string[] = []
  for (const card of visibleCards()) {
    if (gained.length >= 2) break
    if (owned.has(card.id)) continue
    owned.add(card.id)
    gained.push(card.id)
  }
  if (grade === 'L0') {
    const hidden = allCards().find((card) => card.hidden)
    if (hidden && !owned.has(hidden.id)) {
      owned.add(hidden.id)
      gained.push(hidden.id)
    }
  }
  return {
    gained,
    profile: {
      ...profile,
      knowledgeCardIds: [...owned],
      clearCount: profile.clearCount + 1,
      lastClearDate: today,
    },
  }
}

export function pickQuiz(profile: Profile, today: string): KnowledgeCard | null {
  if (!profile.lastClearDate || profile.lastClearDate >= today) return null
  if (profile.lastQuizDate === today) return null
  const owned = profile.knowledgeCardIds.map((id) => cardById(id)).filter((card): card is KnowledgeCard => Boolean(card))
  if (owned.length === 0) return null
  const index = hashString(`${today}|${profile.lastClearDate}`) % owned.length
  return owned[index] ?? null
}

export { emptyProfile }
