import { test, expect, type Page } from "@playwright/test";

/**
 * Route-boundary reliability.
 *
 * Passes 9C and 10B both stalled on the same symptom: a hard load that renders
 * every layout and then sits on the route-level `loading.tsx` forever. The
 * mechanism is React 19.2's animation-frame-scheduled Suspense reveal (see
 * src/lib/dev/hidden-tab-raf.ts); the fallback that fixes it is unit-tested
 * there. This spec guards the user-visible contract instead: on every route
 * that has a `loading.tsx`, the four ways a page can be reached must all end in
 * real content, never a skeleton.
 *
 * `/projects` is covered alongside the contractor routes because the earlier
 * failures showed up there too.
 */

/** Fails with the diagnostic flags rather than a bare timeout. */
async function expectSettled(page: Page, heading: RegExp | string) {
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({
    timeout: 15_000,
  });

  // The heading can be visible from the streamed HTML a beat before React
  // hydrates, so wait for the flags rather than snapshotting them.
  await page
    .waitForFunction(
      () => {
        const f = document.documentElement.dataset;
        return (
          f.constructlyHydrated === "1" &&
          f.constructlyDemo === "1" &&
          f.constructlyQuery === "1" &&
          f.constructlyAuth === "1" &&
          f.constructlyRafShim === "1"
        );
      },
      undefined,
      { timeout: 15_000 },
    )
    .catch(async () => {
      const flags = await page.evaluate(() => ({ ...document.documentElement.dataset }));
      throw new Error(`demo health flags never completed: ${JSON.stringify(flags)}`);
    });

  // No Suspense boundary left in React's "reveal queued" state.
  const queued = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
    let n: Node | null;
    let count = 0;
    while ((n = walker.nextNode())) if ((n as Comment).data === "$~") count += 1;
    return count;
  });
  expect(queued, "Suspense boundaries stuck in the queued-reveal state").toBe(0);
}

const ROUTES: { path: string; heading: RegExp }[] = [
  { path: "/projects", heading: /Projects/ },
  { path: "/labor", heading: /Labor/ },
  { path: "/labor/contractors", heading: /Contractors/ },
  // Payments has its own `loading.tsx` and aggregates four sources, so it is
  // exactly the shape of route that stalled before.
  { path: "/payments", heading: /^Payments$/ },
];

for (const { path, heading } of ROUTES) {
  test(`hard load settles: ${path}`, async ({ page }) => {
    await page.goto(path);
    await expectSettled(page, heading);
  });

  test(`reload settles: ${path}`, async ({ page }) => {
    await page.goto(path);
    await expectSettled(page, heading);
    await page.reload();
    await expectSettled(page, heading);
  });
}

test("fresh tab settles on a deep-linked contractor detail", async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/labor/contractors");
  await expectSettled(page, /Contractors/);

  const href = await page.locator('a[href^="/labor/contractors/"]').first().getAttribute("href");
  expect(href).toBeTruthy();

  // A genuinely fresh context, as if the URL were pasted into a new tab.
  const fresh = await browser.newPage();
  await fresh.goto(href!);
  await expect(fresh.getByText(/Advance balance|Ledger|Agreements/).first()).toBeVisible({
    timeout: 15_000,
  });
  await fresh.close();
  await page.close();
});

test("client-side navigation settles across the labour routes", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Labor" }).first().click();
  await expectSettled(page, /Labor/);

  await page.getByRole("link", { name: "Contractors" }).first().click();
  await expect(page).toHaveURL(/\/labor\/contractors$/);
  await expectSettled(page, /Contractors/);

  await page.getByRole("link", { name: "Projects" }).first().click();
  await expect(page).toHaveURL(/\/projects$/);
  await expectSettled(page, /Projects/);
});
