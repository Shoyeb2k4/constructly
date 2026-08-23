import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression cover for the first failure on real hardware.
 *
 * A signed APK launched on a phone and died with "Couldn't reach Constructly /
 * Failed to fetch". The artifact was correct in every respect; the mobile API
 * simply had not been deployed to the backend it pointed at, so the CORS
 * preflight hit a 404 page carrying no `Access-Control-Allow-Origin` and the
 * WebView blocked the request before sending it.
 *
 * `fetch` reports that — and DNS failure, and TLS refusal, and no route to host
 * — as one indistinguishable `TypeError: Failed to fetch`. These tests pin the
 * two properties that stop the next such failure needing an adb session:
 * a request that never became a response is a transport error carrying its URL,
 * and a request that DID get a response is never described as unreachable.
 */

vi.mock("./platform", () => ({
  isNativeClient: true,
  mobileApiBase: "https://constructly.co.in",
}));
vi.mock("./session", () => ({ getAccessToken: async () => "token-abc" }));

const { call, RpcError, RpcTransportError } = await import("./rpc");

const originalFetch = globalThis.fetch;

beforeEach(() => vi.restoreAllMocks());
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("a blocked or failed request", () => {
  it("becomes an RpcTransportError, not an RpcError", async () => {
    // Exactly what a CORS-blocked preflight produces in a WebView.
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const err = await call("session", "me").catch((e) => e);

    expect(err).toBeInstanceOf(RpcTransportError);
    expect(err).not.toBeInstanceOf(RpcError);
    // No status invented for a response that never existed.
    expect((err as { status?: number }).status).toBeUndefined();
  });

  it("carries the URL it could not reach", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const err = (await call("session", "me").catch((e) => e)) as InstanceType<
      typeof RpcTransportError
    >;

    // The single fact that made the hardware failure diagnosable.
    expect(err.url).toBe("https://constructly.co.in/api/mobile/session/me");
    expect(err.message).toContain("https://constructly.co.in/api/mobile/session/me");
    // The bare, useless string must not be what reaches the UI.
    expect(err.message).not.toBe("Failed to fetch");
  });

  it("keeps the original failure as the cause", async () => {
    const underlying = new TypeError("Failed to fetch");
    globalThis.fetch = vi.fn().mockRejectedValue(underlying);

    const err = (await call("projects", "list").catch((e) => e)) as InstanceType<
      typeof RpcTransportError
    >;

    expect(err.cause).toBe(underlying);
    expect(err.url).toBe("https://constructly.co.in/api/mobile/projects/list");
  });
});

describe("a request that did get a response", () => {
  it("is an RpcError with the real status, never a transport error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: "UNAUTHENTICATED" }, 401));

    const err = await call("session", "me").catch((e) => e);

    expect(err).toBeInstanceOf(RpcError);
    expect(err).not.toBeInstanceOf(RpcTransportError);
    expect((err as InstanceType<typeof RpcError>).status).toBe(401);
    expect((err as InstanceType<typeof RpcError>).code).toBe("UNAUTHENTICATED");
  });

  it("distinguishes 403 from a network problem", async () => {
    // The case that must never be reported as "couldn't reach": the server
    // answered, and the answer is actionable.
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: "NO_WORKSPACE" }, 403));

    const err = (await call("session", "me").catch((e) => e)) as InstanceType<typeof RpcError>;

    expect(err).toBeInstanceOf(RpcError);
    expect(err.status).toBe(403);
    expect(err.code).toBe("NO_WORKSPACE");
  });

  it("treats a 404 as an answered request, not an unreachable server", async () => {
    // An undeployed route reached directly (no preflight) answers 404. That is
    // still a response: calling it "unreachable" sends the reader to the
    // network instead of to the deployment.
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("<html>404</html>", { status: 404 }));

    const err = (await call("session", "me").catch((e) => e)) as InstanceType<typeof RpcError>;

    expect(err).toBeInstanceOf(RpcError);
    expect(err.status).toBe(404);
    // Non-JSON body must not crash the client on the way to reporting it.
    expect(err.code).toBe("INTERNAL");
  });

  it("returns data on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ data: ["p-1"] }, 200));
    await expect(call<string[]>("projects", "list")).resolves.toEqual(["p-1"]);
  });

  it("sends the bearer token and JSON body the server expects", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse({ data: null }, 200));
    globalThis.fetch = spy;

    await call("projects", "get", ["p-1"]);

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://constructly.co.in/api/mobile/projects/get");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer token-abc");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ args: ["p-1"] });
  });
});
