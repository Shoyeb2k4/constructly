import { rpcMethod } from "@/lib/mobile/rpc";
import type { BrandingRepository } from "./repository";

/**
 * Company branding and profile over the mobile RPC transport — the third
 * implementation of `BrandingRepository`, beside `demo/` and the
 * Server-Action-backed one in `data.ts`.
 *
 * Pure transport. Every method forwards to the identically named entry in the
 * mobile RPC allowlist, which invokes the very same server function the web app
 * calls, under the caller's real resolved session. No query logic, no
 * authorization, no formatting — anything resembling business logic here would
 * be a second source of truth, which is exactly what this architecture exists
 * to avoid.
 *
 * Annotated as `BrandingRepository`, so the compiler checks every key and
 * signature against the interface the UI already consumes. Method names match
 * the interface rather than being shortened, so repository, registry and call
 * site share one vocabulary.
 */
export const httpBrandingRepository: BrandingRepository = {
  getCompanyBranding: rpcMethod("branding", "getCompanyBranding"),
  updateCompanyProfile: rpcMethod("branding", "updateCompanyProfile"),
  updateBrandColors: rpcMethod("branding", "updateBrandColors"),
  getProfile: rpcMethod("branding", "getProfile"),
  updateProfile: rpcMethod("branding", "updateProfile"),
  getBrandingAssetUrls: rpcMethod("branding", "getBrandingAssetUrls"),
  getProfileAssetUrls: rpcMethod("branding", "getProfileAssetUrls"),
  removeBrandingAsset: rpcMethod("branding", "removeBrandingAsset"),
  getPdfBrandingData: rpcMethod("branding", "getPdfBrandingData"),
};
