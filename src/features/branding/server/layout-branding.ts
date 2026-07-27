import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isDemoMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { brandColorsCss, companyDisplayName, normalizeBrandColors } from "../assets";
import { brandingTag } from "../cache-tags";
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
 * Cached per company (revalidated every 5 min, or immediately via brandingTag).
 * Signs with the service-role client so the cache has no request-cookie
 * dependency — the signed URL TTL (1h) safely exceeds the cache window.
 */
function cachedBranding(companyId: string): Promise<LayoutBranding> {
  return unstable_cache(
    async (): Promise<LayoutBranding> => {
      const c = await prisma.company.findUnique({
        where: { id: companyId },
        select: { name: true, brandColors: true, logoPath: true, faviconPath: true },
      });
      if (!c) return CONSTRUCTLY_FALLBACK;
      const admin = createAdminClient();
      const sign = async (bucket: string, path: string | null): Promise<string | null> => {
        if (!path || !admin) return null;
        const { data } = await admin.storage.from(bucket).createSignedUrl(path, 3600);
        return data?.signedUrl ?? null;
      };
      return {
        name: companyDisplayName(c),
        colorsCss: brandColorsCss(normalizeBrandColors(c.brandColors)),
        logoUrl: await sign("company-logos", c.logoPath),
        faviconUrl: await sign("company-favicons", c.faviconPath),
      };
    },
    ["layout-branding", companyId],
    { revalidate: 300, tags: [brandingTag(companyId)] },
  )();
}

/**
 * Branding for the app shell + metadata. Deduped per request (React.cache) and
 * cached across navigations per company. Demo mode and companies without
 * branding fall back to Constructly.
 */
export const getLayoutBranding = cache(async (): Promise<LayoutBranding> => {
  const user = await getCurrentUser();
  if (!user) return CONSTRUCTLY_FALLBACK;
  if (isDemoMode) {
    return { ...CONSTRUCTLY_FALLBACK, name: user.company.name?.trim() || CONSTRUCTLY_NAME };
  }
  return cachedBranding(user.company.id);
});
