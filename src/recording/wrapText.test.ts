import { describe, expect, it } from 'vitest';
import { wrapText } from './wrapText';

const byLetters = (line: string) => line.length;

describe('wrapText', () => {
  it('leaves a short line alone', () => {
    expect(wrapText('Money Trees', 20, byLetters)).toEqual(['Money Trees']);
  });

  it('wraps by word, keeping every word when two lines are enough', () => {
    expect(wrapText('Bitch Dont Kill My Vibe', 12, byLetters)).toEqual([
      'Bitch Dont',
      'Kill My Vibe',
    ]);
  });

  it('ends in an ellipsis rather than losing the end silently', () => {
    const lines = wrapText('one two three four five six seven eight', 10, byLetters);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('one two');
    expect(lines[1]?.endsWith('…')).toBe(true);
    expect(lines[1]?.length).toBeLessThanOrEqual(10);
  });

  it('cuts a single word too long for the line', () => {
    expect(wrapText('Supercalifragilistic', 8, byLetters)).toEqual(['Superca…']);
  });

  it('has nothing to draw for empty text', () => {
    expect(wrapText('   ', 8, byLetters)).toEqual([]);
  });
});
