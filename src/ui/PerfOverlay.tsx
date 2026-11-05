import { useEffect, useState } from 'react';
import { isShortcutKey } from '../lib/keyboard';
import { perfStats } from '../perf/perfStats';
import { useSettings } from '../settings/settingsStore';
import { useAppStore } from '../state/appStore';

const REFRESH_MS = 250;

/** FPS / frame time / GPU time readout, toggled with F. */
export function PerfOverlay() {
  const visible = useAppStore((state) => state.perfOverlay);
  const setVisible = useAppStore((state) => state.setPerfOverlay);
  const gpu = useAppStore((state) => state.gpu);
  const scene = useSettings((state) => state.scene);
  const [stats, setStats] = useState({ ...perfStats });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isShortcutKey(event)) return;
      if (event.key === 'f' || event.key === 'F') setVisible(!useAppStore.getState().perfOverlay);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setVisible]);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => setStats({ ...perfStats }), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [visible]);

  if (!visible) return null;
  const low = stats.fps > 0 && stats.fps < 45;
  return (
    <div className="perf-overlay" role="status" aria-label="Performance">
      <div className={low ? 'perf-overlay__fps is-low' : 'perf-overlay__fps'}>
        {stats.fps.toFixed(0)} <span>FPS</span>
      </div>
      <dl>
        <dt>Frame</dt>
        <dd>{stats.frameMs.toFixed(1)} ms</dd>
        <dt>GPU</dt>
        <dd>{stats.gpuMs === null ? 'n/a' : `${stats.gpuMs.toFixed(1)} ms`}</dd>
        <dt>Particles</dt>
        <dd>{gpu.state === 'ready' ? gpu.particles.toLocaleString('en-US') : '—'}</dd>
        <dt>DPR</dt>
        <dd>{stats.dpr.toFixed(2)}</dd>
        <dt>Scene</dt>
        <dd>{scene}</dd>
      </dl>
      <p>F to hide</p>
    </div>
  );
}
