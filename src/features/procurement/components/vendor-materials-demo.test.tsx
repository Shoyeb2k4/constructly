/**
 * Vendor materials end to end in DEMO MODE — the real Vendors list, the real
 * vendor detail page, the real sheet and hooks, and the demo repository
 * underneath. The data layer is not stubbed.
 *
 * This is the flow the client will actually walk: add a vendor with the
 * materials it supplies, see those materials on the list and the vendor page,
 * then change them and see the change land everywhere — with no stale legacy
 * text anywhere on screen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Permission } from "@/features/rbac/permissions";
import { demoProcurementRepository as repo } from "../demo/demo-repository";

const h = vi.hoisted(() => ({ permissions: new Set<string>() }));

vi.mock("@/features/rbac/permission-context", () => ({
  useCan: () => (p: Permission) => h.permissions.has(p),
}));
vi.mock("../data", async (orig) => {
  const mod = (await orig()) as Record<string, unknown>;
  const { demoProcurementRepository: demo } = await import("../demo/demo-repository");
  return { ...mod, procurementApi: demo };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/vendors",
  useSearchParams: () => new URLSearchParams(),
}));

import { VendorsView } from "./vendors-view";
import { VendorDetailView } from "./vendor-detail-view";

const EDITOR: Permission[] = [
  "vendors.view",
  "vendors.create",
  "vendors.edit",
  "materials.view",
  "materials.create",
];

function withClient(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, node));
}

const options = () => within(screen.getByRole("group", { name: "Materials" }));
const chips = () => within(screen.getByRole("list", { name: "Selected materials" }));

/** Make sure the named materials exist in the master (the demo seeds others). */
async function ensureMaterials(...names: string[]) {
  const have = new Set((await repo.listMaterialMaster()).map((m) => m.name));
  for (const name of names) if (!have.has(name)) await repo.createMaterial({ name });
}

beforeEach(async () => {
  localStorage.clear();
  h.permissions = new Set(EDITOR);
  await ensureMaterials("OPC 53 Cement", "TMT Steel 12mm", "Sand", "Aggregate 20mm");
});
afterEach(cleanup);

describe("adding a vendor with its materials", () => {
  it("saves the mappings and shows canonical names on the list", async () => {
    withClient(<VendorsView />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Add vendor/i })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Add vendor/i }));
    fireEvent.change(screen.getByPlaceholderText("UltraTech Cement"), {
      target: { value: "Shree Building Supplies" },
    });
    await waitFor(() => expect(options().getByLabelText("OPC 53 Cement")).toBeTruthy());
    fireEvent.click(options().getByLabelText("OPC 53 Cement"));
    fireEvent.click(options().getByLabelText("TMT Steel 12mm"));
    fireEvent.click(options().getByLabelText("Sand"));
    fireEvent.click(screen.getByRole("button", { name: /^Add vendor$/ }));

    // Persisted as real mappings.
    await waitFor(async () => {
      const v = (await repo.listVendors()).find((x) => x.businessName === "Shree Building Supplies");
      expect(v?.materials.map((m) => m.name).sort()).toEqual(["OPC 53 Cement", "Sand", "TMT Steel 12mm"]);
    });

    // And the list shows them, from the mapping.
    const row = await waitFor(() =>
      screen.getAllByRole("row").find((r) => r.textContent?.includes("Shree Building Supplies"))!,
    );
    expect(row.textContent).toMatch(/OPC 53 Cement|Sand|TMT Steel 12mm/);
  });

  it("the legacy mirror follows the mapping, so the old list filter still finds the vendor", async () => {
    const [cement] = (await repo.listMaterialMaster()).filter((m) => m.name === "OPC 53 Cement");
    await repo.createVendor({ businessName: "Mirror Co", materialIds: [cement.id] });
    const v = (await repo.listVendors({ material: "OPC 53 Cement" })).find(
      (x) => x.businessName === "Mirror Co",
    );
    expect(v).toBeTruthy();
  });
});

describe("editing a vendor's materials", () => {
  it("preloads the mappings, then adds one and removes another", async () => {
    const all = await repo.listMaterialMaster();
    const id = (n: string) => all.find((m) => m.name === n)!.id;
    const vendor = await repo.createVendor({
      businessName: "Shree Building Supplies",
      materialIds: [id("OPC 53 Cement"), id("TMT Steel 12mm"), id("Sand")],
    });

    withClient(<VendorDetailView id={vendor.id} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Edit vendor/i })).toBeTruthy());

    // The detail page lists the canonical names.
    const card = within(screen.getByRole("list", { name: "Materials supplied" }));
    expect(card.getByText("Sand")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Edit vendor/i }));
    // Preselected from the mapping.
    await waitFor(() => expect(chips().getByText("Sand")).toBeTruthy());
    expect(chips().getByText("OPC 53 Cement")).toBeTruthy();

    // Chips come from the vendor's own mappings (already loaded); the options
    // come from the master query, which resolves separately.
    await waitFor(() => expect(options().getByLabelText("Aggregate 20mm")).toBeTruthy());
    fireEvent.click(options().getByLabelText("Aggregate 20mm"));
    fireEvent.click(screen.getByRole("button", { name: "Remove Sand" }));
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(async () => {
      const v = await repo.getVendor(vendor.id);
      expect(v!.materials.map((m) => m.name).sort()).toEqual([
        "Aggregate 20mm",
        "OPC 53 Cement",
        "TMT Steel 12mm",
      ]);
    });

    // The detail page reflects it — and shows nothing stale.
    await waitFor(() => {
      const after = within(screen.getByRole("list", { name: "Materials supplied" }));
      expect(after.getByText("Aggregate 20mm")).toBeTruthy();
      expect(after.queryByText("Sand")).toBeNull();
    });
  });

  it("shows an archived mapping on the detail page, marked, not hidden", async () => {
    const m = await repo.createMaterial({ name: "Retired Cement" });
    const vendor = await repo.createVendor({ businessName: "Old Supplier", materialIds: [m.id] });
    await repo.setMaterialArchived(m.id, true);

    withClient(<VendorDetailView id={vendor.id} />);
    const card = await waitFor(() => within(screen.getByRole("list", { name: "Materials supplied" })));
    expect(card.getByText("Retired Cement")).toBeTruthy();
    expect(card.getByText(/Archived/)).toBeTruthy();
  });

  it("a vendor with no mappings says so rather than showing nothing", async () => {
    const vendor = await repo.createVendor({ businessName: "Bare", materialIds: [] });
    withClient(<VendorDetailView id={vendor.id} />);
    await waitFor(() => expect(screen.getByText(/No materials recorded for this vendor/i)).toBeTruthy());
  });

  it("offers no Edit to someone who cannot edit vendors", async () => {
    h.permissions = new Set(["vendors.view", "materials.view"]);
    const vendor = await repo.createVendor({ businessName: "Read Only", materialIds: [] });
    withClient(<VendorDetailView id={vendor.id} />);
    await waitFor(() => expect(screen.getByText("Read Only")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Edit vendor/i })).toBeNull();
  });
});

describe("legacy-only text is shown for what it is", () => {
  it("never as a material chip — only in the labelled older-app note", async () => {
    // Text an older app recorded that matches no material. Gate 0 keeps it
    // rather than silently dropping it, and says plainly what it is.
    const vendor = await repo.createVendor({ businessName: "Divergent", materialIds: [] });
    const stored = JSON.parse(localStorage.getItem("constructly.demo.vendors.v2")!);
    stored.find((v: { id: string }) => v.id === vendor.id).materialsSupplied = ["LEGACY ONLY TEXT"];
    localStorage.setItem("constructly.demo.vendors.v2", JSON.stringify(stored));

    withClient(<VendorDetailView id={vendor.id} />);
    await waitFor(() => expect(screen.getByText("Divergent")).toBeTruthy());
    // Not a mapped material…
    expect(screen.queryByRole("list", { name: "Materials supplied" })).toBeNull();
    // …but visible, labelled as coming from an older version.
    expect(screen.getByText(/recorded by an older version of the app/i).textContent).toContain(
      "LEGACY ONLY TEXT",
    );
  });
});
