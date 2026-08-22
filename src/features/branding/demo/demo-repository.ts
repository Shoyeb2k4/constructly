import { DEMO_USER } from "@/lib/auth/demo";
import { normalizeBrandColors } from "../assets";
import { companyProfileSchema, brandColorsSchema, profileSchema } from "../schema";
import type { BrandingRepository } from "../repository";
import type {
  BrandAssetUrls,
  BrandColors,
  CompanyBranding,
  CompanyProfileInput,
  PdfBrandingData,
  ProfileInput,
  UserProfile,
} from "../types";

/**
 * Demo branding + profile, in localStorage.
 *
 * Settings is the one screen where a demo visitor types their OWN company name
 * in, so it has to persist across a reload like every other demo store — a
 * read-only stub would be a different kind of lie from the Prisma error it
 * replaces. Writes stay here and never reach a real database.
 *
 * Assets are deliberately absent: uploads need Supabase Storage and a signed
 * URL, which demo mode has no equivalent for. Every URL getter returns null, so
 * the uploader shows its empty state rather than a broken image.
 */

const K = {
  company: "constructly.demo.companyBranding.v1",
  profile: "constructly.demo.userProfile.v1",
};

const SEED_COMPANY: CompanyBranding = {
  id: DEMO_USER.company.id,
  name: DEMO_USER.company.name,
  legalName: "Meridian Build Company Private Limited",
  gstin: "27AABCM1234F1Z5",
  pan: "AABCM1234F",
  cin: "U45200MH2019PTC123456",
  addressLine: "4th Floor, Rustomjee Central, Bandra Kurla Complex",
  city: "Mumbai",
  state: "Maharashtra",
  country: "India",
  pincode: "400051",
  phone: "+91 22 6789 1234",
  email: "accounts@meridianbuild.example",
  website: "https://meridianbuild.example",
  logoPath: null,
  squareLogoPath: null,
  darkLogoPath: null,
  lightLogoPath: null,
  faviconPath: null,
  stampPath: null,
  brandColors: null,
};

const SEED_PROFILE: UserProfile = {
  id: DEMO_USER.id,
  fullName: DEMO_USER.fullName,
  email: DEMO_USER.email,
  designation: "Managing Director",
  phone: "+91 98200 10101",
  photoPath: null,
  signaturePath: null,
  theme: null,
  language: "en-IN",
  timezone: "Asia/Kolkata",
};

function read<T>(key: string, seed: T): T {
  if (typeof window === "undefined") return structuredClone(seed);
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* corrupt entry — fall through to the seed */
  }
  const fresh = structuredClone(seed);
  write(key, fresh);
  return fresh;
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota — the in-memory value is still returned */
  }
}

const loadCompany = () => read(K.company, SEED_COMPANY);
const loadProfile = () => read(K.profile, SEED_PROFILE);

export const demoBrandingRepository: BrandingRepository = {
  async getCompanyBranding() {
    return loadCompany();
  },

  async updateCompanyProfile(input: CompanyProfileInput) {
    // The SAME schema the server parses with, so demo cannot accept a value
    // production would reject.
    const data = companyProfileSchema.parse(input);
    const next: CompanyBranding = { ...loadCompany(), ...data };
    write(K.company, next);
    return next;
  },

  async updateBrandColors(colors: BrandColors) {
    const clean = normalizeBrandColors(brandColorsSchema.parse(colors));
    const next: CompanyBranding = { ...loadCompany(), brandColors: clean };
    write(K.company, next);
    return next;
  },

  async getProfile() {
    return loadProfile();
  },

  async updateProfile(input: ProfileInput) {
    const data = profileSchema.parse(input);
    const next: UserProfile = { ...loadProfile(), ...data };
    write(K.profile, next);
    return next;
  },

  async getBrandingAssetUrls(): Promise<BrandAssetUrls> {
    // No Storage in demo mode. Null is the honest answer, and the uploader
    // renders its empty state for it.
    return {
      logo: null,
      squareLogo: null,
      darkLogo: null,
      lightLogo: null,
      favicon: null,
      stamp: null,
    };
  },

  async getProfileAssetUrls() {
    return { photo: null, signature: null };
  },

  async removeBrandingAsset() {
    // Nothing is ever stored, so removal is a no-op rather than a fake success
    // that claims to have deleted something.
  },

  async getPdfBrandingData(): Promise<PdfBrandingData> {
    // Reads the demo company the user has actually edited, so a PDF or report
    // export in demo carries the same identity Settings shows.
    const c = loadCompany();
    const p = loadProfile();
    return {
      company: {
        name: c.name,
        legalName: c.legalName,
        gstin: c.gstin,
        addressLine: c.addressLine,
        city: c.city,
        state: c.state,
        country: c.country,
        pincode: c.pincode,
        phone: c.phone,
        email: c.email,
        website: c.website,
      },
      preparedBy: p.fullName,
      logoUrl: null,
      stampUrl: null,
      signatureUrl: null,
    };
  },
};
