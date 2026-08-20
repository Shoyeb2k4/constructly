/**
 * What a SCOPED advance may and may not pay for.
 *
 * The allocator has always implemented this; until this pass no user could
 * record a scoped advance, so the rules were unreachable in practice. These pin
 * the exact numbers, using the real engine, for the scenario the scoping UI now
 * makes possible:
 *
 *   Advance A  ₹5,00,000  scoped to Structure (agreement)
 *   Advance B  ₹2,00,000  scoped to Skyline   (project)
 *   Advance C  ₹1,00,000  general
 *
 * The rule that matters most is the one that is easiest to get wrong in the
 * convenient direction: Structure's money is NOT available to Compound Wall, and
 * NOT available to labour that carries no agreement at all — because that labour
 * might belong to a different agreement and nothing can know which. Leaving
 * correctly-earmarked money unspent beats spending it on the wrong work.
 */
import { describe, it, expect } from "vitest";
import { allocateAdvanceDrawdown, unusableAdvances, type BillComposition } from "./calc";

const L = (lakhs: number) => lakhs * 100_000 * 100;

const SKYLINE = "p-skyline";
const ORION = "p-orion";
const STRUCTURE = "ag-structure";
const WALL = "ag-compound-wall";

/** Oldest first — the order `outstandingPerAdvance` produces. */
const ADVANCES = [
  { entryId: "adv-a", projectId: SKYLINE, contractId: STRUCTURE, remainingPaise: L(5), date: "2026-01-01" },
  { entryId: "adv-b", projectId: SKYLINE, contractId: null, remainingPaise: L(2), date: "2026-01-02" },
  { entryId: "adv-c", projectId: null, contractId: null, remainingPaise: L(1), date: "2026-01-03" },
];

const composition = (entries: [string | null, number][]): BillComposition => new Map(entries);

/** Total drawn from one advance across all buckets. */
const drawn = (allocs: ReturnType<typeof allocateAdvanceDrawdown>, entryId: string) =>
  allocs.filter((a) => a.entryId === entryId).reduce((t, a) => t + a.amountPaise, 0);

/* ── Compound Wall only ─────────────────────────────────────────────────── */

describe("a settlement containing only Compound Wall labour", () => {
  const run = (requested: number) =>
    allocateAdvanceDrawdown({
      outstanding: ADVANCES,
      requestedPaise: requested,
      projectId: SKYLINE,
      composition: composition([[WALL, L(2.5)]]),
    });

  it("does NOT touch Structure's ₹5,00,000", () => {
    const allocs = run(L(2.5));
    expect(drawn(allocs, "adv-a")).toBe(0);
  });

  it("spends the project advance first, then the general one", () => {
    const allocs = run(L(2.5));
    // ₹2,00,000 project + ₹50,000 general = the ₹2,50,000 bill.
    expect(drawn(allocs, "adv-b")).toBe(L(2));
    expect(drawn(allocs, "adv-c")).toBe(L(0.5));
    expect(allocs.reduce((t, a) => t + a.amountPaise, 0)).toBe(L(2.5));
  });

  it("records which bucket each drawdown funded", () => {
    for (const a of run(L(2.5))) expect(a.fundsContractId).toBe(WALL);
  });

  it("explains why Structure's money was left alone", () => {
    const allocs = run(L(2.5));
    const unusable = unusableAdvances({
      outstanding: ADVANCES,
      allocations: allocs,
      projectId: SKYLINE,
      composition: composition([[WALL, L(2.5)]]),
    });
    const structure = unusable.find((u) => u.entryId === "adv-a")!;
    expect(structure.remainingPaise).toBe(L(5));
    expect(structure.reason).toMatch(/hasn't been attributed to that agreement/);
  });

  it("cannot spend more than the bill even when more money exists", () => {
    // ₹8,00,000 is outstanding; the period's labour is ₹2,50,000.
    const allocs = run(L(8));
    expect(allocs.reduce((t, a) => t + a.amountPaise, 0)).toBe(L(2.5));
  });
});

/* ── Structure only ─────────────────────────────────────────────────────── */

describe("a settlement containing only Structure labour", () => {
  const comp = composition([[STRUCTURE, L(6)]]);
  const run = (requested: number) =>
    allocateAdvanceDrawdown({
      outstanding: ADVANCES,
      requestedPaise: requested,
      projectId: SKYLINE,
      composition: comp,
    });

  it("spends Structure's own money FIRST — strict before broad", () => {
    const allocs = run(L(6));
    expect(allocs[0].entryId).toBe("adv-a");
    expect(drawn(allocs, "adv-a")).toBe(L(5));
  });

  it("then falls through project, then general, in that order", () => {
    const allocs = run(L(8));
    expect(drawn(allocs, "adv-a")).toBe(L(5)); // agreement
    expect(drawn(allocs, "adv-b")).toBe(L(1)); // project — bill caps it at ₹6L total
    expect(drawn(allocs, "adv-c")).toBe(0); // general — nothing left to fund
    expect(allocs.reduce((t, a) => t + a.amountPaise, 0)).toBe(L(6));
  });

  it("stops at the requested adjustment, not at the balance", () => {
    const allocs = run(L(3));
    expect(allocs.reduce((t, a) => t + a.amountPaise, 0)).toBe(L(3));
    expect(drawn(allocs, "adv-a")).toBe(L(3));
  });
});

/* ── Unattributed labour ────────────────────────────────────────────────── */

describe("labour that carries no agreement", () => {
  const comp = composition([[null, L(1)]]);
  const run = () =>
    allocateAdvanceDrawdown({
      outstanding: ADVANCES,
      requestedPaise: L(1),
      projectId: SKYLINE,
      composition: comp,
    });

  it("NEVER draws on an agreement-scoped advance", () => {
    // The labour might belong to Structure — or to Compound Wall, or to no
    // agreement at all. Spending Structure's money on a guess is the one
    // outcome that cannot be undone by a later correction.
    expect(drawn(run(), "adv-a")).toBe(0);
  });

  it("does draw on project and general money", () => {
    const allocs = run();
    expect(drawn(allocs, "adv-b")).toBe(L(1));
    expect(allocs.every((a) => a.fundsContractId === null)).toBe(true);
  });

  it("leaves the agreement advance fully outstanding, with a reason", () => {
    const unusable = unusableAdvances({
      outstanding: ADVANCES,
      allocations: run(),
      projectId: SKYLINE,
      composition: comp,
    });
    expect(unusable.find((u) => u.entryId === "adv-a")!.remainingPaise).toBe(L(5));
  });
});

/* ── Mixed settlement ───────────────────────────────────────────────────── */

describe("one settlement containing Structure, Compound Wall AND unattributed labour", () => {
  const comp = composition([
    [STRUCTURE, L(3)],
    [WALL, L(2)],
    [null, L(1)],
  ]);
  const run = (requested: number) =>
    allocateAdvanceDrawdown({
      outstanding: ADVANCES,
      requestedPaise: requested,
      projectId: SKYLINE,
      composition: comp,
    });

  it("keeps Structure's money inside the Structure bucket only", () => {
    const allocs = run(L(6));
    const fromA = allocs.filter((a) => a.entryId === "adv-a");
    expect(fromA.every((a) => a.fundsContractId === STRUCTURE)).toBe(true);
    // The Structure bucket is only ₹3,00,000, so ₹2,00,000 of A stays put.
    expect(drawn(allocs, "adv-a")).toBe(L(3));
  });

  it("lets project money cover the other buckets", () => {
    const allocs = run(L(6));
    const fromB = allocs.filter((a) => a.entryId === "adv-b");
    expect(fromB.every((a) => a.fundsContractId !== STRUCTURE)).toBe(true);
    expect(drawn(allocs, "adv-b")).toBe(L(2));
  });

  it("never lets a bucket absorb more than its own labour", () => {
    const allocs = run(L(8));
    const perBucket = new Map<string | null, number>();
    for (const a of allocs) {
      perBucket.set(a.fundsContractId, (perBucket.get(a.fundsContractId) ?? 0) + a.amountPaise);
    }
    expect(perBucket.get(STRUCTURE)).toBeLessThanOrEqual(L(3));
    expect(perBucket.get(WALL)).toBeLessThanOrEqual(L(2));
    expect(perBucket.get(null)).toBeLessThanOrEqual(L(1));
  });

  it("fills unattributed LAST, after every agreement bucket", () => {
    const allocs = run(L(6));
    const firstNull = allocs.findIndex((a) => a.fundsContractId === null);
    const lastNamed = allocs.map((a) => a.fundsContractId).lastIndexOf(WALL);
    expect(firstNull).toBeGreaterThan(lastNamed);
  });
});

/* ── Another project ────────────────────────────────────────────────────── */

describe("money scoped to a different project", () => {
  const orionAdvance = [
    { entryId: "adv-orion", projectId: ORION, contractId: null, remainingPaise: L(4), date: "2026-01-01" },
  ];

  it("is not spendable on this project's settlement", () => {
    const allocs = allocateAdvanceDrawdown({
      outstanding: orionAdvance,
      requestedPaise: L(2),
      projectId: SKYLINE,
      composition: composition([[null, L(2)]]),
    });
    expect(allocs).toEqual([]);
  });

  it("says so, rather than leaving the balance unexplained", () => {
    const unusable = unusableAdvances({
      outstanding: orionAdvance,
      allocations: [],
      projectId: SKYLINE,
      composition: composition([[null, L(2)]]),
    });
    expect(unusable[0].reason).toMatch(/scoped to a different project/);
  });
});
