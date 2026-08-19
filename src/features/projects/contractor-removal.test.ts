/**
 * The removal-blocker vocabulary.
 *
 * The wording matters as much as the rule: a refusal that does not name the
 * agreement in the way is a dead end, and this text is what reaches the user
 * (the server returns a typed result precisely because Next masks thrown
 * messages in production).
 */
import { describe, it, expect } from "vitest";
import {
  agreementBlocksRemoval,
  describeRemovalBlocker,
  describeRemovalBlockers,
  hasBlockers,
  removalRemedy,
  type ContractorRemovalBlocker,
} from "./contractor-removal";
import { CONTRACT_STATUSES } from "@/features/contracts/constants";

function blocker(over: Partial<ContractorRemovalBlocker> = {}): ContractorRemovalBlocker {
  return {
    contractorId: "c-pappu",
    contractorName: "Pappu Contractor",
    agreements: [],
    attendanceCount: 0,
    settlementCount: 0,
    ...over,
  };
}

const structure = { id: "ag-structure", title: "Structure Labour Contract", status: "IN_PROGRESS" as const };

describe("agreementBlocksRemoval", () => {
  it("blocks on every status except cancelled", () => {
    for (const s of CONTRACT_STATUSES) {
      expect(agreementBlocksRemoval(s)).toBe(s !== "CANCELLED");
    }
  });

  it("blocks on SETTLED — a close-out is reversible to COMPLETED", () => {
    expect(agreementBlocksRemoval("SETTLED")).toBe(true);
  });

  it("does not block on CANCELLED — the one deliberate terminal state", () => {
    expect(agreementBlocksRemoval("CANCELLED")).toBe(false);
  });
});

describe("hasBlockers", () => {
  it("is false for a contractor with nothing attached", () => {
    expect(hasBlockers(blocker())).toBe(false);
  });

  it("is true for any single dependency", () => {
    expect(hasBlockers(blocker({ agreements: [structure] }))).toBe(true);
    expect(hasBlockers(blocker({ attendanceCount: 1 }))).toBe(true);
    expect(hasBlockers(blocker({ settlementCount: 1 }))).toBe(true);
  });
});

describe("describeRemovalBlocker", () => {
  it("names the contractor, the project and the agreement", () => {
    const msg = describeRemovalBlocker(blocker({ agreements: [structure] }), "Skyline Tower");
    expect(msg).toBe(
      'Pappu Contractor can\'t be removed from Skyline Tower because the agreement "Structure Labour Contract" is still live.',
    );
  });

  it("works without a project name", () => {
    expect(describeRemovalBlocker(blocker({ attendanceCount: 3 }))).toBe(
      "Pappu Contractor can't be removed because 3 attendance records are attributed to them here.",
    );
  });

  it("uses singular wording for one record", () => {
    expect(describeRemovalBlocker(blocker({ attendanceCount: 1 }))).toMatch(
      /1 attendance record is attributed/,
    );
    expect(describeRemovalBlocker(blocker({ settlementCount: 1 }))).toMatch(
      /1 settlement has been recorded/,
    );
  });

  it("lists every agreement when several are live", () => {
    const msg = describeRemovalBlocker(
      blocker({
        agreements: [structure, { id: "ag-wall", title: "Compound Wall", status: "ON_HOLD" }],
      }),
    );
    expect(msg).toMatch(/2 agreements are still live/);
    expect(msg).toMatch(/"Structure Labour Contract", "Compound Wall"/);
  });

  it("reads as one sentence when several kinds of blocker apply", () => {
    const msg = describeRemovalBlocker(
      blocker({ agreements: [structure], attendanceCount: 4, settlementCount: 2 }),
      "Skyline Tower",
    );
    expect(msg).toMatch(/is still live, 4 attendance records are attributed to them here and 2 settlements have been recorded/);
  });
});

describe("removalRemedy", () => {
  it("points at cancelling when an agreement is in the way, and reassures", () => {
    const r = removalRemedy(blocker({ agreements: [structure] }));
    expect(r).toMatch(/Cancel the agreement first/);
    expect(r).toMatch(/Nothing is deleted/);
  });

  it("explains why history keeps the relationship when there is no agreement", () => {
    const r = removalRemedy(blocker({ attendanceCount: 5 }));
    expect(r).toMatch(/explains how that history was attributed/);
    expect(r).toMatch(/remove individual labour types/);
  });
});

describe("describeRemovalBlockers", () => {
  it("is empty when nothing blocks", () => {
    expect(describeRemovalBlockers([])).toBe("");
  });

  it("adds the remedy for a single contractor", () => {
    const msg = describeRemovalBlockers([blocker({ agreements: [structure] })], "Skyline Tower");
    expect(msg).toMatch(/still live\./);
    expect(msg).toMatch(/Cancel the agreement first/);
  });

  it("names each contractor when several are blocked", () => {
    const msg = describeRemovalBlockers([
      blocker({ agreements: [structure] }),
      blocker({ contractorId: "c-suresh", contractorName: "Suresh Masonry", attendanceCount: 2 }),
    ]);
    expect(msg).toMatch(/Pappu Contractor can't be removed/);
    expect(msg).toMatch(/Suresh Masonry can't be removed/);
  });
});
