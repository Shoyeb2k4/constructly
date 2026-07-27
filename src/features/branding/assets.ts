import { ASSET_SPECS, CONSTRUCTLY_BRAND_COLORS, CONSTRUCTLY_NAME } from "./constants";
import type { BrandAssetKind, BrandColors } from "./types";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

export function assetExtension(mime: string): string {
  return EXT_BY_MIME[mime] ?? "png";
}

const kb = (bytes: number) => Math.round(bytes / 1024);

/** Validate a file for an asset kind. Returns an error message, or null if OK. */
export function validateAsset(
  kind: BrandAssetKind,
  file: { type: string; size: number },
): string | null {
  const spec = ASSET_SPECS[kind];
  if (file.size <= 0) return "The file appears to be empty.";
  if (!spec.mimeTypes.includes(file.type)) {
    const exts = [...new Set(spec.mimeTypes.map((m) => assetExtension(m).toUpperCase()))];
    return `${spec.label}: unsupported file type. Use ${exts.join(", ")}.`;
  }
  if (file.size > spec.maxBytes) {
    return `${spec.label} is too large (${kb(file.size)} KB). Maximum ${kb(spec.maxBytes)} KB.`;
  }
  return null;
}

/**
 * Storage object path for an asset — always "{companyId}/…" so RLS isolates by
 * company. Per-user assets embed the userId. A stable name per kind means a
 * re-upload overwrites the previous file (no orphans of the same extension).
 */
export function assetPath(
  kind: BrandAssetKind,
  mime: string,
  ids: { companyId: string; userId?: string },
): string {
  const spec = ASSET_SPECS[kind];
  const ext = assetExtension(mime);
  if (spec.perUser) {
    if (!ids.userId) throw new Error(`Asset "${kind}" requires a userId`);
    // "{companyId}/{userId}/…" so RLS can scope per-user assets to their owner.
    return `${ids.companyId}/${ids.userId}/${kind}.${ext}`;
  }
  return `${ids.companyId}/${kind}.${ext}`;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Keep only valid #rrggbb values; lowercased. Drops anything malformed. */
export function normalizeBrandColors(input: unknown): BrandColors {
  const out: BrandColors = {};
  if (input && typeof input === "object") {
    const rec = input as Record<string, unknown>;
    for (const k of ["primary", "secondary", "accent", "success", "warning", "danger"] as const) {
      const v = rec[k];
      if (typeof v === "string" && HEX.test(v)) out[k] = v.toLowerCase();
    }
  }
  return out;
}

/** Darken a #rrggbb by `amount` (0–1) toward black. */
export function darkenHex(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const f = Math.max(0, Math.min(1, 1 - amount));
  const ch = (h: string) => Math.round(parseInt(h, 16) * f).toString(16).padStart(2, "0");
  return `#${ch(m[1])}${ch(m[2])}${ch(m[3])}`;
}

/**
 * CSS custom-property declarations overriding the theme with a company's
 * colors. Only set keys are emitted, so an empty/partial palette falls back to
 * the Constructly defaults already in globals.css. A custom primary also
 * derives --primary-hover so hover states stay on-brand.
 */
export function brandColorsCss(colors: BrandColors | null | undefined): string {
  const c = normalizeBrandColors(colors ?? {});
  const decls: string[] = [];
  const push = (name: string, value?: string) => {
    if (value) decls.push(`${name}:${value}`);
  };
  push("--primary", c.primary);
  if (c.primary) push("--primary-hover", darkenHex(c.primary, 0.12));
  push("--secondary", c.secondary);
  push("--accent", c.accent);
  push("--success", c.success);
  push("--warning", c.warning);
  push("--danger", c.danger);
  return decls.join(";");
}

/** Full palette with Constructly defaults filled in — for pickers/previews. */
export function effectiveBrandColors(colors: BrandColors | null | undefined): Required<BrandColors> {
  return { ...CONSTRUCTLY_BRAND_COLORS, ...normalizeBrandColors(colors ?? {}) };
}

/** Company display name, falling back to Constructly. */
export function companyDisplayName(company: { name?: string | null } | null | undefined): string {
  return company?.name?.trim() || CONSTRUCTLY_NAME;
}
