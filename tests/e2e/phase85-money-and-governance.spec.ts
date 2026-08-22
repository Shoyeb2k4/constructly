import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 8.5 in a real browser.
 *
 * Two things unit tests cannot see. First, that money reads the way an Indian
 * site office writes it WHILE being typed — the grouping is a caret problem as
 * much as a formatting one, and a formatter that jumps the cursor is worse than
 * no formatter. Second, that a destructive control tells the truth: the server
 * refuses to remove a recorded vendor payment, so the UI must not offer one.
 */

/** Pappu, the demo contractor with a live advance ledger. */
const CONTRACTOR = "/labor/contractors/c-pappu";

async function openAdvanceSheet(page: Page) {
  await page.goto(CONTRACTOR);
  await settle(page);
  await page.getByRole("button", { name: "Record advance" }).first().click();
  await page.waitForTimeout(600);
  await expect(page.getByLabel("Amount")).toBeVisible();
}

async function settle(page: Page) {
  await page
    .waitForFunction(() => document.documentElement.dataset.constructlyHydrated === "1", undefined, {
      timeout: 15_000,
    })
    .catch(() => {});
  await page.waitForTimeout(900);
}

/* ── Indian money input ──────────────────────────────────────────────── */

test("money groups the Indian way as it is typed", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openAdvanceSheet(page);
  const amount = page.getByLabel("Amount");
  await amount.click();

  // Thousands first, then the lakh/crore pairs that a Western formatter gets wrong.
  await amount.pressSequentially("1000");
  await expect(amount).toHaveValue("1,000");
  await amount.pressSequentially("00");
  await expect(amount).toHaveValue("1,00,000");
  await amount.pressSequentially("000");
  await expect(amount).toHaveValue("10,00,00,000");

  // Paise survive, and so does the half-typed state on the way there.
  await amount.fill("");
  await amount.pressSequentially("12345678.5");
  await expect(amount).toHaveValue("1,23,45,678.5");
  await amount.pressSequentially("0");
  await expect(amount).toHaveValue("1,23,45,678.50");
});

test("the caret stays where the typist put it when a separator appears", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openAdvanceSheet(page);
  const amount = page.getByLabel("Amount");
  await amount.click();
  await amount.pressSequentially("50000");
  await expect(amount).toHaveValue("50,000");

  // Type a digit in the MIDDLE. A naive formatter re-renders and throws the
  // caret to the end, so the next keystroke lands in the wrong place.
  // Insert a digit in the MIDDLE, at "50|,000". A naive formatter re-renders
  // and throws the caret to the end, so the next keystroke lands in the wrong
  // place — which is how "50,000" quietly becomes "5,00,007".
  await amount.evaluate((el: HTMLInputElement) => el.setSelectionRange(2, 2));
  await page.keyboard.type("7");
  await expect(amount).toHaveValue("5,07,000");

  // The caret sits just after the 7 — "5,07|,000" — even though a separator
  // appeared to its left and shifted every character along.
  const caret = await amount.evaluate((el: HTMLInputElement) => el.selectionStart);
  expect(caret).toBe(4);

  // Proof that it matters: the next keystroke lands where the typist is looking.
  await page.keyboard.type("2");
  await expect(amount).toHaveValue("50,72,000");
});

test("a typed amount survives to the summary as the same number", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openAdvanceSheet(page);
  const amount = page.getByLabel("Amount");
  await amount.click();
  await amount.pressSequentially("125000");
  await expect(amount).toHaveValue("1,25,000");
  // The sheet echoes what will be recorded; grouping must match the field.
  await expect(page.getByText(/1,25,000/).first()).toBeVisible();
});

/* ── Governed deletion ───────────────────────────────────────────────── */

test("a recorded vendor payment offers an explanation, not a delete", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/vendors");
  await settle(page);

  await page.getByRole("link", { name: /UltraTech/i }).first().click();
  await settle(page);
  await page.getByRole("tab", { name: /payments/i }).first().click();
  await page.waitForTimeout(600);

  // The rule is stated once, where a user would look for the missing control.
  await expect(page.getByText(/can't be edited or removed/i).first()).toBeVisible();

  await page.getByRole("button", { name: /can't be removed/i }).first().click();
  await page.waitForTimeout(500);

  // No destructive button anywhere in the dialog.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: /^delete/i })).toHaveCount(0);
  await expect(dialog.getByText(/known gap/i)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Got it" })).toBeVisible();
});

test("a purchase order that has been paid against says why it stays", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // PO-0230 — the demo seeds a part payment of 15,00,000 against it.
  await page.goto("/procurement/50000000-0000-0000-0000-000000000230");
  await settle(page);

  await page.getByRole("button", { name: /more|actions/i }).first().click();
  await page.waitForTimeout(400);

  // The menu names the reason instead of offering a delete that would fail.
  await expect(page.getByText(/Paid against — the order stays/)).toBeVisible();
  const item = page.getByRole("menuitem", { name: /Delete purchase order/ });
  await expect(item).toBeDisabled();
});

test("an order nothing has been paid against can still be deleted", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // PO-0233 is a draft with no payments.
  await page.goto("/procurement/50000000-0000-0000-0000-000000000233");
  await settle(page);

  await page.getByRole("button", { name: /more|actions/i }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole("menuitem", { name: /Delete purchase order/ }).click();
  await page.waitForTimeout(500);

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Delete purchase order" })).toBeEnabled();
  // Even here the dialog states what leaves with it, rather than "cannot be undone".
  await expect(dialog.getByText(/ordered value leaves the budget/i)).toBeVisible();
});

test("the Owner's Delete on a contractor leads to what actually happens", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(CONTRACTOR);
  await settle(page);

  await page.getByRole("button", { name: "More contractor actions" }).click();
  await page.waitForTimeout(400);
  // The Owner gets the affordance they look for rather than being left hunting.
  await page.getByRole("menuitem", { name: /Delete contractor/ }).click();
  await page.waitForTimeout(600);

  const dialog = page.getByRole("dialog").first();
  // …and it tells the truth: nothing is erased, and here is what is attached.
  await expect(dialog.getByText(/never permanently deleted/i)).toBeVisible();
  // The impact summary answers "why not?" in figures: Pappu has 2 projects,
  // 4 agreements and a live advance ledger behind him.
  const body = await dialog.innerText();
  expect(body).toMatch(/Projects\s+[1-9]/);
  expect(body).toMatch(/Agreements\s+[1-9]/);
  expect(body).toMatch(/Advance ledger entries\s+[1-9]/);

  // The button performs the governed outcome, named honestly.
  await expect(dialog.getByRole("button", { name: /Archive contractor/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
});

test("Archive opens the same dialog without the delete explanation", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(CONTRACTOR);
  await settle(page);

  await page.getByRole("button", { name: "More contractor actions" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("menuitem", { name: /Archive contractor/ }).click();
  await page.waitForTimeout(600);

  const dialog = page.getByRole("dialog").first();
  await expect(dialog.getByRole("button", { name: /Archive contractor/i })).toBeVisible();
  // The extra explanation belongs to the Delete route only — a user who asked
  // to archive is not told why they cannot do something they did not ask for.
  await expect(dialog.getByText(/never permanently deleted/i)).toHaveCount(0);
});

/* ── The same field, module by module ────────────────────────────────── */

/**
 * The primitive is proven in isolation by its unit tests. What these check is
 * that each FORM actually adopted it — a form still on a plain number input
 * looks fine until someone types a crore into it.
 */
test.describe("every money form groups the same way", () => {
  const TYPED = "12345678";
  const SHOWN = "1,23,45,678";

  test("vendor payment", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/vendors");
    await settle(page);
    await page.getByRole("link", { name: /UltraTech/i }).first().click();
    await settle(page);
    await page.getByRole("button", { name: "Record payment" }).first().click();
    await page.waitForTimeout(700);

    // /^Amount/ rather than an exact match: the label carries a required
    // marker, which real assistive tech drops (it is aria-hidden) and
    // Playwright's label matching does not.
    const amount = page.getByLabel(/^Amount/);
    // It is reached BY ITS LABEL — the association is the point, not just the
    // formatting. This field had none until the Field wiring was fixed.
    await amount.click();
    await amount.pressSequentially(TYPED);
    await expect(amount).toHaveValue(SHOWN);
  });

  test("purchase order line rate", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/procurement");
    await settle(page);
    await page.getByRole("button", { name: /New purchase order/i }).first().click();
    await page.waitForTimeout(900);

    const rate = page.getByLabel("Rate per unit").first();
    await rate.click();
    await rate.pressSequentially(TYPED);
    await expect(rate).toHaveValue(SHOWN);
  });

  test("project budget, retyped over an existing value", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/projects/10000000-0000-0000-0000-000000000001");
    await settle(page);
    await page.getByRole("button", { name: /Edit budget/i }).first().click();
    await page.waitForTimeout(900);

    const budget = page.getByLabel("Total project budget");
    await expect(budget).toHaveValue(/[0-9]/); // it arrives with a real budget
    await budget.click();
    // Clearing a seeded field used to be impossible — the old number was pushed
    // straight back and the next keystrokes landed inside it.
    await budget.fill("");
    await expect(budget).toHaveValue("");
    await budget.pressSequentially(TYPED);
    await expect(budget).toHaveValue(SHOWN);
  });

  test("settlement advance adjustment", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(CONTRACTOR);
    await settle(page);
    await page.getByRole("button", { name: "New settlement" }).click();
    await page.waitForTimeout(900);

    // The bill — and with it the advance adjustment — only exists once a
    // project and period are chosen, so choose one.
    await page.getByRole("combobox").first().click();
    await page.waitForTimeout(400);
    await page.getByRole("option").first().click();
    await page.waitForTimeout(1200);

    const adj = page.locator('input[inputmode="decimal"]').first();
    await adj.click();
    await adj.fill("");
    await adj.pressSequentially(TYPED);
    await expect(adj).toHaveValue(SHOWN);
  });

  test("agreement value", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(CONTRACTOR);
    await settle(page);
    await page.getByRole("button", { name: "Create agreement" }).click();
    await page.waitForTimeout(900);

    const value = page.locator('input[inputmode="decimal"]').first();
    await value.click();
    await value.pressSequentially(TYPED);
    await expect(value).toHaveValue(SHOWN);
  });
});

/**
 * A sweep rather than a list: any money field that lost its label association
 * shows up here, including ones added after this was written.
 */
test("no money field anywhere is left without an accessible name", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  const openForm = async (go: () => Promise<void>) => {
    await go();
    const nameless = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"], input[inputmode="numeric"]')]
        .filter((i) => {
          const byLabel = i.labels && i.labels.length > 0;
          const byAria = i.getAttribute("aria-label") || i.getAttribute("aria-labelledby");
          return !byLabel && !byAria;
        })
        .map((i) => i.placeholder || i.name || i.className.slice(0, 40)),
    );
    expect(nameless, `unlabelled money input(s): ${nameless.join(", ")}`).toHaveLength(0);
  };

  await openForm(async () => {
    await page.goto(CONTRACTOR);
    await settle(page);
    await page.getByRole("button", { name: "Record advance" }).first().click();
    await page.waitForTimeout(700);
  });

  await openForm(async () => {
    await page.goto("/vendors");
    await settle(page);
    await page.getByRole("link", { name: /UltraTech/i }).first().click();
    await settle(page);
    await page.getByRole("button", { name: "Record payment" }).first().click();
    await page.waitForTimeout(700);
  });

  await openForm(async () => {
    await page.goto("/procurement");
    await settle(page);
    await page.getByRole("button", { name: /New purchase order/i }).first().click();
    await page.waitForTimeout(900);
  });
});

/* ── Responsive ──────────────────────────────────────────────────────── */

const WIDTHS = [375, 768, 1130, 1280, 1440];

test("the money field and the governed dialogs hold at every width", async ({ page }) => {
  // Five widths, two surfaces each — well past the default budget.
  test.setTimeout(180_000);

  const overflows = async () =>
    page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  const clipped = async (selector: string) =>
    page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return false;
      return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
    }, selector);

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });

    // A money field inside a sheet, with a long value in it.
    await page.goto(CONTRACTOR);
    await settle(page);
    const trigger = page.getByRole("button", { name: "Record advance" });
    if (await trigger.isVisible()) {
      await trigger.click();
    } else {
      await page.getByRole("button", { name: "More contractor actions" }).click();
      await page.waitForTimeout(300);
      await page.getByRole("menuitem", { name: /Record advance/ }).click();
    }
    await page.waitForTimeout(600);
    const amount = page.getByLabel("Amount");
    await amount.click();
    await amount.pressSequentially("123456789012");
    await expect(amount, `amount at ${width}px`).toHaveValue("1,23,45,67,89,012");
    expect(await clipped("#advance-amount"), `amount clipped at ${width}px`).toBe(false);
    expect(await overflows(), `page overflows at ${width}px`).toBe(false);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // A governed refusal dialog.
    await page.goto("/procurement/50000000-0000-0000-0000-000000000230");
    await settle(page);
    await page.getByRole("button", { name: /more|actions/i }).first().click();
    await page.waitForTimeout(300);
    await expect(page.getByText(/Paid against — the order stays/)).toBeVisible();
    expect(await overflows(), `PO menu overflows at ${width}px`).toBe(false);
    await page.keyboard.press("Escape");
  }
});
