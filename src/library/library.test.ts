import { beforeEach, describe, expect, it } from 'vitest';
import { addFolderFiles, addLooseFiles, type Track, useLibrary } from './library';

const song = (id: string, title: string, artist: string, guessed = false): Track => ({
  id,
  fileName: `${id}.mp3`,
  title,
  artist,
  guessed,
  album: '',
  year: '',
  genre: '',
  number: 0,
  disc: 0,
  duration: 0,
  cover: undefined,
  open: () => Promise.reject(new Error('not needed')),
});

const untagged = (name: string) => new File(['not really audio'], name);

/** Node's File has no folder path, which a browser's folder input always gives. */
function inFolder(name: string): File {
  const file = untagged(name);
  Object.defineProperty(file, 'webkitRelativePath', { value: `Music/${name}` });
  return file;
}

describe('names read backwards', () => {
  beforeEach(() => {
    const tagged = song('tagged', 'EARFQUAKE', 'Tyler, The Creator');
    useLibrary.setState({
      tracks: [tagged],
      byId: new Map([[tagged.id, tagged]]),
      nowPlaying: null,
    });
  });

  it('corrects a dropped file against what the library knows', async () => {
    const [added] = await addLooseFiles([untagged('SORRY NOT SORRY - Tyler, The Creator.mp3')]);
    const track = useLibrary.getState().byId.get(added?.id ?? '');
    expect(track?.title).toBe('SORRY NOT SORRY');
    expect(track?.artist).toBe('Tyler, The Creator');
  });

  it('corrects the song that’s playing when more of the library arrives', async () => {
    const [playing] = await addLooseFiles([untagged('Her - Royel Otis.mp3')]);
    useLibrary.setState({ nowPlaying: useLibrary.getState().byId.get(playing?.id ?? '') });
    expect(useLibrary.getState().nowPlaying?.title).toBe('Royel Otis');

    // Tags arrive from a later file, and they say which side was the artist.
    const { tracks } = useLibrary.getState();
    const tagged = song('later', 'come on home', 'Royel Otis');
    useLibrary.setState({ tracks: [...tracks, tagged] });
    await addLooseFiles([untagged('Another - Song.mp3')]);

    expect(useLibrary.getState().nowPlaying?.title).toBe('Her');
    expect(useLibrary.getState().nowPlaying?.artist).toBe('Royel Otis');
  });
});

describe('dropping songs during a folder scan', () => {
  it('keeps them when the scan finishes', async () => {
    useLibrary.setState({ tracks: [], byId: new Map(), scan: null });
    // Enough files that the scan is still going when the drop lands.
    const folder = Array.from({ length: 200 }, (_, i) => inFolder(`Artist - Song ${i}.mp3`));
    const scanning = addFolderFiles(folder);
    const [dropped] = await addLooseFiles([untagged('The Weeknd - Shameless.mp3')]);
    expect(useLibrary.getState().scan).not.toBeNull();
    await scanning;
    const titles = useLibrary.getState().tracks.map((track) => track.title);
    expect(titles).toEqual(expect.arrayContaining(['Song 0', 'Shameless']));
    expect(useLibrary.getState().byId.has(dropped?.id ?? '')).toBe(true);
  });
});
