import type { Page } from "@playwright/test";

/**
 * Layout assertions shared by every redesign spec.
 *
 * Five specs had grown their own copy of this, and the copies had already begun
 * to drift. More importantly, the naive version reports collisions that no user
 * can see, and a check that cries wolf gets muted:
 *
 *   CLIPPING — `truncate` puts `overflow: hidden` on the PARENT, but an inline
 *   child still reports its full unclipped width from `getClientRects()`. A
 *   truncated vendor name therefore "overlaps" the badge beside it while the
 *   browser is visibly clipping it. Rects are intersected with every clipping
 *   ancestor before comparison.
 *
 *   NESTING — an element always overlaps its own ancestors. Only unrelated
 *   elements can genuinely collide.
 *
 *   TIGHT LEADING — `leading-none` makes a line box shorter than its glyphs, so
 *   two stacked labels overlap by a pixel or two without any ink touching. The
 *   vertical threshold is set above that noise floor.
 */

/** Minimum overlap, in px, before two fragments count as colliding. */
const X_THRESHOLD = 4;
const Y_THRESHOLD = 6;

export async function textCollisions(page: Page, root = "main"): Promise<string[]> {
  return page.evaluate(
    ({ rootSel, xMin, yMin }) => {
      const scope = document.querySelector(rootSel) ?? document.body;

      // Sticky/fixed chrome passing over scrolled content is correct behaviour.
      const sticky = [...document.querySelectorAll('header,[class*="sticky"],[class*="fixed"]')];

      /** The visible rect after every clipping ancestor has had its say. */
      function clipped(el: Element, rect: DOMRect): DOMRect | null {
        let left = rect.left;
        let right = rect.right;
        let top = rect.top;
        let bottom = rect.bottom;

        for (let p = el.parentElement; p; p = p.parentElement) {
          const style = getComputedStyle(p);
          const clips =
            style.overflow !== "visible" ||
            style.overflowX !== "visible" ||
            style.overflowY !== "visible";
          if (!clips) continue;
          const b = p.getBoundingClientRect();
          left = Math.max(left, b.left);
          right = Math.min(right, b.right);
          top = Math.max(top, b.top);
          bottom = Math.min(bottom, b.bottom);
          if (right <= left || bottom <= top) return null;
        }
        return new DOMRect(left, top, right - left, bottom - top);
      }

      const leaves = [...scope.querySelectorAll("*")].filter(
        (el) =>
          el.children.length === 0 &&
          (el.textContent ?? "").trim() &&
          !sticky.some((s) => s.contains(el)),
      );

      const boxes = leaves.flatMap((el) => {
        const text = (el.textContent ?? "").trim().slice(0, 30);
        return [...el.getClientRects()]
          .map((r) => clipped(el, r as DOMRect))
          .filter((r): r is DOMRect => r !== null && r.width > 0 && r.height > 0)
          .map((r) => ({ text, r, el }));
      });

      const hits: string[] = [];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const A = boxes[i];
          const B = boxes[j];
          if (A.el === B.el) continue;
          if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
          const ox = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
          const oy = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
          if (ox > xMin && oy > yMin) hits.push(`"${A.text}" ⨯ "${B.text}"`);
        }
      }
      return [...new Set(hits)];
    },
    { rootSel: root, xMin: X_THRESHOLD, yMin: Y_THRESHOLD },
  );
}

/** True when the PAGE itself scrolls sideways — contained scrollers are fine. */
export async function hasPageOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

/** Text visibly cut off by its own box, ignoring deliberate `truncate`. */
export async function clippedText(page: Page, root = "main"): Promise<string[]> {
  return page.evaluate((rootSel) => {
    const scope = document.querySelector(rootSel) ?? document.body;
    return [...scope.querySelectorAll("p, span, a, td")]
      .filter(
        (el) =>
          el.children.length === 0 &&
          el.scrollWidth > el.clientWidth + 1 &&
          el.clientWidth > 0 &&
          !el.className.toString().includes("truncate") &&
          !el.className.toString().includes("sr-only"),
      )
      .map((el) => `${(el.textContent ?? "").trim()} (${el.clientWidth}/${el.scrollWidth}px)`);
  }, root);
}

/** Elements laid out wider than the viewport itself. */
export async function tooWideForViewport(page: Page, root = "main"): Promise<string[]> {
  return page.evaluate((rootSel) => {
    const scope = document.querySelector(rootSel) ?? document.body;
    const viewport = document.documentElement.clientWidth;
    return [...scope.querySelectorAll("*")]
      .filter((el) => el.getBoundingClientRect().width > viewport + 1)
      .map(
        (el) =>
          `${Math.round(el.getBoundingClientRect().width)}px: ${(el.textContent ?? "").trim().slice(0, 40)}`,
      );
  }, root);
}
