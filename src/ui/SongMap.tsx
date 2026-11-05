import { type PointerEvent, useEffect, useRef } from 'react';
import { Color } from 'three';
import { audioEngine } from '../audio/AudioEngine';
import { sectionAt, type SongSummary } from '../audio/score/songMap';
import { formatTime } from '../lib/formatTime';
import { useMediaQuery } from '../lib/useMediaQuery';
import { lookOf } from '../scene/partLook';
import { paletteColors } from '../settings/palettes';
import { useSettings } from '../settings/settingsStore';
import { seekTo } from '../state/actions';
import { useAppStore } from '../state/appStore';

const UI_INTERVAL_S = 1 / 30;
/** Top part of the strip for the sections, the rest for one thin lane per kind of sound. */
const SECTION_SHARE = 0.52;
const LANE_GAP = 1;
const BRAND_STOPS = ['#6a4cf0', '#1c8fd6', '#d63fae'] as const;
const ORDINALS = ['', '', '2nd time', '3rd time'];

/** The strip wears each part's own colour, so a song's repeats can be seen at a glance. */
function partColour(base: string, part: number): string {
  return `#${new Color(base).offsetHSL(lookOf(part).hue, 0.1, 0).getHexString()}`;
}

function describe(song: SongSummary, time: number): string {
  const section = sectionAt(song, time);
  if (!section) return formatTime(time);
  const visit = ORDINALS[section.visit] ?? (section.visit > 1 ? `${section.visit}th time` : '');
  const part = visit ? `Part ${section.letter}, ${visit}` : `Part ${section.letter}`;
  return `${formatTime(time)} · ${section.kind} · ${part}`;
}

/** The strip only changes with the song, its size or the palette, so it's drawn once for each. */
function drawSong(
  ctx: CanvasRenderingContext2D,
  song: SongSummary,
  width: number,
  height: number,
  [sectionColour, noteColour, hitColour]: readonly [string, string, string],
): void {
  const x = (time: number) => (time / song.duration) * width;
  const top = Math.round(height * SECTION_SHARE);
  ctx.clearRect(0, 0, width, height);

  for (const section of song.sections) {
    const left = x(section.start);
    const barHeight = top * (0.22 + 0.78 * section.size);
    const drop = section.kind === 'Drop';
    ctx.globalAlpha = drop ? 0.95 : 0.3 + 0.4 * section.size;
    ctx.fillStyle = partColour(drop ? hitColour : sectionColour, section.part);
    ctx.fillRect(left + 0.5, top - barHeight, Math.max(1, x(section.end) - left - 1), barHeight);
  }

  const { held, notes, hits, tension } = song.lanes;
  const column = width / held.length;
  ctx.fillStyle = noteColour;
  for (let i = 0; i < tension.length; i++) {
    const level = tension[i] ?? 0;
    if (level <= 0.01) continue;
    ctx.globalAlpha = 0.25 + 0.75 * level;
    ctx.fillRect(i * column, top - top * level, column + 0.5, top * level);
  }

  const lane = (height - top - LANE_GAP * 3) / 3;
  const drawLane = (levels: Float32Array, row: number, colour: string) => {
    ctx.fillStyle = colour;
    const y = top + LANE_GAP + row * (lane + LANE_GAP);
    for (let i = 0; i < levels.length; i++) {
      ctx.globalAlpha = (levels[i] ?? 0) * 0.95;
      ctx.fillRect(i * column, y, column + 0.5, lane);
    }
  };
  drawLane(held, 0, sectionColour);
  drawLane(notes, 1, noteColour);
  drawLane(hits, 2, hitColour);

  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  for (const drop of song.drops) ctx.fillRect(Math.round(x(drop.time)) - 1, 0, 2, height);
}

/**
 * The whole song on one strip: how big each section is, where it climbs and drops, and where
 * pads, notes and hits sit. It shows what the app understood, so a wrong reading is visible at
 * a glance, and it's also the way to move around the song.
 */
export function SongMap({ song }: { song: SongSummary }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const future = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);
  const lightScheme = useMediaQuery('(prefers-color-scheme: light)');
  const palette = useSettings((state) => state.palette);
  const custom = useSettings((state) => state.customColors);
  const paletteStops = paletteColors(palette, custom);
  const [first, second, third] = lightScheme
    ? BRAND_STOPS
    : [paletteStops[1], paletteStops[2], paletteStops[3]];

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx) return;
    const redraw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = element.clientWidth;
      const height = element.clientHeight;
      element.width = Math.round(width * dpr);
      element.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawSong(ctx, song, width, height, [first, second, third]);
    };
    const observer = new ResizeObserver(redraw);
    observer.observe(element);
    redraw();
    return () => observer.disconnect();
  }, [song, first, second, third]);

  // Follows playback on the frame tick, writing to the DOM rather than going through React.
  useEffect(() => {
    let elapsed = UI_INTERVAL_S;
    let spoken = '';
    return audioEngine.onFrame((dt) => {
      elapsed += dt;
      if (elapsed < UI_INTERVAL_S) return;
      elapsed = 0;
      const transport = audioEngine.transport;
      if (!transport || dragging.current) return;
      const now = transport.currentTime();
      if (future.current) {
        future.current.style.transform = `translateX(${(now / song.duration) * 100}%)`;
      }
      if (input.current) input.current.valueAsNumber = now;
      const section = sectionAt(song, now);
      const label = section ? `${section.kind}, part ${section.letter}` : '';
      if (label !== spoken && input.current) {
        spoken = label;
        input.current.setAttribute('aria-valuetext', `${formatTime(now)}, ${label}`);
      }
    });
  }, [song]);

  const showTip = (event: PointerEvent<HTMLInputElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const place = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const time = place * song.duration;
    if (!tip.current) return;
    tip.current.textContent = describe(song, time);
    // Kept inside the strip at both ends, so the label never gets clipped.
    tip.current.style.left = `${Math.min(86, Math.max(14, place * 100))}%`;
    tip.current.dataset['shown'] = 'true';
  };

  const hideTip = () => {
    if (tip.current) tip.current.dataset['shown'] = 'false';
  };

  const commit = () => {
    if (!dragging.current || !input.current) return;
    dragging.current = false;
    seekTo(input.current.valueAsNumber);
  };

  return (
    <div className="songmap">
      <canvas ref={canvas} className="songmap__song" aria-hidden="true" />
      <div ref={future} className="songmap__future" aria-hidden="true" />
      <span ref={tip} className="songmap__tip" data-shown="false" aria-hidden="true" />
      <input
        ref={input}
        className="songmap__seek"
        type="range"
        min={0}
        max={song.duration}
        step={0.01}
        defaultValue={0}
        aria-label="Song position"
        onPointerDown={() => {
          dragging.current = true;
        }}
        onPointerUp={commit}
        onPointerCancel={commit}
        onPointerMove={showTip}
        onPointerLeave={hideTip}
        onChange={(event) => {
          const value = event.currentTarget.valueAsNumber;
          if (future.current) {
            future.current.style.transform = `translateX(${(value / song.duration) * 100}%)`;
          }
          // Keyboard arrows seek immediately; pointer drags seek on release.
          if (!dragging.current) seekTo(value);
        }}
      />
    </div>
  );
}

/** The song map's row, with who's playing beside it. Nothing shows for a song with no timeline. */
export function SongLearning() {
  const learning = useAppStore((state) => state.learning);
  if (!learning) return null;
  return (
    <div className="songmap songmap--learning" role="status">
      Learning the song…
    </div>
  );
}
