import { useEffect, useRef, useState } from 'react'
import climate from '../data/climate.json'
import { colorOf } from '../assets/registry'
import { cardById, f, t, verses, visibleCards } from '../content/text'
import { session } from '../game/session'
import { clayBodyColor, hexToRgb, mixHex } from '../render/color'
import { CupView, type CupHandle } from '../render/CupView'
import { skyColor } from '../render/scene'
import { downloadShare } from '../render/shareImage'
import { bakeCupTexture, textureSeed } from '../render/textureJob'
import { encodeCup } from '../sim/share'
import { glazeById } from '../sim/glaze'
import { writeSave } from '../persist/storage'
import type { CupSnapshot, Profile } from '../sim/types'
import type { KnowledgeCard } from '../content/text'

const CRAFT_PATH = ['mix', 'throw', 'dry', 'glaze', 'fire'] as const

export function HomeScreen({
  profile,
  monthLabel,
  blurb,
  practice,
  onPractice,
  practiceUnlocked,
  onStart,
  onContinue,
  onAtlas,
  onArchive,
  quiz,
  onQuiz,
}: {
  profile: Profile
  monthLabel: string
  blurb: string
  practice: boolean
  onPractice: (value: boolean) => void
  practiceUnlocked: boolean
  onStart: () => void
  onContinue: (() => void) | null
  onAtlas: () => void
  onArchive: () => void
  quiz: KnowledgeCard | null
  onQuiz: () => void
}) {
  const hasRun = Boolean(session.get().run)
  const title = t('ui.appTitle')
  return (
    <section className="welcome">
      <div className="welcome-stage">
        <p className="welcome-kicker">{monthLabel}</p>
        <h1 className="welcome-title" aria-label={title}>
          <span aria-hidden="true">{title.slice(0, 2)}</span>
          <span aria-hidden="true">{title.slice(2)}</span>
        </h1>
        <p className="welcome-sub">{t('ui.appSub')}</p>
        <figure className="welcome-still">
          <div className="welcome-plate" aria-hidden="true">
            <WelcomeMark />
          </div>
          <figcaption className="welcome-path" aria-label={CRAFT_PATH.map((id) => t(`ui.stage.${id}`)).join('，')}>
            {CRAFT_PATH.map((id) => (
              <span key={id}>{t(`ui.stage.${id}`)}</span>
            ))}
          </figcaption>
        </figure>
        <div className="welcome-rest">
          <p className="welcome-blurb">{blurb}</p>
          {profile.clearCount < 3 ? <p className="welcome-note">{t('ui.novice')}</p> : null}
          <aside className="welcome-master">
            <span className="welcome-seal" aria-hidden="true">陈</span>
            <div>
              <p className="welcome-master-name">{t('ui.portraitName')}</p>
              <p>{t('lines.home')}</p>
            </div>
          </aside>
        </div>
        <div className="welcome-actions-block">
          <div className="welcome-actions">
            <button type="button" className="welcome-start" onClick={onStart}>{t('ui.start')}</button>
            {hasRun && onContinue ? <button type="button" className="ghost welcome-continue" onClick={onContinue}>{t('ui.continue')}</button> : null}
          </div>
          <nav className="welcome-links" aria-label={t('ui.appTitle')}>
            <button type="button" onClick={onAtlas}>{t('ui.atlas')}</button>
            <button type="button" onClick={onArchive}>{t('ui.archive')}</button>
            {quiz ? <button type="button" onClick={onQuiz}>{t('ui.quizTitle')}</button> : <span className="fine">{t('ui.quizNeed')}</span>}
          </nav>
          {practiceUnlocked ? (
            <label className="check welcome-practice">
              <input type="checkbox" checked={practice} onChange={(event) => onPractice(event.target.checked)} />
              {t('ui.practice')}
            </label>
          ) : null}
          {practice && practiceUnlocked ? <p className="welcome-note">{t('ui.practiceOn')}</p> : null}
        </div>
      </div>
      <footer className="welcome-foot">
        {practiceUnlocked ? null : <p>{t('ui.practiceLocked')}</p>}
        <p>{t('ui.privacy')}</p>
        <p>{t('ui.placeholderNote')}</p>
        <p>{t('ui.reviewPending')}</p>
      </footer>
    </section>
  )
}

function WelcomeMark() {
  const cup = 'M150 202C146 240 156 288 178 322C196 340 210 350 216 358L216 370C216 382 320 382 320 370L320 358C326 350 340 340 358 322C380 288 390 240 386 202C352 180 184 180 150 202Z'
  return (
    <svg className="welcome-art" viewBox="0 0 520 480" role="presentation">
      <defs>
        <radialGradient id="welcome-glow" cx="50%" cy="42%" r="52%">
          <stop offset="0%" stopColor="#fff8ee" />
          <stop offset="62%" stopColor="#f0d7bc" />
          <stop offset="100%" stopColor="#e7c4a4" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="welcome-body" x1="0" y1="0" x2="1" y2="0.15">
          <stop offset="0%" stopColor="#7d948c" />
          <stop offset="42%" stopColor="#6e8680" />
          <stop offset="58%" stopColor="#8c4030" />
          <stop offset="100%" stopColor="#7a382c" />
        </linearGradient>
        <clipPath id="welcome-cup-clip">
          <path d={cup} />
        </clipPath>
      </defs>
      <ellipse className="welcome-glow" cx="268" cy="250" rx="188" ry="176" fill="url(#welcome-glow)" />
      <ellipse cx="268" cy="412" rx="168" ry="12" fill="#3a332c" opacity="0.1" />
      <ellipse cx="268" cy="386" rx="156" ry="28" fill="#6e5344" />
      <ellipse cx="268" cy="370" rx="156" ry="28" fill="#d2ae88" />
      <ellipse cx="268" cy="370" rx="114" ry="20" fill="none" stroke="#a88462" strokeWidth="2" />
      <ellipse cx="268" cy="370" rx="70" ry="12" fill="none" stroke="#8d6b50" strokeWidth="1.5" />
      <ellipse cx="268" cy="370" rx="8" ry="2.2" fill="#4a3428" />
      <path d={cup} fill="url(#welcome-body)" />
      <g clipPath="url(#welcome-cup-clip)">
        <path d="M176 224C184 272 176 312 190 354" fill="none" stroke="#fff6ee" strokeWidth="7" strokeLinecap="round" opacity="0.38" />
      </g>
      <path fill="#d7bba0" d="M216 360L216 370C216 382 320 382 320 370L320 360Z" />
      <ellipse cx="268" cy="198" rx="120" ry="22" fill="#ead4c0" />
      <ellipse cx="268" cy="200" rx="98" ry="16" fill="#d8b89c" />
      <ellipse cx="268" cy="202" rx="74" ry="11" fill="#c49a78" />
      <ellipse cx="268" cy="194" rx="122" ry="23" fill="none" stroke="#6e5344" strokeWidth="1.6" />
      <path fill="#b46348" d="M78 348C64 318 108 302 140 320C164 334 158 368 122 374C94 378 84 364 78 348Z" />
      <path d="M98 336C116 324 136 332 142 346" fill="none" stroke="#8c4030" strokeWidth="3" strokeLinecap="round" opacity="0.45" />
    </svg>
  )
}

export function AtlasScreen({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const owned = new Set(profile.knowledgeCardIds)
  return (
    <section className="panel wide">
      <h2>{t('ui.atlas')}</h2>
      <p>{t('ui.atlasLead')}</p>
      <p className="fine">{t('ui.reviewPending')}</p>
      <div className="cards">
        {visibleCards().map((card) => (
          <article key={card.id} className="card">
            <header>
              <b>{owned.has(card.id) ? card.title : t('ui.lockedCard')}</b>
              {owned.has(card.id) ? <small>{t('ui.owned')}</small> : null}
            </header>
            {owned.has(card.id) ? (
              <>
                <p>{card.body}</p>
                <p className="fine">{t('ui.source')}：{card.source}</p>
              </>
            ) : null}
          </article>
        ))}
        {profile.knowledgeCardIds.includes('card.hidden') ? (
          <article className="card">
            <header><b>{cardById('card.hidden')?.title}</b></header>
            <p>{cardById('card.hidden')?.body}</p>
            <p className="fine">{cardById('card.hidden')?.source}</p>
          </article>
        ) : null}
      </div>
      <h2>{t('ui.climateTitle')}</h2>
      {climate.seasons.map((season) => (
        <p key={season.id}><b>{t(`ui.season.${season.id}`)}</b> {season.blurb}</p>
      ))}
      <p className="fine">{climate.sourceNote}</p>
      <h2>{t('ui.verses')}</h2>
      {verses().map((verse) => <p key={verse.id}>{verse.text}</p>)}
      <button type="button" onClick={onBack}>{t('ui.home')}</button>
    </section>
  )
}

export function ArchiveScreen({ profile, onBack, webgl }: { profile: Profile; onBack: () => void; webgl: boolean }) {
  const [tab, setTab] = useState<'whole' | 'residual'>('whole')
  const [picked, setPicked] = useState<CupSnapshot | null>(null)
  const list = profile.cups.filter((cup) => (tab === 'residual' ? cup.result.grade === 'L2' || cup.flaws.length > 0 : cup.result.grade !== 'L2'))
  return (
    <section className="panel wide">
      <h2>{t('ui.archive')}</h2>
      <div className="row">
        <button type="button" className={tab === 'whole' ? '' : 'ghost'} onClick={() => setTab('whole')}>{t('ui.whole')}</button>
        <button type="button" className={tab === 'residual' ? '' : 'ghost'} onClick={() => setTab('residual')}>{t('ui.residual')}</button>
      </div>
      {list.length === 0 ? <p>{t('ui.archiveEmpty')}</p> : null}
      <div className="cards">
        {list.map((cup) => (
          <button key={cup.result.uniqueId} type="button" className="card" onClick={() => setPicked(cup)}>
            <b>{cup.result.uniqueId}</b>
            <span>{t(`ui.grade.${cup.result.grade}`)}</span>
          </button>
        ))}
      </div>
      {picked ? <CupPoster shot={picked} webgl={webgl} elapsed="" gained={[]} /> : null}
      <button type="button" onClick={onBack}>{t('ui.home')}</button>
    </section>
  )
}

export function QuizScreen({
  card,
  onAnswer,
  note,
  onBack,
}: {
  card: KnowledgeCard
  onAnswer: (index: number) => void
  note: string
  onBack: () => void
}) {
  return (
    <section className="panel">
      <h2>{t('ui.quizTitle')}</h2>
      <p>{card.quiz}</p>
      <div className="stack">
        {card.choices.map((choice, index) => (
          <button key={choice} type="button" disabled={Boolean(note)} onClick={() => onAnswer(index)}>
            {choice}
          </button>
        ))}
      </div>
      {note ? <p>{note}</p> : <p className="fine">{t('ui.quizLater')}</p>}
      <button type="button" className="ghost" onClick={onBack}>{t('ui.home')}</button>
    </section>
  )
}

export function ResultScreen({
  shot,
  elapsed,
  gained,
  webgl,
  onAgain,
  onHome,
}: {
  shot: CupSnapshot
  elapsed: string
  gained: string[]
  webgl: boolean
  onAgain: () => void
  onHome: () => void
}) {
  return (
    <section className="panel wide">
      <CupPoster shot={shot} webgl={webgl} elapsed={elapsed} gained={gained} />
      <div className="row">
        <button type="button" onClick={onAgain}>{t('ui.again')}</button>
        <button type="button" className="ghost" onClick={onHome}>{t('ui.home')}</button>
      </div>
    </section>
  )
}

export function CupPoster({
  shot,
  webgl,
  elapsed,
  gained,
}: {
  shot: CupSnapshot
  webgl: boolean
  elapsed: string
  gained: string[]
}) {
  const cup = useRef<CupHandle>(null)
  const [note, setNote] = useState('')
  const color = clayBodyColor(shot.clay.parts)
  const glaze = mixGlaze(shot)
  useEffect(() => {
    let alive = true
    const colors = shot.glaze.picks.map((pick) => hexToRgb(colorOf(glazeById(pick.id)?.card ?? 'ui.glaze.qinghui')))
    void bakeCupTexture(shot.result.uniqueId, {
      seed: textureSeed(shot.result.uniqueId),
      iron: shot.clay.I,
      colors,
      hueShift: shot.result.hueShift,
      pattern: shot.result.pattern,
      density: shot.result.density,
      gloss: shot.result.gloss,
      flow: shot.result.flow,
      flawVisuals: shot.result.flaws.map((flaw) => flaw.visual),
    }).then((tex) => {
      if (!alive) return
      cup.current?.update({ map: tex.albedo, mode: 'reveal', cotton: 0, kilnOpen: 1, radii: shot.radii, glaze, glazeMix: 0.85, color })
    })
    return () => {
      alive = false
    }
  }, [shot, color, glaze])

  async function copyLink() {
    const url = new URL(location.href)
    url.search = ''
    url.hash = ''
    url.searchParams.set('cup', encodeCup(shot))
    try {
      await navigator.clipboard.writeText(url.toString())
      setNote(t('ui.copied'))
    } catch {
      setNote(url.toString())
    }
  }

  return (
    <div className="layout">
      <div className="stage-view">
        <CupView
          ref={cup}
          webgl={webgl}
          mode="reveal"
          radii={shot.radii}
          color={color}
          glaze={glaze}
          glazeMix={0.85}
          sky={skyColor(shot.weather)}
          cotton={0}
          kilnOpen={1}
          lean={shot.lean}
          crack={shot.flaws.some((flaw) => flaw.visual === 'crack' || flaw.visual === 'crazing')}
          pinhole={shot.flaws.some((flaw) => flaw.visual === 'pinhole')}
          crazing={shot.flaws.some((flaw) => flaw.visual === 'crazing')}
        />
      </div>
      <div>
        <h2>{f('ui.cupNo', { id: shot.result.uniqueId })}</h2>
        {shot.result.demo ? <p>{t('ui.demoCup')}</p> : null}
        <p>{t('ui.shape')} {t(`ui.shapeWord.${shot.result.shapeWord}`)}</p>
        <p>{t('ui.glazeLook')} {t(`ui.glazeWord.${shot.result.glazeWord}`)}</p>
        <p>{t(`ui.grade.${shot.result.grade}`)}</p>
        <p>{shot.flaws.length ? shot.flaws.map((flaw) => t(`ui.flaw.${flaw.visual}`)).join(' · ') : t('ui.note.ok')}</p>
        {elapsed ? <p>{f('ui.elapsed', { n: elapsed })}</p> : null}
        {gained.length ? (
          <p>{f('ui.cards', { n: gained.length })}：{gained.map((id) => cardById(id)?.title ?? id).join('、')}</p>
        ) : null}
        <div className="row">
          <button type="button" onClick={() => void copyLink()}>{t('ui.copyLink')}</button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              void downloadShare(shot, cup.current?.capture()).then(() => setNote(t('ui.saveImageDone')))
            }}
          >
            {t('ui.saveImage')}
          </button>
        </div>
        {note ? <p className="fine">{note}</p> : null}
      </div>
    </div>
  )
}

function mixGlaze(shot: CupSnapshot): string {
  const stops = shot.glaze.picks.map((pick) => ({
    color: colorOf(glazeById(pick.id)?.card ?? 'ui.glaze.qinghui'),
    weight: pick.layers || 1,
  }))
  if (stops.length === 0) return '#7E8B86'
  return mixHex(stops)
}

export function rememberQuiz(profile: Profile, card: KnowledgeCard, index: number, today: string): { profile: Profile; note: string } {
  const correct = index === card.answer
  const ids = new Set(profile.quizCorrectIds)
  if (correct) ids.add(card.id)
  const next = { ...profile, quizCorrectIds: [...ids], lastQuizDate: today }
  session.setProfile(next)
  session.setMemoryOnly(!writeSave(next, session.get().run))
  return { profile: next, note: correct ? t('ui.quizCorrect') : t('ui.quizMiss') }
}
