import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Enforcement at the mobile RPC boundary.
 *
 * `registry.test.ts` pins WHAT is reachable. This pins WHO reaches it, and on
 * whose behalf the reachable thing then runs — the properties that decide
 * whether a phone can read another company's ledger.
 *
 * The route is the only place in the codebase that injects a session rather
 * than resolving one from cookies, so it is the only place where getting this
 * wrong is possible at all.
 */

const verifyBearerToken = vi.fn();
const resolveSessionUser = vi.fn();
const runWithSession = vi.fn();
const rateLimit = vi.fn();
const lookupRpcMethod = vi.fn();
const reportError = vi.fn();

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("./registry", () => ({ lookupRpcMethod }));
vi.mock("@/lib/supabase/bearer", () => ({
  verifyBearerToken,
  bearerTokenFrom: (header: string | null) =>
    header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() || null : null,
}));
vi.mock("@/lib/auth/current-user", () => ({ resolveSessionUser }));
vi.mock("@/lib/auth/request-context", () => ({ runWithSession }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit }));
vi.mock("@/lib/logger", () => ({ reportError }));
vi.mock("@/lib/env", () => ({ isDemoMode: false }));

const { POST, OPTIONS } = await import("./[feature]/[method]/route");

const OWNER = { id: "user-1", company: { id: "company-A" } };

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://constructly.co.in/api/mobile/projects/list", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ feature: "projects", method: "list" });

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockReturnValue({ ok: true });
  // The default happy path: a registered method that reports the session it ran
  // under, and a runWithSession that actually runs its callback.
  lookupRpcMethod.mockReturnValue(async () => ["project-1"]);
  runWithSession.mockImplementation((_user: unknown, fn: () => unknown) => fn());
});

describe("authentication", () => {
  it("rejects a request with no Authorization header", async () => {
    const res = await POST(request({ args: [] }), { params });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "UNAUTHENTICATED" });
    // Critically: it did NOT fall back to a cookie session.
    expect(resolveSessionUser).not.toHaveBeenCalled();
    expect(runWithSession).not.toHaveBeenCalled();
  });

  it("rejects a token the auth server does not recognise", async () => {
    verifyBearerToken.mockResolvedValue(null);
    const res = await POST(request({ args: [] }, { Authorization: "Bearer forged" }), { params });
    expect(res.status).toBe(401);
    expect(runWithSession).not.toHaveBeenCalled();
  });

  it("verifies the token against the auth server rather than decoding it locally", async () => {
    verifyBearerToken.mockResolvedValue("auth-1");
    resolveSessionUser.mockResolvedValue(OWNER);
    await POST(request({ args: [] }, { Authorization: "Bearer good" }), { params });
    // A locally-decoded JWT is a forgeable claim; a round-trip is not.
    expect(verifyBearerToken).toHaveBeenCalledWith("good");
  });

  it("refuses a verified auth user who has no active workspace", async () => {
    verifyBearerToken.mockResolvedValue("auth-1");
    // Invited-but-unaccepted, deactivated, or never onboarded.
    resolveSessionUser.mockResolvedValue(null);

    const res = await POST(request({ args: [] }, { Authorization: "Bearer good" }), { params });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "NO_WORKSPACE" });
    expect(runWithSession).not.toHaveBeenCalled();
  });
});

describe("tenant scoping", () => {
  it("runs the action under the session resolved from the TOKEN", async () => {
    verifyBearerToken.mockResolvedValue("auth-1");
    resolveSessionUser.mockResolvedValue(OWNER);

    await POST(request({ args: [] }, { Authorization: "Bearer good" }), { params });

    // The company the action sees comes from the verified token, not from
    // anything the caller sent in the body or a header.
    expect(resolveSessionUser).toHaveBeenCalledWith("auth-1");
    expect(runWithSession).toHaveBeenCalledTimes(1);
    expect(runWithSession.mock.calls[0][0]).toBe(OWNER);
  });

  it("gives the body no way to choose the session", async () => {
    verifyBearerToken.mockResolvedValue("auth-1");
    resolveSessionUser.mockResolvedValue(OWNER);

    await POST(
      request(
        { args: [{ companyId: "company-B" }], userId: "user-2", companyId: "company-B" },
        { Authorization: "Bearer good" },
      ),
      { params },
    );

    // Fields smuggled into the payload are inert: the resolved user is still A.
    expect(resolveSessionUser).toHaveBeenCalledWith("auth-1");
    expect(runWithSession.mock.calls[0][0]).toBe(OWNER);
  });

  it("rate-limits per authenticated user, not per token", async () => {
    verifyBearerToken.mockResolvedValue("auth-1");
    resolveSessionUser.mockResolvedValue(OWNER);
    await POST(request({ args: [] }, { Authorization: "Bearer good" }), { params });
    // Refreshing a token must not hand the caller a fresh budget.
    expect(rateLimit.mock.calls[0][0]).toBe("mobile-rpc:auth-1");
  });

  it("stops a rate-limited caller before resolving or running anything", async () => {
    verifyBearerToken.mockResolvedValue("auth-1");
    rateLimit.mockReturnValue({ ok: false });

    const res = await POST(request({ args: [] }, { Authorization: "Bearer good" }), { params });
    expect(res.status).toBe(429);
    expect(runWithSession).not.toHaveBeenCalled();
  });
});

describe("surface", () => {
  it("answers an unregistered method as 404, before authenticating", async () => {
    lookupRpcMethod.mockReturnValue(null);
    const res = await POST(request({ args: [] }, { Authorization: "Bearer good" }), { params });
    expect(res.status).toBe(404);
    // Unregistered names look exactly like unknown routes — the server-action
    // surface cannot be probed for what exists.
    await expect(res.json()).resolves.toEqual({ error: "NOT_FOUND" });
  });

  it("rejects a malformed body", async () => {
    const res = await POST(
      new Request("https://constructly.co.in/api/mobile/projects/list", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer good" },
        body: "not json",
      }),
      { params },
    );
    expect(res.status).toBe(400);
  });

  it("caps how many arguments one call may carry", async () => {
    const res = await POST(
      request({ args: Array.from({ length: 9 }, (_, i) => i) }, { Authorization: "Bearer good" }),
      { params },
    );
    expect(res.status).toBe(400);
  });

  it("does not leak internals when an action throws unexpectedly", async () => {
    verifyBearerToken.mockResolvedValue("auth-1");
    resolveSessionUser.mockResolvedValue(OWNER);
    lookupRpcMethod.mockReturnValue(async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.5:5432 — db-primary.internal");
    });

    const res = await POST(request({ args: [] }, { Authorization: "Bearer good" }), { params });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "INTERNAL" });
    // "INTERNAL" is the deliberate opaque code. What must not appear is the
    // thrown message: the host, the port, and the reason it failed.
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|5432|10\.0\.0\.5|db-primary/i);
    expect(reportError).toHaveBeenCalled();
  });

  it("maps domain errors to their status without inventing a message", async () => {
    verifyBearerToken.mockResolvedValue("auth-1");
    resolveSessionUser.mockResolvedValue(OWNER);
    lookupRpcMethod.mockReturnValue(async () => {
      // What requirePermission() throws.
      throw new Error("FORBIDDEN");
    });

    const res = await POST(request({ args: [] }, { Authorization: "Bearer good" }), { params });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "FORBIDDEN" });
    // A permission failure is not an incident; it must not page anyone.
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe("CORS on the route", () => {
  it("answers a preflight from the Android WebView origin", async () => {
    const res = await OPTIONS(
      new Request("https://constructly.co.in/api/mobile/projects/list", {
        method: "OPTIONS",
        headers: { Origin: "https://localhost" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://localhost");
  });

  it("gives an unknown origin no CORS headers at all", async () => {
    const res = await OPTIONS(
      new Request("https://constructly.co.in/api/mobile/projects/list", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      }),
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("carries CORS headers on a rejection, or the app sees a network error", async () => {
    // Without the header the browser discards the 401 and the app cannot tell
    // "signed out" from "server unreachable".
    const res = await POST(request({ args: [] }, { Origin: "https://localhost" }), { params });
    expect(res.status).toBe(401);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://localhost");
  });
});
