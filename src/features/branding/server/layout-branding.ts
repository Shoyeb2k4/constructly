import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isDemoMode } from "@/lib/env";
import { brandColorsCss, companyDisplayName, normalizeBrandColors } from "../assets";
import { CONSTRUCTLY_NAME } from "../constants";

export interface LayoutBranding {
  name: string;
  /** CSS custom-property overrides (empty ⇒ Constructly defaults). */
  colorsCss: string;
  logoUrl: string | null;
  faviconUrl: string | null;
}

const CONSTRUCTLY_FALLBACK: LayoutBranding = {
  name: CONSTRUCTLY_NAME,
  colorsCss: "",
  logoUrl: null,
  faviconUrl: null,
};

/**
 * Branding for the app shell + metadata, resolved once per request
 * (React.cache dedupes the generateMetadata and layout-body calls). Demo mode
 * and companies without branding fall back to Constructly.
 */
export const getLayoutBranding = cache(async (): Promise<LayoutBranding> => {
  const user = await getCurrentUser();
  if (!user) return CONSTRUCTLY_FALLBACK;

  // Demo mode has no real DB/storage — use the demo company name, no assets.
  if (isDemoMode) {
    return { ...CONSTRUCTLY_FALLBACK, name: user.company.name?.trim() || CONSTRUCTLY_NAME };
  }

  const c = await prisma.company.findUnique({
    where: { id: user.company.id },
    select: {
      name: true,
      brandColors: true,
      logoPath: true,
      faviconPath: true,
    },
  });
  if (!c) return CONSTRUCTLY_FALLBACK;

  const { createServerClient } = await import("@/lib/supabase/server");
  const supabase = await createServerClient();
  const sign = async (bucket: string, path: string | null): Promise<string | null> => {
    if (!path) return null;
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  };

  return {
    name: companyDisplayName(c),
    colorsCss: brandColorsCss(normalizeBrandColors(c.brandColors)),
    logoUrl: await sign("company-logos", c.logoPath),
    faviconUrl: await sign("company-favicons", c.faviconPath),
  };
});
