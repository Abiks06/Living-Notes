import { describe, expect, it } from 'vitest';
import { canRecordClip } from './recordable';

describe('canRecordClip', () => {
  it('refuses audio shared from another tab', () => {
    expect(canRecordClip({ kind: 'tab' })).toBe(false);
  });

  it('allows the sources that are the listener’s own', () => {
    expect(canRecordClip(null)).toBe(true);
    expect(canRecordClip({ kind: 'mic' })).toBe(true);
    expect(canRecordClip({ kind: 'file', name: 'song.flac' })).toBe(true);
    expect(canRecordClip({ kind: 'demo', id: 'demo', title: 'Demo' })).toBe(true);
  });
});
