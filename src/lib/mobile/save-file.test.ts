import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * File saving.
 *
 * This exists because the failure it guards against is silent: `<a download>`
 * is ignored by WKWebView, so before this abstraction every CSV, spreadsheet
 * and PDF export on an iPhone produced no file, no share sheet and no error.
 */

async function freshModule() {
  vi.resetModules();
  return import("./save-file");
}

/**
 * Capture the anchor the web path creates, per test.
 *
 * Spying on `HTMLAnchorElement.prototype.click` looked simpler but is shared
 * mutable state across the whole suite, and produced a test that passed alone
 * and intermittently failed in a full run. Intercepting `createElement`
 * captures the specific element this call made, so the assertions cannot be
 * influenced by anything else.
 */
function captureAnchor() {
  const clicks: HTMLAnchorElement[] = [];
  const original = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = original(tag) as HTMLElement;
    if (tag === "a") {
      (el as HTMLAnchorElement).click = () => void clicks.push(el as HTMLAnchorElement);
    }
    return el;
  });
  return clicks;
}

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  // jsdom has no object-URL implementation.
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("web", () => {
  it("saves through an anchor download and says so", async () => {
    const mod = await freshModule();
    const clicks = captureAnchor();

    const how = await mod.saveGeneratedFile(new Blob(["a,b"]), "report.csv");

    expect(how).toBe("downloaded");
    expect(clicks).toHaveLength(1);
  });

  it("names the file and releases the object URL", async () => {
    const mod = await freshModule();
    const clicks = captureAnchor();

    await mod.saveGeneratedFile(new Blob(["x"]), "purchase-orders.xlsx");

    expect(clicks[0].download).toBe("purchase-orders.xlsx");
    // Leaking object URLs in a long-lived SPA is a slow memory leak.
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("reports no native saver until one is installed", async () => {
    const mod = await freshModule();
    expect(mod.hasNativeFileSaver()).toBe(false);
  });
});

describe("native", () => {
  it("uses the installed saver instead of an anchor, and says it was shared", async () => {
    const mod = await freshModule();
    // Parameters are named (not underscored) and recorded, so the filename
    // assertion below stays type-checked without tripping unused-var lint.
    const seen: string[] = [];
    const save = vi.fn(async (blob: Blob, filename: string) => {
      seen.push(`${filename}:${blob.size}`);
    });
    const clicks = captureAnchor();
    mod.configureFileSaver({ save });

    const how = await mod.saveGeneratedFile(new Blob(["x"]), "ledger.pdf");

    // "Downloaded" would be a lie on iOS — the file went to a share sheet.
    expect(how).toBe("shared");
    expect(save).toHaveBeenCalledOnce();
    expect(seen[0]).toMatch(/^ledger\.pdf:/);
    expect(clicks).toHaveLength(0);
  });

  it("propagates a native failure rather than pretending it saved", async () => {
    const mod = await freshModule();
    mod.configureFileSaver({
      save: vi.fn(async () => {
        throw new Error("Sharing is unavailable on this device");
      }),
    });

    await expect(mod.saveGeneratedFile(new Blob(["x"]), "a.csv")).rejects.toThrow(
      /unavailable/i,
    );
  });
});
