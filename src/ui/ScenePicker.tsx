import { useEffect } from 'react';
import { MORPH_SHAPES, SCENES } from '../scene/scenes';
import { useSettings } from '../settings/settingsStore';
import { isShortcutKey } from '../lib/keyboard';
import { InteractionHint } from './InteractionHint';

const SHAPE_OPTIONS = [{ key: 'auto', label: 'Auto' }, ...MORPH_SHAPES] as const;

/** Morph only: hold one shape, or leave it on Auto to change on strong beats. */
function ShapePicker() {
  const morphShape = useSettings((state) => state.morphShape);
  const set = useSettings((state) => state.set);
  return (
    <nav className="scene-picker scene-picker--small" aria-label="Morph shape">
      {SHAPE_OPTIONS.map((shape) => (
        <button
          key={shape.key}
          type="button"
          className="scene-picker__item"
          aria-pressed={morphShape === shape.key}
          title={shape.key === 'auto' ? 'Change shape on strong beats' : undefined}
          onClick={() => set('morphShape', shape.key)}
        >
          {shape.label}
        </button>
      ))}
    </nav>
  );
}

/** Four one-click scene presets (also keys 1–4). Works before audio starts, too. */
export function ScenePicker() {
  const scene = useSettings((state) => state.scene);
  const set = useSettings((state) => state.set);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isShortcutKey(event)) return;
      const preset = SCENES[Number(event.key) - 1];
      if (preset) set('scene', preset.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [set]);

  return (
    <div className="scene-stack chrome">
      <nav className="scene-picker" aria-label="Scenes">
        {SCENES.map((preset, index) => (
          <button
            key={preset.key}
            type="button"
            className="scene-picker__item"
            aria-pressed={scene === preset.key}
            title={`${preset.hint} (${index + 1})`}
            onClick={() => set('scene', preset.key)}
          >
            {preset.label}
          </button>
        ))}
      </nav>
      {scene === 'morph' && <ShapePicker />}
      <InteractionHint />
    </div>
  );
}
