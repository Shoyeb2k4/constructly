/**
 * Generate the iOS app icon and splash images from Constructly's brand mark.
 *
 * The Capacitor template ships its own placeholder logo, which would be the
 * first thing a tester sees on their home screen. This renders the real
 * Constructly mark — the same building glyph and primary blue used in
 * `src/components/shell/logo.tsx` — so the source of truth is the brand, not a
 * hand-exported file nobody can regenerate.
 *
 * Two iOS constraints drive the output:
 *   - App icons must be FULLY OPAQUE. An alpha channel is an App Store
 *     rejection, so everything is flattened onto a solid background.
 *   - iOS applies its own rounded-rect mask, so the source must be a plain
 *     square with no rounding of its own.
 *
 * Run: npm run assets:generate
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ICON_SET = path.join(ROOT, "ios/App/App/Assets.xcassets/AppIcon.appiconset");
const SPLASH_SET = path.join(ROOT, "ios/App/App/Assets.xcassets/Splash.imageset");

/** Brand tokens, mirroring src/app/globals.css. */
const PRIMARY = "#2e5bff";
const LIGHT_BG = "#fbfbfd";
const DARK_BG = "#0b0c0f";

/**
 * The Constructly mark: a building outline with a doorway, from logo.tsx.
 * `scale` is the fraction of the canvas the glyph should occupy.
 */
function markSvg({ size, background, stroke, scale }) {
  const glyph = size * scale;
  const offset = (size - glyph) / 2;
  // Stroke width is expressed in the 24-unit viewBox, so it scales with the glyph.
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${background}"/>
  <g transform="translate(${offset} ${offset}) scale(${glyph / 24})">
    <path d="M4 20V7l8-4 8 4v13" fill="none" stroke="${stroke}" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M9 20v-6h6v6" fill="none" stroke="${stroke}" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`);
}

async function write(svg, size, background, file) {
  await sharp(svg)
    .resize(size, size)
    // flatten() removes the alpha channel; `.png({ palette: false })` keeps it
    // a straightforward 8-bit RGB PNG that Xcode's actool is happy with.
    .flatten({ background })
    .png()
    .toFile(file);
  console.log(`  ${path.relative(ROOT, file)}  (${size}x${size})`);
}

mkdirSync(ICON_SET, { recursive: true });
mkdirSync(SPLASH_SET, { recursive: true });

console.log("App icon (opaque, no rounding — iOS masks it):");
// 0.54 leaves the visual margin iOS icons conventionally have once masked.
await write(
  markSvg({ size: 1024, background: PRIMARY, stroke: "#ffffff", scale: 0.54 }),
  1024,
  PRIMARY,
  path.join(ICON_SET, "AppIcon-512@2x.png"),
);

console.log("Splash (centre-cropped by Capacitor, so the mark stays small):");
for (const [file, background] of [
  ["splash-2732x2732.png", LIGHT_BG],
  ["splash-2732x2732-1.png", LIGHT_BG],
  // Capacitor uses the third entry for the dark appearance.
  ["splash-2732x2732-2.png", DARK_BG],
]) {
  await write(
    markSvg({ size: 2732, background, stroke: PRIMARY, scale: 0.12 }),
    2732,
    background,
    path.join(SPLASH_SET, file),
  );
}

console.log("\nDone. Run `npx cap sync ios` to copy them into the app.");
