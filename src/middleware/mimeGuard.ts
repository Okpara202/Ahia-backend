// Magic-bytes sniff so we don't trust Multer's field name. Cloudinary will
// usually reject garbage but this gives us a clean 400 + structured error
// before any external call. Keep the set small + easy to extend.

import { ValidationError } from "../errors.js";

type Kind = "image" | "video" | "audio";

const SIGNATURES: Array<{
  kind: Kind;
  bytes: number[];
  // optional: ASCII string that must appear at a fixed offset
  asciiAt?: { offset: number; text: string };
  label: string;
}> = [
  { kind: "image", bytes: [0xff, 0xd8, 0xff], label: "JPEG" },
  { kind: "image", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], label: "PNG" },
  { kind: "image", bytes: [0x47, 0x49, 0x46, 0x38], label: "GIF" }, // GIF87a / GIF89a
  {
    kind: "image",
    bytes: [0x52, 0x49, 0x46, 0x46],
    asciiAt: { offset: 8, text: "WEBP" },
    label: "WebP",
  },
  { kind: "image", bytes: [0x42, 0x4d], label: "BMP" },
  // HEIC/HEIF — magic at offset 4 = "ftypheic" / "ftypheix" / "ftypmif1"
  { kind: "image", bytes: [], asciiAt: { offset: 4, text: "ftyp" }, label: "HEIC/HEIF/MP4 family" },
  { kind: "video", bytes: [0x1a, 0x45, 0xdf, 0xa3], label: "WebM/Matroska" },
  // MP4 container — same ftyp magic as HEIC; treat as video if ftyp matches mp42/avc1/etc
  // Audio: webm/ogg, mp3, wav
  { kind: "audio", bytes: [0x49, 0x44, 0x33], label: "MP3 (ID3)" },
  { kind: "audio", bytes: [0xff, 0xfb], label: "MP3 (frame sync)" },
  { kind: "audio", bytes: [0xff, 0xf3], label: "MP3 (frame sync alt)" },
  { kind: "audio", bytes: [0x4f, 0x67, 0x67, 0x53], label: "OGG (incl. Opus)" },
  { kind: "audio", bytes: [0x52, 0x49, 0x46, 0x46], asciiAt: { offset: 8, text: "WAVE" }, label: "WAV" },
];

function startsWith(buf: Buffer, prefix: number[]): boolean {
  if (prefix.length === 0) return true;
  if (buf.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (buf[i] !== prefix[i]) return false;
  return true;
}

function asciiMatches(buf: Buffer, at: number, text: string): boolean {
  if (buf.length < at + text.length) return false;
  return buf.slice(at, at + text.length).toString("ascii") === text;
}

function sniff(buf: Buffer): Kind | null {
  for (const sig of SIGNATURES) {
    const headOk = startsWith(buf, sig.bytes);
    const asciiOk = sig.asciiAt
      ? asciiMatches(buf, sig.asciiAt.offset, sig.asciiAt.text)
      : true;
    if (headOk && asciiOk) return sig.kind;
  }
  return null;
}

export function assertFileKind(buf: Buffer, expected: Kind, fieldName: string): void {
  const detected = sniff(buf);
  if (detected === null) {
    throw new ValidationError(
      `Unrecognized file format on ${fieldName}. Send a real image / video / audio file.`,
      { [fieldName]: "Unrecognized format" },
    );
  }
  // Treat MP4-family ftyp matches as either image-or-video; accept for either.
  // (HEIC is actually image, MP4 is video — we don't distinguish here; Cloudinary will.)
  if (detected !== expected) {
    throw new ValidationError(
      `Wrong file type on ${fieldName}. Expected ${expected}, got ${detected}.`,
      { [fieldName]: `Expected ${expected}` },
    );
  }
}
