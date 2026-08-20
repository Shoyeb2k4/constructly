import { describe, expect, it, vi } from "vitest";
import { installHiddenTabRafFallback, HIDDEN_TAB_RAF_SCRIPT } from "./hidden-tab-raf";

/**
 * Locks the runtime defect that cost Passes 9C–10B: React 19.2 schedules the
 * reveal of a late-completing Suspense boundary through `requestAnimationFrame`
 * (`$RC` → `$RB` → `$RV`), and Chrome does not run animation frames in a hidden
 * tab — so a hard load into an unpainted tab sits on `loading.tsx` forever.
 *
 * These assert the fallback's contract directly rather than through a browser,
 * because the browser cannot be made to reproduce it deterministically.
 */

/** Minimal window stand-in: enough surface for the fallback, nothing more. */
function fakeWindow(visibilityState: "visible" | "hidden") {
  const nativeRequest = vi.fn(() => 7);
  const nativeCancel = vi.fn();
  const timers = new Map<number, () => void>();
  let nextTimer = 1;

  const win = {
    requestAnimationFrame: nativeRequest as unknown as Window["requestAnimationFrame"],
    cancelAnimationFrame: nativeCancel as unknown as Window["cancelAnimationFrame"],
    performance: { now: () => 123 },
    setTimeout: vi.fn((cb: () => void) => {
      const id = nextTimer++;
      timers.set(id, cb);
      return id;
    }),
    clearTimeout: vi.fn((id: number) => {
      timers.delete(id);
    }),
    document: {
      visibilityState,
      documentElement: { dataset: {} as Record<string, string> },
    },
  };

  return { win: win as unknown as Window, nativeRequest, nativeCancel, timers };
}

describe("hidden-tab requestAnimationFrame fallback", () => {
  it("delegates to the real animation frame while the tab is visible", () => {
    const { win, nativeRequest } = fakeWindow("visible");
    installHiddenTabRafFallback(win);

    const cb = vi.fn();
    expect(win.requestAnimationFrame(cb)).toBe(7);
    expect(nativeRequest).toHaveBeenCalledWith(cb);
  });

  it("runs the callback off a timer while the tab is hidden", () => {
    const { win, nativeRequest, timers } = fakeWindow("hidden");
    installHiddenTabRafFallback(win);

    const cb = vi.fn();
    const handle = win.requestAnimationFrame(cb);

    // The native frame — the one Chrome never fires in a hidden tab — is untouched.
    expect(nativeRequest).not.toHaveBeenCalled();
    expect(timers.size).toBe(1);

    timers.forEach((run) => run());
    expect(cb).toHaveBeenCalledWith(123);
    // Handles are offset clear of the animation-frame range so cancel can route.
    expect(handle).toBeGreaterThan(1_000_000_000);
  });

  it("routes cancellation to whichever scheduler issued the handle", () => {
    const { win, nativeCancel } = fakeWindow("hidden");
    installHiddenTabRafFallback(win);

    const timerHandle = win.requestAnimationFrame(vi.fn());
    win.cancelAnimationFrame(timerHandle);
    expect(win.clearTimeout).toHaveBeenCalledWith(timerHandle - 1_000_000_000);
    expect(nativeCancel).not.toHaveBeenCalled();

    win.cancelAnimationFrame(42);
    expect(nativeCancel).toHaveBeenCalledWith(42);
  });

  it("is idempotent, so a re-executed script cannot chain wrappers", () => {
    const { win } = fakeWindow("hidden");
    installHiddenTabRafFallback(win);
    const patched = win.requestAnimationFrame;
    installHiddenTabRafFallback(win);
    expect(win.requestAnimationFrame).toBe(patched);
  });

  it("stamps the diagnostic flag the demo health signal reports", () => {
    const { win } = fakeWindow("hidden");
    installHiddenTabRafFallback(win);
    expect(win.document.documentElement.dataset.constructlyRafShim).toBe("1");
  });

  it("serialises to a self-contained inline script", () => {
    // The script is injected as raw HTML in the root layout, so it may not
    // reference module scope and must not need a closing-tag escape.
    expect(HIDDEN_TAB_RAF_SCRIPT.endsWith("(window);")).toBe(true);
    expect(HIDDEN_TAB_RAF_SCRIPT).not.toContain("</script");
    expect(HIDDEN_TAB_RAF_SCRIPT).not.toMatch(/\bhidden_tab_raf\b/i);
  });
});
