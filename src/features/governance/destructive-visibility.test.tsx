/**
 * Who sees a destructive control, and what it promises them.
 *
 * The Owner is meant to find the destructive action everywhere it exists — the
 * whole point of Phase 8.5's first workstream. That makes the opposite question
 * sharper, not softer: everyone else must still be gated, and the Owner's extra
 * visibility must never become extra power over financial history.
 *
 * These are UI-affordance tests. The server re-checks every one of them; a
 * hidden button is a courtesy, never a control.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PermissionProvider } from "@/features/rbac/permission-context";
import { GovernedDeleteDialog } from "./components/governed-delete-dialog";
import { DELETE_POLICY, type GovernedEntity } from "./delete-policy";

afterEach(cleanup);

const as = (permissions: string[], isOwner = false, children: React.ReactNode) =>
  render(
    <PermissionProvider permissions={permissions} isOwner={isOwner}>
      {children}
    </PermissionProvider>,
  );

describe("the destructive dialog never over-promises", () => {
  it("offers no confirm for any entity the domain refuses, whoever is looking", () => {
    const refusing = (Object.keys(DELETE_POLICY) as GovernedEntity[]).filter(
      (k) => DELETE_POLICY[k].outcome === "REFUSE",
    );
    expect(refusing.length).toBeGreaterThan(0);

    for (const entity of refusing) {
      const onConfirm = vi.fn();
      // Rendered for the most powerful user there is.
      as(["payments.delete", "contractors.archive"], true,
        <GovernedDeleteDialog entity={entity} open onOpenChange={() => {}} onConfirm={onConfirm} />,
      );
      const confirm = screen.queryByRole("button", { name: new RegExp(DELETE_POLICY[entity].label, "i") });
      expect(confirm, `${entity} offered a confirm to the Owner`).toBeNull();
      cleanup();
    }
  });

  it("names a reversal a reversal even for the Owner", () => {
    as([], true,
      <GovernedDeleteDialog entity="settlement" open onOpenChange={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /reverse settlement/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("withdraws the confirm the moment the screen finds a blocker", () => {
    const onConfirm = vi.fn();
    as([], true,
      <GovernedDeleteDialog
        entity="purchaseOrder"
        open
        onOpenChange={() => {}}
        blockedReason="2 payments have been recorded against this order."
        onConfirm={onConfirm}
      />,
    );
    expect(screen.queryByRole("button", { name: /delete purchase order/i })).toBeNull();
    expect(screen.getByText(/2 payments/)).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("says what the audit rule is, in the dialog, for the Owner", () => {
    as([], true,
      <GovernedDeleteDialog entity="activityLog" open onOpenChange={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.getByText(/including the Owner/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
});
