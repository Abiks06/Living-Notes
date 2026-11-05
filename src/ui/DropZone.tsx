import { useEffect, useState } from 'react';
import { AUDIO_FILE } from '../library/library';
import { playFiles } from '../library/player';
import { ensureStarted } from '../state/actions';
import { useAppStore } from '../state/appStore';

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/** Window-wide drag-and-drop target for audio files. */
export function DropZone() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let depth = 0;

    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth++;
      setActive(true);
    };
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setActive(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      const audio = files.filter((file) => AUDIO_FILE.test(file.name));
      if (files.length > 0 && audio.length === 0) {
        useAppStore.getState().showNotice({
          tone: 'error',
          title: files.length > 1 ? 'No audio files there' : 'That isn’t an audio file',
          body: 'Try MP3, FLAC, WAV, M4A or OGG files.',
        });
      } else if (audio.length > 0 && ensureStarted()) {
        void playFiles(audio);
      }
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  if (!active) return null;
  return (
    <div className="drop-zone" aria-hidden="true">
      <div className="drop-zone__frame">
        <p className="drop-zone__title">Drop to visualize</p>
        <p className="drop-zone__body">MP3, FLAC, WAV, M4A or OGG</p>
      </div>
    </div>
  );
}
