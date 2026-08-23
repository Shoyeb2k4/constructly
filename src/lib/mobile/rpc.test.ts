import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The RPC transport's authorization behaviour.
 *
 * The dangerous bugs here are invisible in normal use: sending a token that has
 * since been rotated, or still sending one after logout. Both are asserted on
 * the headers that actually go out.
 */

const getAccessToken = vi.fn();

vi.mock("./session", () => ({ getAccessToken: () => getAccessToken() }));
vi.mock("./platform", () => ({
  isNativeClient: true,
  mobileApiBase: "https://api.example.test",
}));

const { call, RpcError } = await import("./rpc");

function mockFetch(status: number, body: unknown) {
  // Typed parameters so assertions on the outgoing request stay type-checked.
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    url,
    init,
    json: async () => body,
  }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function headersOf(fetchMock: ReturnType<typeof mockFetch>) {
  const [, init] = fetchMock.mock.calls[0];
  return init.headers as Record<string, string>;
}

beforeEach(() => {
  getAccessToken.mockReset();
});

describe("authorization header", () => {
  it("sends the current access token as a bearer credential", async () => {
    getAccessToken.mockResolvedValue("token-1");
    const fetchMock = mockFetch(200, { data: [] });

    await call("projects", "list", [{}]);

    expect(headersOf(fetchMock).Authorization).toBe("Bearer token-1");
  });

  it("sends the rotated token on a later call, never a cached one", async () => {
    getAccessToken.mockResolvedValueOnce("old").mockResolvedValueOnce("rotated");

    const first = mockFetch(200, { data: [] });
    await call("projects", "list", [{}]);
    expect(headersOf(first).Authorization).toBe("Bearer old");

    const second = mockFetch(200, { data: [] });
    await call("projects", "list", [{}]);
    expect(headersOf(second).Authorization).toBe("Bearer rotated");
  });

  it("sends NO authorization header once signed out", async () => {
    // A stale header after logout would keep a revoked session usable until it
    // expired server-side.
    getAccessToken.mockResolvedValue(null);
    const fetchMock = mockFetch(401, { error: "UNAUTHENTICATED" });

    await expect(call("projects", "list", [{}])).rejects.toBeInstanceOf(RpcError);
    expect(headersOf(fetchMock).Authorization).toBeUndefined();
  });
});

describe("request shape", () => {
  it("posts to the absolute backend origin, not a relative path", async () => {
    // A relative URL would resolve against capacitor://localhost, where no
    // server exists.
    getAccessToken.mockResolvedValue("t");
    const fetchMock = mockFetch(200, { data: null });

    await call("session", "me");

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.test/api/mobile/session/me");
  });

  it("sends args as a JSON body", async () => {
    getAccessToken.mockResolvedValue("t");
    const fetchMock = mockFetch(200, { data: null });

    await call("projects", "get", ["project-1"]);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({ args: ["project-1"] });
  });
});

describe("error mapping", () => {
  it("surfaces the server's domain code and status", async () => {
    getAccessToken.mockResolvedValue("t");
    mockFetch(403, { error: "FORBIDDEN" });

    await expect(call("projects", "getRetention")).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("falls back to INTERNAL when the server returns no code", async () => {
    getAccessToken.mockResolvedValue("t");
    mockFetch(500, {});

    await expect(call("projects", "list", [{}])).rejects.toMatchObject({
      code: "INTERNAL",
      status: 500,
    });
  });

  it("unwraps the data envelope on success", async () => {
    getAccessToken.mockResolvedValue("t");
    mockFetch(200, { data: [{ id: "p1" }] });

    await expect(call("projects", "list", [{}])).resolves.toEqual([{ id: "p1" }]);
  });
});
