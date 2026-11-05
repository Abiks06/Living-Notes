import { useEffect, useRef } from 'react';
import { useLibrary } from '../library/library';
import { MORPH_SHAPES, SCENES } from '../scene/scenes';
import { useSettings } from '../settings/settingsStore';
import { useAppStore } from '../state/appStore';
import { CastList } from './CastList';
import { MusicDna } from './MusicDna';
import { STUDIO_TOGGLE_ID } from './studio/studioIds';

const CROSSFADES = [
  { seconds: 0, label: 'Off' },
  { seconds: 3, label: '3 s' },
  { seconds: 6, label: '6 s' },
  { seconds: 10, label: '10 s' },
];
const SHAPE_OPTIONS = [{ key: 'auto', label: 'Auto' }, ...MORPH_SHAPES] as const;

/** Everything about how the show looks, kept out of sight until it's asked for. */
export function VisualsMenu({ onClose }: { onClose: () => void }) {
  const scene = useSettings((state) => state.scene);
  const auto = useSettings((state) => state.autoDirector);
  const morphShape = useSettings((state) => state.morphShape);
  const set = useSettings((state) => state.set);
  const crossfade = useLibrary((state) => state.crossfade);
  const artColours = useLibrary((state) => state.artColours);
  const setCrossfade = useLibrary((state) => state.setCrossfade);
  const setArtColours = useLibrary((state) => state.setArtColours);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (box.current?.contains(target) || target.closest(`#${STUDIO_TOGGLE_ID}`)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div ref={box} className="menu" role="dialog" aria-label="Visuals">
      <label className="menu__auto">
        <span>
          <strong>Auto</strong>
          <small>Scenes and colours follow the music</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={auto}
          onChange={(event) => set('autoDirector', event.currentTarget.checked)}
        />
      </label>

      <div className="menu__section">
        <p className="menu__label">Scene</p>
        <div className="menu__scenes" role="group" aria-label="Scenes">
          {SCENES.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className="menu__option"
              aria-pressed={!auto && scene === preset.key}
              data-showing={auto && scene === preset.key}
              title={preset.hint}
              onClick={() => {
                // Picking a scene is taking the wheel.
                set('autoDirector', false);
                set('scene', preset.key);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Only once a person is driving: under Auto this row would come and go with the scene. */}
      {!auto && scene === 'morph' && (
        <div className="menu__section">
          <p className="menu__label">Shape</p>
          <div className="menu__scenes" role="group" aria-label="Morph shape">
            {SHAPE_OPTIONS.map((shape) => (
              <button
                key={shape.key}
                type="button"
                className="menu__option menu__option--small"
                aria-pressed={morphShape === shape.key}
                onClick={() => set('morphShape', shape.key)}
              >
                {shape.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="menu__section">
        <p className="menu__label">Show only</p>
        <CastList />
      </div>

      <div className="menu__rows">
        <label className="menu__row">
          Crossfade
          <select
            value={crossfade}
            onChange={(event) => setCrossfade(Number(event.currentTarget.value))}
          >
            {CROSSFADES.map(({ seconds, label }) => (
              <option key={seconds} value={seconds}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="menu__row">
          Colours from album art
          <input
            type="checkbox"
            role="switch"
            checked={artColours}
            onChange={(event) => setArtColours(event.currentTarget.checked)}
          />
        </label>
      </div>

      <footer className="menu__footer">
        <MusicDna />
        <button
          type="button"
          className="menu__more"
          onClick={() => {
            onClose();
            useAppStore.getState().setStudioOpen(true);
          }}
        >
          All settings
        </button>
      </footer>
    </div>
  );
}
