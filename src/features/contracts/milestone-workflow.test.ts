/**
 * The milestone workflow end to end, on the demo stores.
 *
 * This is the walkthrough a reviewer clicks through, pinned so the numbers can't
 * drift: plan six slabs, complete one, watch reconciliation move, reopen it,
 * watch reconciliation come back. Every figure is produced by the SAME pure
 * engine the server uses, so this exercises production arithmetic — only the
 * persistence differs.
 *
 * The rule under test throughout: a milestone changes what the agreement has
 * EARNED. It never moves money and never attaches an existing payment to itself.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { demoContractsRepository as contracts } from "./demo/demo-repository";
import { buildBulkMilestones } from "./components/bulk-milestones-sheet";

const L = (lakhs: number) => lakhs * 100_000 * 100;

/** The seeded ₹60,00,000 Structure agreement, six ₹10,00,000 slabs, one done. */
const STRUCTURE = "ag-structure";
/** ₹8,00,000, one seeded checkpoint, nothing earned — the planning fixture. */
const WALL = "ag-compound-wall";

beforeEach(() => {
  localStorage.clear();
});

const recon = async (id: string) => (await contracts.getContract(id))!.contract.reconciliation;

/* ── Planning ───────────────────────────────────────────────────────────── */

describe("planning milestones", () => {
  it("creates one milestone with the value given, and nothing is earned yet", async () => {
    const before = await recon(WALL);
    expect(before.earnedValuePaise).toBe(0);

    const rows = await contracts.createMilestone({
      contractId: WALL,
      title: "Foundation",
      valuePaise: L(3),
    });
    const mine = rows.filter((m) => m.title === "Foundation");
    expect(mine).toHaveLength(1);
    expect(mine[0].valuePaise).toBe(L(3));
    expect(mine[0].status).toBe("NOT_STARTED");

    // Planning allocates; it does not earn.
    const after = await recon(WALL);
    expect(after.earnedValuePaise).toBe(0);
    expect(after.milestoneCoveragePaise).toBeGreaterThan(before.milestoneCoveragePaise);
  });

  it("bulk-creates six ₹10,00,000 slabs, correctly named and ordered", async () => {
    const inputs = buildBulkMilestones({
      contractId: WALL,
      prefix: "Slab",
      count: 6,
      valuePaise: L(10),
    });
    const rows = await contracts.createMilestonesBulk(WALL, inputs);
    const slabs = rows.filter((m) => m.title.startsWith("Slab")).sort((a, b) => a.sequence - b.sequence);

    expect(slabs.map((m) => m.title)).toEqual([
      "Slab 1",
      "Slab 2",
      "Slab 3",
      "Slab 4",
      "Slab 5",
      "Slab 6",
    ]);
    expect(slabs.every((m) => m.valuePaise === L(10))).toBe(true);
    // Sequence continues from what was already there, and stays contiguous.
    expect(slabs.map((m) => m.sequence)).toEqual(
      slabs.map((_, i) => slabs[0].sequence + i),
    );
    // Σ 6 × ₹10L = ₹60,00,000, in integer paise with no float drift.
    expect(slabs.reduce((a, m) => a + m.valuePaise, 0)).toBe(L(60));
  });

  it("continues numbering from the milestones already there", async () => {
    await contracts.createMilestonesBulk(
      WALL,
      buildBulkMilestones({ contractId: WALL, prefix: "Slab", count: 2, valuePaise: L(1) }),
    );
    const rows = await contracts.createMilestonesBulk(
      WALL,
      buildBulkMilestones({
        contractId: WALL,
        prefix: "Slab",
        count: 2,
        valuePaise: L(1),
        startNumber: 3,
      }),
    );
    expect(rows.filter((m) => m.title.startsWith("Slab")).map((m) => m.title)).toEqual([
      "Slab 1",
      "Slab 2",
      "Slab 3",
      "Slab 4",
    ]);
  });

  it("permits planning ABOVE the agreement value — a warning, never a refusal", async () => {
    const before = await recon(WALL);
    // ₹8,00,000 agreement; add ₹12,00,000 more of planned checkpoints on top.
    await contracts.createMilestonesBulk(
      WALL,
      buildBulkMilestones({ contractId: WALL, prefix: "Stage", count: 4, valuePaise: L(3) }),
    );
    const r = await recon(WALL);
    expect(r.currentContractValuePaise).toBe(L(8));
    expect(r.milestoneCoveragePaise).toBe(before.milestoneCoveragePaise + L(12));
    // Over-coverage is surfaced as a positive variance, not normalised away.
    expect(r.milestoneCoverageVariancePaise).toBe(r.milestoneCoveragePaise - L(8));
    expect(r.milestoneCoverageVariancePaise).toBeGreaterThan(0);
    // Planning earns nothing.
    expect(r.earnedValuePaise).toBe(0);
  });
});

/* ── Earned value ───────────────────────────────────────────────────────── */

describe("completing a milestone", () => {
  it("increases cumulative earned value by exactly that milestone's value, once", async () => {
    const before = await recon(STRUCTURE);
    // The seed has Slab 1 already complete: ₹10,00,000 earned of ₹60,00,000.
    expect(before.earnedValuePaise).toBe(L(10));
    expect(before.milestonesCompleted).toBe(1);

    const rows = await contracts.listMilestones(STRUCTURE);
    const slab2 = rows.find((m) => m.title === "Slab 2")!;
    await contracts.setMilestoneStatus(slab2.id, "COMPLETED");

    const after = await recon(STRUCTURE);
    expect(after.earnedValuePaise).toBe(L(20));
    expect(after.milestonesCompleted).toBe(2);
    // The agreement value itself never moves — only an amendment does that.
    expect(after.currentContractValuePaise).toBe(before.currentContractValuePaise);
  });

  it("moves Due by the same amount, without touching any payment", async () => {
    const before = await recon(STRUCTURE);
    const creditedBefore = before.totalCreditedPaise;

    const rows = await contracts.listMilestones(STRUCTURE);
    await contracts.setMilestoneStatus(rows.find((m) => m.title === "Slab 2")!.id, "COMPLETED");

    const after = await recon(STRUCTURE);
    // Credit is untouched: completion recognises work, it does not pay for it.
    expect(after.totalCreditedPaise).toBe(creditedBefore);
    expect(after.currentDuePaise).toBe(Math.max(0, after.earnedValuePaise - creditedBefore));
    expect(after.currentDuePaise - before.currentDuePaise).toBe(L(10));
  });

  it("refuses a completion that would recognise more than the authorised value", async () => {
    const rows = await contracts.listMilestones(STRUCTURE);
    const pending = rows.filter((m) => m.status !== "COMPLETED");
    // Complete all five remaining slabs — lands exactly on ₹60,00,000.
    for (const m of pending) await contracts.setMilestoneStatus(m.id, "COMPLETED");
    expect((await recon(STRUCTURE)).earnedValuePaise).toBe(L(60));

    // A seventh checkpoint cannot earn anything more.
    const [extra] = await contracts.createMilestone({
      contractId: STRUCTURE,
      title: "Extra slab",
      valuePaise: L(5),
    }).then((all) => all.filter((m) => m.title === "Extra slab"));

    await expect(contracts.setMilestoneStatus(extra.id, "COMPLETED")).rejects.toThrow(
      "EARNED_VALUE_EXCEEDS_CONTRACT",
    );
    expect((await recon(STRUCTURE)).earnedValuePaise).toBe(L(60));
  });

  it("refuses to complete the same milestone twice", async () => {
    const rows = await contracts.listMilestones(STRUCTURE);
    const slab2 = rows.find((m) => m.title === "Slab 2")!;
    await contracts.setMilestoneStatus(slab2.id, "COMPLETED");
    await expect(contracts.setMilestoneStatus(slab2.id, "COMPLETED")).rejects.toThrow(
      "INVALID_STATUS_TRANSITION",
    );
    // Earned value moved exactly once.
    expect((await recon(STRUCTURE)).earnedValuePaise).toBe(L(20));
  });
});

/* ── Correction ─────────────────────────────────────────────────────────── */

describe("reopening a completed milestone", () => {
  it("un-recognises its value and returns reconciliation to where it was", async () => {
    const start = await recon(STRUCTURE);
    const rows = await contracts.listMilestones(STRUCTURE);
    const slab2 = rows.find((m) => m.title === "Slab 2")!;

    await contracts.setMilestoneStatus(slab2.id, "COMPLETED");
    expect((await recon(STRUCTURE)).earnedValuePaise).toBe(L(20));

    await contracts.setMilestoneStatus(slab2.id, "IN_PROGRESS");
    const after = await recon(STRUCTURE);
    expect(after.earnedValuePaise).toBe(start.earnedValuePaise);
    expect(after.currentDuePaise).toBe(start.currentDuePaise);
    expect(after.advanceCreditPaise).toBe(start.advanceCreditPaise);
    expect(after.milestonesCompleted).toBe(start.milestonesCompleted);
  });

  it("keeps the milestone on record rather than deleting it", async () => {
    const rows = await contracts.listMilestones(STRUCTURE);
    const slab2 = rows.find((m) => m.title === "Slab 2")!;
    await contracts.setMilestoneStatus(slab2.id, "COMPLETED");
    const reopened = await contracts.setMilestoneStatus(slab2.id, "IN_PROGRESS");

    const kept = reopened.find((m) => m.id === slab2.id);
    expect(kept).toBeDefined();
    expect(kept!.status).toBe("IN_PROGRESS");
    expect(kept!.valuePaise).toBe(L(10));
    expect(kept!.completedAt).toBeNull();
    // Still part of planned coverage — reopening is not cancelling.
    expect((await recon(STRUCTURE)).milestoneCoveragePaise).toBe(L(60));
  });

  it("is the ONLY move out of COMPLETED — cancelling directly is refused", async () => {
    const rows = await contracts.listMilestones(STRUCTURE);
    const done = rows.find((m) => m.status === "COMPLETED")!;
    await expect(contracts.setMilestoneStatus(done.id, "CANCELLED", { reason: "x" })).rejects.toThrow(
      "INVALID_STATUS_TRANSITION",
    );
  });
});

describe("cancelling a milestone", () => {
  it("requires a reason and drops the value out of planned coverage", async () => {
    const rows = await contracts.listMilestones(STRUCTURE);
    const slab6 = rows.find((m) => m.title === "Slab 6")!;

    await expect(contracts.setMilestoneStatus(slab6.id, "CANCELLED")).rejects.toThrow(
      "CANCEL_REASON_REQUIRED",
    );

    await contracts.setMilestoneStatus(slab6.id, "CANCELLED", {
      reason: "Slab dropped from the package",
    });
    const r = await recon(STRUCTURE);
    expect(r.milestoneCoveragePaise).toBe(L(50));
    expect(r.milestonesTotal).toBe(5);
    // A cancelled milestone never earned anything.
    expect(r.earnedValuePaise).toBe(L(10));
  });
});

/* ── Delete ─────────────────────────────────────────────────────────────── */

describe("deleting a milestone", () => {
  it("removes one that never started", async () => {
    const rows = await contracts.listMilestones(STRUCTURE);
    const fresh = rows.find((m) => m.status === "NOT_STARTED")!;
    const after = await contracts.deleteMilestone(fresh.id);
    expect(after.find((m) => m.id === fresh.id)).toBeUndefined();
  });

  it("refuses to destroy a completed one — earned-value history stays intact", async () => {
    const rows = await contracts.listMilestones(STRUCTURE);
    const done = rows.find((m) => m.status === "COMPLETED")!;
    await expect(contracts.deleteMilestone(done.id)).rejects.toThrow("MILESTONE_HAS_HISTORY");
    expect((await recon(STRUCTURE)).earnedValuePaise).toBe(L(10));
  });
});

/* ── Reorder ────────────────────────────────────────────────────────────── */

describe("reordering milestones", () => {
  it("persists the new order and changes no value", async () => {
    const before = await contracts.listMilestones(STRUCTURE);
    const ids = before.map((m) => m.id);
    const swapped = [ids[1], ids[0], ...ids.slice(2)];

    await contracts.reorderMilestones(STRUCTURE, swapped);

    const after = await contracts.listMilestones(STRUCTURE);
    expect(after.map((m) => m.id)).toEqual(swapped);
    expect(after.map((m) => m.sequence)).toEqual(after.map((_, i) => i));
    // Values and earned value are untouched by ordering.
    expect(after.reduce((a, m) => a + m.valuePaise, 0)).toBe(
      before.reduce((a, m) => a + m.valuePaise, 0),
    );
    expect((await recon(STRUCTURE)).earnedValuePaise).toBe(L(10));
  });

  it("refuses ids that belong to another agreement", async () => {
    const mine = await contracts.listMilestones(STRUCTURE);
    await expect(
      contracts.reorderMilestones(STRUCTURE, [...mine.map((m) => m.id), "not-mine"]),
    ).rejects.toThrow("INVALID_MILESTONE");
  });
});

/* ── Agreement lifecycle interaction ────────────────────────────────────── */

describe("agreement lifecycle guards", () => {
  it("refuses every earned-value change on a cancelled agreement", async () => {
    await contracts.cancelContract(WALL, "Client dropped the wall");

    await expect(
      contracts.createMilestone({ contractId: WALL, title: "X", valuePaise: L(1) }),
    ).rejects.toThrow("AGREEMENT_CANCELLED");
    await expect(contracts.reorderMilestones(WALL, [])).rejects.toThrow("AGREEMENT_CANCELLED");
  });

  it("refuses an earned-value change on a settled agreement, but allows ordering", async () => {
    // Drive Structure to a genuine close-out: all six slabs complete, and
    // credited exactly to the authorised value.
    const rows = await contracts.listMilestones(STRUCTURE);
    for (const m of rows.filter((x) => x.status !== "COMPLETED")) {
      await contracts.setMilestoneStatus(m.id, "COMPLETED");
    }
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

    const settled = await contracts.listMilestones(STRUCTURE);
    // Reopening would silently contradict a close-out that was only permitted
    // while earned === credited === authorised.
    await expect(
      contracts.setMilestoneStatus(settled[0].id, "IN_PROGRESS"),
    ).rejects.toThrow("AGREEMENT_SETTLED");

    // Ordering is presentation, so it stays available.
    await expect(
      contracts.reorderMilestones(STRUCTURE, settled.map((m) => m.id)),
    ).resolves.toBeDefined();
  });
});
