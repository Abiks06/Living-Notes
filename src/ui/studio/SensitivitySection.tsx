import { useEffect, useRef } from 'react';
import { audioEngine } from '../../audio/AudioEngine';
import { BANDS } from '../../audio/bands';
import { audioFeatures } from '../../audio/features';
import { SENSITIVITY } from '../../settings/schema';
import { useSettings } from '../../settings/settingsStore';
import { Section, Slider } from './controls';

const METER_INTERVAL_S = 1 / 30;

/** Per-band sensitivity, each with a live level meter so you can see what you're tuning. */
export function SensitivitySection() {
  const sensitivity = useSettings((state) => state.sensitivity);
  const setSensitivity = useSettings((state) => state.setSensitivity);
  const meters = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    let elapsed = 0;
    return audioEngine.onFrame((dt) => {
      elapsed += dt;
      if (elapsed < METER_INTERVAL_S) return;
      elapsed = 0;
      for (let band = 0; band < meters.current.length; band++) {
        const meter = meters.current[band];
        if (meter) meter.style.transform = `scaleX(${(audioFeatures.bands[band] ?? 0).toFixed(3)})`;
      }
    });
  }, []);

  return (
    <Section title="Audio sensitivity">
      {BANDS.map((band, index) => (
        <div key={band.key} className="band-control">
          <Slider
            label={band.label}
            hint={`${band.minHz}–${band.maxHz} Hz`}
            value={sensitivity[index] ?? 1}
            min={SENSITIVITY.min}
            max={SENSITIVITY.max}
            step={SENSITIVITY.step}
            defaultValue={SENSITIVITY.default}
            onChange={(value) => setSensitivity(index, value)}
          />
          <span className="band-meter" aria-hidden="true">
            <span
              ref={(el) => {
                meters.current[index] = el;
              }}
            />
          </span>
        </div>
      ))}
    </Section>
  );
}
