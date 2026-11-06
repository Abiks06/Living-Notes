import { describe, expect, it } from 'vitest';
import { cleanTitle, nameParts, namedBackwards, readTags } from './tags';

const text = (value: string) => Array.from(new TextEncoder().encode(value));
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];
const be32 = (n: number) => [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const blob = (bytes: number[]) => new Blob([Uint8Array.from(bytes)]);

function comments(entries: string[]): number[] {
  const vendor = text('test');
  return [
    ...le32(vendor.length),
    ...vendor,
    ...le32(entries.length),
    ...entries.flatMap((entry) => {
      const bytes = text(entry);
      return [...le32(bytes.length), ...bytes];
    }),
  ];
}

const flacBlock = (type: number, body: number[], last = false) => [
  type | (last ? 128 : 0),
  (body.length >> 16) & 255,
  (body.length >> 8) & 255,
  body.length & 255,
  ...body,
];

function streamInfo(rate: number, samples: number): number[] {
  const info = new Array<number>(34).fill(0);
  info[10] = rate >> 12;
  info[11] = (rate >> 4) & 255;
  info[12] = (rate & 15) << 4;
  be32(samples).forEach((byte, i) => (info[14 + i] = byte));
  return info;
}

function picture(image: number[]): number[] {
  const mime = text('image/png');
  return [
    ...be32(3),
    ...be32(mime.length),
    ...mime,
    ...be32(0),
    ...new Array<number>(16).fill(0),
    ...be32(image.length),
    ...image,
  ];
}

const syncsafe = (n: number) => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];

function id3(frames: number[][]): number[] {
  const body = frames.flat();
  return [...text('ID3'), 4, 0, 0, ...syncsafe(body.length), ...body];
}

const id3Frame = (name: string, body: number[]) => [
  ...text(name),
  ...syncsafe(body.length),
  0,
  0,
  ...body,
];

describe('Reading tags', () => {
  it('reads a FLAC’s comments, length and art', async () => {
    const art = [1, 2, 3, 4, 5];
    const bytes = [
      ...text('fLaC'),
      ...flacBlock(0, streamInfo(44100, 44100 * 90)),
      ...flacBlock(
        4,
        comments([
          'TITLE=EARFQUAKE',
          'ARTIST=Tyler',
          'ALBUM=IGOR',
          'TRACKNUMBER=2',
          'DATE=2019/5/17',
        ]),
      ),
      ...flacBlock(6, picture(art), true),
      0xff,
      0xf8,
    ];
    const tags = await readTags(blob(bytes));
    expect(tags.title).toBe('EARFQUAKE');
    expect(tags.artist).toBe('Tyler');
    expect(tags.album).toBe('IGOR');
    expect(tags.track).toBe(2);
    expect(tags.year).toBe('2019');
    expect(tags.duration).toBeCloseTo(90);
    expect(tags.cover?.type).toBe('image/png');
    const { offset, length } = tags.cover ?? { offset: 0, length: 0 };
    expect(bytes.slice(offset, offset + length)).toEqual(art);
  });

  it('reads an MP3’s frames in every text encoding', async () => {
    const utf16 = [1, 0xff, 0xfe, ...Array.from('Tröoper').flatMap((c) => [c.charCodeAt(0), 0])];
    const tags = await readTags(
      blob([
        ...id3([
          id3Frame('TIT2', utf16),
          id3Frame('TPE1', [3, ...text('Iron Maiden')]),
          id3Frame('TALB', [0, ...text('Piece of Mind')]),
          id3Frame('TRCK', [0, ...text('4/9')]),
        ]),
        0xff,
        0xfb,
      ]),
    );
    expect(tags.title).toBe('Tröoper');
    expect(tags.artist).toBe('Iron Maiden');
    expect(tags.album).toBe('Piece of Mind');
    expect(tags.track).toBe(4);
  });

  it('finds an MP3’s cover art past its description', async () => {
    const art = [9, 8, 7];
    const bytes = id3([
      id3Frame('APIC', [0, ...text('image/jpeg'), 0, 3, ...text('Front'), 0, ...art]),
    ]);
    const tags = await readTags(blob(bytes));
    const { offset, length } = tags.cover ?? { offset: 0, length: 0 };
    expect(tags.cover?.type).toBe('image/jpeg');
    expect(bytes.slice(offset, offset + length)).toEqual(art);
  });

  it('reads an M4A’s atoms', async () => {
    const atom = (name: string, body: number[]) => [
      ...be32(body.length + 8),
      ...Array.from(name, (c) => c.charCodeAt(0)),
      ...body,
    ];
    const data = (body: number[]) => atom('data', [...be32(1), ...be32(0), ...body]);
    const ilst = atom('ilst', [
      ...atom('©nam', data(text('Crown'))),
      ...atom('©ART', data(text('Kendrick'))),
      ...atom('trkn', data([0, 0, 0, 7, 0, 12, 0, 0])),
    ]);
    const bytes = [
      ...atom('ftyp', text('M4A ')),
      ...atom('moov', atom('udta', atom('meta', [...be32(0), ...ilst]))),
    ];
    const tags = await readTags(blob(bytes));
    expect(tags.title).toBe('Crown');
    expect(tags.artist).toBe('Kendrick');
    expect(tags.track).toBe(7);
  });

  it('shrugs off a damaged or untagged file', async () => {
    expect(await readTags(blob([0, 1, 2, 3]))).toEqual({});
    expect(await readTags(blob([...text('fLaC'), 4, 255, 255]))).toEqual({});
  });
});

describe('Names', () => {
  it('cleans what doesn’t belong in a title', () => {
    expect(cleanTitle('Hotel California (2013 Remaster)')).toBe('Hotel California');
    expect(cleanTitle('The Trooper (Official Video)')).toBe('The Trooper');
    expect(cleanTitle('Crown (FLAC)')).toBe('Crown');
    expect(cleanTitle('TSUNAMI (Original Mix)')).toBe('TSUNAMI (Original Mix)');
  });

  it('guesses from a file name when there are no tags', () => {
    expect(nameParts('11. 21 Savage - pad lock (FLAC).flac')).toEqual({
      title: 'pad lock',
      artist: '21 Savage',
    });
    expect(nameParts('Hotel California (2013 Remaster).mp3').title).toBe('Hotel California');
    expect(nameParts('Iron Maiden - The Trooper (Official Video).mp3')).toEqual({
      title: 'The Trooper',
      artist: 'Iron Maiden',
    });
  });
});

describe('namedBackwards', () => {
  const tagged = (artist: string) => ({ title: 'Anything', artist, guessed: false });
  const file = (artist: string, title: string) => ({ title, artist, guessed: true });

  it('spots an artist the tags already know, on the song side', () => {
    const track = file('SORRY NOT SORRY', 'Tyler, The Creator');
    expect(namedBackwards(track, [track, tagged('Tyler, The Creator')])).toBe(true);
  });

  it('allows for a guest after the artist', () => {
    const track = file('She', 'Tyler, The Creator Frank Ocean');
    expect(namedBackwards(track, [track, tagged('Tyler, The Creator')])).toBe(true);
  });

  it('spots the same name on the song side of several files', () => {
    const one = file('Song One', 'Royel Otis');
    const two = file('Song Two', 'Royel Otis');
    expect(namedBackwards(one, [one, two])).toBe(true);
  });

  it('leaves the usual order alone', () => {
    const track = file('The Weeknd', 'Shameless');
    const other = file('The Weeknd', 'As You Are');
    expect(namedBackwards(track, [track, other, tagged('The Weeknd')])).toBe(false);
  });

  it('never touches tagged songs', () => {
    const track = tagged('Kendrick Lamar');
    expect(namedBackwards(track, [track, tagged('Anything')])).toBe(false);
  });
});
