/**
 * The material hooks against a REAL QueryClient.
 *
 * Two things are worth pinning here and cannot be seen from the component
 * tests: that each mutation invalidates exactly the queries the Pass 3 contract
 * on `procurementKeys` names — no more, because over-invalidating queues
 * refetches that cannot return anything new, and no less, because a stale list
 * is how a user concludes their edit did not save — and that the domain error
 * codes reach the user as sentences rather than as codes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Material } from "./types";

const h = vi.hoisted(() => ({
  createMaterial: vi.fn(),
  updateMaterial: vi.fn(),
  setMaterialArchived: vi.fn(),
  listMaterialMaster: vi.fn(),
  getMaterial: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("./data", async (orig) => {
  const mod = (await orig()) as Record<string, unknown>;
  return {
    ...mod,
    procurementApi: {
      createMaterial: h.createMaterial,
      updateMaterial: h.updateMaterial,
      setMaterialArchived: h.setMaterialArchived,
      listMaterialMaster: h.listMaterialMaster,
      getMaterial: h.getMaterial,
    },
  };
});
vi.mock("sonner", () => ({
  toast: { error: h.toastError, success: h.toastSuccess },
}));

import { MATERIAL_LABEL_VIEWS, useMaterialMutations } from "./hooks";
import { procurementKeys } from "./data";

const MATERIAL: Material = {
  id: "m1",
  name: "Cement",
  category: "Cement",
  defaultUnit: "bag",
  hsnCode: null,
  displayOrder: 0,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** Records every key passed to invalidateQueries, as a JSON string. */
function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidated: string[] = [];
  const original = qc.invalidateQueries.bind(qc);
  vi.spyOn(qc, "invalidateQueries").mockImplementation((filters?: { queryKey?: unknown }) => {
    invalidated.push(JSON.stringify(filters?.queryKey));
    return original(filters as never);
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  const { result } = renderHook(() => useMaterialMutations(), { wrapper });
  return { result, invalidated };
}

const LIST = JSON.stringify(["procurement", "material-master"]);
const NAMES = JSON.stringify(procurementKeys.materials);
const ONE = JSON.stringify(procurementKeys.material("m1"));

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
  h.createMaterial.mockResolvedValue(MATERIAL);
  h.updateMaterial.mockResolvedValue(MATERIAL);
  h.setMaterialArchived.mockResolvedValue(MATERIAL);
});
afterEach(cleanup);

describe("invalidation contract", () => {
  it("after create: the master list and the transitional name list", async () => {
    const { result, invalidated } = setup();
    await act(async () => {
      await result.current.create.mutateAsync({ name: "Cement" });
    });
    expect(invalidated).toContain(LIST);
    expect(invalidated).toContain(NAMES);
  });

  it("after edit: the list, the name list, and that one material", async () => {
    const { result, invalidated } = setup();
    await act(async () => {
      await result.current.update.mutateAsync({ id: "m1", patch: { name: "Cement OPC" } });
    });
    expect(invalidated).toEqual(expect.arrayContaining([LIST, NAMES, ONE]));
  });

  it("after archive and after restore: the same three", async () => {
    for (const archived of [true, false]) {
      const { result, invalidated } = setup();
      await act(async () => {
        await result.current.setArchived.mutateAsync({ id: "m1", archived });
      });
      expect(invalidated, `archived=${archived}`).toEqual(
        expect.arrayContaining([LIST, NAMES, ONE]),
      );
    }
  });

  it("never invalidates unrelated procurement data", async () => {
    const { result, invalidated } = setup();
    await act(async () => {
      await result.current.update.mutateAsync({ id: "m1", patch: { name: "X" } });
    });
    // The blunt instrument that would refetch every PO, payment and vendor.
    expect(invalidated).not.toContain(JSON.stringify(procurementKeys.all));
    // Pass 7: views that label materials by identity (current name) refresh
    // too — but never POs or payments, whose snapshots a rename cannot touch.
    const labelViews = MATERIAL_LABEL_VIEWS.map((k) => JSON.stringify(k));
    for (const key of invalidated) {
      expect([LIST, NAMES, ONE, ...labelViews]).toContain(key);
    }
    expect(invalidated).toEqual(expect.arrayContaining(labelViews));
    expect(invalidated).not.toContain(JSON.stringify(["procurement", "pos"]));
    expect(invalidated).not.toContain(JSON.stringify(["procurement", "payments"]));
  });
});

describe("domain errors reach the user as sentences", () => {
  const cases: [string, RegExp][] = [
    ["MATERIAL_NAME_TAKEN", /already exists/i],
    ["INVALID_UNIT", /valid unit/i],
    ["INVALID_CATEGORY", /category from the list/i],
    ["NOT_FOUND", /no longer exists/i],
    ["FORBIDDEN", /permission/i],
  ];

  it.each(cases)("%s is translated, not shown raw", async (code, expected) => {
    h.createMaterial.mockRejectedValue(new Error(code));
    const { result } = setup();
    await act(async () => {
      await result.current.create.mutateAsync({ name: "Cement" }).catch(() => {});
    });
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    const message = h.toastError.mock.calls[0][0] as string;
    expect(message).toMatch(expected);
    expect(message).not.toContain(code);
  });

  it("falls back to a plain message for an unrecognised failure", async () => {
    h.updateMaterial.mockRejectedValue(new Error("ECONNRESET"));
    const { result } = setup();
    await act(async () => {
      await result.current.update.mutateAsync({ id: "m1", patch: {} }).catch(() => {});
    });
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Couldn't save the material"));
  });

  it("surfaces a restore name conflict rather than hiding it", async () => {
    // The real case: another material took the name while this one was archived.
    h.setMaterialArchived.mockRejectedValue(new Error("MATERIAL_NAME_TAKEN"));
    const { result } = setup();
    await act(async () => {
      await result.current.setArchived
        .mutateAsync({ id: "m1", archived: false })
        .catch(() => {});
    });
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("A material with this name already exists."),
    );
  });

  it("distinguishes an archive failure from a restore failure", async () => {
    h.setMaterialArchived.mockRejectedValue(new Error("boom"));
    const { result } = setup();
    await act(async () => {
      await result.current.setArchived.mutateAsync({ id: "m1", archived: true }).catch(() => {});
    });
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("Couldn't archive the material"),
    );
  });
});
