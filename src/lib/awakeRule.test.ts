import { describe, expect, it } from 'vitest';
import { AwakeRule } from './awakeRule';

describe('AwakeRule', () => {
  it('stays awake in fullscreen while music is playing', () => {
    expect(new AwakeRule().update(5, true, true)).toBe(true);
  });

  it('leaves the PC alone outside fullscreen', () => {
    expect(new AwakeRule().update(5, false, true)).toBe(false);
  });

  it('leaves the PC alone if nothing has played', () => {
    expect(new AwakeRule().update(5, true, false)).toBe(false);
  });

  it('sits through a quiet passage', () => {
    const rule = new AwakeRule();
    rule.update(5, true, true);
    expect(rule.update(120, true, false)).toBe(true);
  });

  it('lets the PC sleep once the music has stopped for good', () => {
    const rule = new AwakeRule();
    rule.update(5, true, true);
    expect(rule.update(301, true, false)).toBe(false);
  });

  it('wakes up again when the music comes back', () => {
    const rule = new AwakeRule();
    rule.update(5, true, true);
    rule.update(301, true, false);
    expect(rule.update(5, true, true)).toBe(true);
  });
});
