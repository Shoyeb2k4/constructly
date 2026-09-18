/**
 * The Material Master, as a user meets it.
 *
 * These tests assert what the screen OFFERS and what it SAYS — which controls
 * appear for which permissions, what reaches the repository when you search,
 * and that archiving is described as deactivation rather than deletion. The
 * domain rules are pinned on the server (see server/material-master-enforcement)
 * and nothing here re-tests them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { Permission } from "@/features/rbac/permissions";
import type { Material, MaterialFilters } from "../types";

const h = vi.hoisted(() => ({
  permissions: new Set<string>(),
  materials: [] as Material[],
  isLoading: false,
  lastFilters: null as MaterialFilters | null,
  setArchived: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/features/rbac/permission-context", () => ({
  useCan: () => (p: Permission) => h.permissions.has(p),
}));

vi.mock("../hooks", () => ({
  useMaterialCategories: () => ({ data: ["Cement", "Steel"] }),
  useMaterialMaster: (filters: MaterialFilters) => {
    h.lastFilters = filters;
    return { data: h.materials, isLoading: h.isLoading };
  },
  useMaterialMutations: () => ({
    create: { mutate: h.create, mutateAsync: h.create, isPending: false },
    update: { mutate: h.update, mutateAsync: h.update, isPending: false },
    setArchived: { mutate: h.setArchived, mutateAsync: h.setArchived, isPending: false },
  }),
}));

// The form has its own tests; here it only needs to announce which material the
// screen handed it.
vi.mock("./material-sheet", () => ({
  MaterialSheet: ({ open, material }: { open: boolean; material?: Material }) =>
    open ? <div data-testid="material-sheet">{material ? material.id : "new"}</div> : null,
}));

import { MaterialMasterView } from "./material-master-view";

const material = (over: Partial<Material> = {}): Material => ({
  id: "m1",
  name: "OPC 53 Grade Cement",
  category: "Cement",
  defaultUnit: "bag",
  hsnCode: "25232910",
  displayOrder: 0,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

function setup(permissions: Permission[], materials: Material[] = [material()]) {
  h.permissions = new Set(permissions);
  h.materials = materials;
  h.isLoading = false;
  return render(<MaterialMasterView />);
}

/** The desktop table, so assertions do not double-count the mobile card list. */
const table = () => within(screen.getByRole("table"));

/** Open the first row's action menu. Radix opens on pointerdown, not click. */
function openRowMenu() {
  const trigger = screen.getAllByRole("button", { name: /Actions for/i })[0];
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  return within(screen.getByRole("menu"));
}

beforeEach(() => {
  h.lastFilters = null;
  h.setArchived.mockReset();
  h.create.mockReset();
  h.update.mockReset();
});
afterEach(cleanup);

describe("viewing the catalogue", () => {
  it("lists a material with its category, unit and HSN", () => {
    setup(["materials.view"]);
    const t = table();
    expect(t.getByText("OPC 53 Grade Cement")).toBeTruthy();
    expect(t.getByText("Cement")).toBeTruthy();
    expect(t.getByText("bag")).toBeTruthy();
    expect(t.getByText("25232910")).toBeTruthy();
    expect(t.getByText("Active")).toBeTruthy();
  });

  it("explains how categories differ from materials", () => {
    setup(["materials.view"]);
    expect(screen.getByText(/Categories group materials/i)).toBeTruthy();
  });

  it("renders both the table and the card list, so narrow viewports work", () => {
    // DataTable keeps both in the DOM and swaps them with CSS, so the mobile
    // path is exercised by the same render rather than a separate component.
    setup(["materials.view"]);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Materials" })).toBeTruthy();
    expect(screen.getAllByText("OPC 53 Grade Cement").length).toBeGreaterThan(1);
  });

  it("shows a skeleton while loading rather than an empty state", () => {
    h.permissions = new Set(["materials.view"]);
    h.materials = [];
    h.isLoading = true;
    render(<MaterialMasterView />);
    expect(screen.queryByText(/No materials have been added yet/i)).toBeNull();
  });

  it("marks an archived material as archived", () => {
    setup(["materials.view"], [material({ isActive: false })]);
    expect(table().getByText("Archived")).toBeTruthy();
  });
});

describe("search and filters", () => {
  it("passes the search term to the repository, not a client-side filter", () => {
    setup(["materials.view"]);
    fireEvent.change(screen.getByLabelText("Search materials"), { target: { value: "cem" } });
    expect(h.lastFilters).toMatchObject({ search: "cem" });
  });

  it("sends no search key for whitespace", () => {
    setup(["materials.view"]);
    fireEvent.change(screen.getByLabelText("Search materials"), { target: { value: "   " } });
    expect(h.lastFilters!.search).toBeUndefined();
  });

  it("asks only for active materials by default", () => {
    setup(["materials.view"]);
    expect(h.lastFilters).toMatchObject({ includeArchived: false, category: "ALL" });
  });

  it("says so when a search matches nothing, without looking like a failure", () => {
    setup(["materials.view"], []);
    fireEvent.change(screen.getByLabelText("Search materials"), { target: { value: "zzz" } });
    expect(screen.getByText(/No materials match this search/i)).toBeTruthy();
  });
});

describe("empty state", () => {
  it("invites a creator to add the first material", () => {
    setup(["materials.view", "materials.create"], []);
    expect(screen.getByText(/No materials have been added yet/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add your first material/i })).toBeTruthy();
  });

  it("tells a read-only user who to ask instead", () => {
    setup(["materials.view"], []);
    expect(screen.getByText(/No materials have been added yet/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add your first material/i })).toBeNull();
    expect(screen.getByText(/Ask someone with material management access/i)).toBeTruthy();
  });
});

describe("permission-aware controls", () => {
  it("offers Add material only with materials.create", () => {
    setup(["materials.view", "materials.create"]);
    expect(screen.getByRole("button", { name: /Add material/i })).toBeTruthy();

    cleanup();
    setup(["materials.view"]);
    expect(screen.queryByRole("button", { name: /Add material/i })).toBeNull();
  });

  it("gives a view-only user no row actions at all", () => {
    setup(["materials.view"]);
    expect(screen.queryByRole("button", { name: /Actions for/i })).toBeNull();
  });

  it("offers Edit with materials.edit", () => {
    setup(["materials.view", "materials.edit"]);
    const menu = openRowMenu();
    expect(menu.getByText("Edit")).toBeTruthy();
    expect(menu.queryByText("Archive")).toBeNull();
  });

  it("offers Archive with materials.archive", () => {
    setup(["materials.view", "materials.archive"]);
    const menu = openRowMenu();
    expect(menu.getByText("Archive")).toBeTruthy();
    expect(menu.queryByText("Edit")).toBeNull();
  });

  it("offers Restore instead of Archive on an archived material", () => {
    setup(["materials.view", "materials.archive"], [material({ isActive: false })]);
    expect(openRowMenu().getByText("Restore")).toBeTruthy();
  });
});

describe("creating and editing", () => {
  it("opens an empty form from Add material", () => {
    setup(["materials.view", "materials.create"]);
    fireEvent.click(screen.getByRole("button", { name: /Add material/i }));
    expect(screen.getByTestId("material-sheet").textContent).toBe("new");
  });

  it("hands the chosen material to the form when editing", () => {
    setup(["materials.view", "materials.edit"], [material({ id: "m-42" })]);
    fireEvent.click(openRowMenu().getByText("Edit"));
    expect(screen.getByTestId("material-sheet").textContent).toBe("m-42");
  });
});

describe("archiving is not deleting", () => {
  function openArchiveDialog(m: Material = material()) {
    setup(["materials.view", "materials.archive"], [m]);
    fireEvent.click(openRowMenu().getByText(m.isActive ? "Archive" : "Restore"));
  }

  it("asks for confirmation before archiving", () => {
    openArchiveDialog();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(h.setArchived).not.toHaveBeenCalled();
  });

  it("describes deactivation, and never says the material is deleted", () => {
    openArchiveDialog();
    const dialog = screen.getByRole("dialog").textContent ?? "";
    expect(dialog).toMatch(/stops appearing/i);
    expect(dialog).toMatch(/Nothing is deleted/i);
    expect(dialog).toMatch(/existing purchase orders keep/i);
    expect(dialog).toMatch(/restore it at any time/i);
    // The word that would make this a different, scarier action.
    expect(dialog).not.toMatch(/permanently/i);
  });

  it("archives only after the user confirms", () => {
    openArchiveDialog();
    fireEvent.click(screen.getByRole("button", { name: /Archive material/i }));
    expect(h.setArchived).toHaveBeenCalledWith(
      { id: "m1", archived: true },
      expect.anything(),
    );
  });

  it("does nothing when the user cancels", () => {
    openArchiveDialog();
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(h.setArchived).not.toHaveBeenCalled();
  });

  it("restores an archived material, with wording about availability", () => {
    openArchiveDialog(material({ isActive: false }));
    const dialog = screen.getByRole("dialog").textContent ?? "";
    expect(dialog).toMatch(/available again/i);

    fireEvent.click(screen.getByRole("button", { name: /Restore material/i }));
    expect(h.setArchived).toHaveBeenCalledWith(
      { id: "m1", archived: false },
      expect.anything(),
    );
  });
});
