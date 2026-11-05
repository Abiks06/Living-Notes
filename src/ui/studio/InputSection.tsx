import { useEffect, useState } from 'react';
import { listAudioInputs } from '../../audio/sources';
import { selectMicDevice } from '../../state/actions';
import { useAppStore } from '../../state/appStore';
import { Section } from './controls';

/** Picks the mic input: an audio interface, or a loopback like BlackHole or Stereo Mix. */
export function InputSection() {
  const micDevice = useAppStore((state) => state.micDevice);
  const mic = useAppStore((state) => state.mic);
  const [inputs, setInputs] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    const refresh = () => {
      listAudioInputs()
        .then(setInputs)
        .catch(() => setInputs([]));
    };
    refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
    // Names appear once permission is granted, so look again when the mic goes live.
  }, [mic]);

  return (
    <Section title="Input device">
      {inputs.length > 0 ? (
        <select
          className="input-select"
          value={micDevice ?? ''}
          aria-label="Audio input device"
          onChange={(event) => selectMicDevice(event.currentTarget.value || null)}
        >
          <option value="">System default</option>
          {inputs.map((input) => (
            <option key={input.id} value={input.id}>
              {input.label}
            </option>
          ))}
        </select>
      ) : (
        <p className="studio-caption">Turn on the mic once and your inputs will be listed here.</p>
      )}
    </Section>
  );
}
