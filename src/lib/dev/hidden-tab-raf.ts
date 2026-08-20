/**
 * Hidden-tab `requestAnimationFrame` fallback. DEV/DEMO ONLY.
 *
 * WHY THIS EXISTS
 *
 * React 19.2 does not reveal a late-completing Suspense boundary the moment its
 * content arrives. `$RC` (the inline "complete boundary" instruction React
 * streams into the HTML) marks the boundary `<!--$~-->` — *reveal queued* —
 * pushes it onto the global `$RB` queue and schedules the actual reveal `$RV`
 * through `requestAnimationFrame`. `$RV` in turn schedules the boundary's
 * hydration retry (`_reactRetry`) through `requestAnimationFrame` as well.
 *
 * Chrome does not run animation frames in a tab whose `visibilityState` is
 * `"hidden"`. So on a HARD LOAD into a tab that is not actually being painted —
 * an automation harness, a background tab, a window behind another window — the
 * queued reveal never fires and the route-level `loading.tsx` fallback stays
 * mounted forever. Every layout above it renders; only the page segment sticks.
 *
 * It is not a hang: nothing is pending, the RSC stream has completed and the
 * content is sitting in an offscreen `<div hidden>` waiting to be spliced in.
 * It self-heals the instant the tab is painted, which is exactly what made it
 * look like an intermittent framework bug across three debugging passes.
 *
 * Only the FIRST boundary of a page load is affected: `$RV` sets `$RT`, after
 * which `$RC` schedules through `setTimeout` instead. That is why hard loads
 * broke and client-side navigation did not.
 *
 * THE FIX
 *
 * Route animation frames to a timer while the document is hidden. This is a
 * verification aid, not a product behaviour change — real users look at visible
 * tabs — so it is installed only in demo builds, from the document head, before
 * React's streamed instruction scripts run.
 */

/**
 * Install the fallback on `win`. Self-contained on purpose: it is serialised
 * with `Function.prototype.toString` into an inline `<script>`, so it may not
 * reference anything in module scope. Idempotent.
 */
export function installHiddenTabRafFallback(win: Window): void {
  // Timer handles are offset out of the animation-frame handle range so
  // `cancelAnimationFrame` can tell the two apart without a bookkeeping set.
  const OFFSET = 1000000000;
  const w = win as unknown as Record<string, unknown>;
  if (w.__constructlyRafFallback) return;
  const nativeRequest = win.requestAnimationFrame;
  const nativeCancel = win.cancelAnimationFrame;
  if (typeof nativeRequest !== "function") return;
  w.__constructlyRafFallback = true;

  win.requestAnimationFrame = function (cb: FrameRequestCallback): number {
    if (win.document.visibilityState !== "hidden") return nativeRequest.call(win, cb);
    return (
      win.setTimeout(function () {
        cb(win.performance.now());
      }, 16) + OFFSET
    );
  };

  win.cancelAnimationFrame = function (handle: number): void {
    if (handle > OFFSET) {
      win.clearTimeout(handle - OFFSET);
      return;
    }
    nativeCancel.call(win, handle);
  };

  // Read by the demo health signal, and by anyone reading the DOM to decide
  // whether a stuck skeleton still needs to be blamed on animation frames.
  win.document.documentElement.dataset.constructlyRafShim = "1";
}

/** The same function, serialised for a blocking inline `<script>` in `<head>`. */
export const HIDDEN_TAB_RAF_SCRIPT = `(${installHiddenTabRafFallback.toString()})(window);`;
