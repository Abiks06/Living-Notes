/** The bits of an element these checks read, so they can be tested without a DOM. */
interface KeyTarget {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
}

const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'radio',
  'range',
  'reset',
  'submit',
]);
const SPACE_TOGGLED_INPUTS = new Set(['button', 'checkbox', 'radio', 'reset', 'submit']);

/**
 * True only where a key press types something. Single-key shortcuts must keep working
 * when a button or slider has focus, which is the case after almost any mouse click.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  const element = target as KeyTarget | null;
  if (!element?.tagName) return false;
  if (element.isContentEditable) return true;
  if (element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') return true;
  return element.tagName === 'INPUT' && !NON_TEXT_INPUTS.has(element.type ?? 'text');
}

let focusFromKeyboard = false;

/**
 * Remembers how focus last moved. `:focus-visible` can't answer this: browsers flip it on
 * as soon as any key goes down, so by the time Space arrives every button matches it.
 */
export function trackFocusSource(): void {
  window.addEventListener('pointerdown', () => (focusFromKeyboard = false), true);
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Tab' || event.key === 'Escape') focusFromKeyboard = true;
    },
    true,
  );
}

/**
 * True when Space belongs to the focused control rather than to play/pause. A button
 * clicked with the mouse keeps focus, but Space should still play and pause; a button
 * reached with Tab keeps its normal keyboard activation.
 */
export function ownsSpace(target: EventTarget | null, fromKeyboard = focusFromKeyboard): boolean {
  if (isTextEntry(target)) return true;
  const element = target as KeyTarget | null;
  const activates =
    element?.tagName === 'BUTTON' ||
    element?.tagName === 'A' ||
    (element?.tagName === 'INPUT' && SPACE_TOGGLED_INPUTS.has(element.type ?? ''));
  return activates && fromKeyboard;
}

/** Modifier chords belong to the browser and OS, never to our shortcuts. */
export function isShortcutKey(event: KeyboardEvent): boolean {
  return !event.ctrlKey && !event.metaKey && !event.altKey && !isTextEntry(event.target);
}
