/**
 * The design system's accessibility contract, enforced against the real
 * stylesheet.
 *
 * A single token — `--foreground-subtle` at #8a909e — was responsible for 149 of
 * the 181 axe violations found across the app, and its dark-mode counterpart
 * failed too without ever being detected, because the browser scans only ran in
 * light mode. Colour is edited by eye far more often than it is measured, so the
 * values are parsed straight out of `globals.css` here: a future edit fails in
 * milliseconds instead of shipping a hundred regressions.
 *
 * WHAT EACH THRESHOLD IS
 *   4.5:1  WCAG 2.2 AA for normal-size text (1.4.3)
 *   3.0:1  AA for non-text UI component boundaries (1.4.11) — this applies to
 *          the border that delimits an input or select, NOT to decorative rules
 *          between table rows, which is why only `border-strong` is held to it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(join(__dirname, "globals.css"), "utf8");

/** Pull one `selector { … }` block's custom properties out of the stylesheet. */
function tokensIn(selector: string): Record<string, string> {
  // Anchored at the start of a line so `.dark` never matches inside a comment.
  const block = new RegExp(`^${selector.replace(".", "\\.")}\\s*\\{([\\s\\S]*?)^\\}`, "m").exec(CSS);
  if (!block) throw new Error(`No ${selector} block in globals.css`);
  const out: Record<string, string> = {};
  for (const [, name, value] of block[1].matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[name] = value.toLowerCase();
  }
  return out;
}

const THEMES = { light: tokensIn(":root"), dark: tokensIn(".dark") } as const;

function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio. Exported so a UI test can reuse it. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const SURFACES = ["background", "surface", "surface-muted"] as const;

/** Tokens rendered as body-size text directly on a page surface. */
const TEXT_TOKENS = [
  "foreground",
  "foreground-muted",
  "foreground-subtle",
  "primary",
  "success",
  "warning",
  "danger",
] as const;

/** Badge/callout tones, each shown on its own `-subtle` fill. */
const TONES = ["success", "warning", "danger", "info"] as const;

describe.each(Object.entries(THEMES))("%s theme", (themeName, T) => {
  const ratio = (a: string, b: string) => contrastRatio(T[a], T[b]);

  it("defines every token the contract covers", () => {
    for (const name of [...TEXT_TOKENS, ...SURFACES, "border", "border-strong", "primary-foreground"]) {
      expect(T[name], `--${name} missing from the ${themeName} block`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it.each(TEXT_TOKENS)("%s reads as text on every surface (AA 4.5:1)", (token) => {
    for (const surface of SURFACES) {
      expect(
        ratio(token, surface),
        `--${token} on --${surface} in ${themeName}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(TONES)("%s-foreground reads on its own subtle fill (AA 4.5:1)", (tone) => {
    expect(ratio(`${tone}-foreground`, `${tone}-subtle`)).toBeGreaterThanOrEqual(4.5);
  });

  it("selected surfaces read (AA 4.5:1)", () => {
    // `bg-primary/10 text-primary` composited to 4.36:1 wherever a nav item,
    // scope chip or segmented control was active. The explicit pair replaces it.
    expect(ratio("primary-emphasis", "primary-subtle")).toBeGreaterThanOrEqual(4.5);
    for (const surface of SURFACES) {
      expect(ratio("primary-emphasis", surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("primary button labels read on the primary fill (AA 4.5:1)", () => {
    // Dark mode cannot satisfy this AND `text-primary` on a dark surface with a
    // single blue, so its label token is dark. Whatever the resolution, the pair
    // must pass — that is what this asserts.
    expect(ratio("primary-foreground", "primary")).toBeGreaterThanOrEqual(4.5);
  });

  it("border-strong delimits form controls (1.4.11, 3:1)", () => {
    for (const surface of SURFACES) {
      expect(
        ratio("border-strong", surface),
        `--border-strong on --${surface} in ${themeName}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("decorative borders are visible without being heavy", () => {
    for (const surface of SURFACES) {
      const r = ratio("border", surface);
      // Perceptible — the old #e9eaee sat at 1.16 and read as no border at all.
      expect(r, `--border on --${surface} is invisible`).toBeGreaterThanOrEqual(1.4);
      // Restrained — a separator competing with body text is a different bug.
      expect(r, `--border on --${surface} is too heavy`).toBeLessThan(3);
    }
  });

  it("keeps the muted → subtle prominence ladder", () => {
    // Raising the floor must not flatten the two tiers into one another.
    expect(ratio("foreground-muted", "surface")).toBeGreaterThan(ratio("foreground-subtle", "surface"));
    expect(ratio("foreground", "surface")).toBeGreaterThan(ratio("foreground-muted", "surface"));
  });

  it("focus rings are discernible against every surface (1.4.11, 3:1)", () => {
    for (const surface of SURFACES) {
      expect(ratio("ring", surface), `--ring on --${surface}`).toBeGreaterThanOrEqual(3);
    }
  });
});
