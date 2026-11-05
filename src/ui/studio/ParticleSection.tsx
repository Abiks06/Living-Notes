import { isTouchDevice } from '../../scene/particles/tiers';
import { PARTICLE_TIERS, type ParticleTier } from '../../settings/schema';
import { useSettings } from '../../settings/settingsStore';
import { useAppStore } from '../../state/appStore';
import { Section, Segmented } from './controls';

const OPTIONS = PARTICLE_TIERS.map((tier) => ({
  value: tier,
  label: tier === 'auto' ? 'Auto' : tier,
}));

export function ParticleSection() {
  const particles = useSettings((state) => state.particles);
  const set = useSettings((state) => state.set);
  const autoTier = useAppStore((state) => state.autoTier);
  const benchmark = useAppStore((state) => state.benchmark);
  const gpu = useAppStore((state) => state.gpu);

  let caption: string;
  if (particles !== 'auto') {
    caption =
      particles === '590k' && isTouchDevice()
        ? 'Manual · 590k is heavy for phones; expect heat and dropped frames.'
        : `Manual · ${particles} particles.`;
  } else if (benchmark) {
    caption = `Auto picked ${benchmark.picked} at ${benchmark.dpr}× resolution: ${benchmark.measuredAt} at ${benchmark.measuredDpr}× took ${benchmark.frameMs.toFixed(1)} ms of GPU time a frame, ${benchmark.stepMs.toFixed(1)} ms of it simulation.`;
  } else {
    caption = `Auto · ${autoTier ?? '…'}. Lowers resolution, then particles, if the frame rate drops.`;
  }

  return (
    <Section title="Particles">
      <Segmented<ParticleTier>
        label="Particle count"
        options={OPTIONS}
        value={particles}
        onChange={(tier) => set('particles', tier)}
      />
      <p className="studio-caption">
        {caption}
        {gpu.state === 'ready' && gpu.precision === 'half' ? ' Half-precision mode.' : ''}
      </p>
    </Section>
  );
}
