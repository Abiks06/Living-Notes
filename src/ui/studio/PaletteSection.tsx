import { DEFAULT_CUSTOM_COLORS, PALETTES, type PaletteColors } from '../../settings/palettes';
import { useSettings } from '../../settings/settingsStore';
import { Section } from './controls';

const STOP_LABELS = ['Quiet', 'Body', 'Hot', 'Sparkle'] as const;

function gradient(colors: PaletteColors): string {
  return `linear-gradient(90deg, ${colors.join(', ')})`;
}

export function PaletteSection() {
  const palette = useSettings((state) => state.palette);
  const custom = useSettings((state) => state.customColors);
  const set = useSettings((state) => state.set);
  const setCustomColor = useSettings((state) => state.setCustomColor);

  return (
    <Section title="Palette">
      <div className="swatches" role="radiogroup" aria-label="Colour palette">
        {PALETTES.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={palette === p.key}
            className="swatch"
            onClick={() => set('palette', p.key)}
          >
            <span className="swatch__preview" style={{ background: gradient(p.colors) }} />
            <span className="swatch__label">{p.label}</span>
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={palette === 'custom'}
          className="swatch"
          onClick={() => set('palette', 'custom')}
        >
          <span className="swatch__preview" style={{ background: gradient(custom) }} />
          <span className="swatch__label">Custom</span>
        </button>
      </div>

      {palette === 'custom' && (
        <div className="custom-gradient">
          {custom.map((color, index) => (
            <label key={STOP_LABELS[index]} className="custom-gradient__stop">
              <input
                type="color"
                value={color}
                onChange={(event) => setCustomColor(index, event.currentTarget.value)}
              />
              <span>{STOP_LABELS[index]}</span>
            </label>
          ))}
          <button
            type="button"
            className="link-button"
            onClick={() => set('customColors', DEFAULT_CUSTOM_COLORS)}
          >
            Reset
          </button>
        </div>
      )}
    </Section>
  );
}
