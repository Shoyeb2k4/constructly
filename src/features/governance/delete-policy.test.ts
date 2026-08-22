import { describe, it, expect, beforeEach } from "vitest";
import {
  DELETE_POLICY,
  FINANCIAL_HISTORY_ENTITIES,
  deletePolicy,
  destroysHistory,
  type GovernedEntity,
} from "./delete-policy";
import { demoProcurementRepository } from "@/features/procurement/demo/demo-repository";
import { demoContractorsRepository } from "@/features/contractors/demo/demo-repository";
import { demoRolesRepository, resetDemoRoles } from "@/features/rbac/demo/demo-repository";
import { demoTeamRepository, resetDemoTeam } from "@/features/team/demo/demo-repository";
import { getPayments } from "@/features/payments/data";
import { paymentsVisibilityFor } from "@/features/payments/visibility";
import { summarisePayments } from "@/features/payments/assemble";
import { resolvePeriod } from "@/lib/period";
import { demoSpendByProject } from "@/features/budget/spend";
import { ALL_PERMISSIONS } from "@/features/rbac/permissions";
import type { SessionUser } from "@/lib/auth/types";

/**
 * Deletion must never change what already happened.
 *
 * The Owner is the most powerful role in the product and can reach every
 * destructive control — which is exactly why these exist. Power to remove an
 * operational record is not power to rewrite the financial past, and the
 * difference has to be enforced rather than assumed.
 */

const OWNER: SessionUser = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "owner@demo.constructly.app",
  fullName: "Aarav Mehta",
  role: "OWNER",
  isOwner: true,
  permissions: [...ALL_PERMISSIONS],
  company: { id: "co", name: "Demo" },
};

beforeEach(() => {
  localStorage.clear();
  resetDemoRoles();
  resetDemoTeam();
});

/* ── The matrix itself ───────────────────────────────────────────────── */

describe("the governed delete matrix", () => {
  it("gives every entity an outcome, a label and an explanation", () => {
    for (const key of Object.keys(DELETE_POLICY) as GovernedEntity[]) {
      const p = deletePolicy(key);
      expect(p.label, `${key} has no label`).toBeTruthy();
      // The explanation ends up in a confirmation dialog, so it has to be a
      // sentence a person can act on, not a shrug.
      expect(p.explains.length, `${key} has no explanation`).toBeGreaterThan(40);
      expect(p.explains, `${key}'s explanation is not a sentence`).toMatch(/[.]$/);
    }
  });

  it("never labels a reversal as a deletion", () => {
    for (const key of Object.keys(DELETE_POLICY) as GovernedEntity[]) {
      const p = deletePolicy(key);
      if (p.outcome === "REVERSE") {
        expect(p.label.toLowerCase(), `${key} calls a reversal "delete"`).toContain("reverse");
        expect(p.label.toLowerCase()).not.toContain("delete");
      }
    }
  });

  it("lets nothing that holds financial history be destroyed", () => {
    for (const key of FINANCIAL_HISTORY_ENTITIES) {
      expect(destroysHistory(key), `${key} can be hard-deleted with no blocker`).toBe(false);
      expect(
        ["REVERSE", "REFUSE"],
        `${key} resolves to ${deletePolicy(key).outcome}`,
      ).toContain(deletePolicy(key).outcome);
    }
  });

  it("gives every hard delete a blocker unless the record is genuinely inert", () => {
    // The only records that may vanish without a guard are ones that carry no
    // history at all: a reminder, an unaccepted invitation.
    const inert: GovernedEntity[] = ["projectDeadline", "invitation"];
    for (const key of Object.keys(DELETE_POLICY) as GovernedEntity[]) {
      const p = deletePolicy(key);
      if (p.outcome !== "HARD_DELETE") continue;
      if (inert.includes(key)) continue;
      expect(p.blockers.length, `${key} hard-deletes with no blockers`).toBeGreaterThan(0);
    }
  });

  it("holds audit history as never deletable, by anyone", () => {
    const audit = deletePolicy("activityLog");
    expect(audit.outcome).toBe("REFUSE");
    expect(audit.explains).toMatch(/including the Owner/i);
  });
});

/* ── Vendor payments: the hole that was open ─────────────────────────── */

describe("a recorded vendor payment cannot be destroyed", () => {
  it("refuses deletion and leaves the row in place", async () => {
    const before = await demoProcurementRepository.listPayments({});
    const created = await demoProcurementRepository.createPayment({
      vendorId: before[0].vendor.id,
      projectId: before[0].project.id,
      purchaseOrderId: null,
      amountPaise: 250_000,
      paymentMode: "CASH",
      date: "2026-08-14",
    });
    await expect(demoProcurementRepository.deletePayment(created.id)).rejects.toThrow(
      "VENDOR_PAYMENT_IMMUTABLE",
    );
    const after = await demoProcurementRepository.listPayments({});
    expect(after.find((p) => p.id === created.id)).toBeTruthy();
  });

  it("leaves the Payments centre's cash total untouched by an attempted delete", async () => {
    const period = resolvePeriod("ALL_TIME", "2026-08-21");
    const read = async () => {
      const snap = await getPayments({
        userId: OWNER.id,
        isOwner: true,
        visibility: paymentsVisibilityFor(OWNER),
        from: period.from,
        to: period.to,
      });
      return summarisePayments(snap.transactions, period).paidPaise;
    };

    const payments = await demoProcurementRepository.listPayments({});
    const target = payments[0];
    const paidBefore = await read();
    expect(paidBefore).toBeGreaterThan(0);

    await expect(demoProcurementRepository.deletePayment(target.id)).rejects.toThrow();

    // The figure the whole Payments centre and every report rests on is the
    // same afterwards. This is the assertion the old hard delete would fail.
    expect(await read()).toBe(paidBefore);
  });

  it("keeps a purchase order that has been paid against", async () => {
    // Deleting it nulls the payment's PO link (schema: SetNull) and takes the
    // ordered value out of the budget — the cash stays, what it bought does not.
    const pos = await demoProcurementRepository.listPurchaseOrders();
    const paid = pos.find((p) => p.paidPaise > 0)!;
    expect(paid).toBeTruthy();
    await expect(demoProcurementRepository.deletePurchaseOrder(paid.id)).rejects.toThrow(
      "PO_HAS_PAYMENTS",
    );
    expect((await demoProcurementRepository.getPurchaseOrder(paid.id))!.id).toBe(paid.id);
    expect(deletePolicy("purchaseOrder").blockers).toContain("PO_HAS_PAYMENTS");
  });

  it("still deletes an order nothing has been paid against", async () => {
    const draft = await demoProcurementRepository.createPurchaseOrder({
      vendorId: "40000000-0000-0000-0000-0000000000v1",
      projectId: "10000000-0000-0000-0000-000000000001",
      purchaseDate: "2026-08-14",
      lineItems: [
        { material: "Cement", category: "Cement", quantity: 1, unit: "bag", ratePaise: 38000, gstRateBps: 0 },
      ],
    });
    await expect(
      demoProcurementRepository.deletePurchaseOrder(draft.id),
    ).resolves.toBeUndefined();
  });

  it("says so honestly in the policy rather than hiding the gap", () => {
    const p = deletePolicy("vendorPayment");
    expect(p.outcome).toBe("REFUSE");
    expect(p.explains).toMatch(/known gap/i);
    expect(p.explains).toMatch(/no reversal/i);
  });
});

/* ── Refusals leave the numbers exactly where they were ──────────────── */

/**
 * The point of a refusal is not the error message — it is that nothing moved.
 * A guard that throws AFTER a partial write would pass every test above and
 * still corrupt the books, so these read the canonical figure on both sides.
 */
describe("a refused delete changes no financial total", () => {
  it("leaves procurement spend untouched when a paid-against order is refused", async () => {
    const pos = await demoProcurementRepository.listPurchaseOrders();
    const paid = pos.find((p) => p.paidPaise > 0)!;
    const spendOf = () =>
      demoSpendByProject().get(paid.project.id)?.procurementPaise ?? 0;

    const before = spendOf();
    expect(before).toBeGreaterThan(0);
    await expect(demoProcurementRepository.deletePurchaseOrder(paid.id)).rejects.toThrow(
      "PO_HAS_PAYMENTS",
    );
    expect(spendOf()).toBe(before);

    // And the order is still there to account for the cash that was paid.
    const still = await demoProcurementRepository.getPurchaseOrder(paid.id);
    expect(still!.totalPaise).toBe(paid.totalPaise);
    expect(still!.paidPaise).toBe(paid.paidPaise);
  });

  it("leaves the vendor's outstanding untouched when a payment delete is refused", async () => {
    const payments = await demoProcurementRepository.listPayments({});
    const target = payments[0];
    const outstandingOf = async () =>
      (await demoProcurementRepository.getVendor(target.vendor.id))!.outstandingPaise;

    const before = await outstandingOf();
    await expect(demoProcurementRepository.deletePayment(target.id)).rejects.toThrow();
    expect(await outstandingOf()).toBe(before);
  });
});

/* ── Contractor cash ─────────────────────────────────────────────────── */

describe("contractor cash survives every destructive control", () => {
  it("has no path that removes a recorded advance", () => {
    // The ledger is append-only by construction: there is no delete on the
    // repository at all, and the policy says why.
    expect("recordAdvance" in demoContractorsRepository).toBe(true);
    expect(Object.keys(demoContractorsRepository)).not.toContain("deleteAdvance");
    expect(Object.keys(demoContractorsRepository)).not.toContain("removeLedgerEntry");
    expect(deletePolicy("advance").outcome).toBe("REFUSE");
  });

  it("archives a contractor rather than erasing their history", async () => {
    const contractors = await demoContractorsRepository.listContractors({});
    const target = contractors.find((c) => c.advanceBalancePaise > 0) ?? contractors[0];
    const ledgerBefore = (await demoContractorsRepository.getLedger(target.id)).entries.length;

    await demoContractorsRepository.archiveContractor(target.id);

    const after = await demoContractorsRepository.getLedger(target.id);
    // Archive is not deletion: every entry is still there, and the balance is
    // unchanged.
    expect(after.entries.length).toBe(ledgerBefore);
    expect(after.contractor.advanceBalancePaise).toBe(target.advanceBalancePaise);
    expect(after.contractor.status).toBe("INACTIVE");
    expect(deletePolicy("contractor").outcome).toBe("ARCHIVE");
    expect(deletePolicy("contractor").recoverable).toBe(true);
  });

  it("corrects a settlement by reversing it, never by removing it", () => {
    const p = deletePolicy("settlement");
    expect(p.outcome).toBe("REVERSE");
    expect(p.label).toBe("Reverse settlement");
    expect(p.explains).toMatch(/stays visible/i);
  });

  it("corrects an agreement payment the same way", () => {
    const p = deletePolicy("agreementPayment");
    expect(p.outcome).toBe("REVERSE");
    expect(p.explains).toMatch(/original amount/i);
  });

  it("refuses to reverse a re-scope whose money has been consumed", () => {
    expect(deletePolicy("advanceRescope").blockers).toContain("RESCOPE_CONSUMED");
  });
});

/* ── Rates and attendance ────────────────────────────────────────────── */

describe("historical pricing cannot be rewritten", () => {
  it("keeps rate revisions append-only", () => {
    const p = deletePolicy("rateRevision");
    expect(p.outcome).toBe("REFUSE");
    expect(p.explains).toMatch(/append-only/i);
    expect(p.explains).toMatch(/reprice/i);
  });

  it("refuses to clear attendance a settlement has recognised", () => {
    const p = deletePolicy("attendance");
    expect(p.blockers).toContain("ATTENDANCE_SETTLED");
    expect(p.explains).toMatch(/reverse the settlement/i);
  });

  it("refuses to remove a scope item that priced real work", () => {
    expect(deletePolicy("scopeItem").blockers).toContain("SCOPE_IN_USE");
  });
});

/* ── Agreements, milestones, amendments ──────────────────────────────── */

describe("agreement history is preserved", () => {
  it("blocks deleting an agreement that carries financial history", () => {
    expect(deletePolicy("agreement").blockers).toContain("HAS_FINANCIAL_HISTORY");
    expect(deletePolicy("agreement").outcome).toBe("SOFT_DELETE");
  });

  it("offers cancel as the path for one that does", () => {
    expect(deletePolicy("agreementCancel").outcome).toBe("CANCEL");
    expect(deletePolicy("agreementCancel").explains).toMatch(/keeps everything already recorded/i);
  });

  it("blocks deleting a milestone that has started or been paid", () => {
    const p = deletePolicy("milestone");
    expect(p.blockers).toEqual(
      expect.arrayContaining(["MILESTONE_HAS_HISTORY", "MILESTONE_HAS_PAYMENTS"]),
    );
  });

  it("keeps an approved amendment, which already moved the authorised value", () => {
    expect(deletePolicy("amendment").blockers).toContain("AMENDMENT_APPROVED");
  });
});

/* ── Administration ──────────────────────────────────────────────────── */

describe("administration limits hold for the Owner too", () => {
  it("will not remove the last active owner", async () => {
    const members = await demoTeamRepository.listMembers();
    const owner = members.find((m) => m.role === "OWNER")!;
    await expect(demoTeamRepository.removeMember(owner.id)).rejects.toThrow();
    await expect(demoTeamRepository.setMemberStatus(owner.id, "DISABLED")).rejects.toThrow();
    await expect(demoTeamRepository.changeMemberRole(owner.id, "PROJECT_MANAGER")).rejects.toThrow();
  });

  it("will not let anyone remove themselves", async () => {
    const members = await demoTeamRepository.listMembers();
    const self = members.find((m) => m.isSelf)!;
    await expect(demoTeamRepository.removeMember(self.id)).rejects.toThrow();
  });

  it("will not delete a built-in role", async () => {
    const roles = await demoRolesRepository.listRoles();
    for (const r of roles.filter((x) => x.isSystem)) {
      await expect(demoRolesRepository.deleteRole(r.id)).rejects.toThrow("PROTECTED_ROLE");
    }
    expect(deletePolicy("builtInRole").outcome).toBe("REFUSE");
  });

  it("deletes a custom role only when nobody holds it", async () => {
    const custom = await demoRolesRepository.createRole({ name: "Temp Reviewer" });
    await expect(demoRolesRepository.deleteRole(custom.id)).resolves.toBeUndefined();
    expect(deletePolicy("customRole").blockers).toContain("ROLE_IN_USE");
  });
});
