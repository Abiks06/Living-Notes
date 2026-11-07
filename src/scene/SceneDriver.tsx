import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { audioFeatures } from '../audio/features';
import { useReducedMotion } from '../lib/useMediaQuery';
import { nextMoment, prepareMoment, spokenMoment, useLyrics } from '../lyrics/lyrics';
import { useSettings } from '../settings/settingsStore';
import { useAppStore } from '../state/appStore';
import { AutoDirector, moodOf, nextShow } from './AutoDirector';
import { flashWordFor, readingTime } from './flashWord';
import { partMemory } from './partLook';
import { sceneDirector } from './SceneDirector';
import { MORPH_SHAPES, sceneByKey } from './scenes';

const auto = new AutoDirector();
/** The show each part of the current song got the first time it played. */
const shows = new Map<number, ReturnType<typeof nextShow>>();
/** Short passages aren't worth a new scene, unless a drop says otherwise. */
const MIN_SHOW_S = 8;
const DROP_LANDED = 0.9;
/** How far up the climb the title starts to form. */
const TITLE_FROM = 0.3;
/** How long a streamed song plays before its name appears, and what counts as playing. */
const LIVE_TITLE_AFTER_S = 20;
const LIVE_HEARD_GATE = 0.5;
/** Rasterizing a word takes a moment, and the particles then need a moment to gather. */
const MOMENT_PREPARE_S = 1.6;
const MOMENT_LEAD_S = 0.35;

/** Feeds scene selection into the director and advances it, right after audio analysis. */
export function SceneDriver() {
  const scene = useSettings((state) => state.scene);
  const morphShape = useSettings((state) => state.morphShape);
  const reducedMotion = useReducedMotion();
  const source = useAppStore((state) => state.source);
  const mounted = useRef(false);
  const showClock = useRef({ part: -1, held: MIN_SHOW_S });
  const wordSpent = useRef(false);
  const liveHeard = useRef(0);

  useEffect(() => {
    // The first scene (e.g. from a share link) appears directly; later changes fly over.
    if (mounted.current) sceneDirector.setScene(sceneByKey(scene));
    else sceneDirector.jumpTo(sceneByKey(scene));
    mounted.current = true;
  }, [scene]);

  useEffect(() => {
    auto.newTrack();
    shows.clear();
    wordSpent.current = false;
    liveHeard.current = 0;
    showClock.current = { part: -1, held: MIN_SHOW_S };
  }, [source]);

  const shapeMounted = useRef(false);
  useEffect(() => {
    const shape = MORPH_SHAPES.find((s) => s.key === morphShape);
    sceneDirector.pinShape(shape?.id ?? null, !shapeMounted.current);
    shapeMounted.current = true;
  }, [morphShape]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    sceneDirector.update(dt, audioFeatures);
    partMemory.update(dt, audioFeatures);

    const settings = useSettings.getState();
    // Whatever the mode, a song's first big moment smashes its own title. A song that builds to
    // a drop forms it in the climb; one that never does spells it when it first opens up.
    const titled = source?.kind === 'file' && Boolean(source.title);
    const spelling = useLyrics.getState().spell !== null;
    if (titled && !spelling && !reducedMotion && !wordSpent.current && audioFeatures.scored) {
      const climbing = audioFeatures.tension >= TITLE_FROM;
      if ((climbing || audioFeatures.titleDue) && !sceneDirector.wordFlash) {
        wordSpent.current = sceneDirector.flashWord(
          sceneByKey(settings.scene),
          audioFeatures.snareCount,
          climbing,
          readingTime(flashWordFor(source, settings.word)),
        );
        auto.wordShown();
      }
    }
    // Nothing says when live sound will open up, so a streamed song's name comes once it's going.
    const liveTitled = source?.kind === 'tab' && Boolean(source.title);
    if (liveTitled && !spelling && !reducedMotion && !wordSpent.current) {
      if (audioFeatures.gate >= LIVE_HEARD_GATE) liveHeard.current += dt;
      if (liveHeard.current >= LIVE_TITLE_AFTER_S && !sceneDirector.wordFlash) {
        wordSpent.current = sceneDirector.flashWord(
          sceneByKey(settings.scene),
          audioFeatures.snareCount,
          false,
          readingTime(flashWordFor(source, settings.word)),
        );
        auto.wordShown();
      }
    }
    // A lyric forms just as it's sung, so it starts a moment ahead of the singer.
    const moment = reducedMotion ? null : nextMoment();
    if (moment && !sceneDirector.wordFlash) {
      if (moment.in <= MOMENT_PREPARE_S) prepareMoment(moment.text);
      if (moment.in <= MOMENT_LEAD_S && useLyrics.getState().spell === moment.text) {
        const up = sceneDirector.flashWord(
          sceneByKey(settings.scene),
          audioFeatures.snareCount,
          false,
          readingTime(moment.text),
        );
        if (up) auto.wordShown();
      }
    }
    spokenMoment(sceneDirector.wordFlash);
    const directing = settings.autoDirector && audioFeatures.live;
    if (directing && !reducedMotion && auto.takeBuildWord(audioFeatures)) {
      sceneDirector.flashWord(sceneByKey(settings.scene), audioFeatures.snareCount, true);
    }
    const changing = directing && auto.update(dt, audioFeatures);
    const part = audioFeatures.scored ? audioFeatures.sectionPart : -1;
    if (directing && part >= 0) {
      // A song's own shape runs the show: each part keeps the look it first had.
      const clock = showClock.current;
      clock.held += dt;
      const landed = audioFeatures.impact >= DROP_LANDED;
      if (part !== clock.part && (clock.held >= MIN_SHOW_S || landed)) {
        clock.part = part;
        clock.held = 0;
        const show =
          shows.get(part) ??
          nextShow(settings.scene, settings.palette, moodOf(audioFeatures, landed));
        shows.set(part, show);
        if (landed) sceneDirector.expectDropChange();
        settings.set('scene', show.scene);
        settings.set('palette', show.palette);
      }
    } else if (changing) {
      const mood = moodOf(audioFeatures, auto.drop);
      const show = nextShow(settings.scene, settings.palette, mood);
      // A known song spells its word in the climb, so nothing calms the drop itself.
      if (auto.takeWord() && !reducedMotion && !audioFeatures.scored) {
        sceneDirector.flashWord(sceneByKey(show.scene), audioFeatures.snareCount);
      }
      if (auto.drop) sceneDirector.expectDropChange();
      settings.set('scene', show.scene);
      settings.set('palette', show.palette);
    }
  }, -1);

  return null;
}
