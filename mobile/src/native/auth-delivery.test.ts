import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Deep-link delivery on Android has two paths, and only one of them used to be
 * listened to.
 *
 * `appUrlOpen` is emitted by the Capacitor App plugin from `handleOnNewIntent`
 * ONLY — the warm path, where the activity already exists. If Android kills the
 * app while the user is away completing Google sign-in (ordinary on a
 * low-memory device), the redirect LAUNCHES the activity instead: the intent
 * arrives via `onCreate`, `onNewIntent` never runs, and no `appUrlOpen` is ever
 * emitted. The authorization code was dropped in silence — no session, no
 * error, just the sign-in screen again.
 *
 * These tests pin both paths, and pin that a code is never redeemed twice: an
 * authorization code is single-use, so a duplicate delivery would fail and be
 * reported to the user as a broken sign-in even though the first one worked.
 */

const addListener = vi.fn();
const getLaunchUrl = vi.fn();
const exchangeCodeForSession = vi.fn();
const browserClose = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" },
}));
vi.mock("@capacitor/app", () => ({ App: { addListener, getLaunchUrl } }));
vi.mock("@capacitor/browser", () => ({ Browser: { open: vi.fn(), close: browserClose } }));
vi.mock("@/lib/mobile/session", () => ({
  getMobileSupabase: () => ({ auth: { exchangeCodeForSession, verifyOtp: vi.fn() } }),
  signOutMobile: vi.fn(),
}));

const CALLBACK = "in.co.constructly.app://auth/callback?code=abc123";

let emitAppUrlOpen: ((event: { url: string }) => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  emitAppUrlOpen = null;
  browserClose.mockResolvedValue(undefined);
  exchangeCodeForSession.mockResolvedValue({ error: null });
  addListener.mockImplementation((_event: string, cb: (e: { url: string }) => void) => {
    emitAppUrlOpen = cb;
    return Promise.resolve({ remove: vi.fn() });
  });
  getLaunchUrl.mockResolvedValue(null);
});

/** Fresh module per test — the dedupe guard is module-level state. */
async function load() {
  return import("./auth");
}

describe("warm path — activity already running", () => {
  it("handles a callback delivered through appUrlOpen", async () => {
    const { listenForAuthLinks } = await load();
    const onResult = vi.fn();
    await listenForAuthLinks(onResult);

    emitAppUrlOpen!({ url: CALLBACK });
    await vi.waitFor(() => expect(onResult).toHaveBeenCalled());

    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(onResult.mock.calls[0][0]).toEqual({ kind: "oauth-code", code: "abc123" });
  });
});

describe("cold path — app launched BY the redirect", () => {
  it("handles a callback that arrived as the launch intent", async () => {
    // The regression: no appUrlOpen is ever emitted in this case.
    getLaunchUrl.mockResolvedValue({ url: CALLBACK });

    const { listenForAuthLinks } = await load();
    const onResult = vi.fn();
    await listenForAuthLinks(onResult);

    await vi.waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
  });

  it("does not blow up when there is no launch URL", async () => {
    getLaunchUrl.mockResolvedValue(null);
    const { listenForAuthLinks } = await load();
    await expect(listenForAuthLinks(vi.fn())).resolves.toBeTypeOf("function");
  });

  it("survives getLaunchUrl rejecting", async () => {
    // Must never block start-up.
    getLaunchUrl.mockRejectedValue(new Error("not available"));
    const { listenForAuthLinks } = await load();
    await expect(listenForAuthLinks(vi.fn())).resolves.toBeTypeOf("function");
  });
});

describe("an authorization code is redeemed exactly once", () => {
  it("ignores the same URL arriving from both sources", async () => {
    getLaunchUrl.mockResolvedValue({ url: CALLBACK });

    const { listenForAuthLinks } = await load();
    const onResult = vi.fn();
    await listenForAuthLinks(onResult);
    await vi.waitFor(() => expect(exchangeCodeForSession).toHaveBeenCalledTimes(1));

    // Android delivers the same intent again.
    emitAppUrlOpen!({ url: CALLBACK });
    await new Promise((r) => setTimeout(r, 10));

    // Redeeming twice fails server-side and would be shown to the user as a
    // failed sign-in even though the first exchange succeeded.
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });

  it("still handles a genuinely different callback", async () => {
    const { listenForAuthLinks } = await load();
    const onResult = vi.fn();
    await listenForAuthLinks(onResult);

    emitAppUrlOpen!({ url: CALLBACK });
    await vi.waitFor(() => expect(exchangeCodeForSession).toHaveBeenCalledTimes(1));

    emitAppUrlOpen!({ url: "in.co.constructly.app://auth/callback?code=different" });
    await vi.waitFor(() => expect(exchangeCodeForSession).toHaveBeenCalledTimes(2));
    expect(exchangeCodeForSession).toHaveBeenLastCalledWith("different");
  });
});

describe("failure reporting", () => {
  it("reports the provider's reason rather than a generic failure", async () => {
    exchangeCodeForSession.mockResolvedValue({
      error: { message: "PKCE code verifier not found in storage." },
    });

    const { listenForAuthLinks } = await load();
    const onResult = vi.fn();
    await listenForAuthLinks(onResult);

    emitAppUrlOpen!({ url: CALLBACK });
    await vi.waitFor(() => expect(onResult).toHaveBeenCalled());

    // This exact string is what identified the real device failure. It must
    // reach the caller, not be flattened into "sign-in failed".
    expect(onResult.mock.calls[0][0]).toEqual({
      kind: "error",
      reason: "PKCE code verifier not found in storage.",
    });
  });
});
