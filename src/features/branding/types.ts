/**
 * White-labeling / company branding. All branding lives on the Company record
 * and personal fields on the User record; companies without branding fall back
 * to Constructly defaults (see constants.ts). Uploaded assets are Supabase
 * Storage objects referenced by path ("{companyId}/…").
 */

export type BrandAssetKind =
  | "logo"
  | "squareLogo"
  | "darkLogo"
  | "lightLogo"
  | "favicon"
  | "stamp"
  | "signature"
  | "photo";

export interface BrandColors {
  primary?: string;
  secondary?: string;
  accent?: string;
  success?: string;
  warning?: string;
  danger?: string;
}

/** Company branding + profile, as consumed by the app (nullable = unset). */
export interface CompanyBranding {
  id: string;
  name: string;
  legalName: string | null;
  gstin: string | null;
  pan: string | null;
  cin: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoPath: string | null;
  squareLogoPath: string | null;
  darkLogoPath: string | null;
  lightLogoPath: string | null;
  faviconPath: string | null;
  stampPath: string | null;
  brandColors: BrandColors | null;
}

/** Resolved asset URLs (short-lived signed URLs) for rendering. */
export interface BrandAssetUrls {
  logo: string | null;
  squareLogo: string | null;
  darkLogo: string | null;
  lightLogo: string | null;
  favicon: string | null;
  stamp: string | null;
}

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  designation: string | null;
  phone: string | null;
  photoPath: string | null;
  signaturePath: string | null;
  theme: string | null;
  language: string | null;
  timezone: string | null;
}

export interface CompanyProfileInput {
  name?: string;
  legalName?: string | null;
  gstin?: string | null;
  pan?: string | null;
  cin?: string | null;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
}

export interface ProfileInput {
  fullName?: string;
  designation?: string | null;
  phone?: string | null;
  theme?: string | null;
  language?: string | null;
  timezone?: string | null;
}
