import { useEffect, useState } from 'react';
import { ensureStarted, loadFiles } from '../state/actions';

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
      if (files.length > 0 && ensureStarted()) void loadFiles(files);
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
        <p className="drop-zone__body">MP3, WAV or OGG</p>
      </div>
    </div>
  );
}
