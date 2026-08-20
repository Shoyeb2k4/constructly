import { describe, it, expect, beforeEach } from "vitest";
import { gatherDemoPayments } from "./gather";
import { assemblePayments } from "../assemble";
import type { PaymentsVisibility } from "../types";

const ALL_VISIBLE: PaymentsVisibility = {
  vendorPayments: true,
  agreementPayments: true,
  contractorLedger: true,
  companyWideAdvances: true,
};

const OWNER = { userId: "u", isOwner: true, visibility: ALL_VISIBLE };
const UNBOUNDED = { from: null, to: null };

/**
 * A payments index that under-reports is worse than one that fails: nothing
 * looks wrong. Every module's demo repository seeds its own store lazily on
 * first read, so reading the raw keys returns nothing until that module has
 * been visited — which is exactly how the dashboard once reported zero
 * purchase orders on a fresh session.
 */
describe("gatherDemoPayments — a fresh session, before any module has been visited", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reports vendor payments without visiting Procurement first", async () => {
    const raw = await gatherDemoPayments({ ...OWNER, ...UNBOUNDED });
    expect(raw.vendorPayments.length).toBeGreaterThan(0);
  });

  it("reports contractor advances without visiting Contractors first", async () => {
    const raw = await gatherDemoPayments({ ...OWNER, ...UNBOUNDED });
    expect(raw.ledger.filter((e) => e.type === "ADVANCE").length).toBeGreaterThan(0);
  });

  it("reports agreement payments without visiting the agreement first", async () => {
    const raw = await gatherDemoPayments({ ...OWNER, ...UNBOUNDED });
    expect(raw.agreementPayments.length).toBeGreaterThan(0);
  });

  it("resolves project names, so no transaction shows a blank project", async () => {
    const snap = assemblePayments(await gatherDemoPayments({ ...OWNER, ...UNBOUNDED }));
    expect(snap.transactions.length).toBeGreaterThan(0);
    for (const t of snap.transactions) {
      if (t.project) expect(t.project.name).not.toBe("");
    }
  });

  it("knows the company has payments even when the current period is quiet", async () => {
    // A period far in the past: no rows, but the company plainly has history.
    const raw = await gatherDemoPayments({
      ...OWNER,
      from: "2000-01-01",
      to: "2000-12-31",
    });
    const snap = assemblePayments(raw);
    expect(snap.isEmpty).toBe(true);
    expect(snap.hasAnyPayments).toBe(true);
  });
});

describe("gatherDemoPayments — scoping", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns nothing for a user who manages no project", async () => {
    const raw = await gatherDemoPayments({
      userId: "not-a-pm",
      isOwner: false,
      visibility: ALL_VISIBLE,
      ...UNBOUNDED,
    });
    // Project-scoped rows are filtered at gather time, never in React.
    expect(raw.vendorPayments).toEqual([]);
    expect(raw.agreementPayments).toEqual([]);
    expect(raw.settlements).toEqual([]);
    expect(raw.ledger.every((e) => e.projectId === null)).toBe(true);
  });

  it("never fetches an instrument the caller may not see", async () => {
    const raw = await gatherDemoPayments({
      userId: "u",
      isOwner: true,
      visibility: {
        vendorPayments: false,
        agreementPayments: false,
        contractorLedger: true,
        companyWideAdvances: true,
      },
      ...UNBOUNDED,
    });
    expect(raw.vendorPayments).toEqual([]);
    expect(raw.agreementPayments).toEqual([]);
    expect(raw.ledger.length).toBeGreaterThan(0);
  });

  it("bounds the rows it returns by the requested period", async () => {
    const all = await gatherDemoPayments({ ...OWNER, ...UNBOUNDED });
    const narrow = await gatherDemoPayments({ ...OWNER, from: "2026-02-01", to: "2026-02-28" });
    const total = (r: Awaited<ReturnType<typeof gatherDemoPayments>>) =>
      r.ledger.length + r.settlements.length + r.agreementPayments.length + r.vendorPayments.length;
    expect(total(narrow)).toBeLessThanOrEqual(total(all));
    for (const p of narrow.agreementPayments) {
      expect(p.date >= "2026-02-01" && p.date <= "2026-02-28").toBe(true);
    }
  });
});

describe("gatherDemoPayments — an empty company", () => {
  beforeEach(() => {
    localStorage.clear();
    for (const k of [
      "constructly.demo.projects.v1",
      "constructly.demo.contractors.v1",
      "constructly.demo.contractorLedger.v1",
      "constructly.demo.contractorSettlements.v1",
      "constructly.demo.contractorContracts.v2",
      "constructly.demo.contractorContractPayments.v2",
      "constructly.demo.vendors.v2",
      "constructly.demo.pos.v2",
      "constructly.demo.vendorPayments.v1",
    ]) {
      localStorage.setItem(k, "[]");
    }
  });

  it("reports no payments at all, which is the onboarding case", async () => {
    const snap = assemblePayments(await gatherDemoPayments({ ...OWNER, ...UNBOUNDED }));
    expect(snap.transactions).toEqual([]);
    expect(snap.isEmpty).toBe(true);
    expect(snap.hasAnyPayments).toBe(false);
  });
});
