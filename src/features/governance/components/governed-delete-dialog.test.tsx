/**
 * The dialog's whole job is to stop a screen from promising the wrong outcome,
 * so the tests are about what it refuses to render: no destructive button for a
 * refusal, no "delete" wording on a reversal, and no button at all once the
 * screen has found a concrete blocker.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { GovernedDeleteDialog } from "./governed-delete-dialog";

afterEach(cleanup);

describe("the governed delete dialog", () => {
  it("offers no destructive button for an entity the domain refuses", () => {
    const onConfirm = vi.fn();
    render(
      <GovernedDeleteDialog
        entity="vendorPayment"
        open
        onOpenChange={() => {}}
        onConfirm={onConfirm}
        subject="UltraTech Cement"
      />,
    );
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Got it" })).toBeTruthy();
    // The dialog's own dismiss control is the only thing named "Close".
    expect(screen.getAllByRole("button", { name: /close/i })).toHaveLength(1);
    // And it says why, in the policy's words rather than the screen's.
    expect(screen.getByText(/known gap/i)).toBeTruthy();
  });

  it("labels a reversal a reversal", () => {
    render(
      <GovernedDeleteDialog
        entity="settlement"
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /reverse settlement/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^delete/i })).toBeNull();
  });

  it("withdraws the button when the screen reports a blocker", () => {
    render(
      <GovernedDeleteDialog
        entity="purchaseOrder"
        open
        onOpenChange={() => {}}
        blockedReason="2 payments have been recorded against this order."
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText(/2 payments have been recorded/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /delete purchase order/i })).toBeNull();
  });

  it("still deletes where deleting is the honest outcome", () => {
    const onConfirm = vi.fn();
    render(
      <GovernedDeleteDialog
        entity="purchaseOrder"
        open
        onOpenChange={() => {}}
        onConfirm={onConfirm}
        subject="PO-0231"
      />,
    );
    const btn = screen.getByRole("button", { name: /delete purchase order/i });
    btn.click();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("says so when the outcome can be undone, and stays quiet when it can't", () => {
    render(
      <GovernedDeleteDialog entity="project" open onOpenChange={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.getByText(/can be undone/i)).toBeTruthy();
    cleanup();
    render(
      <GovernedDeleteDialog
        entity="purchaseOrder"
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByText(/can be undone/i)).toBeNull();
  });
});
