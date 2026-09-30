// Generates simple placeholder PNG icons (solid blue square with a white "A")
// without any image library. Run: node scripts/make-icons.mjs
// NOTE: public/icons/ now holds the company logo. Running this script replaces
// it with the placeholder, so only use it for a fresh fork of the project.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// Simple 5x7 glyph for "A"
const A = ["01110", "10001", "10001", "11111", "10001", "10001", "10001"];
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const scale = Math.max(1, Math.floor(size / 9));
  const gx = Math.floor((size - 5 * scale) / 2), gy = Math.floor((size - 7 * scale) / 2);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      let r = 46, g = 134, b = 222;
      const cx = Math.floor((x - gx) / scale), cy = Math.floor((y - gy) / scale);
      if (cx >= 0 && cx < 5 && cy >= 0 && cy < 7 && A[cy][cx] === "1") { r = g = b = 255; }
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}
mkdirSync("public/icons", { recursive: true });
for (const s of [16, 48, 128]) writeFileSync(`public/icons/${s}.png`, png(s));
console.log("icons written to public/icons");
