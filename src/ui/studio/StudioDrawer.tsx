import { useEffect, useRef } from 'react';
import { activeLook, LOOKS } from '../../settings/looks';
import { NUMERIC, type NumericKey } from '../../settings/schema';
import { useSettings } from '../../settings/settingsStore';
import { useAppStore } from '../../state/appStore';
import { CloseIcon } from '../icons';
import { STUDIO_TOGGLE_ID } from './studioIds';
import { Section, Slider, Toggle } from './controls';
import { CaptureSection } from './CaptureSection';
import { InputSection } from './InputSection';
import { MorphSection } from './MorphSection';
import { PaletteSection } from './PaletteSection';
import { ParticleSection } from './ParticleSection';
import { SensitivitySection } from './SensitivitySection';
import { ShareSection } from './ShareSection';

const EFFECTS: readonly NumericKey[] = ['bloom', 'aberration', 'trails', 'dof'];
const MOTION: readonly NumericKey[] = ['curl', 'turbulence', 'spring', 'pointSize'];

function NumericSlider({ settingKey }: { settingKey: NumericKey }) {
  const value = useSettings((state) => state[settingKey]);
  const setNumeric = useSettings((state) => state.setNumeric);
  const spec = NUMERIC[settingKey];
  return (
    <Slider
      label={spec.label}
      hint={spec.hint}
      value={value}
      min={spec.min}
      max={spec.max}
      step={spec.step}
      defaultValue={spec.default}
      onChange={(next) => setNumeric(settingKey, next)}
    />
  );
}

function LooksSection() {
  const applyLook = useSettings((state) => state.applyLook);
  const current = useSettings((state) => activeLook(state));
  return (
    <Section title="Looks">
      <div className="looks">
        {LOOKS.map((look) => (
          <button
            key={look.key}
            type="button"
            className="look"
            aria-pressed={current === look.key}
            onClick={() => applyLook(look.key)}
          >
            {look.label}
          </button>
        ))}
      </div>
    </Section>
  );
}

/** The Studio side panel. Esc closes it and returns focus to the toolbar toggle. */
export function StudioPanel() {
  const setOpen = useAppStore((state) => state.setStudioOpen);
  const autoOrbit = useSettings((state) => state.autoOrbit);
  const autoDirector = useSettings((state) => state.autoDirector);
  const set = useSettings((state) => state.set);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      document.getElementById(STUDIO_TOGGLE_ID)?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  return (
    <aside id="studio" className="studio" aria-label="Studio">
      <header className="studio__header">
        <h2>Studio</h2>
        <button
          ref={closeButton}
          type="button"
          className="toast__close"
          aria-label="Close studio"
          onClick={() => setOpen(false)}
        >
          <CloseIcon width={18} height={18} />
        </button>
      </header>
      <div className="studio__body">
        <LooksSection />
        <MorphSection />
        <PaletteSection />
        <ParticleSection />
        <Section title="Effects">
          {EFFECTS.map((key) => (
            <NumericSlider key={key} settingKey={key} />
          ))}
        </Section>
        <Section title="Motion">
          {MOTION.map((key) => (
            <NumericSlider key={key} settingKey={key} />
          ))}
          <Toggle
            label="Camera auto-orbit"
            checked={autoOrbit}
            onChange={(next) => set('autoOrbit', next)}
          />
          <Toggle
            label="Auto-VJ (V)"
            checked={autoDirector}
            onChange={(next) => set('autoDirector', next)}
          />
          <p className="studio-caption">
            Auto-VJ changes scene and palette at drops, breakdowns and every 32 beats. Big drops
            spell out your word, or the track’s name.
          </p>
        </Section>
        <InputSection />
        <SensitivitySection />
        <CaptureSection />
        <ShareSection />
      </div>
    </aside>
  );
}
