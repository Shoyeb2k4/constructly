/**
 * Decide whether a simulator screenshot shows a real rendered UI, or a blank
 * screen (the classic Capacitor failure: the native shell launches fine, the
 * WebView never loads, and you get a white or black rectangle).
 *
 * "The app launched" and "the app rendered" are different claims. A process
 * check proves the first; this proves the second. Without it, a broken CSP or a
 * bad asset path would still produce a green build.
 *
 * Approach: `sips` (built into macOS) downsamples the PNG to a small
 * uncompressed BMP, which is trivially parseable with no dependencies — far more
 * robust than hand-decoding PNG, and it avoids adding an image library or OCR.
 * Colours are quantised to 4 bits per channel so that antialiasing and gradients
 * do not inflate the count.
 *
 * Usage: node scripts/analyze-screenshot.mjs <screenshot.png> [label]
 * Exits non-zero if the image reads as blank.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** A real screen has many colours; a blank one has almost none. */
const MIN_DISTINCT_COLORS = 8;
/** ...and is not ~entirely one colour. */
const MAX_DOMINANT_FRACTION = 0.98;

const input = process.argv[2];
const label = process.argv[3] ?? path.basename(input ?? "screenshot");

if (!input || !existsSync(input)) {
  console.error(`x Screenshot not found: ${input}`);
  process.exit(1);
}

const bytes = statSync(input).size;

const work = mkdtempSync(path.join(tmpdir(), "shot-"));
const bmp = path.join(work, "small.bmp");
// -Z caps the longest edge; 96px is plenty to judge colour variety and keeps
// the parse trivial.
execFileSync("sips", ["-s", "format", "bmp", "-Z", "96", input, "--out", bmp], {
  stdio: "pipe",
});

const buf = readFileSync(bmp);
if (buf.readUInt16LE(0) !== 0x4d42) {
  console.error("x sips did not produce a BMP");
  process.exit(1);
}

const dataOffset = buf.readUInt32LE(10);
const width = buf.readInt32LE(18);
const heightRaw = buf.readInt32LE(22);
const height = Math.abs(heightRaw);
const bpp = buf.readUInt16LE(28);

if (bpp !== 24 && bpp !== 32) {
  console.error(`x Unsupported BMP depth ${bpp}bpp — cannot analyse.`);
  process.exit(1);
}

const bytesPerPixel = bpp / 8;
const stride = Math.floor((bpp * width + 31) / 32) * 4;

const counts = new Map();
let total = 0;

for (let y = 0; y < height; y++) {
  const row = dataOffset + y * stride;
  for (let x = 0; x < width; x++) {
    const p = row + x * bytesPerPixel;
    if (p + 2 >= buf.length) continue;
    // BMP stores BGR(A).
    const b = buf[p] >> 4;
    const g = buf[p + 1] >> 4;
    const r = buf[p + 2] >> 4;
    const key = (r << 8) | (g << 4) | b;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total++;
  }
}

const distinct = counts.size;
let dominant = 0;
for (const n of counts.values()) dominant = Math.max(dominant, n);
const dominantFraction = total > 0 ? dominant / total : 1;

console.log(`Screenshot analysis — ${label}`);
console.log(`  file:              ${input} (${(bytes / 1024).toFixed(1)} KB)`);
console.log(`  sampled:           ${width}x${height}`);
console.log(`  distinct colours:  ${distinct} (need >= ${MIN_DISTINCT_COLORS})`);
console.log(
  `  dominant colour:   ${(dominantFraction * 100).toFixed(1)}% (need <= ${MAX_DOMINANT_FRACTION * 100}%)`,
);

const blank = distinct < MIN_DISTINCT_COLORS || dominantFraction > MAX_DOMINANT_FRACTION;
if (blank) {
  console.error(
    `x ${label}: screen reads as BLANK — the WebView probably never rendered.`,
  );
  process.exit(1);
}

console.log(`OK ${label}: screen shows rendered content.`);
