// make-icons.js — Node.js script (no external deps)
// Generates icons/icon16.png, icon48.png, icon128.png
// Usage: node make-icons.js

const zlib = require("zlib");
const fs   = require("fs");
const path = require("path");

// ── CRC32 ─────────────────────────────────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[i] = c;
}
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG chunk helper ──────────────────────────────────────────────────────────
function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf  = Buffer.allocUnsafe(4); lenBuf.writeUInt32BE(data.length);
  const crcBuf  = Buffer.allocUnsafe(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// ── PNG builder ───────────────────────────────────────────────────────────────
function makePNG(w, h, drawFn) {
  // RGBA pixel array
  const px = new Uint8Array(w * h * 4); // transparent start

  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const i = (y * w + x) * 4;
    px[i] = r; px[i+1] = g; px[i+2] = b; px[i+3] = a;
  };

  drawFn(set, w, h);

  // Raw rows: filter byte (0 = None) + RGBA row
  const raw = [];
  for (let y = 0; y < h; y++) {
    raw.push(0);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw.push(px[i], px[i+1], px[i+2], px[i+3]);
    }
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const idat = zlib.deflateSync(Buffer.from(raw), { level: 9 });

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Draw function — orange circle with 3-bar chart ────────────────────────────
function drawIcon(set, w, h) {
  // Accent orange
  const [OR, OG, OB] = [212, 103, 15];
  const cx = w / 2, cy = h / 2;
  const R  = w / 2 - 0.5;

  // Anti-aliased circle background
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx + 0.5, dy = y - cy + 0.5;
      const d  = Math.sqrt(dx*dx + dy*dy);
      if (d < R) {
        const a = d > R - 1.2 ? Math.round(255 * (R - d) / 1.2) : 255;
        set(x, y, OR, OG, OB, a);
      }
    }
  }

  // Three white bars (ascending left → right, like a bar chart)
  const barW  = Math.max(1, Math.round(w * 0.14));
  const gap   = Math.max(1, Math.round(w * 0.07));
  const baseY = Math.round(h * 0.76);
  const maxH  = Math.round(h * 0.46);
  const heights = [Math.round(maxH * 0.45), Math.round(maxH * 0.72), Math.round(maxH * 1.0)];

  const totalW = heights.length * barW + (heights.length - 1) * gap;
  let bx = Math.round((w - totalW) / 2);

  for (const bh of heights) {
    for (let y = baseY - bh; y < baseY; y++) {
      for (let x = bx; x < bx + barW; x++) {
        // Check inside circle with slight inset
        const dx = x - cx + 0.5, dy = y - cy + 0.5;
        if (Math.sqrt(dx*dx + dy*dy) < R - 0.5) set(x, y, 255, 255, 255, 230);
      }
    }
    bx += barW + gap;
  }
}

// ── Generate ──────────────────────────────────────────────────────────────────
const iconsDir = path.join(__dirname, "icons");
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir);

for (const size of [16, 48, 128]) {
  const buf  = makePNG(size, size, drawIcon);
  const dest = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(dest, buf);
  console.log(`✓  icons/icon${size}.png  (${buf.length} bytes)`);
}

console.log("\nDone. Load the extension in chrome://extensions → Load unpacked.");
