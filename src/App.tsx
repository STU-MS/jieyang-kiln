import { lazy, Suspense, useEffect, useState } from 'react'
import difficulty from './data/difficulty.json'
import climate from './data/climate.json'
import { assetId, fontOf, touchAssetCatalog } from './assets/registry'
import { resumeAudio } from './audio/bus'
import { t } from './content/text'
import { session, useSession } from './game/session'
import { loadSave, writeSave } from './persist/storage'
import { createClock } from './sim/clock'
import { seasonById, seasonOf } from './sim/drying'
import { createRun, skipStage, snapshotOf } from './sim/flow'
import { awardCards, localDate, pickQuiz } from './sim/profile'
import { decodeCup } from './sim/share'
import MixStage from './stages/MixStage'
import { formatElapsed } from './ui/hooks'
import { ArchiveScreen, AtlasScreen, CupPoster, HomeScreen, QuizScreen, ResultScreen, rememberQuiz } from './ui/screens'
import { Shell } from './ui/widgets'
import type { CupSnapshot } from './sim/types'
import type { KnowledgeCard } from './content/text'

const ThrowStage = lazy(() => import('./stages/ThrowStage'))
const DryStage = lazy(() => import('./stages/DryStage'))
const GlazeStage = lazy(() => import('./stages/GlazeStage'))
const FireStage = lazy(() => import('./stages/FireStage'))

type View = 'home' | 'play' | 'atlas' | 'archive' | 'quiz' | 'result' | 'share'

function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2'))
  } catch {
    return false
  }
}

export default function App() {
  const webgl = useState(hasWebGL2)[0]
  const { profile, run, memoryOnly } = useSession()
  const [view, setView] = useState<View>('home')
  const [notice, setNotice] = useState('')
  const [practice, setPractice] = useState(false)
  const [quiz, setQuiz] = useState<KnowledgeCard | null>(null)
  const [quizNote, setQuizNote] = useState('')
  const [result, setResult] = useState<{ shot: CupSnapshot; gained: string[]; elapsed: string } | null>(null)
  const [shared, setShared] = useState<CupSnapshot | null>(null)
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    document.documentElement.style.setProperty('--font-body', fontOf(assetId('font.body')))
    document.documentElement.style.setProperty('--font-display', fontOf(assetId('font.display')))
    touchAssetCatalog()
    const loaded = loadSave()
    session.hydrate(loaded.save.profile, loaded.save.run, loaded.memoryOnly)
    if (loaded.gifted) setNotice(t('ui.gift'))
    else if (loaded.memoryOnly) setNotice(t('ui.memoryOnly'))
    const code = new URLSearchParams(location.search).get('cup')
    if (code) {
      const cup = decodeCup(code)
      if (cup) {
        setShared(cup)
        setView('share')
      } else setNotice(t('ui.shareBad'))
    }
    setQuiz(pickQuiz(loaded.save.profile, localDate()))
    setBooted(true)
  }, [])

  useEffect(() => {
    const clock = createClock()
    let acc = 0
    let raf = 0
    let alive = true
    const persist = () => {
      session.flushElapsed()
      const snap = session.get()
      session.setMemoryOnly(!writeSave(snap.profile, snap.run))
    }
    const loop = () => {
      if (!alive) return
      const { dt } = clock.delta()
      if (dt > 0 && session.get().run) {
        session.addElapsed(dt)
        acc += dt
        if (acc >= difficulty.saveEverySeconds) {
          acc = 0
          persist()
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    const onHide = () => {
      clock.sync()
      if (document.hidden) persist()
    }
    window.addEventListener('pagehide', persist)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      window.removeEventListener('pagehide', persist)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [])

  function start(nextPractice: boolean) {
    resumeAudio()
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    const month = new Date().getMonth() + 1
    const unlocked = profile.clearCount >= difficulty.practiceUnlockClears
    session.setRun(createRun(buf[0] || 1, month, unlocked && nextPractice))
    const snap = session.get()
    session.setMemoryOnly(!writeSave(snap.profile, snap.run))
    setView('play')
  }

  function finishCup() {
    session.flushElapsed()
    const live = session.get().run
    if (!live) return
    const shot = snapshotOf(live)
    if (!shot) return
    const elapsed = formatElapsed(session.elapsed())
    const awarded = awardCards(session.get().profile, shot.result.grade, localDate())
    const cups = [shot, ...awarded.profile.cups.filter((cup) => cup.result.uniqueId !== shot.result.uniqueId)].slice(0, 24)
    const nextProfile = { ...awarded.profile, cups }
    session.setProfile(nextProfile)
    session.setRun(null)
    session.setMemoryOnly(!writeSave(nextProfile, null))
    setResult({ shot, gained: awarded.gained, elapsed })
    setView('result')
    resumeAudio()
  }

  function quit() {
    session.flushElapsed()
    const snap = session.get()
    session.setMemoryOnly(!writeSave(snap.profile, snap.run))
    setView('home')
  }

  function skip() {
    const live = session.get().run
    if (!live) return
    const novice = profile.clearCount < difficulty.noviceClears
    const next = skipStage(live, novice)
    session.setRun(next)
    if (live.stage === 'fire' && next.result && !next.result.stuck && !next.result.shattered) finishCup()
  }

  const month = new Date().getMonth() + 1
  const season = seasonOf(month)
  const seasonDef = seasonById(season) ?? climate.seasons[3]
  const monthLabel = `${month} 月 · ${t(`ui.season.${season}`)}${run ? ` · ${t(`ui.weather.${run.weather}`)}` : ''}`
  const banner = [notice, memoryOnly ? t('ui.memoryOnly') : ''].filter(Boolean).join(' ')

  if (!booted) return <Shell webgl={webgl}><p className="banner">{t('ui.loading')}</p></Shell>

  return (
    <Shell stage={view === 'play' ? run?.stage : undefined} webgl={webgl} notice={banner} onQuit={view === 'play' ? quit : undefined} onSkip={view === 'play' ? skip : undefined} welcome={view === 'home'}>
      {view === 'home' ? (
        <HomeScreen
          profile={profile}
          monthLabel={monthLabel}
          blurb={seasonDef.blurb}
          practice={practice}
          onPractice={setPractice}
          practiceUnlocked={profile.clearCount >= difficulty.practiceUnlockClears}
          onStart={() => start(practice)}
          onContinue={run ? () => { resumeAudio(); setView('play') } : null}
          onAtlas={() => setView('atlas')}
          onArchive={() => setView('archive')}
          quiz={quiz}
          onQuiz={() => { setQuizNote(''); setView('quiz') }}
        />
      ) : null}
      {view === 'atlas' ? <AtlasScreen profile={profile} onBack={() => setView('home')} /> : null}
      {view === 'archive' ? <ArchiveScreen profile={profile} webgl={webgl} onBack={() => setView('home')} /> : null}
      {view === 'quiz' && quiz ? (
        <QuizScreen
          card={quiz}
          note={quizNote}
          onAnswer={(index) => {
            const saved = rememberQuiz(session.get().profile, quiz, index, localDate())
            setQuizNote(saved.note)
          }}
          onBack={() => setView('home')}
        />
      ) : null}
      {view === 'result' && result ? (
        <ResultScreen
          shot={result.shot}
          elapsed={result.elapsed}
          gained={result.gained}
          webgl={webgl}
          onAgain={() => start(false)}
          onHome={() => setView('home')}
        />
      ) : null}
      {view === 'share' && shared ? (
        <section className="panel wide">
          <CupPoster shot={shared} webgl={webgl} elapsed="" gained={[]} />
          <button type="button" onClick={() => { history.replaceState(null, '', location.pathname); setView('home') }}>{t('ui.home')}</button>
        </section>
      ) : null}
      {view === 'play' && run ? (
        <Suspense fallback={<p className="banner">{t('ui.loading')}</p>}>
          {run.stage === 'mix' ? <MixStage key={run.seed} webgl={webgl} /> : null}
          {run.stage === 'throw' ? <ThrowStage key={run.seed} webgl={webgl} onDone={finishCup} onRestart={() => start(run.practice)} /> : null}
          {run.stage === 'dry' ? <DryStage webgl={webgl} onDone={finishCup} /> : null}
          {run.stage === 'glaze' ? <GlazeStage webgl={webgl} onDone={finishCup} /> : null}
          {run.stage === 'fire' ? <FireStage webgl={webgl} onDone={finishCup} /> : null}
        </Suspense>
      ) : null}
    </Shell>
  )
}
