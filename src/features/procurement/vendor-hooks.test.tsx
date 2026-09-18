/**
 * The vendor mutation hooks against a REAL QueryClient: which queries a vendor
 * save invalidates, and how its failures read to the user.
 *
 * These used to invalidate `procurementKeys.all` — every procurement query in
 * the app, including the Material Master, members and categories, none of which
 * a vendor write can change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Vendor } from "./types";

const h = vi.hoisted(() => ({
  createVendor: vi.fn(),
  updateVendor: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("./data", async (orig) => {
  const mod = (await orig()) as Record<string, unknown>;
  return {
    ...mod,
    procurementApi: { createVendor: h.createVendor, updateVendor: h.updateVendor },
  };
});
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: h.toastSuccess } }));

import { useVendorMutations } from "./hooks";
import { procurementKeys } from "./data";

const VENDOR = { id: "v1", businessName: "Shree", materials: [] } as unknown as Vendor;

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidated: string[] = [];
  const original = qc.invalidateQueries.bind(qc);
  vi.spyOn(qc, "invalidateQueries").mockImplementation((f?: { queryKey?: unknown }) => {
    invalidated.push(JSON.stringify(f?.queryKey));
    return original(f as never);
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  const { result } = renderHook(() => useVendorMutations(), { wrapper });
  return { result, invalidated };
}

const K = (k: readonly unknown[]) => JSON.stringify(k);

/** Queries a vendor save can never change. */
const UNRELATED = [
  K(procurementKeys.all),
  K(["procurement", "material-master"]),
  K(procurementKeys.members),
  K(procurementKeys.materialCategories),
  K(procurementKeys.pendingApprovals),
];

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
  h.createVendor.mockResolvedValue(VENDOR);
  h.updateVendor.mockResolvedValue(VENDOR);
});
afterEach(cleanup);

describe("targeted invalidation", () => {
  it("after create: the vendor lists and the transitional material names", async () => {
    const { result, invalidated } = setup();
    await act(async () => {
      await result.current.create.mutateAsync({ businessName: "Shree", materialIds: [] });
    });
    expect(invalidated).toEqual(
      expect.arrayContaining([K(["procurement", "vendors"]), K(procurementKeys.materials)]),
    );
    // A brand-new vendor is on no purchase order, so PO screens are left alone.
    expect(invalidated).not.toContain(K(["procurement", "pos"]));
  });

  it("after update: that vendor's detail and mappings, plus the screens that show its name", async () => {
    const { result, invalidated } = setup();
    await act(async () => {
      await result.current.update.mutateAsync({ id: "v1", patch: { materialIds: ["m1"] } });
    });
    expect(invalidated).toEqual(
      expect.arrayContaining([
        K(["procurement", "vendors"]),
        K(procurementKeys.vendor("v1")),
        K(procurementKeys.vendorMaterials("v1")),
        K(procurementKeys.materials),
        K(["procurement", "pos"]),
      ]),
    );
  });

  it("never invalidates what a vendor write cannot change", async () => {
    const { result, invalidated } = setup();
    await act(async () => {
      await result.current.create.mutateAsync({ businessName: "Shree" });
      await result.current.update.mutateAsync({ id: "v1", patch: {} });
    });
    for (const key of UNRELATED) expect(invalidated, key).not.toContain(key);
  });
});

describe("failures read as sentences", () => {
  it.each([
    ["MATERIAL_ARCHIVED", /has been archived/i],
    ["NOT_FOUND", /no longer exists/i],
    ["FORBIDDEN", /permission/i],
  ])("%s", async (code, expected) => {
    h.updateVendor.mockRejectedValue(new Error(code));
    const { result } = setup();
    await act(async () => {
      await result.current.update.mutateAsync({ id: "v1", patch: {} }).catch(() => {});
    });
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    const msg = h.toastError.mock.calls[0][0] as string;
    expect(msg).toMatch(expected);
    expect(msg).not.toContain(code);
  });

  it("a create failure is reported, not swallowed", async () => {
    h.createVendor.mockRejectedValue(new Error("something unexpected"));
    const { result } = setup();
    await act(async () => {
      await result.current.create.mutateAsync({ businessName: "X" }).catch(() => {});
    });
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Couldn't add the vendor"));
  });
});
