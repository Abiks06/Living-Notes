import { useEffect, useRef } from 'react';
import { audioEngine } from '../audio/AudioEngine';
import { audioFeatures } from '../audio/features';
import { VIBES } from '../audio/mood';
import { TEMPO_LOCKED } from '../audio/tempo';
import { useAppStore } from '../state/appStore';
import { describeHearing } from './hearing';

const UPDATE_S = 0.25;
const PULSE_S = 1 / 12;
/**
 * The BPM, strongest note and vibe the analysis has settled on. Seeing the right tempo and
 * note for a song you know is what earns trust in everything else on screen. It writes
 * straight to the DOM a few times a second, and only when something has changed.
 */
export function MusicDna() {
  const source = useAppStore((state) => state.source);
  const root = useRef<HTMLParagraphElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const tempo = useRef<HTMLSpanElement>(null);
  const note = useRef<HTMLSpanElement>(null);
  const vibe = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!source) return;
    let elapsed = UPDATE_S;
    let sincePulse = 0;
    const write = (target: HTMLElement | null, text: string) => {
      if (target && target.textContent !== text) target.textContent = text;
    };
    return audioEngine.onFrame((dt) => {
      // The dot beats with the song, so a lock is something you can see and not just read.
      sincePulse += dt;
      if (sincePulse >= PULSE_S && dot.current) {
        sincePulse = 0;
        const locked = audioFeatures.tempoConfidence >= TEMPO_LOCKED;
        const beat = (1 - audioFeatures.groovePhase) ** 2;
        dot.current.style.opacity = locked ? String(0.4 + 0.6 * beat) : '';
      }
      elapsed += dt;
      if (elapsed < UPDATE_S) return;
      elapsed = 0;
      const heard = describeHearing();
      write(tempo.current, heard.tempo);
      write(note.current, heard.note);
      write(vibe.current, heard.vibe);
      if (root.current) root.current.dataset['locked'] = String(heard.locked);
    });
  }, [source]);

  if (!source) return null;
  return (
    <p className="hearing" ref={root} data-locked="false" title="What Living Notes is hearing">
      <span className="hearing__tempo">
        <span className="hearing__lock" ref={dot} aria-hidden="true" />
        <span ref={tempo}>– BPM</span>
      </span>
      <span ref={note}>–</span>
      <span ref={vibe}>{VIBES[0]}</span>
    </p>
  );
}
