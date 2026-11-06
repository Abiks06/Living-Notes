import { useLayoutEffect, useRef } from 'react';

const SCROLL_PX_PER_S = 55;
/** Rests at each end, across the whole there-and-back. */
const PAUSES_S = 3;

/** One line of text that drifts across and back when it's too long for its space. */
export function ScrollText({ text, className }: { text: string; className: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const line = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const outer = box.current;
    const inner = line.current;
    if (!outer || !inner) return;
    const measure = () => {
      const shift = inner.scrollWidth - outer.clientWidth;
      outer.dataset['overflow'] = String(shift > 1);
      outer.style.setProperty('--shift', `${-shift}px`);
      outer.style.setProperty('--scroll-s', `${(shift / SCROLL_PX_PER_S) * 2 + PAUSES_S}s`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    return () => observer.disconnect();
  }, [text]);

  return (
    <span ref={box} className={`scroll-text ${className}`} title={text}>
      <span ref={line} className="scroll-text__line">
        {text}
      </span>
    </span>
  );
}
