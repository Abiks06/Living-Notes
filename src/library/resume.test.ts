import { describe, expect, it } from 'vitest';
import { canResume, resumeFrom } from './resume';

describe('resumeFrom', () => {
  it('carries on from where the song was left', () => {
    expect(resumeFrom(92, 240)).toBe(92);
  });

  it('starts again when only the very start was heard', () => {
    expect(resumeFrom(4, 240)).toBe(0);
  });

  it('starts again when the song had all but finished', () => {
    expect(resumeFrom(235, 240)).toBe(0);
  });

  it('trusts the position when the length isn’t known', () => {
    expect(resumeFrom(92, 0)).toBe(92);
  });
});

describe('canResume', () => {
  it('remembers songs from the folder, not ones dropped in', () => {
    expect(canResume('Music/new/song.mp3')).toBe(true);
    expect(canResume('dropped/song.mp3/1234')).toBe(false);
  });
});
