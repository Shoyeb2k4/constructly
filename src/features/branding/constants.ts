import type { BrandAssetKind, BrandColors } from "./types";

/** Product default when a company has no branding of its own. */
export const CONSTRUCTLY_NAME = "Constructly";

/** Constructly default palette (mirrors globals.css light theme). */
export const CONSTRUCTLY_BRAND_COLORS: Required<BrandColors> = {
  primary: "#2e5bff",
  secondary: "#64748b",
  accent: "#0ea5e9",
  success: "#0e9f6e",
  warning: "#d98a00",
  danger: "#e02424",
};

const IMG = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
const FAV = ["image/png", "image/svg+xml", "image/webp", "image/x-icon", "image/vnd.microsoft.icon"];
const PHOTO = ["image/png", "image/jpeg", "image/webp"];

export interface AssetSpec {
  bucket: string;
  maxBytes: number;
  mimeTypes: string[];
  /** Per-user assets (signature, photo) include the userId in their path. */
  perUser: boolean;
  label: string;
}

export const ASSET_SPECS: Record<BrandAssetKind, AssetSpec> = {
  logo: { bucket: "company-logos", maxBytes: 2_097_152, mimeTypes: IMG, perUser: false, label: "Logo" },
  squareLogo: { bucket: "company-logos", maxBytes: 2_097_152, mimeTypes: IMG, perUser: false, label: "Square logo" },
  darkLogo: { bucket: "company-logos", maxBytes: 2_097_152, mimeTypes: IMG, perUser: false, label: "Dark logo" },
  lightLogo: { bucket: "company-logos", maxBytes: 2_097_152, mimeTypes: IMG, perUser: false, label: "Light logo" },
  favicon: { bucket: "company-favicons", maxBytes: 524_288, mimeTypes: FAV, perUser: false, label: "Favicon" },
  stamp: { bucket: "company-stamps", maxBytes: 1_048_576, mimeTypes: IMG, perUser: false, label: "Company stamp" },
  signature: { bucket: "company-signatures", maxBytes: 1_048_576, mimeTypes: IMG, perUser: true, label: "Signature" },
  photo: { bucket: "profile-photos", maxBytes: 1_048_576, mimeTypes: PHOTO, perUser: true, label: "Profile photo" },
};

/** The DB column on `Company` that stores each company-level asset's path. */
export const ASSET_PATH_COLUMN: Partial<Record<BrandAssetKind, string>> = {
  logo: "logoPath",
  squareLogo: "squareLogoPath",
  darkLogo: "darkLogoPath",
  lightLogo: "lightLogoPath",
  favicon: "faviconPath",
  stamp: "stampPath",
};

/**
 * Extension point for future per-company branded transactional emails
 * (§11). Auth emails currently use Supabase's shared templates; when a
 * provider (e.g. Resend) is added, branded email will read the same
 * CompanyBranding record — no schema change required.
 */
export const EMAIL_BRANDING_ENABLED = false;
