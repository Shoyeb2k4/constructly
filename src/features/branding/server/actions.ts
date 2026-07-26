"use server";

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma";
import { requireUser } from "@/lib/auth/current-user";
import type { SessionUser } from "@/lib/auth/types";
import { isDemoMode } from "@/lib/env";
import { createServerClient } from "@/lib/supabase/server";
import { companyProfileSchema, brandColorsSchema, profileSchema, assetKindSchema } from "../schema";
import { ASSET_SPECS } from "../constants";
import { assetPath, validateAsset, normalizeBrandColors } from "../assets";
import type {
  BrandAssetKind,
  BrandAssetUrls,
  BrandColors,
  CompanyBranding,
  CompanyProfileInput,
  PdfBrandingData,
  ProfileInput,
  UserProfile,
} from "../types";

const SIGNED_TTL = 3600; // 1 hour

function assertOwner(u: SessionUser) {
  if (u.role !== "OWNER") throw new Error("FORBIDDEN");
}

const companySelect = {
  id: true,
  name: true,
  legalName: true,
  gstin: true,
  pan: true,
  cin: true,
  addressLine: true,
  city: true,
  state: true,
  country: true,
  pincode: true,
  phone: true,
  email: true,
  website: true,
  logoPath: true,
  squareLogoPath: true,
  darkLogoPath: true,
  lightLogoPath: true,
  faviconPath: true,
  stampPath: true,
  brandColors: true,
} satisfies Prisma.CompanySelect;

type CompanyRow = Prisma.CompanyGetPayload<{ select: typeof companySelect }>;

function toBranding(c: CompanyRow): CompanyBranding {
  return {
    id: c.id,
    name: c.name,
    legalName: c.legalName,
    gstin: c.gstin,
    pan: c.pan,
    cin: c.cin,
    addressLine: c.addressLine,
    city: c.city,
    state: c.state,
    country: c.country,
    pincode: c.pincode,
    phone: c.phone,
    email: c.email,
    website: c.website,
    logoPath: c.logoPath,
    squareLogoPath: c.squareLogoPath,
    darkLogoPath: c.darkLogoPath,
    lightLogoPath: c.lightLogoPath,
    faviconPath: c.faviconPath,
    stampPath: c.stampPath,
    brandColors: c.brandColors ? normalizeBrandColors(c.brandColors) : null,
  };
}

async function logActivity(user: SessionUser, action: string, summary: string) {
  await prisma.activityLog.create({
    data: {
      companyId: user.company.id,
      actorId: user.id,
      action,
      entityType: "company",
      entityId: user.company.id,
      summary,
    },
  });
}

// ── Company profile + colors ──────────────────────────────────────────
export async function getCompanyBranding(): Promise<CompanyBranding> {
  const user = await requireUser();
  const c = await prisma.company.findUniqueOrThrow({
    where: { id: user.company.id },
    select: companySelect,
  });
  return toBranding(c);
}

export async function updateCompanyProfile(input: CompanyProfileInput): Promise<CompanyBranding> {
  const user = await requireUser();
  assertOwner(user);
  const data = companyProfileSchema.parse(input);
  const c = await prisma.company.update({
    where: { id: user.company.id },
    data,
    select: companySelect,
  });
  await logActivity(user, "company.updated", "Updated company details");
  return toBranding(c);
}

export async function updateBrandColors(colors: BrandColors): Promise<CompanyBranding> {
  const user = await requireUser();
  assertOwner(user);
  const clean = normalizeBrandColors(brandColorsSchema.parse(colors));
  const c = await prisma.company.update({
    where: { id: user.company.id },
    data: { brandColors: clean as Prisma.InputJsonValue },
    select: companySelect,
  });
  await logActivity(user, "company.branding", "Updated brand colors");
  return toBranding(c);
}

// ── Personal profile (own user) ───────────────────────────────────────
const profileSelect = {
  id: true,
  fullName: true,
  email: true,
  designation: true,
  phone: true,
  photoPath: true,
  signaturePath: true,
  theme: true,
  language: true,
  timezone: true,
} satisfies Prisma.UserSelect;

type ProfileRow = Prisma.UserGetPayload<{ select: typeof profileSelect }>;
const toProfile = (u: ProfileRow): UserProfile => ({ ...u });

export async function getProfile(): Promise<UserProfile> {
  const user = await requireUser();
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: profileSelect });
  return toProfile(u);
}

export async function updateProfile(input: ProfileInput): Promise<UserProfile> {
  const user = await requireUser();
  const data = profileSchema.parse(input);
  const u = await prisma.user.update({ where: { id: user.id }, data, select: profileSelect });
  return toProfile(u);
}

// ── Storage: signed upload + asset persistence ────────────────────────
function companyAssetData(kind: BrandAssetKind, path: string | null): Prisma.CompanyUpdateInput {
  switch (kind) {
    case "logo": return { logoPath: path };
    case "squareLogo": return { squareLogoPath: path };
    case "darkLogo": return { darkLogoPath: path };
    case "lightLogo": return { lightLogoPath: path };
    case "favicon": return { faviconPath: path };
    case "stamp": return { stampPath: path };
    default: throw new Error(`Not a company asset: ${kind}`);
  }
}

async function currentAssetPath(user: SessionUser, kind: BrandAssetKind): Promise<string | null> {
  if (ASSET_SPECS[kind].perUser) {
    const u = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { signaturePath: true, photoPath: true },
    });
    return kind === "signature" ? u.signaturePath : u.photoPath;
  }
  const c = await prisma.company.findUniqueOrThrow({ where: { id: user.company.id }, select: companySelect });
  const key = companyAssetData(kind, null);
  const col = Object.keys(key)[0] as keyof CompanyRow;
  return (c[col] as string | null) ?? null;
}

/**
 * Server issues a signed upload URL for a company-isolated path. The path is
 * derived from the session (never the client), so the token can't write
 * outside the caller's company folder even though signed uploads bypass RLS.
 */
export async function createBrandingUploadUrl(
  kindRaw: string,
  mime: string,
  size: number,
): Promise<{ bucket: string; path: string; token: string }> {
  const user = await requireUser();
  const kind = assetKindSchema.parse(kindRaw);
  const spec = ASSET_SPECS[kind];
  if (!spec.perUser) assertOwner(user);
  const err = validateAsset(kind, { type: mime, size });
  if (err) throw new Error(err);
  const path = assetPath(kind, mime, { companyId: user.company.id, userId: user.id });
  const supabase = await createServerClient();
  const { data, error } = await supabase.storage.from(spec.bucket).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "Could not create upload URL");
  return { bucket: spec.bucket, path: data.path, token: data.token };
}

/** Persist a freshly-uploaded asset's path, cleaning up any prior object. */
export async function setBrandingAsset(kindRaw: string, path: string): Promise<void> {
  const user = await requireUser();
  const kind = assetKindSchema.parse(kindRaw);
  const spec = ASSET_SPECS[kind];
  if (!spec.perUser) assertOwner(user); // company assets are owner-only (before any DB access)
  if (!path.startsWith(`${user.company.id}/`)) throw new Error("FORBIDDEN");

  const prev = await currentAssetPath(user, kind);
  if (prev && prev !== path) {
    const supabase = await createServerClient();
    await supabase.storage.from(spec.bucket).remove([prev]).catch(() => {});
  }

  if (spec.perUser) {
    await prisma.user.update({
      where: { id: user.id },
      data: kind === "signature" ? { signaturePath: path } : { photoPath: path },
    });
  } else {
    await prisma.company.update({ where: { id: user.company.id }, data: companyAssetData(kind, path) });
  }
  await logActivity(user, "branding.asset", `Updated ${spec.label.toLowerCase()}`);
}

export async function removeBrandingAsset(kindRaw: string): Promise<void> {
  const user = await requireUser();
  const kind = assetKindSchema.parse(kindRaw);
  const spec = ASSET_SPECS[kind];
  if (!spec.perUser) assertOwner(user); // company assets are owner-only (before any DB access)
  const prev = await currentAssetPath(user, kind);
  if (prev) {
    const supabase = await createServerClient();
    await supabase.storage.from(spec.bucket).remove([prev]).catch(() => {});
  }
  if (spec.perUser) {
    await prisma.user.update({
      where: { id: user.id },
      data: kind === "signature" ? { signaturePath: null } : { photoPath: null },
    });
  } else {
    await prisma.company.update({ where: { id: user.company.id }, data: companyAssetData(kind, null) });
  }
  await logActivity(user, "branding.asset.removed", `Removed ${spec.label.toLowerCase()}`);
}

/** Short-lived signed URLs for the company's brand assets (null when unset). */
export async function getBrandingAssetUrls(): Promise<BrandAssetUrls> {
  const user = await requireUser();
  const c = await prisma.company.findUniqueOrThrow({
    where: { id: user.company.id },
    select: {
      logoPath: true,
      squareLogoPath: true,
      darkLogoPath: true,
      lightLogoPath: true,
      faviconPath: true,
      stampPath: true,
    },
  });
  const supabase = await createServerClient();
  const sign = async (bucket: string, path: string | null): Promise<string | null> => {
    if (!path) return null;
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_TTL);
    return data?.signedUrl ?? null;
  };
  return {
    logo: await sign("company-logos", c.logoPath),
    squareLogo: await sign("company-logos", c.squareLogoPath),
    darkLogo: await sign("company-logos", c.darkLogoPath),
    lightLogo: await sign("company-logos", c.lightLogoPath),
    favicon: await sign("company-favicons", c.faviconPath),
    stamp: await sign("company-stamps", c.stampPath),
  };
}

/**
 * Everything a branded PDF needs: company fields, "prepared by" (the current
 * user), and short-lived signed URLs for the logo, company stamp, and the
 * user's signature. Demo mode / unbranded companies fall back to name-only.
 */
export async function getPdfBrandingData(): Promise<PdfBrandingData> {
  const user = await requireUser();
  const preparedBy = user.fullName;
  const empty = {
    legalName: null,
    gstin: null,
    addressLine: null,
    city: null,
    state: null,
    country: null,
    pincode: null,
    phone: null,
    email: null,
    website: null,
  };
  if (isDemoMode) {
    return {
      company: { name: user.company.name, ...empty },
      preparedBy,
      logoUrl: null,
      stampUrl: null,
      signatureUrl: null,
    };
  }
  const [c, u] = await Promise.all([
    prisma.company.findUniqueOrThrow({
      where: { id: user.company.id },
      select: {
        name: true,
        legalName: true,
        gstin: true,
        addressLine: true,
        city: true,
        state: true,
        country: true,
        pincode: true,
        phone: true,
        email: true,
        website: true,
        logoPath: true,
        stampPath: true,
      },
    }),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { signaturePath: true } }),
  ]);
  const supabase = await createServerClient();
  const sign = async (bucket: string, path: string | null): Promise<string | null> => {
    if (!path) return null;
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_TTL);
    return data?.signedUrl ?? null;
  };
  const { logoPath, stampPath, ...companyFields } = c;
  return {
    company: companyFields,
    preparedBy,
    logoUrl: await sign("company-logos", logoPath),
    stampUrl: await sign("company-stamps", stampPath),
    signatureUrl: await sign("company-signatures", u.signaturePath),
  };
}

/** Signed URLs for the current user's personal assets. */
export async function getProfileAssetUrls(): Promise<{ photo: string | null; signature: string | null }> {
  const user = await requireUser();
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { photoPath: true, signaturePath: true },
  });
  const supabase = await createServerClient();
  const sign = async (bucket: string, path: string | null): Promise<string | null> => {
    if (!path) return null;
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_TTL);
    return data?.signedUrl ?? null;
  };
  return {
    photo: await sign("profile-photos", u.photoPath),
    signature: await sign("company-signatures", u.signaturePath),
  };
}
