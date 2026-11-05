import { describe, expect, it } from 'vitest';
import { isShortcutKey, isTextEntry, ownsSpace } from './keyboard';

const element = (tagName: string, extra: object = {}) =>
  ({ tagName, ...extra }) as unknown as EventTarget;

describe('isTextEntry', () => {
  it('lets shortcuts through from buttons and non-text inputs', () => {
    expect(isTextEntry(element('BUTTON'))).toBe(false);
    expect(isTextEntry(element('INPUT', { type: 'range' }))).toBe(false);
    expect(isTextEntry(element('INPUT', { type: 'color' }))).toBe(false);
    expect(isTextEntry(element('INPUT', { type: 'checkbox' }))).toBe(false);
  });

  it('blocks them where the key actually types', () => {
    expect(isTextEntry(element('INPUT', { type: 'text' }))).toBe(true);
    expect(isTextEntry(element('INPUT'))).toBe(true);
    expect(isTextEntry(element('TEXTAREA'))).toBe(true);
    expect(isTextEntry(element('DIV', { isContentEditable: true }))).toBe(true);
  });

  it('treats window and document as no target', () => {
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry({} as EventTarget)).toBe(false);
  });
});

describe('ownsSpace', () => {
  it('leaves Space to play/pause after a mouse click on a button', () => {
    expect(ownsSpace(element('BUTTON'), false)).toBe(false);
  });

  it('keeps keyboard activation for a tabbed-to button or switch', () => {
    expect(ownsSpace(element('BUTTON'), true)).toBe(true);
    expect(ownsSpace(element('INPUT', { type: 'checkbox' }), true)).toBe(true);
  });

  it('never claims Space on a slider, where it does nothing', () => {
    expect(ownsSpace(element('INPUT', { type: 'range' }), true)).toBe(false);
  });

  it('keeps Space for typing, however focus arrived', () => {
    expect(ownsSpace(element('INPUT', { type: 'text' }), false)).toBe(true);
  });
});

describe('isShortcutKey', () => {
  const press = (target: EventTarget, modifiers: object = {}) =>
    ({ target, ctrlKey: false, metaKey: false, altKey: false, ...modifiers }) as KeyboardEvent;

  it('fires from a focused button (the regression this guards)', () => {
    expect(isShortcutKey(press(element('BUTTON')))).toBe(true);
  });

  it('ignores browser chords and typing', () => {
    expect(isShortcutKey(press(element('BUTTON'), { ctrlKey: true }))).toBe(false);
    expect(isShortcutKey(press(element('INPUT', { type: 'text' })))).toBe(false);
  });
});
