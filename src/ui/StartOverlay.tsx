import { useAppStore } from '../state/appStore';
import { startExperience } from '../state/actions';
import { PlayIcon } from './icons';

/** Full-screen click target over the already-animating preview. */
export function StartOverlay() {
  const phase = useAppStore((state) => state.phase);
  const gpu = useAppStore((state) => state.gpu);
  if (phase !== 'intro') return null;

  // State the real simulated count, never a rounded-up claim.
  const tagline =
    gpu.state === 'ready'
      ? `${gpu.particles.toLocaleString('en-US')} GPU particles, played by your music.`
      : 'A GPU particle cloud, played by your music.';

  return (
    <div className="start-overlay" onClick={() => startExperience()}>
      <div className="start-overlay__content">
        <h1 className="start-overlay__title">Resonance</h1>
        <p className="start-overlay__tagline">{tagline}</p>
        <button
          type="button"
          className="start-button"
          autoFocus
          onClick={(event) => {
            event.stopPropagation();
            startExperience();
          }}
        >
          <span className="start-button__ring" aria-hidden="true" />
          <PlayIcon width={22} height={22} />
          <span>Click to start</span>
        </button>
        <p className="start-overlay__hint">
          Sound on · or pick a track, your mic, or drop a file below
        </p>
      </div>
    </div>
  );
}
