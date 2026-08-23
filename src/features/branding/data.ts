import { isDemoMode } from "@/lib/env";
import { isNativeClient } from "@/lib/mobile/platform";
import { demoBrandingRepository } from "./demo/demo-repository";
import { httpBrandingRepository } from "./http-repository";
import type { BrandingRepository } from "./repository";
import * as server from "./server/actions";

/**
 * The demo/server switch for branding — the piece this feature was missing.
 *
 * It has to happen HERE, on the client, not inside the server actions. A
 * `"use server"` function still executes on the server even in demo mode, where
 * there is no localStorage to read; guarding inside the action could therefore
 * only ever return a hard-coded stub, never the company the demo user just
 * edited. Selecting the repository before the call is what makes demo Settings
 * a real, persistent surface instead of a placeholder.
 */
const serverRepository: BrandingRepository = {
  getCompanyBranding: server.getCompanyBranding,
  updateCompanyProfile: server.updateCompanyProfile,
  updateBrandColors: server.updateBrandColors,
  getProfile: server.getProfile,
  updateProfile: server.updateProfile,
  getBrandingAssetUrls: server.getBrandingAssetUrls,
  getProfileAssetUrls: server.getProfileAssetUrls,
  removeBrandingAsset: server.removeBrandingAsset,
  getPdfBrandingData: server.getPdfBrandingData,
};

/**
 * Transport selection, in priority order:
 *   demo mode  → in-browser fixtures (unchanged)
 *   native app → HTTP RPC to the deployed Next backend (Capacitor; no Server
 *                Actions, because the bundle has no same-origin Next server)
 *   web        → Server Actions (unchanged — this is the production path)
 *
 * `isNativeClient` is a build-time constant, so each bundle keeps exactly one
 * of these branches and tree-shakes the rest: the web bundle never carries the
 * RPC client, and the mobile bundle never carries Prisma.
 */
export const brandingApi: BrandingRepository = isDemoMode
  ? demoBrandingRepository
  : isNativeClient
    ? httpBrandingRepository
    : serverRepository;
