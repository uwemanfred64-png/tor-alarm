// Tray-Icon: eine Mini-Anzeigetafel mit "1:0" in Leuchtpunkten – passend zum Popup.
// Wird direkt in einen Pixelpuffer gezeichnet, die App braucht keine Bilddatei.

// "1", Lücke, ":", Lücke, "0" – 10 x 7 Punkte
// prettier-ignore
const TEXT = [
  '.#.....##.',
  '##....#..#',
  '.#..#.#..#',
  '.#....#..#',
  '.#..#.#..#',
  '.#....#..#',
  '###....##.',
];
const TW = TEXT[0].length;
const TH = TEXT.length;

const BG = [0x15, 0x14, 0x12];
const EDGE = [0x4a, 0x46, 0x3e];
const LIT = [0xff, 0xb5, 0x2e];
const OFF = [0x2e, 0x24, 0x14];

function drawIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const radius = size * 0.16;
  const edge = size >= 48 ? size / 16 : 0; // Rahmen nur bei großen Icons
  const SS = 4;

  // Klein (16/20 px): jeder Leuchtpunkt genau ein Pixel, damit nichts verschwimmt.
  // Groß: runde Punkte auf ganzzahligem Raster.
  const pixelMode = size < 24;
  const cell = pixelMode ? 1 : Math.floor(size / 12);
  const ox = Math.floor((size - TW * cell) / 2);
  const oy = Math.floor((size - TH * cell) / 2);

  const inRoundRect = (x, y, inset) => {
    const r = Math.max(0, radius - inset);
    const lo = inset;
    const hi = size - inset;
    if (x < lo || y < lo || x > hi || y > hi) return false;
    const cx = Math.min(Math.max(x, lo + r), hi - r);
    const cy = Math.min(Math.max(y, lo + r), hi - r);
    return Math.hypot(x - cx, y - cy) <= r;
  };

  const dotAt = (px, py) => {
    const gx = (px - ox) / cell;
    const gy = (py - oy) / cell;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    if (ix < 0 || iy < 0 || ix >= TW || iy >= TH) return null;
    if (!pixelMode && Math.hypot(gx - ix - 0.5, gy - iy - 0.5) >= 0.42) return null;
    return TEXT[iy][ix] === '#' ? LIT : pixelMode ? null : OFF;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      let cover = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (!inRoundRect(px, py, 0)) continue;
          cover++;
          const col = dotAt(px, py) || (edge && !inRoundRect(px, py, edge) ? EDGE : BG);
          acc[0] += col[0];
          acc[1] += col[1];
          acc[2] += col[2];
        }
      }
      if (!cover) continue;
      const alpha = cover / (SS * SS);
      const i = (y * size + x) * 4;
      // BGRA, vormultipliziert
      buf[i] = Math.round((acc[2] / cover) * alpha);
      buf[i + 1] = Math.round((acc[1] / cover) * alpha);
      buf[i + 2] = Math.round((acc[0] / cover) * alpha);
      buf[i + 3] = Math.round(255 * alpha);
    }
  }
  return buf;
}

function trayIcon(nativeImage) {
  const img = nativeImage.createEmpty();
  for (const [size, scale] of [
    [16, 1],
    [20, 1.25],
    [24, 1.5],
    [32, 2],
  ]) {
    const png = nativeImage.createFromBitmap(drawIcon(size), { width: size, height: size }).toPNG();
    img.addRepresentation({ scaleFactor: scale, width: size, height: size, buffer: png });
  }
  return img;
}

module.exports = { trayIcon, drawIcon };
