import { describe, expect, it } from 'vitest';
import { offersWindowsApp } from './desktop';

const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156.0 Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/156.0 Mobile';

describe('offersWindowsApp', () => {
  it('offers the download to Windows browsers', () => {
    expect(offersWindowsApp(WINDOWS, false)).toBe(true);
  });

  it('counts a 32-bit browser on 64-bit Windows', () => {
    expect(
      offersWindowsApp('Mozilla/5.0 (Windows NT 10.0; WOW64; rv:140.0) Firefox/140.0', false),
    ).toBe(true);
  });

  it('skips Windows the app can’t run on', () => {
    expect(offersWindowsApp('Mozilla/5.0 (Windows NT 10.0; rv:140.0) Firefox/140.0', false)).toBe(
      false,
    );
    expect(offersWindowsApp('Mozilla/5.0 (Windows NT 6.1; Win64; x64) Firefox/115.0', false)).toBe(
      false,
    );
  });

  it('leaves everyone else alone', () => {
    expect(offersWindowsApp(MAC, false)).toBe(false);
    expect(offersWindowsApp(ANDROID, false)).toBe(false);
  });

  it('never offers the app to itself', () => {
    expect(offersWindowsApp(WINDOWS, true)).toBe(false);
  });
});
