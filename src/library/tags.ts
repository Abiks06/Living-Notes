/** What a file says about itself. Anything it doesn't say is simply absent. */
export interface Tags {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  year?: string;
  genre?: string;
  track?: number;
  disc?: number;
  /** Seconds, where the format states it without reading the audio. */
  duration?: number;
  /** Where the embedded picture sits, so it can be read only when it's shown. */
  cover?: { offset: number; length: number; type: string };
}

/** Reads a byte range. Only the headers are ever read, never the audio. */
type Read = (from: number, to: number) => Promise<Uint8Array>;

const FIRST_READ = 64 * 1024;
/** Enough for any sane comment block, while skipping lyrics novels and embedded images. */
const MAX_TEXT_BLOCK = 512 * 1024;
const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));
const u32be = (b: Uint8Array, i: number) =>
  (((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)) >>> 0;
const u24be = (b: Uint8Array, i: number) =>
  ((b[i] ?? 0) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
const u32le = (b: Uint8Array, i: number) =>
  ((b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16) | ((b[i + 3] ?? 0) << 24)) >>> 0;
const syncsafe = (b: Uint8Array, i: number) =>
  (((b[i] ?? 0) & 127) << 21) |
  (((b[i + 1] ?? 0) & 127) << 14) |
  (((b[i + 2] ?? 0) & 127) << 7) |
  ((b[i + 3] ?? 0) & 127);

const trimmed = (text: string) => text.replace(/\0+$/, '').trim() || undefined;
const firstNumber = (text: string | undefined) => {
  const value = Number.parseInt(text ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

/** Vorbis comments, as FLAC, Ogg and Opus all carry them. */
function readComments(block: Uint8Array, tags: Tags): void {
  let at = 4 + u32le(block, 0);
  const count = u32le(block, at);
  at += 4;
  for (let i = 0; i < count && at + 4 <= block.length; i++) {
    const length = u32le(block, at);
    at += 4;
    const text = utf8.decode(block.subarray(at, Math.min(block.length, at + length)));
    at += length;
    const split = text.indexOf('=');
    if (split < 0) continue;
    const value = trimmed(text.slice(split + 1));
    switch (text.slice(0, split).toUpperCase()) {
      case 'TITLE':
        tags.title ??= value;
        break;
      case 'ARTIST':
        tags.artist ??= value;
        break;
      case 'ALBUM':
        tags.album ??= value;
        break;
      case 'ALBUMARTIST':
      case 'ALBUM ARTIST':
        tags.albumArtist ??= value;
        break;
      case 'DATE':
      case 'YEAR':
        tags.year ??= value?.slice(0, 4);
        break;
      case 'GENRE':
        tags.genre ??= value;
        break;
      case 'TRACKNUMBER':
        tags.track ??= firstNumber(value);
        break;
      case 'DISCNUMBER':
        tags.disc ??= firstNumber(value);
        break;
    }
  }
}

async function readFlac(read: Read, tags: Tags): Promise<void> {
  let at = 4;
  for (;;) {
    const header = await read(at, at + 4);
    if (header.length < 4) return;
    const type = (header[0] ?? 0) & 127;
    const length = u24be(header, 1);
    const body = at + 4;
    if (type === 0) {
      const info = await read(body, body + 18);
      const rate = ((info[10] ?? 0) << 12) | ((info[11] ?? 0) << 4) | ((info[12] ?? 0) >> 4);
      const high = (info[13] ?? 0) & 15;
      const samples = high * 2 ** 32 + u32be(info, 14);
      if (rate > 0 && samples > 0) tags.duration = samples / rate;
    } else if (type === 4 && length <= MAX_TEXT_BLOCK) {
      readComments(await read(body, body + length), tags);
    } else if (type === 6 && !tags.cover) {
      const head = await read(body, body + 4096);
      const mimeLength = u32be(head, 4);
      const mime = ascii(head, 8, 8 + mimeLength);
      const textAt = 8 + mimeLength;
      const dataAt = textAt + 4 + u32be(head, textAt) + 16;
      tags.cover = {
        offset: body + dataAt + 4,
        length: u32be(head, dataAt),
        type: mime || 'image/jpeg',
      };
    }
    if ((header[0] ?? 0) & 128) return;
    at = body + length;
  }
}

function id3Text(bytes: Uint8Array): string | undefined {
  const body = bytes.subarray(1);
  switch (bytes[0]) {
    case 1:
      return trimmed(new TextDecoder('utf-16').decode(body));
    case 2:
      return trimmed(new TextDecoder('utf-16be').decode(body));
    case 3:
      return trimmed(utf8.decode(body));
    default:
      return trimmed(latin1.decode(body));
  }
}

const ID3_FRAMES: Record<string, 'title' | 'artist' | 'album' | 'albumArtist' | 'genre'> = {
  TIT2: 'title',
  TT2: 'title',
  TPE1: 'artist',
  TP1: 'artist',
  TALB: 'album',
  TAL: 'album',
  TPE2: 'albumArtist',
  TP2: 'albumArtist',
  TCON: 'genre',
  TCO: 'genre',
};

const MPEG1_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MPEG_RATES = [44100, 48000, 32000];

/**
 * An MP3's length from its first frame: its stated frame count if it has one, which any
 * variable-bitrate file does, otherwise the file's size at that frame's bitrate.
 */
async function readMpegLength(read: Read, from: number, size: number, tags: Tags): Promise<void> {
  const start = await read(from, from + 4096);
  let at = 0;
  while (at + 4 < start.length && !(start[at] === 0xff && ((start[at + 1] ?? 0) & 0xe0) === 0xe0)) {
    at++;
  }
  const version = ((start[at + 1] ?? 0) >> 3) & 3;
  const mpeg1 = version === 3;
  const kbps = (mpeg1 ? MPEG1_KBPS : MPEG2_KBPS)[((start[at + 2] ?? 0) >> 4) & 15] ?? 0;
  const baseRate = MPEG_RATES[((start[at + 2] ?? 0) >> 2) & 3] ?? 0;
  const rate = mpeg1 ? baseRate : version === 2 ? baseRate / 2 : baseRate / 4;
  if (kbps === 0 || rate === 0) return;
  const mono = (start[at + 3] ?? 0) >> 6 === 3;
  const header = at + 4 + (mpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17);
  const mark = ascii(start, header, header + 4);
  if ((mark === 'Xing' || mark === 'Info') && ((start[header + 7] ?? 0) & 1) === 1) {
    tags.duration = (u32be(start, header + 8) * (mpeg1 ? 1152 : 576)) / rate;
    return;
  }
  tags.duration = ((size - from - at) * 8) / (kbps * 1000);
}

async function readId3(read: Read, head: Uint8Array, tags: Tags): Promise<void> {
  const version = head[3] ?? 3;
  const end = 10 + syncsafe(head, 6);
  const nameLength = version === 2 ? 3 : 4;
  const headerLength = version === 2 ? 6 : 10;
  let at = 10;
  while (at + headerLength < end) {
    const header = await read(at, at + headerLength);
    const name = ascii(header, 0, nameLength);
    if (!/^[A-Z0-9]+$/.test(name)) return;
    const size =
      version === 2 ? u24be(header, 3) : version === 4 ? syncsafe(header, 4) : u32be(header, 4);
    const body = at + headerLength;
    at = body + size;
    if (size <= 0) return;

    const field = ID3_FRAMES[name];
    if (field && size <= MAX_TEXT_BLOCK) {
      tags[field] ??= id3Text(await read(body, body + size));
    } else if ((name === 'TRCK' || name === 'TRK') && size < 64) {
      tags.track ??= firstNumber(id3Text(await read(body, body + size)));
    } else if ((name === 'TPOS' || name === 'TPA') && size < 64) {
      tags.disc ??= firstNumber(id3Text(await read(body, body + size)));
    } else if ((name === 'TDRC' || name === 'TYER' || name === 'TYE') && size < 64) {
      tags.year ??= id3Text(await read(body, body + size))?.slice(0, 4);
    } else if ((name === 'APIC' || name === 'PIC') && !tags.cover) {
      const start = await read(body, body + 512);
      const encoding = start[0] ?? 0;
      let cursor = 1;
      let type = 'image/jpeg';
      if (name === 'APIC') {
        const zero = start.indexOf(0, cursor);
        type = ascii(start, cursor, zero) || type;
        cursor = zero + 1;
      } else {
        type = ascii(start, 1, 4).toLowerCase() === 'png' ? 'image/png' : type;
        cursor = 4;
      }
      cursor++;
      // The description ends in a zero the width of its encoding.
      const wide = encoding === 1 || encoding === 2;
      while (cursor < start.length) {
        const ended = wide ? start[cursor] === 0 && start[cursor + 1] === 0 : start[cursor] === 0;
        cursor += ended ? (wide ? 2 : 1) : wide ? 2 : 1;
        if (ended) break;
      }
      tags.cover = { offset: body + cursor, length: size - cursor, type };
    }
  }
}

const MP4_TEXT: Record<string, 'title' | 'artist' | 'album' | 'albumArtist' | 'genre' | 'year'> = {
  '©nam': 'title',
  '©ART': 'artist',
  '©alb': 'album',
  aART: 'albumArtist',
  '©gen': 'genre',
  '©day': 'year',
};
const atomName = (b: Uint8Array) => latin1.decode(b.subarray(4, 8));

async function readAtoms(
  read: Read,
  from: number,
  to: number,
  visit: (name: string, body: number, end: number) => Promise<void>,
): Promise<void> {
  let at = from;
  while (at + 8 <= to) {
    const header = await read(at, at + 16);
    if (header.length < 8) return;
    let size = u32be(header, 0);
    let body = at + 8;
    if (size === 1) {
      size = u32be(header, 8) * 2 ** 32 + u32be(header, 12);
      body = at + 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < 8) return;
    await visit(atomName(header), body, Math.min(to, at + size));
    at += size;
  }
}

async function readMp4(read: Read, size: number, tags: Tags): Promise<void> {
  await readAtoms(read, 0, size, async (top, body, end) => {
    if (top !== 'moov') return;
    await readAtoms(read, body, end, async (name, inner, innerEnd) => {
      if (name === 'mvhd') {
        const head = await read(inner, inner + 32);
        const wide = head[0] === 1;
        const scale = u32be(head, wide ? 20 : 12);
        const length = wide ? u32be(head, 24) * 2 ** 32 + u32be(head, 28) : u32be(head, 16);
        if (scale > 0) tags.duration = length / scale;
      }
      if (name !== 'udta') return;
      await readAtoms(read, inner, innerEnd, async (meta, metaBody, metaEnd) => {
        if (meta !== 'meta') return;
        // 'meta' has four version bytes before its children.
        await readAtoms(read, metaBody + 4, metaEnd, async (list, listBody, listEnd) => {
          if (list !== 'ilst') return;
          await readAtoms(read, listBody, listEnd, async (key, keyBody, keyEnd) => {
            await readAtoms(read, keyBody, keyEnd, async (data, dataBody, dataEnd) => {
              if (data !== 'data') return;
              const start = dataBody + 8;
              const field = MP4_TEXT[key];
              if (field) {
                const text = trimmed(utf8.decode(await read(start, dataEnd)));
                tags[field] ??= field === 'year' ? text?.slice(0, 4) : text;
              } else if (key === 'trkn' || key === 'disk') {
                const value = await read(start, dataEnd);
                const number = ((value[2] ?? 0) << 8) | (value[3] ?? 0);
                if (number > 0 && key === 'trkn') tags.track ??= number;
                if (number > 0 && key === 'disk') tags.disc ??= number;
              } else if (key === 'covr' && !tags.cover) {
                const kind = (await read(dataBody, dataBody + 4))[3];
                tags.cover = {
                  offset: start,
                  length: dataEnd - start,
                  type: kind === 14 ? 'image/png' : 'image/jpeg',
                };
              }
            });
          });
        });
      });
    });
  });
}

async function readOgg(read: Read, tags: Tags): Promise<void> {
  const head = await read(0, FIRST_READ);
  for (const marker of ['\x03vorbis', 'OpusTags']) {
    const needle = Array.from(marker, (c) => c.charCodeAt(0));
    for (let i = 0; i + needle.length < head.length; i++) {
      if (needle.every((byte, j) => head[i + j] === byte)) {
        readComments(head.subarray(i + needle.length), tags);
        return;
      }
    }
  }
}

/** Reads a file's own description of itself. Never throws: a bad tag just means no tag. */
export async function readTags(file: Blob): Promise<Tags> {
  const read: Read = async (from, to) => new Uint8Array(await file.slice(from, to).arrayBuffer());
  const tags: Tags = {};
  try {
    const head = await read(0, 12);
    const start = ascii(head, 0, 4);
    if (start === 'fLaC') await readFlac(read, tags);
    else if (start.startsWith('ID3')) {
      await readId3(read, head, tags);
      await readMpegLength(read, 10 + syncsafe(head, 6), file.size, tags);
    } else if (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0) {
      await readMpegLength(read, 0, file.size, tags);
    } else if (start === 'OggS') await readOgg(read, tags);
    else if (ascii(head, 4, 8) === 'ftyp') await readMp4(read, file.size, tags);
  } catch {
    // Whatever was read before the damage is still good.
  }
  return tags;
}

const NOISE =
  /\s*[([{](?:flac|mp3|320\s*kbps|hq|hd|4k|lyrics?|lyric video|visuali[sz]er|official[^)\]}]*|audio|music video|video)[)\]}]/gi;
const REMASTER = /\s*[([{][^)\]}]*\bremaster(?:ed)?\b[^)\]}]*[)\]}]|\s*-\s*\d{4} remaster\S*$/gi;

/** A title as it should be shown: no file-sharing noise, and no remaster notes. */
export function cleanTitle(title: string): string {
  return title.replace(NOISE, '').replace(REMASTER, '').replace(/\s+/g, ' ').trim() || title;
}

/** Best guess from a file name, for files with no tags: "03. Artist - Song (FLAC).flac". */
export function nameParts(name: string): { title: string; artist?: string } {
  const bare = cleanTitle(
    name
      .replace(/\.[^.]+$/, '')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ).replace(/^\d{1,3}[.\s-]+/, '');
  const split = bare.split(/\s+-\s+/);
  if (split.length < 2) return { title: bare };
  const first = (split[0] ?? '').trim();
  return { title: split.slice(1).join(' - ').trim(), artist: first };
}
