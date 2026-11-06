import { describe, expect, it } from 'vitest';
import { cleanSong, type MediaSession, pickSession } from './session';

const session = (id: string, status: string, title = 'A Song'): MediaSession => ({
  id,
  key: `${id}|${title}`,
  title,
  artist: 'An Artist',
  album: '',
  status,
  canToggle: true,
  canNext: true,
  canPrevious: true,
});

describe('pickSession', () => {
  it('picks what’s actually playing over something paused', () => {
    const list = [session('Chrome', 'paused'), session('Spotify', 'playing')];
    expect(pickSession(list, 'Chrome')?.id).toBe('Spotify');
  });

  it('stays on the current one when two apps are playing', () => {
    const list = [session('Chrome', 'playing'), session('Spotify', 'playing')];
    expect(pickSession(list, 'Spotify')?.id).toBe('Spotify');
  });

  it('keeps a song on screen while it’s paused', () => {
    const list = [session('Netflix', 'paused'), session('Spotify', 'paused')];
    expect(pickSession(list, 'Spotify')?.id).toBe('Spotify');
  });

  it('never picks this app, or a session with nothing to show', () => {
    const list = [
      session('app.livingnotes.resonance', 'playing'),
      session('Chrome', 'playing', ''),
    ];
    expect(pickSession(list, null)).toBeNull();
  });

  it('doesn’t guess at something paused that it wasn’t already showing', () => {
    expect(pickSession([session('Spotify', 'paused')], null)).toBeNull();
  });
});

describe('cleanSong', () => {
  it('leaves a music app’s names alone', () => {
    expect(cleanSong({ title: 'The Let Out', artist: 'J. Cole' })).toEqual({
      title: 'The Let Out',
      artist: 'J. Cole',
    });
  });

  it('drops YouTube Music’s Topic label', () => {
    expect(cleanSong({ title: 'As You Are', artist: 'The Weeknd - Topic' })).toEqual({
      title: 'As You Are',
      artist: 'The Weeknd',
    });
  });

  it('reads the song and artist out of a plain YouTube title', () => {
    expect(
      cleanSong({ title: 'Harry Styles - As It Was (Official Video)', artist: 'HarryStylesVEVO' }),
    ).toEqual({ title: 'As It Was', artist: 'Harry Styles' });
  });

  it('keeps a Topic title whole, dash and all', () => {
    expect(cleanSong({ title: 'Song - Live', artist: 'Band - Topic' })).toEqual({
      title: 'Song - Live',
      artist: 'Band',
    });
  });
});
