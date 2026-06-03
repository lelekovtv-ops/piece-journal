// Generates the app icons (PNG) for the PWA / iOS home-screen without any
// image dependency — draws a clean "ruled notebook" mark pixel by pixel and
// encodes PNG with Node's built-in zlib. Run: node tools/generate-icons.mjs
import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
mkdirSync(OUT, { recursive: true });

const CRC = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(S, rgba) {
  const stride = S * 4 + 1;
  const raw = Buffer.alloc(stride * S);
  for (let y = 0; y < S; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * S * 4, (y + 1) * S * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0);
  ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function draw(S) {
  const buf = Buffer.alloc(S * S * 4);
  const px = (x, y, [r, g, b, a = 255]) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    const ia = a / 255, ib = 1 - ia;
    buf[i] = r * ia + buf[i] * ib;
    buf[i + 1] = g * ia + buf[i + 1] * ib;
    buf[i + 2] = b * ia + buf[i + 2] * ib;
    buf[i + 3] = Math.max(buf[i + 3], a);
  };
  const rect = (x0, y0, x1, y1, col) => {
    for (let y = Math.floor(y0); y < y1; y++)
      for (let x = Math.floor(x0); x < x1; x++) px(x, y, col);
  };
  const disc = (cx, cy, r, col) => {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) px(x, y, col);
  };
  const seg = (x0, y0, x1, y1, w, col) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let t = 0; t <= n; t++) disc(x0 + (x1 - x0) * t / n, y0 + (y1 - y0) * t / n, w / 2, col);
  };
  const wave = (x0, x1, y, amp, k, w, col) => {
    const n = Math.ceil(x1 - x0);
    let px0 = x0, py0 = y;
    for (let i = 1; i <= n; i++) {
      const x = x0 + i;
      const py = y + Math.sin((i / (x1 - x0)) * Math.PI * k) * amp;
      seg(px0, py0, x, py, w, col);
      px0 = x; py0 = py;
    }
  };
  const f = (v) => v * S;

  const CREAM = [247, 241, 223, 255];
  const KRAFT = [219, 197, 158, 255];
  const RED = [196, 73, 64, 235];
  const RULE = [46, 64, 110, 70];
  const INK = [41, 74, 114, 255];
  const SPIRAL = [120, 104, 74, 255];

  rect(0, 0, S, S, CREAM);
  rect(0, 0, S, f(0.2), KRAFT);              // top binding band
  for (let i = 0; i < 6; i++) {              // spiral dots
    disc(f(0.16 + i * 0.136), f(0.1), f(0.026), SPIRAL);
  }
  rect(f(0.205), f(0.22), f(0.205) + Math.max(2, f(0.012)), f(0.95), RED); // margin
  for (const y of [0.42, 0.57, 0.72, 0.86]) {                              // ruled lines
    rect(f(0.12), f(y), f(0.9), f(y) + Math.max(1, f(0.008)), RULE);
  }
  wave(f(0.27), f(0.74), f(0.41), f(0.018), 5, Math.max(3, f(0.02)), INK);  // handwriting
  seg(f(0.30), f(0.52), f(0.66), f(0.52), Math.max(3, f(0.022)), RED);      // marker underline

  return buf;
}

for (const size of [512, 192, 180]) {
  const png = encodePng(size, draw(size));
  writeFileSync(join(OUT, `icon-${size}.png`), png);
  console.log(`icon-${size}.png  ${png.length} bytes`);
}
