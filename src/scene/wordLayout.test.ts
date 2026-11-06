import { describe, expect, it } from 'vitest';
import { wordLines } from './wordLayout';

const widthOf = (text: string) => text.length * 100;

describe('wordLines', () => {
  it('keeps a short word on one line', () => {
    expect(wordLines('RESONANCE', widthOf, 1700)).toEqual(['RESONANCE']);
  });

  it('breaks a long title into even lines, keeping every word', () => {
    const lines = wordLines('Bitch, Don’t Kill My Vibe (Remix)', widthOf, 1700);
    expect(lines).toEqual(['Bitch, Don’t Kill', 'My Vibe (Remix)']);
  });

  it('uses a third line only when two would still be too wide', () => {
    const title = 'The Long and Winding Road Back Home Again Tonight, Once More With Feeling';
    const lines = wordLines(title, widthOf, 2800);
    expect(lines).toHaveLength(3);
    expect(lines.join(' ')).toBe(title);
  });

  it('can’t break a single word, however long', () => {
    expect(wordLines('Supercalifragilisticexpialidocious', widthOf, 1700)).toHaveLength(1);
  });
});
