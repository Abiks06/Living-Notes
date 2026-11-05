import { describe, expect, it } from 'vitest';
import { withoutCoverArt } from './flac';

const block = (type: number, length: number, last = false) => [
  type | (last ? 0x80 : 0),
  0,
  0,
  length,
  ...new Array<number>(length).fill(type + 1),
];
const magic = [0x66, 0x4c, 0x61, 0x43];
const audio = [0xff, 0xf8, 1, 2, 3];
const file = (...parts: number[][]) => new File([Uint8Array.from(parts.flat())], 'song.flac');

async function read(blob: Blob): Promise<number[]> {
  return [...new Uint8Array(await blob.arrayBuffer())];
}

describe('FLAC cover art', () => {
  it('takes the picture out and leaves the audio alone', async () => {
    const song = file(magic, block(0, 3), block(6, 5), block(4, 2, true), audio);
    expect(await read(await withoutCoverArt(song))).toEqual([
      ...magic,
      ...block(0, 3),
      ...block(4, 2, true),
      ...audio,
    ]);
  });

  it('moves the last-block flag when the picture was last', async () => {
    const song = file(magic, block(0, 3), block(6, 5, true), audio);
    expect(await read(await withoutCoverArt(song))).toEqual([
      ...magic,
      ...block(0, 3, true),
      ...audio,
    ]);
  });

  it('returns a FLAC with no art untouched', async () => {
    const song = file(magic, block(0, 3, true), audio);
    expect(await withoutCoverArt(song)).toBe(song);
  });

  it('ignores anything that isn’t a FLAC', async () => {
    const song = new File(['ID3 something'], 'song.mp3');
    expect(await withoutCoverArt(song)).toBe(song);
  });
});
