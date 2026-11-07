import { describe, expect, it } from 'vitest';
import { lyricShift } from './align';
import { lineAt, parseLyrics, shifted } from './lrc';
import { pickMoments } from './moments';
import { bareTitle, bestEntry, likeness, type LyricsEntry, plain, searches } from './names';

const entry = (over: Partial<LyricsEntry>): LyricsEntry => ({
  trackName: 'Song',
  artistName: 'Artist',
  duration: 200,
  instrumental: false,
  syncedLyrics: '[00:01.00] words',
  ...over,
});

describe('bareTitle', () => {
  it('drops what a file name adds', () => {
    expect(bareTitle('Adore You (Official Video)')).toBe('Adore You');
    expect(bareTitle('Crown (FLAC)')).toBe('Crown');
    expect(bareTitle('Creep [Remastered 2009]')).toBe('Creep');
    expect(bareTitle('Hotel California - 2013 Remaster')).toBe('Hotel California');
    expect(bareTitle('She feat. Frank Ocean')).toBe('She');
    expect(bareTitle('She (feat. Frank Ocean)')).toBe('She');
  });

  it('keeps what makes it a different recording', () => {
    expect(bareTitle('Creep (Acoustic)')).toBe('Creep (Acoustic)');
    expect(bareTitle('Vibe (Remix)')).toBe('Vibe (Remix)');
  });

  it('never leaves a song with no name', () => {
    expect(bareTitle('(Official Video)')).toBe('(Official Video)');
  });
});

describe('plain', () => {
  it('compares words, not spelling', () => {
    expect(plain('Beyoncé')).toBe('beyonce');
    expect(plain("Don't")).toBe(plain('Don t'));
    expect(plain('Salt & Pepper')).toBe('salt and pepper');
    expect(plain('GOD.')).toBe('god');
  });
});

describe('likeness', () => {
  it('finds the same name', () => {
    expect(likeness('Is There Someone Else?', 'is there someone else')).toBe(1);
  });

  it('tells different names apart', () => {
    expect(likeness('Falling', 'Adore You')).toBe(0);
  });
});

describe('bestEntry', () => {
  const song = { title: 'Cinnamon Girl', artist: 'Lana Del Rey', duration: 296 };
  const lana = { trackName: 'Cinnamon Girl', artistName: 'Lana Del Rey' };

  it('picks the entry with the same length as this copy', () => {
    const entries = [entry({ ...lana, duration: 301 }), entry({ ...lana, duration: 296 })];
    expect(bestEntry(song, entries)?.duration).toBe(296);
  });

  it('finds files named the other way round', () => {
    const found = bestEntry({ title: 'Kendrick Lamar', artist: 'Crown', duration: 264 }, [
      entry({ trackName: 'Crown', artistName: 'Kendrick Lamar', duration: 264 }),
    ]);
    expect(found?.trackName).toBe('Crown');
  });

  it('accepts one artist out of several', () => {
    const found = bestEntry({ title: 'Many Men', artist: '21 Savage', duration: 0 }, [
      entry({ trackName: 'Many Men', artistName: '21 Savage & Metro Boomin' }),
    ]);
    expect(found).not.toBeNull();
  });

  it('turns down a same-named song by someone else', () => {
    const found = bestEntry({ title: 'Falling', artist: 'Harry Styles', duration: 240 }, [
      entry({ trackName: 'Falling', artistName: 'Trevor Daniel', duration: 240 }),
    ]);
    expect(found).toBeNull();
  });

  it('prefers the studio recording over a live one', () => {
    const entries = [
      entry({ ...lana, trackName: 'Cinnamon Girl (Live)', duration: 296 }),
      entry({ ...lana, duration: 300 }),
    ];
    expect(bestEntry(song, entries)?.trackName).toBe('Cinnamon Girl');
  });

  it('skips entries with no timing, and instrumentals', () => {
    expect(bestEntry(song, [entry({ ...lana, syncedLyrics: null })])).toBeNull();
    expect(bestEntry(song, [entry({ ...lana, instrumental: true })])).toBeNull();
  });

  it('needs the length to agree when there is no artist', () => {
    const named = { trackName: 'Hotel California', artistName: 'Eagles' };
    const title = 'Hotel California';
    expect(
      bestEntry({ title, artist: '', duration: 391 }, [entry({ ...named, duration: 391 })]),
    ).not.toBeNull();
    expect(
      bestEntry({ title, artist: '', duration: 120 }, [entry({ ...named, duration: 391 })]),
    ).toBeNull();
  });

  it('untangles a file name with no separators', () => {
    const title = 'Bitch, Don t Kill My Vibe Remix Kendrick Lamar JAY Z';
    const found = bestEntry({ title, artist: '', duration: 0 }, [
      entry({ trackName: "Bitch, Don't Kill My Vibe", artistName: 'Kendrick Lamar' }),
    ]);
    expect(found).not.toBeNull();
  });
});

describe('searches', () => {
  it('tries both ways round', () => {
    const asked = searches({ title: 'Crown', artist: 'Kendrick Lamar', duration: 0 });
    expect(asked[0]).toContain('track_name=Crown');
    expect(asked[1]).toContain('artist_name=Crown');
  });

  it('sends only the name', () => {
    const asked = searches({ title: 'Crown', artist: '', duration: 264 }).join('&');
    expect(asked).toBe('q=Crown');
  });
});

describe('parseLyrics', () => {
  it('reads timed lines in order', () => {
    const lines = parseLyrics('[00:12.50] second\n[00:02.00] first\n[ar: someone]\nnot timed');
    expect(lines.map((line) => line.text)).toEqual(['first', 'second']);
    expect(lines[0]?.time).toBe(2);
    expect(lines[1]?.time).toBe(12.5);
  });

  it('reads one line sung at several times', () => {
    const lines = parseLyrics('[00:01.00][01:01.00] chorus');
    expect(lines.map((line) => line.time)).toEqual([1, 61]);
  });

  it('ends a line at the next one', () => {
    expect(parseLyrics('[00:01.00] a\n[00:02.00] b')[0]?.end).toBe(2);
  });

  it('ends a line at a marked break', () => {
    expect(parseLyrics('[00:01.00] a\n[00:02.50]\n[00:30.00] b')[0]?.end).toBe(2.5);
  });

  it("doesn't leave a line up through a long solo", () => {
    const [line] = parseLyrics('[00:01.00] a short line\n[01:00.00] b');
    expect(line?.end).toBeLessThan(10);
  });

  it('survives nonsense', () => {
    expect(parseLyrics('')).toEqual([]);
    expect(parseLyrics('no timing here')).toEqual([]);
  });
});

describe('lineAt', () => {
  const lines = parseLyrics('[00:10.00] a\n[00:12.00] b\n[00:13.00]\n[00:40.00] c');

  it('finds the line being sung', () => {
    expect(lineAt(lines, 10.5)?.text).toBe('a');
    expect(lineAt(lines, 12.5)?.text).toBe('b');
  });

  it('shows nothing in an instrumental stretch', () => {
    expect(lineAt(lines, 5)).toBeNull();
    expect(lineAt(lines, 25)).toBeNull();
    expect(lineAt(lines, 400)).toBeNull();
  });
});

describe('pickMoments', () => {
  const song = (rows: string[]) => parseLyrics(rows.join('\n'));
  const everyEight = (text: (i: number) => string) =>
    Array.from(
      { length: 30 },
      (_, i) =>
        `[${String(Math.floor((i * 8) / 60)).padStart(2, '0')}:${String((i * 8) % 60).padStart(2, '0')}.00] ${text(i)}`,
    );

  it('spaces them out', () => {
    const moments = pickMoments(song(everyEight((i) => `line number ${i}`)), 'Song');
    expect(moments.length).toBeGreaterThan(3);
    moments.slice(1).forEach((moment, i) => {
      expect(moment.time - (moments[i]?.time ?? 0)).toBeGreaterThanOrEqual(24);
    });
  });

  it('leaves the opening alone', () => {
    const moments = pickMoments(song(everyEight((i) => `line ${i}`)), 'Song');
    expect(moments[0]?.time).toBeGreaterThanOrEqual(10);
  });

  it('goes for the hook', () => {
    const rows = everyEight((i) => (i % 6 === 3 ? 'cinnamon girl' : `verse words here ${i}`));
    const moments = pickMoments(song(rows), 'Cinnamon Girl');
    expect(moments.filter((moment) => moment.text === 'cinnamon girl').length).toBeGreaterThan(0);
  });

  it('uses the opening of a line, as that is what lands on time', () => {
    const moments = pickMoments(
      song(['[00:20.00] Green is the colour of her kind of eyes, and more']),
      'x',
    );
    expect(moments[0]?.text).toBe('Green is the colour');
  });

  it("doesn't stop on a word that leaves the phrase hanging", () => {
    const moments = pickMoments(song(['[00:20.00] All the pills that you left behind']), 'x');
    expect(moments[0]?.text).toBe('All the pills');
  });

  it('leaves backing vocals out', () => {
    const moments = pickMoments(song(['[00:20.00] Blowing gun smoke (smoke, smoke)']), 'x');
    expect(moments[0]?.text).toBe('Blowing gun smoke');
  });

  it('skips sung sounds', () => {
    expect(pickMoments(song(['[00:20.00] Ooh-ooh', '[00:50.00] Oh, yeah']), 'x')).toEqual([]);
  });

  it('skips words someone has censored', () => {
    expect(pickMoments(song(["[00:20.00] I'm a down-to-Earth ****"]), 'x')).toEqual([]);
  });

  it('keeps explicit words off the whole screen', () => {
    expect(pickMoments(song(['[00:20.00] fuck that']), 'x')).toEqual([]);
  });

  it('copes with a song of no words', () => {
    expect(pickMoments([], 'x')).toEqual([]);
  });
});

describe('lyricShift', () => {
  const RATE = 100;
  /** A voice that starts each line 0.05 s after it, sings for two seconds, then rests. */
  function voiceFor(starts: readonly number[], length: number): Float32Array {
    const voice = new Float32Array(length * RATE);
    for (const start of starts) {
      const from = Math.round((start + 0.05) * RATE);
      voice.fill(0.8, from, from + 2 * RATE);
    }
    return voice;
  }
  // Uneven gaps, as real lyrics have, or every shift by a whole gap would fit as well.
  const starts = [12, 15.5, 21, 24, 31.2, 36, 39.1, 47, 50.8, 58, 61.5, 70.3];
  const rows = starts.map((time) => ({ time, end: time + 2, text: 'line' }));

  it('trusts lyrics timed to a recording of the same length', () => {
    expect(lyricShift(shifted(rows, -4), voiceFor(starts, 90), RATE, 1)).toBe(0);
  });

  it('finds how far a longer intro has moved the words', () => {
    expect(lyricShift(shifted(rows, -4), voiceFor(starts, 90), RATE, 4)).toBeCloseTo(4, 0);
  });

  it('finds how far a shorter intro has moved them', () => {
    expect(lyricShift(shifted(rows, 5), voiceFor(starts, 90), RATE, -5)).toBeCloseTo(-5, 0);
  });

  it('leaves them alone if it was the ending that was longer', () => {
    expect(lyricShift(rows, voiceFor(starts, 90), RATE, 6)).toBeCloseTo(0, 0);
  });

  it("won't guess from noise", () => {
    let seed = 7;
    const noise = Float32Array.from({ length: 90 * RATE }, () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    });
    expect(lyricShift(rows, noise, RATE, 4)).toBe(0);
  });

  it('needs a voice, and enough lines', () => {
    expect(lyricShift(rows, new Float32Array(0), RATE, 4)).toBe(0);
    expect(lyricShift(rows.slice(0, 3), voiceFor(starts, 90), RATE, 4)).toBe(0);
  });
});
