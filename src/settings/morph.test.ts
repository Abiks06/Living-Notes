import { describe, expect, it } from 'vitest';
import { activeLook, LOOKS } from './looks';
import { DEFAULT_SETTINGS, MAX_WORD_LENGTH, sanitizeWord } from './schema';
import { decodeSettings, encodeSettings, settingsFromHash } from './urlState';

describe('sanitizeWord', () => {
  it('keeps ordinary names, accents and emoji', () => {
    expect(sanitizeWord('Ayomide')).toBe('Ayomide');
    expect(sanitizeWord('Zoë 🎧')).toBe('Zoë 🎧');
  });

  it('strips control characters and collapses whitespace', () => {
    expect(sanitizeWord('a\u0000b\n\n c‮')).toBe('a b c ');
  });

  it('caps by character, without splitting an emoji in half', () => {
    const capped = sanitizeWord('🎧'.repeat(40));
    expect(Array.from(capped)).toHaveLength(MAX_WORD_LENGTH);
    expect(capped).toBe('🎧'.repeat(MAX_WORD_LENGTH));
  });

  it('keeps a trailing space while typing, so two-word entries are possible', () => {
    expect(sanitizeWord('hello ')).toBe('hello ');
  });
});

describe('morph settings in share links', () => {
  it('round-trips a pinned shape and a custom word', () => {
    const look = {
      ...DEFAULT_SETTINGS,
      scene: 'morph',
      morphShape: 'word',
      word: 'Zoë 🎧',
    } as const;
    expect(settingsFromHash(encodeSettings(look))).toEqual(look);
  });

  it('leaves defaults out of the link', () => {
    expect(encodeSettings(DEFAULT_SETTINGS)).toBe('');
    expect(encodeSettings({ ...DEFAULT_SETTINGS, word: '   ' })).toBe('');
  });

  it('rejects unknown shapes and sanitizes hostile words', () => {
    expect(decodeSettings('ms=cube')).toEqual({});
    expect(decodeSettings('w=%20%20')).toEqual({});
    expect(decodeSettings(`w=${'x'.repeat(500)}`).word).toHaveLength(MAX_WORD_LENGTH);
  });
});

describe('activeLook', () => {
  it('recognises every curated look after it is applied', () => {
    for (const look of LOOKS) {
      expect(activeLook({ ...DEFAULT_SETTINGS, ...look.settings })).toBe(look.key);
    }
  });

  it('clears as soon as a slider moves off the look', () => {
    expect(activeLook({ ...DEFAULT_SETTINGS, bloom: 1.05 })).toBeNull();
  });

  it('ignores personal settings the looks leave alone', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      word: 'Ayo',
      particles: '590k',
      autoOrbit: false,
    } as const;
    expect(activeLook(settings)).toBe('aurora-drift');
  });
});
