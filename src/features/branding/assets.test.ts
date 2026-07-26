import { describe, it, expect } from "vitest";
import {
  assetExtension,
  validateAsset,
  assetPath,
  normalizeBrandColors,
  brandColorsCss,
  effectiveBrandColors,
  companyDisplayName,
} from "./assets";
import { CONSTRUCTLY_BRAND_COLORS } from "./constants";

describe("assetExtension", () => {
  it("maps mimes to extensions, defaulting to png", () => {
    expect(assetExtension("image/png")).toBe("png");
    expect(assetExtension("image/jpeg")).toBe("jpg");
    expect(assetExtension("image/svg+xml")).toBe("svg");
    expect(assetExtension("image/vnd.microsoft.icon")).toBe("ico");
    expect(assetExtension("application/pdf")).toBe("png");
  });
});

describe("validateAsset", () => {
  it("accepts a valid logo", () => {
    expect(validateAsset("logo", { type: "image/png", size: 50_000 })).toBeNull();
  });
  it("rejects an unsupported type", () => {
    expect(validateAsset("logo", { type: "application/pdf", size: 1000 })).toMatch(/unsupported/i);
  });
  it("rejects an oversized file", () => {
    expect(validateAsset("favicon", { type: "image/png", size: 600_000 })).toMatch(/too large/i);
  });
  it("rejects an empty file", () => {
    expect(validateAsset("logo", { type: "image/png", size: 0 })).toMatch(/empty/i);
  });
  it("favicon accepts .ico but logo does not", () => {
    expect(validateAsset("favicon", { type: "image/x-icon", size: 1000 })).toBeNull();
    expect(validateAsset("logo", { type: "image/x-icon", size: 1000 })).toMatch(/unsupported/i);
  });
});

describe("assetPath", () => {
  it("company-level asset is {companyId}/{kind}.{ext}", () => {
    expect(assetPath("logo", "image/png", { companyId: "co1" })).toBe("co1/logo.png");
    expect(assetPath("favicon", "image/svg+xml", { companyId: "co1" })).toBe("co1/favicon.svg");
  });
  it("per-user asset embeds the userId", () => {
    expect(assetPath("signature", "image/png", { companyId: "co1", userId: "u1" })).toBe(
      "co1/u1-signature.png",
    );
  });
  it("throws when a per-user asset lacks a userId", () => {
    expect(() => assetPath("photo", "image/png", { companyId: "co1" })).toThrow();
  });
  it("path always starts with the companyId (RLS isolation)", () => {
    expect(assetPath("stamp", "image/webp", { companyId: "co-xyz" }).startsWith("co-xyz/")).toBe(true);
  });
});

describe("normalizeBrandColors", () => {
  it("keeps valid hex, drops malformed, lowercases", () => {
    expect(
      normalizeBrandColors({ primary: "#AABBCC", accent: "red", danger: "#e02424", junk: "#fff" }),
    ).toEqual({ primary: "#aabbcc", danger: "#e02424" });
  });
  it("handles null/garbage", () => {
    expect(normalizeBrandColors(null)).toEqual({});
    expect(normalizeBrandColors("nope")).toEqual({});
  });
});

describe("brandColorsCss", () => {
  it("emits only set colors", () => {
    expect(brandColorsCss({ primary: "#123456", success: "#0e9f6e" })).toBe(
      "--primary:#123456;--success:#0e9f6e",
    );
  });
  it("empty when nothing set (falls back to defaults)", () => {
    expect(brandColorsCss(null)).toBe("");
    expect(brandColorsCss({})).toBe("");
  });
});

describe("effectiveBrandColors", () => {
  it("fills gaps with Constructly defaults", () => {
    expect(effectiveBrandColors({ primary: "#111111" })).toEqual({
      ...CONSTRUCTLY_BRAND_COLORS,
      primary: "#111111",
    });
  });
});

describe("companyDisplayName", () => {
  it("uses the company name, else Constructly", () => {
    expect(companyDisplayName({ name: "ABC Constructions" })).toBe("ABC Constructions");
    expect(companyDisplayName({ name: "  " })).toBe("Constructly");
    expect(companyDisplayName(null)).toBe("Constructly");
  });
});
