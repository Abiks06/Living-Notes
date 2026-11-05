import { type CSSProperties, useEffect, useRef } from 'react';
import { audioEngine } from '../audio/AudioEngine';
import { type Actor, CAST } from '../audio/cast';
import { audioFeatures } from '../audio/features';
import { useReducedMotion } from '../lib/useMediaQuery';
import { paletteColors } from '../settings/palettes';
import { useSettings } from '../settings/settingsStore';
import { toggleSolo } from '../state/actions';
import { useAppStore } from '../state/appStore';

const UPDATE_S = 1 / 20;
/** Which palette colour each part wears, matching its lane on the song map. */
const COLOUR: Record<Actor, number> = { drums: 3, bass: 1, pads: 1, riffs: 2, voice: 3 };

/**
 * Who's playing, lit as they play. Tapping one leaves only that part driving the picture, which
 * is the quickest way to learn what each of them does on screen.
 */
export function CastList() {
  const solo = useAppStore((state) => state.solo);
  const heard = useAppStore((state) => state.song?.heard);
  const palette = useSettings((state) => state.palette);
  const custom = useSettings((state) => state.customColors);
  const colours = paletteColors(palette, custom);
  const reducedMotion = useReducedMotion();
  const dots = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    let elapsed = UPDATE_S;
    return audioEngine.onFrame((dt) => {
      elapsed += dt;
      if (elapsed < UPDATE_S) return;
      elapsed = 0;
      dots.current.forEach((dot, i) => {
        const level = audioFeatures.cast[i] ?? 0;
        dot?.style.setProperty('opacity', (0.25 + 0.75 * level).toFixed(2));
        if (!reducedMotion)
          dot?.style.setProperty('transform', `scale(${(0.75 + 0.6 * level).toFixed(2)})`);
      });
    });
  }, [reducedMotion]);

  return (
    <div className="cast" role="group" aria-label="What's playing">
      {CAST.map(({ key, label }, i) => (
        <button
          key={key}
          type="button"
          className="cast__actor"
          aria-pressed={solo === key}
          data-unheard={heard ? !heard[key] : undefined}
          title={solo === key ? 'Show everything' : `Show only the ${label.toLowerCase()}`}
          onClick={() => toggleSolo(key)}
        >
          <span
            ref={(dot) => {
              dots.current[i] = dot;
            }}
            className="cast__dot"
            style={{ '--actor': colours[COLOUR[key]] } as CSSProperties}
            aria-hidden="true"
          />
          {label}
        </button>
      ))}
    </div>
  );
}
