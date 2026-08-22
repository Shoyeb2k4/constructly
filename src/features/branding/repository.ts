import type {
  BrandAssetKind,
  BrandAssetUrls,
  BrandColors,
  CompanyBranding,
  CompanyProfileInput,
  PdfBrandingData,
  ProfileInput,
  UserProfile,
} from "./types";

/**
 * Company branding + personal profile contract.
 *
 * This module is the one that never got the repository split every other
 * feature has had since ADR-0016, and the omission was a real defect rather
 * than a tidiness complaint: the hooks called the Prisma-backed server actions
 * directly, so opening Settings in demo mode ran
 * `prisma.company.findUniqueOrThrow` against a company id that does not exist
 * in any database. It threw on every load, and the failure was carried from
 * Phase 3 to Phase 8 because nothing on screen said so.
 *
 * Demo binds to a localStorage implementation; everything else binds to the
 * server actions. Selection happens once, in `data.ts`, and nothing above it
 * changes.
 */
export interface BrandingRepository {
  getCompanyBranding(): Promise<CompanyBranding>;
  updateCompanyProfile(input: CompanyProfileInput): Promise<CompanyBranding>;
  updateBrandColors(colors: BrandColors): Promise<CompanyBranding>;

  getProfile(): Promise<UserProfile>;
  updateProfile(input: ProfileInput): Promise<UserProfile>;

  getBrandingAssetUrls(): Promise<BrandAssetUrls>;
  getProfileAssetUrls(): Promise<{ photo: string | null; signature: string | null }>;
  removeBrandingAsset(kind: BrandAssetKind): Promise<void>;

  /** Company identity as printed on PDFs and written into report exports. */
  getPdfBrandingData(): Promise<PdfBrandingData>;
}
