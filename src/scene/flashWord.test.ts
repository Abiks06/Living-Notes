import { describe, expect, it } from 'vitest';
import { flashWordFor, readingTime, titleFromFile } from './flashWord';

describe('titleFromFile', () => {
  it('finds the song inside a typical file name', () => {
    expect(titleFromFile('03 - Artist - Midnight (Remastered 2011).mp3')).toBe('Midnight');
    expect(titleFromFile('Artist - Slow Burn.flac')).toBe('Slow Burn');
    expect(titleFromFile('07. Golden Hour [Live].m4a')).toBe('Golden Hour');
    expect(titleFromFile('late_night_drive.wav')).toBe('late night drive');
  });

  it('keeps a long title whole', () => {
    expect(titleFromFile('The Long and Winding Road Home.mp3')).toBe(
      'The Long and Winding Road Home',
    );
  });

  it('cuts only a very long title, at a word and never through one', () => {
    const name = 'Now That We Have Found Love What Are We Going To Do With It Tonight.mp3';
    expect(titleFromFile(name)).toBe('Now That We Have Found Love What Are We Going To');
  });

  it('copes with a single unbroken word', () => {
    expect(titleFromFile(`${'x'.repeat(60)}.mp3`)).toHaveLength(48);
  });

  it('gives nothing for a name with no title in it', () => {
    expect(titleFromFile('(1).mp3')).toBe('');
  });
});

describe('readingTime', () => {
  it('gives a long name longer on screen, up to a limit', () => {
    expect(readingTime('Shameless')).toBe(1.6);
    expect(readingTime('Bitch, Don’t Kill My Vibe (Remix)')).toBeGreaterThan(2.5);
    expect(readingTime('x'.repeat(48))).toBe(3.2);
  });
});

describe('flashWordFor', () => {
  it('prefers the word the visitor chose', () => {
    expect(flashWordFor({ kind: 'demo', id: 'a', title: 'Pulse Engine' }, 'HELLO')).toBe('HELLO');
  });

  it('uses the track’s name otherwise', () => {
    expect(flashWordFor({ kind: 'demo', id: 'a', title: 'Pulse Engine' }, 'RESONANCE')).toBe(
      'Pulse Engine',
    );
    expect(flashWordFor({ kind: 'file', name: 'Artist - Song.mp3' }, 'RESONANCE')).toBe('Song');
  });

  it('falls back to the name of the app for inputs with no title', () => {
    expect(flashWordFor({ kind: 'mic' }, 'RESONANCE')).toBe('RESONANCE');
    expect(flashWordFor({ kind: 'file', name: '(1).mp3' }, '  ')).toBe('RESONANCE');
    expect(flashWordFor(null, '')).toBe('RESONANCE');
  });
});
