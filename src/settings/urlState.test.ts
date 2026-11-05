import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from './schema';
import { decodeSettings, encodeSettings, settingsFromHash } from './urlState';

const tweaked: Settings = {
  ...DEFAULT_SETTINGS,
  scene: 'terrain',
  palette: 'custom',
  customColors: ['#112233', '#445566', '#778899', '#aabbcc'],
  particles: '590k',
  autoOrbit: false,
  sensitivity: [1.5, 1, 0.5, 1, 2, 0],
  bloom: 1.35,
  trails: 0.2,
  pointSize: 0.6,
};

describe('share-link codec', () => {
  it('encodes the default look as an empty hash', () => {
    expect(encodeSettings(DEFAULT_SETTINGS)).toBe('');
  });

  it('round-trips every kind of setting', () => {
    expect(settingsFromHash(encodeSettings(tweaked))).toEqual(tweaked);
  });

  it('only writes values that differ from the defaults', () => {
    const hash = encodeSettings({ ...DEFAULT_SETTINGS, bloom: 1.5 });
    expect(new URLSearchParams(hash).get('b')).toBe('1.5');
    expect([...new URLSearchParams(hash).keys()].sort()).toEqual(['b', 'v']);
  });

  it('keeps links readable: no percent-encoded separators', () => {
    const hash = encodeSettings({ ...DEFAULT_SETTINGS, sensitivity: [1, 2, 1, 1, 1, 1] });
    expect(hash).toContain('sens=1_2_1_1_1_1');
    expect(hash).not.toContain('%');
  });

  it('accepts a leading #', () => {
    expect(decodeSettings('#s=morph&p=solar')).toEqual({ scene: 'morph', palette: 'solar' });
  });

  it('ignores unknown keys and invalid enum values', () => {
    expect(decodeSettings('s=disco&p=rainbow&n=1M&o=yes&evil=<script>')).toEqual({});
  });

  it('clamps out-of-range numbers and snaps them to the slider step', () => {
    const decoded = decodeSettings('b=99&ps=-4&cf=1.2345');
    expect(decoded.bloom).toBe(2);
    expect(decoded.pointSize).toBe(0.4);
    expect(decoded.curl).toBe(1.25);
  });

  it('rejects non-numeric numbers instead of producing NaN', () => {
    expect(decodeSettings('b=abc&t=&ca=Infinity')).toEqual({});
  });

  it('requires all six sensitivity bands, defaulting unreadable entries', () => {
    expect(decodeSettings('sens=1_2_3').sensitivity).toBeUndefined();
    expect(decodeSettings('sens=2_x_1_1_1_9').sensitivity).toEqual([2, 1, 1, 1, 1, 2.5]);
  });

  it('requires exactly four valid hex colours', () => {
    expect(decodeSettings('cc=112233-445566-778899').customColors).toBeUndefined();
    expect(decodeSettings('cc=112233-445566-778899-zzzzzz').customColors).toBeUndefined();
    expect(decodeSettings('cc=AABBCC-445566-778899-001122').customColors).toEqual([
      '#aabbcc',
      '#445566',
      '#778899',
      '#001122',
    ]);
  });
});
