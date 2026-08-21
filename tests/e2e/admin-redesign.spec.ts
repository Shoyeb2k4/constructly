import { test, expect, type Page } from "@playwright/test";
import { textCollisions, hasPageOverflow, clippedText } from "./helpers/geometry";

/**
 * Users, Roles and Company Settings.
 *
 * This is where a misunderstanding costs the most: granting the wrong
 * permission exposes financial and project data, and unlike a layout bug nobody
 * notices it. So most of what is checked here is COMPREHENSION — that a
 * permission says what it does, that company-wide access announces itself, and
 * that a built-in role admits it can be reset by an update.
 */

const WIDTHS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1130, height: 800 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

async function settle(page: Page) {
  await page
    .waitForFunction(() => document.documentElement.dataset.constructlyHydrated === "1", undefined, {
      timeout: 15_000,
    })
    .catch(() => {});
  await page.waitForTimeout(900);
}

const open = async (page: Page, section: string) => {
  await page.goto(`/settings?section=${section}`);
  await settle(page);
};

/* ── Settings shell ──────────────────────────────────────────────────── */

test("settings groups its sections rather than listing them flat", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "company");

  // Access control is not another styling choice, and the grouping says so.
  for (const group of ["Company", "People & access", "You"]) {
    await expect(page.getByRole("heading", { name: group, exact: true })).toBeVisible();
  }
  await expect(page.getByText("Who can sign in").first()).toBeVisible();
  await expect(page.getByText("What each role may do").first()).toBeVisible();
});

test("a settings section can be linked to and survives a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "roles");
  // The role list is the unambiguous signal that Roles is the open section.
  await expect(page.getByRole("button", { name: /^Owner/ }).first()).toBeVisible();

  // Reload: the section used to reset to Company, losing your place.
  await page.reload();
  await settle(page);
  await expect(page.getByRole("button", { name: /^Owner/ }).first()).toBeVisible();
});

test("choosing a section records it in the URL", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "company");
  await page.getByRole("button", { name: /Users/ }).first().click();
  await page.waitForTimeout(600);
  await expect(page).toHaveURL(/section=users/);
});

/* ── Company settings + the demo-parity fix ──────────────────────────── */

test("company settings load with real values and no error", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Prisma|findUniqueOrThrow|Invalid `prisma/i.test(m.text())) {
      errors.push(m.text().slice(0, 160));
    }
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "company");

  // The Phase 3 defect: this screen threw on every demo load for five phases.
  expect(errors, errors.join("\n")).toEqual([]);
  const name = page.getByLabel("Company name").first();
  await expect(name).toBeVisible();
  await expect(name).not.toHaveValue("");
  await expect(page.getByLabel("GST number").first()).not.toHaveValue("");
});

test("a company edit saves and survives a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "company");

  const city = page.getByLabel("City").first();
  await city.fill("Pune");
  await page.getByRole("button", { name: /Save changes/ }).click();
  await expect(page.getByText(/Company details saved/)).toBeVisible();

  await page.reload();
  await settle(page);
  await expect(page.getByLabel("City").first()).toHaveValue("Pune");
});

/* ── Users ───────────────────────────────────────────────────────────── */

test("users lists real members with their role and status", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "users");

  // Empty in demo before this phase — the whole screen was unusable.
  await expect(page.getByText("Aarav Mehta").first()).toBeVisible();
  await expect(page.getByText("Priya Nair").first()).toBeVisible();
  await expect(page.getByText("You").first()).toBeVisible();
  // Only real domain states: Active and Deactivated. No invented "Online".
  await expect(page.getByText("Deactivated").first()).toBeVisible();
  await expect(page.getByText(/Online|Last seen|Away/)).toHaveCount(0);
});

test("pending invitations show their state, including expiry", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "users");

  await expect(page.getByText("new.engineer@demo.constructly.app").first()).toBeVisible();
  await expect(page.getByText(/expired/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Resend" }).first()).toBeVisible();
});

/* ── Roles: the comprehension work ───────────────────────────────────── */

test("Owner reads as full access, never as zero permissions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "roles");

  await page.getByRole("button", { name: /^Owner/ }).first().click();
  await page.waitForTimeout(600);

  await expect(page.getByText("Full access").first()).toBeVisible();
  await expect(page.getByText(/implicit, not a stored list/).first()).toBeVisible();
  // The Callout renders its title as a <p>, not a heading.
  await expect(page.getByText(/Owner has full company access/).first()).toBeVisible();
  // The one thing that must never appear for the role that holds everything.
  await expect(page.getByText(/\b0 of 97 permissions/)).toHaveCount(0);
});

test("a built-in role admits an update will reset it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "roles");

  await page.getByRole("button", { name: /^Admin/ }).first().click();
  await page.waitForTimeout(600);

  await expect(page.getByText("Built-in").first()).toBeVisible();
  await expect(page.getByText("Reset by updates").first()).toBeVisible();
  await expect(page.getByText(/will reset this one back to its template/).first()).toBeVisible();
  // And it points at the safe alternative rather than just warning.
  await expect(page.getByText(/Duplicate/).first()).toBeVisible();
  // Admin's real size, matching production.
  await expect(page.getByText(/94 of 97 permissions/).first()).toBeVisible();
});

test("every permission explains itself, its scope and its impact", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "roles");
  await page.getByRole("button", { name: /^Admin/ }).first().click();
  await page.waitForTimeout(600);

  // Plain-words consequence, not a bare verb.
  await expect(page.getByText("See the projects this person is assigned to.").first()).toBeVisible();

  // The distinction most likely to be granted by accident.
  await expect(page.getByText("Assigned projects").first()).toBeVisible();
  await expect(page.getByText("Company-wide").first()).toBeVisible();

  // Impact stated in WORDS — it used to be a 6px aria-hidden dot.
  await expect(page.getByText("High impact").first()).toBeVisible();
  await expect(
    page.getByText(/reveals every project, not only the ones this person is assigned to/).first(),
  ).toBeVisible();
});

test("report permissions name the reports they unlock", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "roles");
  await page.getByRole("button", { name: /^Admin/ }).first().click();
  await page.waitForTimeout(600);

  // Derived from the live registry, not a second hand-kept list.
  await expect(page.getByText(/Unlocks: Cash movement/).first()).toBeVisible();
  await expect(page.getByText(/Unlocks: Project summary/).first()).toBeVisible();
});

test("payments.view does not claim to grant contractor access", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "roles");
  await page.getByRole("button", { name: /^Admin/ }).first().click();
  await page.waitForTimeout(600);

  await expect(page.getByText(/this shows vendor money only/).first()).toBeVisible();
});

/* ── Custom roles: the workflow production has never exercised ───────── */

test("a custom role can be created, granted and kept", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "roles");

  await page.getByRole("button", { name: "New", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox").first().fill("Project Accounts Reviewer");
  await dialog.getByRole("button", { name: /Create/ }).click();
  await page.waitForTimeout(1200);

  // It is a CUSTOM role, and says so.
  await expect(page.getByText("Custom").first()).toBeVisible();
  await expect(page.getByText(/0 of 97 permissions/).first()).toBeVisible();

  // Grant one permission and save.
  await page
    .getByRole("checkbox")
    .filter({ hasText: "See the projects this person is assigned to." })
    .first()
    .click();
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: /^Save/ }).click();
  await page.waitForTimeout(1200);
  await expect(page.getByText(/1 of 97 permissions/).first()).toBeVisible();

  // A custom role — unlike a built-in one — can be deleted.
  await expect(page.getByRole("button", { name: /Delete/ }).first()).toBeVisible();
});

/* ── Geometry ────────────────────────────────────────────────────────── */

for (const section of ["company", "users", "roles"]) {
  test(`settings/${section} lays out cleanly at every width`, async ({ page }) => {
    test.slow();
    for (const vp of WIDTHS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await open(page, section);

      const collisions = await textCollisions(page);
      expect(collisions, `${section} at ${vp.width}px:\n${collisions.join("\n")}`).toEqual([]);
      expect(await hasPageOverflow(page), `${section} scrolls sideways at ${vp.width}px`).toBe(
        false,
      );
    }
  });
}

test("admin text is never clipped on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const section of ["company", "users", "roles"]) {
    await open(page, section);
    const clipped = await clippedText(page);
    expect(clipped, `${section} clips text at 375px:\n${clipped.join("\n")}`).toEqual([]);
  }
});

/* ── Loading ─────────────────────────────────────────────────────────── */

test("settings renders without a hydration mismatch", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Hydration failed|did not match|#418|#425/i.test(m.text())) {
      errors.push(m.text().slice(0, 160));
    }
  });
  await open(page, "users");
  expect(errors, errors.join("\n")).toEqual([]);
  // Pending is not empty: never "no members" while the query resolves.
  await expect(page.getByText(/No members yet/)).toHaveCount(0);
});
