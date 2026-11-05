import { useEffect, useState } from 'react';
import { audioEngine } from '../audio/AudioEngine';
import { audioFeatures } from '../audio/features';
import { useAppStore } from '../state/appStore';
import { describeHearing } from './hearing';

const CHECK_S = 0.5;

/** In Lounge mode the screen stays clean; a badge surfaces only when the mood shifts. */
export function LoungeBadge() {
  const lounge = useAppStore((state) => state.lounge);
  const [shown, setShown] = useState<{ id: number; text: string } | null>(null);

  useEffect(() => {
    if (!lounge) {
      setShown(null);
      return;
    }
    let elapsed = 0;
    let vibe = audioFeatures.vibe;
    let id = 0;
    return audioEngine.onFrame((dt) => {
      elapsed += dt;
      if (elapsed < CHECK_S) return;
      elapsed = 0;
      if (audioFeatures.vibe === vibe) return;
      vibe = audioFeatures.vibe;
      const heard = describeHearing();
      setShown({ id: ++id, text: heard.locked ? `${heard.vibe} · ${heard.tempo}` : heard.vibe });
    });
  }, [lounge]);

  if (!shown) return null;
  return (
    <p key={shown.id} className="lounge-badge" role="status">
      {shown.text}
    </p>
  );
}
