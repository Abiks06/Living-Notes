const MAGIC = 'fLaC';
const HEADER_BYTES = 4;
const PICTURE = 6;
const LAST_BLOCK = 0x80;

/**
 * Chrome won't open a FLAC with cover art embedded, for playback or for decoding, though it
 * says it can play FLAC. Most purchased and ripped albums have art, so it's taken out here. The
 * audio itself isn't read or touched: the new file just points at the same bytes.
 */
export async function withoutCoverArt(file: File): Promise<File> {
  const bytes = async (from: number, to: number) =>
    new Uint8Array(await file.slice(from, to).arrayBuffer());

  const magic = await bytes(0, HEADER_BYTES);
  if (String.fromCharCode(...magic) !== MAGIC) return file;

  const kept: { header: Uint8Array; body: Blob; type: number }[] = [];
  let hadPicture = false;
  let at = HEADER_BYTES;
  for (;;) {
    const header = await bytes(at, at + HEADER_BYTES);
    if (header.length < HEADER_BYTES) return file;
    const type = (header[0] ?? 0) & ~LAST_BLOCK;
    const length = ((header[1] ?? 0) << 16) | ((header[2] ?? 0) << 8) | (header[3] ?? 0);
    const body = at + HEADER_BYTES;
    if (type === PICTURE) hadPicture = true;
    else kept.push({ header, body: file.slice(body, body + length), type });
    at = body + length;
    if ((header[0] ?? 0) & LAST_BLOCK) break;
  }
  if (!hadPicture || kept.length === 0) return file;

  const parts: BlobPart[] = [magic];
  kept.forEach(({ header, body, type }, i) => {
    const copy = Uint8Array.from(header);
    copy[0] = type | (i === kept.length - 1 ? LAST_BLOCK : 0);
    parts.push(copy, body);
  });
  parts.push(file.slice(at));
  return new File(parts, file.name, { type: file.type || 'audio/flac' });
}
