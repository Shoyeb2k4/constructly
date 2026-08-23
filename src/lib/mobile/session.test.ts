import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Session storage and token handling.
 *
 * These exist because the failure modes are silent and serious: a token cached
 * past a refresh keeps sending a dead credential, and a token surviving logout
 * is a real security bug. Both are asserted on observable behaviour rather than
 * on internals.
 */

const authMock = {
  getSession: vi.fn(),
  signOut: vi.fn(),
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: authMock })),
}));

vi.mock("@/lib/env", () => ({
  supabaseUrl: "https://projectref.supabase.co",
  supabasePublishableKey: "sb_publishable_test",
}));

/** An in-memory stand-in for the Keychain-backed store. */
function makeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: vi.fn(async (k: string) => map.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void map.set(k, v)),
    removeItem: vi.fn(async (k: string) => void map.delete(k)),
  };
}

async function freshModule() {
  vi.resetModules();
  return import("./session");
}

beforeEach(() => {
  authMock.getSession.mockReset();
  authMock.signOut.mockReset().mockResolvedValue({ error: null });
});

describe("storage configuration", () => {
  it("reports no store until one is installed", async () => {
    const mod = await freshModule();
    expect(mod.hasMobileAuthStorage()).toBe(false);
  });

  it("accepts an injected store", async () => {
    const mod = await freshModule();
    mod.configureMobileAuth({ storage: makeStorage() });
    expect(mod.hasMobileAuthStorage()).toBe(true);
  });

  it("still builds a usable client when no native store exists", async () => {
    // A browser preview (or a device where the bridge failed to inject) has no
    // native storage. That must degrade to an unpersisted/localStorage session
    // rather than throwing during boot and showing nothing at all.
    const mod = await freshModule();
    expect(() => mod.getMobileSupabase()).not.toThrow();
    expect(mod.hasMobileAuthStorage()).toBe(false);
  });

  it("rebuilds the client when the store is replaced, so no client keeps the old one", async () => {
    const mod = await freshModule();
    mod.configureMobileAuth({ storage: makeStorage() });
    const first = mod.getMobileSupabase();
    mod.configureMobileAuth({ storage: makeStorage() });
    expect(mod.getMobileSupabase()).not.toBe(first);
  });
});

describe("access token", () => {
  it("returns the current token", async () => {
    const mod = await freshModule();
    authMock.getSession.mockResolvedValue({ data: { session: { access_token: "token-1" } } });
    expect(await mod.getAccessToken()).toBe("token-1");
  });

  it("returns null when signed out", async () => {
    const mod = await freshModule();
    authMock.getSession.mockResolvedValue({ data: { session: null } });
    expect(await mod.getAccessToken()).toBeNull();
  });

  it("picks up a refreshed token instead of reusing a stale one", async () => {
    const mod = await freshModule();
    authMock.getSession
      .mockResolvedValueOnce({ data: { session: { access_token: "old" } } })
      .mockResolvedValueOnce({ data: { session: { access_token: "rotated" } } });

    expect(await mod.getAccessToken()).toBe("old");
    // supabase-js rotates tokens in the background; a cached copy here would
    // keep sending the dead one.
    expect(await mod.getAccessToken()).toBe("rotated");
  });
});

describe("sign out", () => {
  it("signs out locally and purges persisted auth material", async () => {
    const mod = await freshModule();
    const storage = makeStorage();
    mod.configureMobileAuth({ storage });
    // Whatever the library persisted under the project-ref key must not survive.
    storage.map.set("sb-projectref-auth-token", "refresh-token-material");

    await mod.signOutMobile();

    expect(authMock.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(storage.map.has("sb-projectref-auth-token")).toBe(false);
  });

  it("still purges storage when the remote sign-out call fails", async () => {
    const mod = await freshModule();
    const storage = makeStorage();
    mod.configureMobileAuth({ storage });
    storage.map.set("sb-projectref-auth-token", "refresh-token-material");
    authMock.signOut.mockRejectedValue(new Error("offline"));

    // Being offline must not leave a usable refresh token on the device.
    await expect(mod.signOutMobile()).rejects.toThrow();
    expect(storage.map.has("sb-projectref-auth-token")).toBe(false);
  });

  it("leaves no token available after logout", async () => {
    const mod = await freshModule();
    mod.configureMobileAuth({ storage: makeStorage() });
    authMock.getSession.mockResolvedValue({ data: { session: null } });
    await mod.signOutMobile();
    expect(await mod.getAccessToken()).toBeNull();
  });
});
