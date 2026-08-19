/**
 * The amendment workflow end to end, on the demo stores.
 *
 * The rule under test throughout: an amendment moves what the agreement
 * AUTHORISES. It never earns anything and never moves a payment — only
 * completing a milestone earns, and only recording a payment credits.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { demoContractsRepository as contracts } from "./demo/demo-repository";

const L = (lakhs: number) => lakhs * 100_000 * 100;

/** ₹60,00,000, six ₹10,00,000 slabs, Slab 1 complete, ₹8,00,000 credited. */
const STRUCTURE = "ag-structure";
/** ₹8,00,000 boundary wall. */
const WALL = "ag-compound-wall";

beforeEach(() => {
  localStorage.clear();
});

const recon = async (id: string) => (await contracts.getContract(id))!.contract.reconciliation;
/**
 * Propose, and return MY amendment. The seed already carries a proposed one on
 * Structure, so every lookup here is by reason — never "the first PROPOSED".
 */
async function propose(
  contractId: string,
  revisedAmountPaise: number,
  reason = "Additional authorised structural work",
) {
  const rows = await contracts.proposeAmendment({
    contractId,
    type: "VARIATION",
    revisedAmountPaise,
    reason,
    effectiveDate: "2026-05-20",
  });
  return rows.find((a) => a.reason === reason)!;
}

/* ── Proposal ───────────────────────────────────────────────────────────── */

describe("proposing an amendment", () => {
  it("records the delta and changes NOTHING about the agreement", async () => {
    const before = await recon(STRUCTURE);
    expect(before.currentContractValuePaise).toBe(L(60));

    const mine = await propose(STRUCTURE, L(65));
    expect(mine.status).toBe("PROPOSED");
    expect(mine.previousAmountPaise).toBe(L(60));
    expect(mine.revisedAmountPaise).toBe(L(65));
    expect(mine.deltaPaise).toBe(L(5));

    const after = await recon(STRUCTURE);
    expect(after.currentContractValuePaise).toBe(L(60));
    expect(after.originalContractValuePaise).toBe(L(60));
    expect(after.amendmentDeltaPaise).toBe(0);
    expect(after.earnedValuePaise).toBe(before.earnedValuePaise);
    expect(after.totalCreditedPaise).toBe(before.totalCreditedPaise);
    expect(after.currentDuePaise).toBe(before.currentDuePaise);
    expect(after.remainingUnearnedPaise).toBe(before.remainingUnearnedPaise);
  });

  it("does not raise the earned-value ceiling while it is only proposed", async () => {
    await propose(STRUCTURE, L(65));
    // Complete every remaining slab: earned reaches ₹60,00,000, the ceiling.
    for (const m of (await contracts.listMilestones(STRUCTURE)).filter((x) => x.status !== "COMPLETED")) {
      await contracts.setMilestoneStatus(m.id, "COMPLETED");
    }
    expect((await recon(STRUCTURE)).earnedValuePaise).toBe(L(60));

    // A seventh checkpoint is still refused — the pending +₹5,00,000 buys nothing.
    const [extra] = (
      await contracts.createMilestone({ contractId: STRUCTURE, title: "Extra", valuePaise: L(5) })
    ).filter((m) => m.title === "Extra");
    await expect(contracts.setMilestoneStatus(extra.id, "COMPLETED")).rejects.toThrow(
      "EARNED_VALUE_EXCEEDS_CONTRACT",
    );
  });

  it("supports a negative amendment", async () => {
    const mine = await propose(WALL, L(5), "Gate omitted from scope");
    expect(mine.deltaPaise).toBe(-L(3));
    expect((await recon(WALL)).currentContractValuePaise).toBe(L(8));
  });

  it("refuses a revision below what is already credited", async () => {
    // Compound Wall carries ₹3,00,000 of payments in the seed.
    const r = await recon(WALL);
    expect(r.totalCreditedPaise).toBe(L(3));
    await expect(propose(WALL, L(2), "Too far")).rejects.toThrow("REVISION_BELOW_CREDITED");
  });

  it("refuses a no-op revision", async () => {
    await expect(propose(STRUCTURE, L(60), "No change")).rejects.toThrow("NO_VALUE_CHANGE");
  });
});

/* ── Approval ───────────────────────────────────────────────────────────── */

describe("approving an amendment", () => {
  it("moves the authorised value once, leaving the original intact", async () => {
    const { id } = await propose(STRUCTURE, L(65));

    const after = await contracts.approveAmendment(id);
    expect(after.find((a) => a.id === id)!.status).toBe("APPROVED");

    const r = await recon(STRUCTURE);
    expect(r.originalContractValuePaise).toBe(L(60)); // never touched
    expect(r.amendmentDeltaPaise).toBe(L(5));
    expect(r.currentContractValuePaise).toBe(L(65));
  });

  it("changes authorised value but NOT earned or credited", async () => {
    const before = await recon(STRUCTURE);
    await contracts.approveAmendment((await propose(STRUCTURE, L(65))).id);
    const after = await recon(STRUCTURE);

    expect(after.earnedValuePaise).toBe(before.earnedValuePaise); // ₹10,00,000
    expect(after.totalCreditedPaise).toBe(before.totalCreditedPaise); // ₹8,00,000
    expect(after.currentDuePaise).toBe(before.currentDuePaise); // ₹2,00,000
    expect(after.advanceCreditPaise).toBe(before.advanceCreditPaise);
    // The whole delta lands on unearned work.
    expect(after.remainingUnearnedPaise).toBe(before.remainingUnearnedPaise + L(5));
  });

  it("raises the earned-value ceiling, so more work can now be recognised", async () => {
    for (const m of (await contracts.listMilestones(STRUCTURE)).filter((x) => x.status !== "COMPLETED")) {
      await contracts.setMilestoneStatus(m.id, "COMPLETED");
    }
    const [extra] = (
      await contracts.createMilestone({ contractId: STRUCTURE, title: "Extra", valuePaise: L(5) })
    ).filter((m) => m.title === "Extra");
    await expect(contracts.setMilestoneStatus(extra.id, "COMPLETED")).rejects.toThrow(
      "EARNED_VALUE_EXCEEDS_CONTRACT",
    );

    await contracts.approveAmendment((await propose(STRUCTURE, L(65))).id);

    // Now it fits.
    await expect(contracts.setMilestoneStatus(extra.id, "COMPLETED")).resolves.toBeDefined();
    expect((await recon(STRUCTURE)).earnedValuePaise).toBe(L(65));
  });

  it("recalculates milestone coverage from over-covered to exact", async () => {
    // ₹60,00,000 agreement with ₹65,00,000 planned → ₹5,00,000 over.
    await contracts.createMilestone({ contractId: STRUCTURE, title: "Lift room", valuePaise: L(5) });
    const before = await recon(STRUCTURE);
    expect(before.milestoneCoveragePaise).toBe(L(65));
    expect(before.milestoneCoverageVariancePaise).toBe(L(5));

    await contracts.approveAmendment((await propose(STRUCTURE, L(65))).id);

    const after = await recon(STRUCTURE);
    expect(after.milestoneCoveragePaise).toBe(L(65));
    expect(after.currentContractValuePaise).toBe(L(65));
    expect(after.milestoneCoverageVariancePaise).toBe(0);
  });

  it("refuses to approve the same amendment twice", async () => {
    const { id } = await propose(STRUCTURE, L(65));
    await contracts.approveAmendment(id);
    await expect(contracts.approveAmendment(id)).rejects.toThrow("AMENDMENT_NOT_PROPOSED");
    expect((await recon(STRUCTURE)).currentContractValuePaise).toBe(L(65));
  });
});

/* ── Staleness ──────────────────────────────────────────────────────────── */

describe("AMENDMENT_STALE", () => {
  it("refuses an amendment raised against a value that has since moved", async () => {
    // Two proposals, both against ₹60,00,000.
    const first = await propose(STRUCTURE, L(65), "First");
    const second = await propose(STRUCTURE, L(62), "Second");
    expect(second.previousAmountPaise).toBe(L(60));

    await contracts.approveAmendment(first.id);
    expect((await recon(STRUCTURE)).currentContractValuePaise).toBe(L(65));

    // The second would compound onto a base nobody saw: ₹62L was computed from ₹60L.
    await expect(contracts.approveAmendment(second.id)).rejects.toThrow("AMENDMENT_STALE");
  });

  it("leaves no partial update behind when it refuses", async () => {
    const first = await propose(STRUCTURE, L(65), "First");
    const second = await propose(STRUCTURE, L(62), "Second");
    await contracts.approveAmendment(first.id);
    await expect(contracts.approveAmendment(second.id)).rejects.toThrow("AMENDMENT_STALE");

    const rows = await contracts.listAmendments(STRUCTURE);
    expect(rows.find((a) => a.id === second.id)!.status).toBe("PROPOSED");
    expect((await recon(STRUCTURE)).currentContractValuePaise).toBe(L(65));
  });
});

/* ── Rejection ──────────────────────────────────────────────────────────── */

describe("rejecting an amendment", () => {
  it("keeps the record and moves no value", async () => {
    const before = await recon(STRUCTURE);
    const { id } = await propose(STRUCTURE, L(65));

    const after = await contracts.rejectAmendment(id, "Variation not agreed with the client");
    const kept = after.find((a) => a.id === id)!;
    expect(kept.status).toBe("REJECTED");
    expect(kept.rejectedReason).toBe("Variation not agreed with the client");
    expect(kept.deltaPaise).toBe(L(5)); // figures preserved

    const r = await recon(STRUCTURE);
    expect(r.currentContractValuePaise).toBe(before.currentContractValuePaise);
    expect(r.amendmentDeltaPaise).toBe(0);
  });

  it("requires a reason, and refuses to decide an already-decided amendment", async () => {
    const { id } = await propose(STRUCTURE, L(65));
    await expect(contracts.rejectAmendment(id, "  ")).rejects.toThrow("REASON_REQUIRED");
    await contracts.rejectAmendment(id, "No");
    await expect(contracts.approveAmendment(id)).rejects.toThrow("AMENDMENT_NOT_PROPOSED");
  });
});

/* ── The floor, re-checked at approval ──────────────────────────────────── */

describe("a reduction cannot land below what has been earned since", () => {
  it("refuses at APPROVAL time, not only at proposal time", async () => {
    // Legitimate when raised: ₹10,00,000 earned, reducing ₹60,00,000 → ₹30,00,000.
    const { id } = await propose(STRUCTURE, L(30), "Scope reduced");

    // Meanwhile the contractor earns past it — this does NOT make the amendment
    // stale, because the authorised value never moved.
    for (const m of (await contracts.listMilestones(STRUCTURE)).filter((x) => x.status !== "COMPLETED")) {
      await contracts.setMilestoneStatus(m.id, "COMPLETED");
    }
    expect((await recon(STRUCTURE)).earnedValuePaise).toBe(L(60));

    await expect(contracts.approveAmendment(id)).rejects.toThrow("REVISION_BELOW_EARNED");
    // Nothing moved: the agreement still authorises what it did.
    const r = await recon(STRUCTURE);
    expect(r.currentContractValuePaise).toBe(L(60));
    expect((await contracts.listAmendments(STRUCTURE)).find((a) => a.id === id)!.status).toBe(
      "PROPOSED",
    );
  });
});

/* ── Agreement lifecycle ────────────────────────────────────────────────── */

describe("agreement lifecycle", () => {
  it("refuses a proposal on a cancelled agreement", async () => {
    await contracts.cancelContract(WALL, "Client dropped the wall");
    await expect(propose(WALL, L(10), "Anything")).rejects.toThrow("AGREEMENT_CANCELLED");
  });

  it("refuses to approve a proposal raised before the agreement was cancelled", async () => {
    const { id } = await propose(WALL, L(10), "Extra gate");
    await contracts.cancelContract(WALL, "Client dropped the wall");
    await expect(contracts.approveAmendment(id)).rejects.toThrow("AGREEMENT_CANCELLED");
    expect((await recon(WALL)).currentContractValuePaise).toBe(L(8));
  });

  it("refuses to approve on a settled agreement — the close-out asserted a value", async () => {
    for (const m of (await contracts.listMilestones(STRUCTURE)).filter((x) => x.status !== "COMPLETED")) {
      await contracts.setMilestoneStatus(m.id, "COMPLETED");
    }
    const { id } = await propose(STRUCTURE, L(65));

    const r = await recon(STRUCTURE);
    await contracts.recordContractPayment({
      contractId: STRUCTURE,
      amountPaise: r.currentDuePaise,
      type: "FINAL",
      paymentMode: "BANK_TRANSFER",
      date: "2026-06-01",
    });
    await contracts.setContractStatus(STRUCTURE, "COMPLETED");
    await contracts.setContractStatus(STRUCTURE, "SETTLED");

    await expect(contracts.approveAmendment(id)).rejects.toThrow("AGREEMENT_SETTLED");
    expect((await recon(STRUCTURE)).currentContractValuePaise).toBe(L(60));
  });
});
