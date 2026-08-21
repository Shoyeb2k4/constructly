import { describe, it, expect, beforeEach, vi } from "vitest";
import { brandingApi } from "./data";
import { demoBrandingRepository } from "./demo/demo-repository";
import { DEMO_USER } from "@/lib/auth/demo";
import { isDemoMode } from "@/lib/env";

/**
 * The Phase 3 defect, closed.
 *
 * Every branding and profile hook called the Prisma-backed server actions
 * directly, so opening Settings in demo mode ran
 * `prisma.company.findUniqueOrThrow` against a company id that exists in no
 * database. It threw on every load and was carried forward for five phases
 * because nothing on screen said so.
 *
 * The fix is the repository split every other feature has had since ADR-0016.
 * These tests hold three things: demo resolves to the demo repository, demo
 * reads and writes never touch the server module, and a demo edit persists like
 * any other demo store.
 */

const COMPANY_KEY = "constructly.demo.companyBranding.v1";
const PROFILE_KEY = "constructly.demo.userProfile.v1";

beforeEach(() => localStorage.clear());

describe("the demo/server switch", () => {
  it("resolves to the demo repository under demo mode", () => {
    // The test environment has no Supabase configured, which is exactly the
    // condition demo mode is defined by.
    expect(isDemoMode).toBe(true);
    expect(brandingApi).toBe(demoBrandingRepository);
  });

  it("never reaches the Prisma-backed server actions", async () => {
    const server = await import("./server/actions");
    const spies = (
      [
        "getCompanyBranding",
        "getProfile",
        "getBrandingAssetUrls",
        "getProfileAssetUrls",
        "updateCompanyProfile",
        "updateProfile",
        "getPdfBrandingData",
      ] as const
    ).map((name) => vi.spyOn(server, name));

    await brandingApi.getCompanyBranding();
    await brandingApi.getProfile();
    await brandingApi.getBrandingAssetUrls();
    await brandingApi.getProfileAssetUrls();
    await brandingApi.getPdfBrandingData();
    await brandingApi.updateCompanyProfile({ name: "X" });
    await brandingApi.updateProfile({ fullName: "Y" });

    for (const spy of spies) {
      expect(spy, `${spy.getMockName()} was called in demo mode`).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe("a fresh demo session", () => {
  it("loads the company profile without throwing", async () => {
    const c = await brandingApi.getCompanyBranding();
    expect(c.id).toBe(DEMO_USER.company.id);
    expect(c.name).toBe(DEMO_USER.company.name);
    // Real, plausible identity — not an empty shell that looks like a failure.
    expect(c.gstin).toBeTruthy();
    expect(c.city).toBeTruthy();
  });

  it("loads the personal profile without throwing", async () => {
    const p = await brandingApi.getProfile();
    expect(p.id).toBe(DEMO_USER.id);
    expect(p.email).toBe(DEMO_USER.email);
  });

  it("reports no branding assets rather than a broken URL", async () => {
    const urls = await brandingApi.getBrandingAssetUrls();
    expect(Object.values(urls).every((v) => v === null)).toBe(true);
    const profile = await brandingApi.getProfileAssetUrls();
    expect(profile).toEqual({ photo: null, signature: null });
  });

  it("seeds the store on first read, so a reload is stable", async () => {
    expect(localStorage.getItem(COMPANY_KEY)).toBeNull();
    await brandingApi.getCompanyBranding();
    expect(localStorage.getItem(COMPANY_KEY)).not.toBeNull();
    await brandingApi.getProfile();
    expect(localStorage.getItem(PROFILE_KEY)).not.toBeNull();
  });
});

describe("demo mutations persist in demo storage", () => {
  it("saves a company edit and reads it back", async () => {
    await brandingApi.updateCompanyProfile({ name: "Ridgeline Infra", city: "Pune" });
    const again = await brandingApi.getCompanyBranding();
    expect(again.name).toBe("Ridgeline Infra");
    expect(again.city).toBe("Pune");
    // Persisted, not just held in memory.
    expect(JSON.parse(localStorage.getItem(COMPANY_KEY)!).name).toBe("Ridgeline Infra");
  });

  it("leaves untouched fields alone", async () => {
    const before = await brandingApi.getCompanyBranding();
    await brandingApi.updateCompanyProfile({ city: "Nagpur" });
    const after = await brandingApi.getCompanyBranding();
    expect(after.gstin).toBe(before.gstin);
    expect(after.name).toBe(before.name);
  });

  it("saves a profile edit and reads it back", async () => {
    await brandingApi.updateProfile({ fullName: "Priya Nair", designation: "Finance Head" });
    const again = await brandingApi.getProfile();
    expect(again.fullName).toBe("Priya Nair");
    expect(again.designation).toBe("Finance Head");
  });

  it("validates with the SAME schema the server parses with", async () => {
    // Demo must not accept a value production would reject, or the demo becomes
    // a worse guide to the product than no demo at all.
    await expect(brandingApi.updateCompanyProfile({ email: "not-an-email" })).rejects.toThrow();
    await expect(brandingApi.updateCompanyProfile({ name: "" })).rejects.toThrow();

    // …and must not reject what production ACCEPTS either. `website` is plain
    // optional text in `companyProfileSchema`, not a URL, so demo accepts it
    // too. Tightening it here would make demo stricter than the product.
    await expect(
      brandingApi.updateCompanyProfile({ website: "meridianbuild.example" }),
    ).resolves.toBeTruthy();
  });

  it("saves brand colours through the shared normaliser", async () => {
    const c = await brandingApi.updateBrandColors({ primary: "#123456" });
    expect(c.brandColors?.primary).toBe("#123456");
    expect((await brandingApi.getCompanyBranding()).brandColors?.primary).toBe("#123456");
  });
});

describe("exports carry the demo company's own identity", () => {
  it("feeds edited company details into PDF/report branding", async () => {
    await brandingApi.updateCompanyProfile({ name: "Ridgeline Infra", gstin: "27AAAAA0000A1Z5" });
    const pdf = await brandingApi.getPdfBrandingData();
    expect(pdf.company.name).toBe("Ridgeline Infra");
    expect(pdf.company.gstin).toBe("27AAAAA0000A1Z5");
    expect(pdf.preparedBy).toBe(DEMO_USER.fullName);
    // No signed URLs exist in demo; null rather than a link that 404s.
    expect(pdf.logoUrl).toBeNull();
    expect(pdf.stampUrl).toBeNull();
  });
});

describe("uploads fail honestly rather than opaquely", () => {
  it("explains that demo has no storage instead of reaching Prisma", async () => {
    const { uploadBrandingAsset } = await import("./upload");
    const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
    await expect(uploadBrandingAsset("logo", file)).rejects.toThrow(/cloud storage/i);
  });

  it("removal is a no-op, not a fake success", async () => {
    await expect(brandingApi.removeBrandingAsset("logo")).resolves.toBeUndefined();
  });
});
