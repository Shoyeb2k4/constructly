import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression guard for tenant isolation in Storage. The policies are enforced
 * by Postgres; this test locks their SHAPE so a future edit can't silently
 * loosen isolation (e.g. drop the per-user uid() check).
 */
const sql = readFileSync(join(process.cwd(), "prisma", "storage-branding.sql"), "utf8");

describe("branding storage RLS", () => {
  it("all five buckets are private", () => {
    for (const b of [
      "company-logos",
      "company-favicons",
      "company-signatures",
      "company-stamps",
      "profile-photos",
    ]) {
      expect(sql).toContain(`'${b}'`);
    }
    // No bucket is created public.
    expect(sql).not.toMatch(/,\s*true\s*,\s*\d+/);
  });

  it("company-shared assets are scoped to the caller's company", () => {
    expect(sql).toMatch(/branding_company_rw/);
    expect(sql).toMatch(/\(storage\.foldername\(name\)\)\[1\]\s*=\s*public\.current_company_id\(\)::text/);
  });

  it("per-user assets are scoped to the caller's company AND their own uid", () => {
    expect(sql).toMatch(/branding_user_rw/);
    // signatures + photos are in the user policy, not the company one.
    const userPolicy = sql.slice(sql.indexOf("branding_user_rw"));
    expect(userPolicy).toMatch(/company-signatures/);
    expect(userPolicy).toMatch(/profile-photos/);
    expect(userPolicy).toMatch(/\(storage\.foldername\(name\)\)\[2\]\s*=\s*auth\.uid\(\)::text/);
  });

  it("signatures and photos are NOT in the company-shared policy", () => {
    const companyPolicy = sql.slice(
      sql.indexOf("branding_company_rw"),
      sql.indexOf("branding_user_rw"),
    );
    expect(companyPolicy).not.toMatch(/company-signatures/);
    expect(companyPolicy).not.toMatch(/profile-photos/);
  });
});
