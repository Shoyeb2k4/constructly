/**
 * Repository-level agreement behaviour, exercised through the demo store.
 *
 * The demo repository calls the SAME pure engine as the server, so these cover
 * the isolation and governance rules end to end without a database: multiple
 * agreements on one project, cross-project separation, the two ceilings,
 * deletion governance and reversal.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { demoContractsRepository as repo, DEMO_IDS } from "./demo/demo-repository";
import { RS_2L, RS_3L, RS_6L, RS_8L, RS_10L, RS_50L, RS_52L, RS_60L, lakhs } from "./__fixtures__/amounts";

const { STRUCTURE, COMPOUND_WALL, FINISHING, ORION_AGREEMENT, PAPPU, PROJECT_A, ORION } = DEMO_IDS;

beforeEach(() => {
  // Each test starts from the seeded acceptance case.
  if (typeof window !== "undefined") window.localStorage.clear();
});

describe("seeded authoritative case", () => {
  it("Structure reconciles to earned ₹10,00,000 / credited ₹8,00,000 / due ₹2,00,000", async () => {
    const detail = await repo.getContract(STRUCTURE);
    const r = detail!.contract.reconciliation;

    expect(detail!.contract.currentAmountPaise).toBe(RS_60L);
    expect(r.earnedValuePaise).toBe(RS_10L);
    expect(r.attendanceCreditPaise).toBe(RS_6L);
    expect(r.otherPaymentCreditPaise).toBe(RS_2L);
    expect(r.totalCreditedPaise).toBe(RS_8L);
    expect(r.currentDuePaise).toBe(RS_2L);
    expect(r.advanceCreditPaise).toBe(0);
    expect(r.remainingUnearnedPaise).toBe(RS_50L);
    expect(r.overallBalancePaise).toBe(RS_52L);
  });

  it("counts six milestones with one complete", async () => {
    const milestones = await repo.listMilestones(STRUCTURE);
    expect(milestones).toHaveLength(6);
    expect(milestones.filter((m) => m.status === "COMPLETED")).toHaveLength(1);
    expect(milestones[0].title).toBe("Slab 1");
    expect(milestones[0].financialStateAtCompletion).toBe("DUE");
    // ₹8,00,000 credited against a ₹10,00,000 threshold — still short today too.
    expect(milestones[0].currentCoverageState).toBe("DUE");
  });

  it("excludes the reversed payment from credit", async () => {
    const detail = await repo.getContract(STRUCTURE);
    const reversed = detail!.payments.find((p) => p.reversedAt != null);
    expect(reversed).toBeDefined();
    expect(reversed!.reversalReason).toContain("Duplicate");
    // ₹1,00,000 reversed, so only the ₹2,00,000 live payment counts.
    expect(detail!.contract.reconciliation.otherPaymentCreditPaise).toBe(RS_2L);
  });

  it("reports unsettled labour without letting it reduce the due", async () => {
    const r = (await repo.getContract(STRUCTURE))!.contract.reconciliation;
    expect(r.unsettledAttendancePaise).toBe(lakhs(1));
    expect(r.currentDuePaise).toBe(RS_2L); // not ₹1,00,000
  });
});

describe("multi-agreement isolation on one project", () => {
  it("keeps Structure's due and Compound Wall's advance separate", async () => {
    const structure = (await repo.getContract(STRUCTURE))!.contract.reconciliation;
    const wall = (await repo.getContract(COMPOUND_WALL))!.contract.reconciliation;

    expect(structure.currentDuePaise).toBe(RS_2L);
    expect(structure.advanceCreditPaise).toBe(0);
    expect(wall.currentDuePaise).toBe(0);
    expect(wall.advanceCreditPaise).toBe(RS_3L);
  });

  it("a payment on one agreement never moves the other", async () => {
    const before = (await repo.getContract(COMPOUND_WALL))!.contract.reconciliation;
    await repo.recordContractPayment({
      contractId: STRUCTURE,
      amountPaise: RS_2L,
      type: "INTERIM",
      paymentMode: "BANK_TRANSFER",
      date: "2026-05-01",
    });
    const after = (await repo.getContract(COMPOUND_WALL))!.contract.reconciliation;
    expect(after).toEqual(before);
  });

  it("the project summary shows Due and Ahead side by side, never netted", async () => {
    const rows = await repo.projectContractsSummary(PROJECT_A);
    const pappu = rows.find((r) => r.contractorId === PAPPU)!;

    // Structure ₹2,00,000 due; Compound Wall ₹3,00,000 ahead; Finishing has its
    // own position. Due must be the SUM of per-agreement dues.
    expect(pappu.currentDuePaise).toBeGreaterThan(0);
    expect(pappu.advanceCreditPaise).toBeGreaterThanOrEqual(RS_3L);

    const naive = Math.max(0, pappu.earnedPaise - pappu.creditedPaise);
    expect(pappu.currentDuePaise).toBeGreaterThanOrEqual(naive);
  });
});

describe("cross-project isolation", () => {
  it("a payment on Project A leaves the Orion agreement untouched", async () => {
    const before = (await repo.getContract(ORION_AGREEMENT))!.contract.reconciliation;
    await repo.recordContractPayment({
      contractId: STRUCTURE,
      amountPaise: RS_2L,
      type: "INTERIM",
      paymentMode: "CASH",
      date: "2026-05-02",
    });
    const after = (await repo.getContract(ORION_AGREEMENT))!.contract.reconciliation;
    expect(after).toEqual(before);
  });

  it("groups a contractor's agreements by project", async () => {
    const profile = await repo.getContractorProfile(PAPPU);
    const projectIds = profile!.projects.map((p) => p.projectId).sort();
    expect(projectIds).toEqual([ORION, PROJECT_A].sort());
  });

  it("the lifetime roll-up sums due and ahead rather than netting them", async () => {
    const profile = await repo.getContractorProfile(PAPPU);
    const { lifetime, projects } = profile!;

    const sumDue = projects.flatMap((p) => p.contracts).reduce((a, c) => a + c.reconciliation.currentDuePaise, 0);
    const sumAhead = projects
      .flatMap((p) => p.contracts)
      .reduce((a, c) => a + c.reconciliation.advanceCreditPaise, 0);

    expect(lifetime.totalCurrentDuePaise).toBe(sumDue);
    expect(lifetime.totalAdvanceCreditPaise).toBe(sumAhead);
    // Both are real at once — an advance elsewhere doesn't settle a liability here.
    expect(lifetime.totalCurrentDuePaise).toBeGreaterThan(0);
    expect(lifetime.totalAdvanceCreditPaise).toBeGreaterThan(0);
  });
});

describe("credit ceiling", () => {
  it("accepts a payment inside the authorised value", async () => {
    const detail = await repo.recordContractPayment({
      contractId: STRUCTURE,
      amountPaise: RS_2L,
      type: "INTERIM",
      paymentMode: "BANK_TRANSFER",
      date: "2026-05-03",
    });
    expect(detail.contract.reconciliation.totalCreditedPaise).toBe(RS_10L);
    expect(detail.contract.reconciliation.currentDuePaise).toBe(0);
  });

  it("accepts paying AHEAD of earned work", async () => {
    await repo.recordContractPayment({
      contractId: STRUCTURE,
      amountPaise: RS_2L,
      type: "INTERIM",
      paymentMode: "BANK_TRANSFER",
      date: "2026-05-03",
    });
    const detail = await repo.recordContractPayment({
      contractId: STRUCTURE,
      amountPaise: RS_2L,
      type: "INTERIM",
      paymentMode: "BANK_TRANSFER",
      date: "2026-05-04",
    });
    // Earned ₹10,00,000, credited ₹12,00,000 ⇒ ₹2,00,000 ahead, nothing due.
    expect(detail.contract.reconciliation.totalCreditedPaise).toBe(lakhs(12));
    expect(detail.contract.reconciliation.currentDuePaise).toBe(0);
    expect(detail.contract.reconciliation.advanceCreditPaise).toBe(RS_2L);
  });

  it("refuses a payment that would exceed the authorised value", async () => {
    await expect(
      repo.recordContractPayment({
        contractId: STRUCTURE,
        amountPaise: lakhs(55), // ₹8L already credited ⇒ would reach ₹63,00,000
        type: "FINAL",
        paymentMode: "BANK_TRANSFER",
        date: "2026-05-05",
      }),
    ).rejects.toThrow("CREDIT_EXCEEDS_CONTRACT_VALUE");
  });

  it("allows the same payment once an amendment raises the value", async () => {
    await repo.proposeAmendment({
      contractId: STRUCTURE,
      type: "VARIATION",
      revisedAmountPaise: lakhs(70),
      reason: "Additional floors",
      effectiveDate: "2026-06-01",
    });
    const amendments = await repo.listAmendments(STRUCTURE);
    const proposed = amendments.find((a) => a.revisedAmountPaise === lakhs(70))!;
    await repo.approveAmendment(proposed.id);

    const detail = await repo.recordContractPayment({
      contractId: STRUCTURE,
      amountPaise: lakhs(55),
      type: "FINAL",
      paymentMode: "BANK_TRANSFER",
      date: "2026-05-05",
    });
    expect(detail.contract.currentAmountPaise).toBe(lakhs(70));
    expect(detail.contract.reconciliation.totalCreditedPaise).toBe(lakhs(63));
  });

  it("dedupes a repeated submit carrying the same idempotency key", async () => {
    const key = "11111111-1111-4111-8111-111111111111";
    const input = {
      contractId: STRUCTURE,
      amountPaise: RS_2L,
      type: "INTERIM" as const,
      paymentMode: "BANK_TRANSFER" as const,
      date: "2026-05-06",
      clientUuid: key,
    };
    const first = await repo.recordContractPayment(input);
    const second = await repo.recordContractPayment(input);
    expect(second.contract.reconciliation.totalCreditedPaise).toBe(
      first.contract.reconciliation.totalCreditedPaise,
    );
  });
});

describe("earned-value ceiling", () => {
  it("refuses to complete a milestone past the authorised value", async () => {
    // Structure is ₹60,00,000 with six ₹10,00,000 slabs. Inflate one, then try
    // to complete it on top of the ₹10,00,000 already earned.
    await repo.updateMilestone("ms-slab-2", { valuePaise: lakhs(55) });
    await expect(repo.setMilestoneStatus("ms-slab-2", "COMPLETED")).rejects.toThrow(
      "EARNED_VALUE_EXCEEDS_CONTRACT",
    );
  });

  it("completes normally inside the authorised value", async () => {
    const milestones = await repo.setMilestoneStatus("ms-slab-2", "COMPLETED");
    const slab2 = milestones.find((m) => m.id === "ms-slab-2")!;
    expect(slab2.status).toBe("COMPLETED");

    const r = (await repo.getContract(STRUCTURE))!.contract.reconciliation;
    expect(r.earnedValuePaise).toBe(lakhs(20));
    expect(r.currentDuePaise).toBe(lakhs(12)); // ₹20L earned − ₹8L credited
  });
});

describe("amendments", () => {
  it("a proposal does not move the authorised value until approved", async () => {
    await repo.proposeAmendment({
      contractId: STRUCTURE,
      type: "VARIATION",
      revisedAmountPaise: lakhs(65),
      reason: "Extra staircase",
      effectiveDate: "2026-06-01",
    });
    expect((await repo.getContract(STRUCTURE))!.contract.currentAmountPaise).toBe(RS_60L);

    const proposed = (await repo.listAmendments(STRUCTURE)).find(
      (a) => a.revisedAmountPaise === lakhs(65) && a.status === "PROPOSED",
    )!;
    await repo.approveAmendment(proposed.id);
    expect((await repo.getContract(STRUCTURE))!.contract.currentAmountPaise).toBe(lakhs(65));
  });

  it("a rejection leaves the value alone", async () => {
    await repo.proposeAmendment({
      contractId: STRUCTURE,
      type: "VARIATION",
      revisedAmountPaise: lakhs(65),
      reason: "Extra staircase",
      effectiveDate: "2026-06-01",
    });
    const proposed = (await repo.listAmendments(STRUCTURE)).find((a) => a.status === "PROPOSED")!;
    await repo.rejectAmendment(proposed.id, "Not approved by the client");
    expect((await repo.getContract(STRUCTURE))!.contract.currentAmountPaise).toBe(RS_60L);
  });

  it("refuses a revision below what has already been credited", async () => {
    await expect(
      repo.proposeAmendment({
        contractId: STRUCTURE,
        type: "VARIATION",
        revisedAmountPaise: lakhs(5), // ₹8,00,000 already credited
        reason: "Descope",
        effectiveDate: "2026-06-01",
      }),
    ).rejects.toThrow("REVISION_BELOW_CREDITED");
  });

  it("refuses a revision below the earned value", async () => {
    await expect(
      repo.proposeAmendment({
        contractId: STRUCTURE,
        type: "VARIATION",
        revisedAmountPaise: lakhs(9), // ₹10,00,000 already earned
        reason: "Descope",
        effectiveDate: "2026-06-01",
      }),
    ).rejects.toThrow("REVISION_BELOW_EARNED");
  });

  it("the seeded Finishing agreement carries its approved variation", async () => {
    const detail = await repo.getContract(FINISHING);
    expect(detail!.contract.originalAmountPaise).toBe(lakhs(60));
    expect(detail!.contract.currentAmountPaise).toBe(lakhs(65));
    expect(detail!.contract.reconciliation.amendmentDeltaPaise).toBe(lakhs(5));
  });
});

describe("value edits go through amendments only", () => {
  it("refuses an amount on updateContract", async () => {
    await expect(
      // A caller trying the old path must be told where the new one is.
      repo.updateContract(STRUCTURE, { contractAmountPaise: lakhs(70) } as never),
    ).rejects.toThrow("USE_AMENDMENT");
  });

  it("still allows work-detail edits", async () => {
    const updated = await repo.updateContract(STRUCTURE, { title: "Structure (Tower B)" });
    expect(updated.title).toBe("Structure (Tower B)");
    expect(updated.currentAmountPaise).toBe(RS_60L);
  });
});

describe("deletion governance", () => {
  it("refuses to delete an agreement with financial history", async () => {
    await expect(repo.deleteContract(STRUCTURE)).rejects.toThrow("HAS_FINANCIAL_HISTORY");
  });

  it("cancels instead, preserving reconciliation", async () => {
    const cancelled = await repo.cancelContract(STRUCTURE, "Client terminated the package");
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledReason).toBe("Client terminated the package");
    // History survives: earned value and credits are still readable.
    expect(cancelled.reconciliation.earnedValuePaise).toBe(RS_10L);
    expect(cancelled.reconciliation.totalCreditedPaise).toBe(RS_8L);
  });

  it("deletes a pristine, never-used agreement", async () => {
    const fresh = await repo.createContract({
      contractorId: PAPPU,
      projectId: PROJECT_A,
      title: "Scratch",
      contractAmountPaise: lakhs(1),
    });
    await expect(repo.deleteContract(fresh.id)).resolves.toBeUndefined();
    expect(await repo.getContract(fresh.id)).toBeNull();
  });

  it("refuses a payment against a cancelled agreement", async () => {
    await repo.cancelContract(COMPOUND_WALL, "Not proceeding");
    await expect(
      repo.recordContractPayment({
        contractId: COMPOUND_WALL,
        amountPaise: RS_2L,
        type: "INTERIM",
        paymentMode: "CASH",
        date: "2026-05-07",
      }),
    ).rejects.toThrow("AGREEMENT_CANCELLED");
  });
});

describe("payment reversal", () => {
  it("stops the money counting while keeping the record", async () => {
    const before = (await repo.getContract(STRUCTURE))!;
    const live = before.payments.find((p) => p.reversedAt == null)!;

    await repo.reverseContractPayment(live.id, "Paid to the wrong contractor");

    const after = (await repo.getContract(STRUCTURE))!;
    expect(after.contract.reconciliation.otherPaymentCreditPaise).toBe(0);
    expect(after.contract.reconciliation.currentDuePaise).toBe(lakhs(4)); // ₹10L − ₹6L attendance

    const kept = after.payments.find((p) => p.id === live.id)!;
    expect(kept.reversedAt).not.toBeNull();
    expect(kept.reversalReason).toBe("Paid to the wrong contractor");
  });

  it("requires a reason", async () => {
    const detail = (await repo.getContract(STRUCTURE))!;
    const live = detail.payments.find((p) => p.reversedAt == null)!;
    await expect(repo.reverseContractPayment(live.id, "  ")).rejects.toThrow(
      "REVERSAL_REASON_REQUIRED",
    );
  });
});

describe("scope and rate history", () => {
  it("lists the agreement's scope", async () => {
    const items = await repo.listScopeItems(STRUCTURE);
    expect(items.map((i) => i.subcategoryName).sort()).toEqual([
      "Main Carpenter",
      "Mason",
      "Mason Helper",
    ]);
  });

  it("keeps every rate revision, newest first", async () => {
    const revisions = await repo.listRateRevisions("si-mason");
    expect(revisions).toHaveLength(2);
    expect(revisions[0].ratePaise).toBe(90_000);
    expect(revisions[1].ratePaise).toBe(85_000);
    expect(revisions[1].reason).toBe("Original agreement");
  });

  it("a revision appends rather than overwriting", async () => {
    await repo.setScopeRate({
      scopeItemId: "si-mason",
      ratePaise: 95_000,
      effectiveFrom: "2026-07-01",
      reason: "Second revision",
    });
    const revisions = await repo.listRateRevisions("si-mason");
    expect(revisions).toHaveLength(3);
    // The originally agreed ₹850/day is still on the record.
    expect(revisions.some((r) => r.ratePaise === 85_000)).toBe(true);
  });

  it("refuses a rate effective before the agreement started", async () => {
    await expect(
      repo.setScopeRate({
        scopeItemId: "si-mason",
        ratePaise: 95_000,
        effectiveFrom: "2025-01-01",
      }),
    ).rejects.toThrow("INVALID_RATE");
  });
});
