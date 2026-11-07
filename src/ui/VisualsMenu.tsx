import { useEffect, useRef } from 'react';
import { useLibrary } from '../library/library';
import { installApp, useInstallOffer } from '../pwa/install';
import { MORPH_SHAPES, SCENES } from '../scene/scenes';
import { APPEARANCES, useAppearance } from '../settings/appearance';
import { useSettings } from '../settings/settingsStore';
import { useAppStore } from '../state/appStore';
import { MAX_NAME_LENGTH, useProfile } from '../state/profile';
import { CastList } from './CastList';
import { MusicDna } from './MusicDna';
import { STUDIO_TOGGLE_ID } from './studio/studioIds';

const CROSSFADES = [
  { seconds: 0, label: 'Off' },
  { seconds: 3, label: '3s' },
  { seconds: 6, label: '6s' },
  { seconds: 10, label: '10s' },
];
const SHAPE_OPTIONS = [{ key: 'auto', label: 'Auto' }, ...MORPH_SHAPES] as const;

/** Everything about how the show looks, kept out of sight until it's asked for. */
/** What the app knows about you, which never leaves this device. */
function YouSection() {
  const name = useProfile((state) => state.name);
  const setName = useProfile((state) => state.setName);
  const forget = useProfile((state) => state.forget);
  return (
    <div className="menu__rows">
      <label className="menu__row">
        Your name
        <input
          className="menu__name"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="given-name"
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </label>
      <button
        type="button"
        className="menu__more menu__forget"
        title="Clears your name, visits and who you play most, from this device"
        onClick={forget}
      >
        Forget me
      </button>
    </div>
  );
}

export function VisualsMenu({ onClose }: { onClose: () => void }) {
  const scene = useSettings((state) => state.scene);
  const auto = useSettings((state) => state.autoDirector);
  const morphShape = useSettings((state) => state.morphShape);
  const set = useSettings((state) => state.set);
  const crossfade = useLibrary((state) => state.crossfade);
  const artColours = useLibrary((state) => state.artColours);
  const setCrossfade = useLibrary((state) => state.setCrossfade);
  const setArtColours = useLibrary((state) => state.setArtColours);
  const appearance = useAppearance((state) => state.appearance);
  const setAppearance = useAppearance((state) => state.setAppearance);
  const canInstall = useInstallOffer((state) => state.offer !== null);
  const showing = SCENES.find((preset) => preset.key === scene)?.label ?? scene;
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
      <div className="menu__section">
        <p className="menu__label">Scene</p>
        <div className="menu__grid" role="group" aria-label="Scene">
          <button
            type="button"
            className="menu__option"
            aria-pressed={auto}
            title="Scenes and colours follow the music"
            onClick={() => set('autoDirector', true)}
          >
            Auto
          </button>
          {SCENES.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className="menu__option"
              aria-pressed={!auto && scene === preset.key}
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
        {auto && (
          <p className="menu__note">
            Following the music · now <strong>{showing}</strong>
          </p>
        )}
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

      <div className="menu__section">
        <p className="menu__label">Appearance</p>
        <div className="menu__looks" role="group" aria-label="Appearance">
          {APPEARANCES.map((option) => (
            <button
              key={option.key}
              type="button"
              className="menu__look"
              data-look={option.key}
              aria-pressed={appearance === option.key}
              title={option.hint}
              onClick={() => setAppearance(option.key)}
            >
              <span className="menu__swatch" aria-hidden="true" />
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="menu__rows">
        <div className="menu__row">
          <span id="crossfade-label">Crossfade</span>
          <div className="menu__segments" role="group" aria-labelledby="crossfade-label">
            {CROSSFADES.map(({ seconds, label }) => (
              <button
                key={seconds}
                type="button"
                aria-pressed={crossfade === seconds}
                onClick={() => setCrossfade(seconds)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
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

      <YouSection />

      <footer className="menu__footer">
        <MusicDna />
        <div className="menu__links">
          {canInstall && (
            <button
              type="button"
              className="menu__more"
              title="Open Resonance in its own window"
              onClick={installApp}
            >
              Install app
            </button>
          )}
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
        </div>
      </footer>
    </div>
  );
}
