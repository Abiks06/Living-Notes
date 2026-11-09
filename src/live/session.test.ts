import { describe, expect, it } from 'vitest';
import { cleanSong, type MediaSession, pickSession } from './session';

const session = (id: string, status: string, title = 'A Song'): MediaSession => ({
  id,
  key: `${id}|${title}`,
  title,
  artist: 'An Artist',
  album: '',
  status,
  updated: 0,
  position: 0,
  duration: 0,
  canToggle: true,
  canNext: true,
  canPrevious: true,
});

describe('pickSession', () => {
  it('never picks this app, however it was installed', () => {
    const own = [
      session('app.livingnotes.resonance', 'playing'),
      session('12345Ayomide.Resonance_abc123!Resonance', 'playing'),
    ];
    expect(pickSession(own, null)).toBeNull();
  });

  it('picks what’s actually playing over something paused', () => {
    const list = [session('Chrome', 'paused'), session('Spotify', 'playing')];
    expect(pickSession(list, 'Chrome')?.id).toBe('Spotify');
  });

  it('stays on the current one when two apps are playing', () => {
    const list = [session('Chrome', 'playing'), session('Spotify', 'playing')];
    expect(pickSession(list, 'Spotify')?.id).toBe('Spotify');
  });

  it('picks the song over a film playing in another tab', () => {
    const film = { ...session('Chrome', 'playing', 'An Episode'), duration: 2541 };
    const song = { ...session('Spotify', 'playing'), duration: 214, album: 'An Album' };
    expect(pickSession([film, song], 'Chrome')?.id).toBe('Spotify');
    expect(pickSession([film, song], null)?.id).toBe('Spotify');
  });

  it('still shows a film when it’s the only thing playing', () => {
    const film = { ...session('Chrome', 'playing', 'An Episode'), duration: 2541 };
    expect(pickSession([film, session('Spotify', 'paused')], null)?.id).toBe('Chrome');
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

  it('offers the last one used when nothing is playing, so Play can start it', () => {
    const list = [
      { ...session('Chrome', 'paused'), updated: 100 },
      { ...session('Spotify', 'paused'), updated: 200 },
    ];
    expect(pickSession(list, null)?.id).toBe('Spotify');
  });

  it('isn’t put off by this app being what Windows calls current', () => {
    const list = [session('app.livingnotes.resonance', 'playing'), session('Spotify', 'paused')];
    expect(pickSession(list, null)?.id).toBe('Spotify');
  });

  it('has nothing to offer when nothing else is open', () => {
    expect(pickSession([session('app.livingnotes.resonance', 'playing')], null)).toBeNull();
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
