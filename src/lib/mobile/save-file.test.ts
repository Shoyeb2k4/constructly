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

beforeEach(() => {
  // Spies here are installed on HTMLAnchorElement.prototype, which is shared —
  // without this, click counts leak between tests.
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  // jsdom has no object-URL implementation.
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("web", () => {
  it("saves through an anchor download and says so", async () => {
    const mod = await freshModule();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const how = await mod.saveGeneratedFile(new Blob(["a,b"]), "report.csv");

    expect(how).toBe("downloaded");
    expect(click).toHaveBeenCalledOnce();
  });

  it("names the file and releases the object URL", async () => {
    const mod = await freshModule();
    let downloadName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });

    await mod.saveGeneratedFile(new Blob(["x"]), "purchase-orders.xlsx");

    expect(downloadName).toBe("purchase-orders.xlsx");
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
    const save = vi.fn(async () => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mod.configureFileSaver({ save });

    const how = await mod.saveGeneratedFile(new Blob(["x"]), "ledger.pdf");

    // "Downloaded" would be a lie on iOS — the file went to a share sheet.
    expect(how).toBe("shared");
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][1]).toBe("ledger.pdf");
    expect(click).not.toHaveBeenCalled();
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
