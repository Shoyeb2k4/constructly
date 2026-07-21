/**
 * Password-reset flow — contract tests.
 *
 * Guards the wiring of the reset flow so a refactor can't silently break it:
 *  - the request page asks Supabase for a recovery link routed through the
 *    existing /auth/callback PKCE exchange,
 *  - the reset page sets the new password via updateUser,
 *  - sign-in exposes the entry point.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const AUTH = path.join(process.cwd(), "src", "app", "(auth)");
const read = (p: string) => readFileSync(path.join(AUTH, p), "utf8");

describe("password reset flow", () => {
  it("request page sends a recovery link via the callback route", () => {
    const src = read("forgot-password/page.tsx");
    expect(src).toMatch(/auth\.resetPasswordForEmail\(/);
    expect(src).toMatch(/\/auth\/callback\?next=\/reset-password/);
  });

  it("reset page sets the new password and guards an expired link", () => {
    const src = read("reset-password/page.tsx");
    expect(src).toMatch(/auth\.updateUser\(\s*\{\s*password/);
    expect(src).toMatch(/getUser\(\)/); // recovery-session check
    expect(src).toMatch(/This link has expired/);
  });

  it("sign-in links to the reset entry point", () => {
    const src = read("sign-in/page.tsx");
    expect(src).toMatch(/href="\/forgot-password"/);
  });
});
