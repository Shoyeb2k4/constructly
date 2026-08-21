"use client";

import { createClient } from "@/lib/supabase/client";
import { isDemoMode } from "@/lib/env";
import { createBrandingUploadUrl, setBrandingAsset } from "./server/actions";
import { validateAsset } from "./assets";
import { DEMO_UPLOAD_MESSAGE } from "./constants";
import type { BrandAssetKind } from "./types";

/**
 * Upload a branding asset end-to-end: validate → ask the server for a signed
 * upload URL (path is server-derived and company-isolated) → upload the bytes
 * directly to Storage → persist the path. Throws on any failure.
 */
export async function uploadBrandingAsset(kind: BrandAssetKind, file: File): Promise<void> {
  const err = validateAsset(kind, { type: file.type, size: file.size });
  if (err) throw new Error(err);

  // Demo mode has no Supabase Storage to upload into. Saying so plainly is the
  // honest failure; the alternative was a signed-URL request that reached
  // Prisma for a company id no database has, and surfaced as an opaque error.
  if (isDemoMode) throw new Error(DEMO_UPLOAD_MESSAGE);

  const { bucket, path, token } = await createBrandingUploadUrl(kind, file.type, file.size);
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(bucket)
    .uploadToSignedUrl(path, token, file, { upsert: true, contentType: file.type });
  if (error) throw new Error(error.message);

  await setBrandingAsset(kind, path);
}
