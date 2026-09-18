/**
 * Procurement duplicate → refetch lifecycle. Guards the reported "stuck on
 * Updating…" glitch: after a duplicate (success OR error), the list's
 * background refetch must settle (queryClient.isFetching() → 0) and the
 * mutation must leave the pending state. Drives the REAL hooks against the
 * demo repository through a QueryClient.
 */
import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePurchaseOrders, usePOMutations, useMaterialMaster, useMembers } from "./hooks";
import { procurementApi } from "./data";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("procurement duplicate does not leave the UI stuck on 'updating…'", () => {
  it("the list refetch settles after a successful duplicate", async () => {
    const client = makeClient();
    const w = wrapper(client);
    const list = renderHook(() => usePurchaseOrders({}), { wrapper: w });
    const mut = renderHook(() => usePOMutations(), { wrapper: w });

    await waitFor(() => expect(list.result.current.isLoading).toBe(false));
    expect(list.result.current.data!.length).toBeGreaterThan(0);
    const firstId = list.result.current.data![0].id;

    await act(async () => {
      await mut.result.current.duplicate.mutateAsync(firstId);
    });

    // The broad invalidation triggers a background refetch — it MUST terminate.
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(mut.result.current.duplicate.isPending).toBe(false);
    expect(mut.result.current.duplicate.isError).toBe(false);
  });

  it("narrows invalidation: a duplicate refetches the PO list but NOT the static materials/members lists", async () => {
    const client = makeClient();
    const w = wrapper(client);
    const listSpy = vi.spyOn(procurementApi, "listPurchaseOrders");
    const materialsSpy = vi.spyOn(procurementApi, "listMaterialMaster");
    const membersSpy = vi.spyOn(procurementApi, "listMembers");

    const list = renderHook(() => usePurchaseOrders({}), { wrapper: w });
    const materials = renderHook(() => useMaterialMaster({ includeArchived: true }), { wrapper: w });
    const members = renderHook(() => useMembers(), { wrapper: w });
    const mut = renderHook(() => usePOMutations(), { wrapper: w });

    await waitFor(() => expect(list.result.current.isLoading).toBe(false));
    await waitFor(() => expect(materials.result.current.isLoading).toBe(false));
    await waitFor(() => expect(members.result.current.isLoading).toBe(false));

    const listCalls0 = listSpy.mock.calls.length;
    const materialsCalls0 = materialsSpy.mock.calls.length;
    const membersCalls0 = membersSpy.mock.calls.length;

    await act(async () => {
      await mut.result.current.duplicate.mutateAsync(list.result.current.data![0].id);
    });
    await waitFor(() => expect(client.isFetching()).toBe(0));

    // PO list refetched (its data changed) …
    expect(listSpy.mock.calls.length).toBeGreaterThan(listCalls0);
    // … but the static lists were NOT force-refetched (root-cause of the
    // prolonged "· updating…": those refetches queued ahead of the list).
    expect(materialsSpy.mock.calls.length).toBe(materialsCalls0);
    expect(membersSpy.mock.calls.length).toBe(membersCalls0);

    listSpy.mockRestore();
    materialsSpy.mockRestore();
    membersSpy.mockRestore();
  });

  it("navigation-aware: leaving the list after a duplicate leaves no lingering/looping fetch; return refetches once", async () => {
    const client = makeClient();
    const w = wrapper(client);
    const listSpy = vi.spyOn(procurementApi, "listPurchaseOrders");

    const list = renderHook(() => usePurchaseOrders({}), { wrapper: w });
    const mut = renderHook(() => usePOMutations(), { wrapper: w });
    await waitFor(() => expect(list.result.current.isLoading).toBe(false));
    const firstId = list.result.current.data![0].id;

    // Duplicate, then "navigate away" from the list (unmount its observer).
    await act(async () => {
      await mut.result.current.duplicate.mutateAsync(firstId);
    });
    list.unmount();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const callsWhileAway = listSpy.mock.calls.length;

    // While away, the invalidated-but-inactive list query must NOT keep
    // refetching (no repeated/looping requests, no lingering isFetching).
    await new Promise((r) => setTimeout(r, 50));
    expect(listSpy.mock.calls.length).toBe(callsWhileAway);
    expect(client.isFetching()).toBe(0);

    // Returning to the list refetches exactly once and settles.
    const list2 = renderHook(() => usePurchaseOrders({}), { wrapper: w });
    await waitFor(() => expect(list2.result.current.isLoading).toBe(false));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(listSpy.mock.calls.length).toBe(callsWhileAway + 1);

    listSpy.mockRestore();
  });

  it("a failed duplicate also settles (no stuck pending, no stuck fetching)", async () => {
    const client = makeClient();
    const w = wrapper(client);
    const list = renderHook(() => usePurchaseOrders({}), { wrapper: w });
    const mut = renderHook(() => usePOMutations(), { wrapper: w });

    await waitFor(() => expect(list.result.current.isLoading).toBe(false));

    const spy = vi
      .spyOn(procurementApi, "duplicatePurchaseOrder")
      .mockRejectedValueOnce(new Error("boom"));

    await act(async () => {
      await expect(mut.result.current.duplicate.mutateAsync("missing")).rejects.toThrow();
    });

    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(mut.result.current.duplicate.isPending).toBe(false);
    expect(mut.result.current.duplicate.isError).toBe(true);

    spy.mockRestore();
  });
});
