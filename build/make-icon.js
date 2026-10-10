// Erzeugt build/icon.ico (App- und Installer-Icon) aus demselben Pixelbild wie das Tray-Icon.
// Aufruf: node build/make-icon.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { drawIcon } = require('../src/icon');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// drawIcon liefert BGRA, vormultipliziert -> PNG braucht RGBA, nicht vormultipliziert
function png(size) {
  const bgra = drawIcon(size);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // Filter: keiner
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const a = bgra[i + 3];
      const un = (v) => (a ? Math.min(255, Math.round((v * 255) / a)) : 0);
      raw[o] = un(bgra[i + 2]);
      raw[o + 1] = un(bgra[i + 1]);
      raw[o + 2] = un(bgra[i]);
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(png);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // Typ: Icon
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s >= 256 ? 0 : s;
  e[1] = s >= 256 ? 0 : s;
  e.writeUInt16LE(1, 4); // Farbebenen
  e.writeUInt16LE(32, 6); // Bit pro Pixel
  e.writeUInt32LE(images[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return e;
});

const out = path.join(__dirname, 'icon.ico');
fs.writeFileSync(out, Buffer.concat([header, ...dir, ...images]));
fs.writeFileSync(path.join(__dirname, 'icon-256.png'), images[sizes.length - 1]);
// Großes Bild für den Discord-Status (Discord zeigt es im Profil an)
fs.writeFileSync(path.join(__dirname, 'icon-512.png'), png(512));
console.log('geschrieben:', out);
