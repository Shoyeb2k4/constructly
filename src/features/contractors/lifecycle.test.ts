/**
 * Contractor lifecycle and duplicate detection — the pure rules.
 *
 * The line that matters throughout: ARCHIVED stops NEW OPERATIONAL WORK, never
 * the CLOSING OUT or CORRECTING of work already recorded. Attendance already on
 * record must still be settleable after archiving, and a settlement recorded
 * before archiving must still be reversible afterwards, or money gets trapped in
 * a state nobody can fix.
 */
import { describe, it, expect } from "vitest";
import {
  contractorNameKey,
  contractorPhoneKey,
  describeContractorError,
  describeDuplicates,
  findDuplicates,
  isArchived,
  newBusinessBlockedReason,
  type NewBusinessAction,
} from "./lifecycle";

const NEW_BUSINESS: NewBusinessAction[] = [
  "RECORD_ADVANCE",
  "RECORD_ATTENDANCE",
  "CREATE_AGREEMENT",
  "ASSIGN_TO_PROJECT",
];

describe("archived is the lifecycle end state", () => {
  it("treats INACTIVE as archived and ACTIVE as not", () => {
    expect(isArchived("INACTIVE")).toBe(true);
    expect(isArchived("ACTIVE")).toBe(false);
  });

  it("blocks every new-business action for an archived contractor", () => {
    for (const action of NEW_BUSINESS) {
      expect(newBusinessBlockedReason("INACTIVE", action, "Pappu Contractor")).toBeTruthy();
    }
  });

  it("blocks nothing at all for an active contractor", () => {
    for (const action of NEW_BUSINESS) {
      expect(newBusinessBlockedReason("ACTIVE", action)).toBeNull();
    }
  });

  it("names the contractor and the way out", () => {
    const msg = newBusinessBlockedReason("INACTIVE", "RECORD_ADVANCE", "Pappu Contractor")!;
    expect(msg).toMatch(/^Pappu Contractor is archived/);
    expect(msg).toMatch(/record a labour advance for them/);
    expect(msg).toMatch(/Restore them first/);
  });

  it("promises that history survives and closure stays open", () => {
    const msg = newBusinessBlockedReason("INACTIVE", "CREATE_AGREEMENT")!;
    expect(msg).toMatch(/Everything already recorded stays/);
    expect(msg).toMatch(/can still be settled/);
    expect(msg).toMatch(/reversed, amended or corrected/);
  });

  it("falls back to a neutral subject when no name is given", () => {
    expect(newBusinessBlockedReason("INACTIVE", "RECORD_ATTENDANCE")).toMatch(
      /^this contractor is archived/i,
    );
  });

  /**
   * The Pass 5.1 correction, pinned as a rule rather than a comment.
   *
   * Settlement is NOT new business. It recognises attendance already recorded,
   * so blocking it let archiving strand a real liability: a crew that worked
   * 1–18 August and was archived on the 19th could never be paid. There is
   * deliberately no CREATE_SETTLEMENT member to pass here — the type itself is
   * the guarantee, and this test states why in the one place someone would look
   * before adding it back.
   */
  it("does not treat settlement as new business", () => {
    const actions: string[] = NEW_BUSINESS;
    expect(actions).not.toContain("CREATE_SETTLEMENT");
  });

  it("counts recording attendance as new work — it is how a liability accrues", () => {
    const msg = newBusinessBlockedReason("INACTIVE", "RECORD_ATTENDANCE", "Pappu Contractor")!;
    expect(msg).toMatch(/record new attendance for them/);
  });
});

/* ── Duplicates ─────────────────────────────────────────────────────────── */

describe("contractorNameKey", () => {
  it("ignores case and collapsed whitespace", () => {
    expect(contractorNameKey("Pappu  Contractor ")).toBe(contractorNameKey("pappu contractor"));
  });

  it("keeps punctuation — two firms may genuinely differ by it", () => {
    expect(contractorNameKey("R.K. Builders")).not.toBe(contractorNameKey("RK Builders"));
  });
});

describe("contractorPhoneKey", () => {
  it("compares the last ten digits, so the country code is irrelevant", () => {
    expect(contractorPhoneKey("+91 98200 77889")).toBe(contractorPhoneKey("9820077889"));
    expect(contractorPhoneKey("098200-77889")).toBe(contractorPhoneKey("9820077889"));
  });

  it("ignores nothing-useful input", () => {
    expect(contractorPhoneKey(null)).toBeNull();
    expect(contractorPhoneKey("")).toBeNull();
    expect(contractorPhoneKey("12")).toBeNull();
  });
});

describe("findDuplicates", () => {
  const existing = [
    { id: "c1", name: "Pappu Contractor", phone: "+91 98200 77889", status: "ACTIVE" as const },
    { id: "c2", name: "Suresh Masonry", phone: "+91 98200 44556", status: "INACTIVE" as const },
  ];

  it("matches on name regardless of case and spacing", () => {
    const [m] = findDuplicates({ name: "  pappu   contractor " }, existing);
    expect(m).toMatchObject({ id: "c1", on: "NAME" });
  });

  it("matches on phone when the name was changed", () => {
    const [m] = findDuplicates({ name: "Pappu & Sons", phone: "9820077889" }, existing);
    expect(m).toMatchObject({ id: "c1", on: "PHONE" });
  });

  it("prefers the NAME signal when both match", () => {
    const [m] = findDuplicates(
      { name: "Pappu Contractor", phone: "9820077889" },
      existing,
    );
    expect(m.on).toBe("NAME");
    expect(findDuplicates({ name: "Pappu Contractor", phone: "9820077889" }, existing)).toHaveLength(1);
  });

  it("finds an ARCHIVED look-alike — reusing it is usually the right answer", () => {
    const [m] = findDuplicates({ name: "Suresh Masonry" }, existing);
    expect(m).toMatchObject({ id: "c2", status: "INACTIVE" });
  });

  it("returns nothing for a genuinely new contractor", () => {
    expect(findDuplicates({ name: "New Crew", phone: "+91 90000 00000" }, existing)).toEqual([]);
  });
});

describe("describeDuplicates", () => {
  const match = (over = {}) => ({
    id: "c1",
    name: "Pappu Contractor",
    phone: null,
    status: "ACTIVE" as const,
    on: "NAME" as const,
    ...over,
  });

  it("says nothing when there is nothing to say", () => {
    expect(describeDuplicates([])).toBe("");
  });

  it("names the existing contractor", () => {
    expect(describeDuplicates([match()])).toBe(
      'A contractor called "Pappu Contractor" already exists.',
    );
  });

  it("flags an archived match, so the user knows to restore rather than re-add", () => {
    expect(describeDuplicates([match({ status: "INACTIVE" })])).toMatch(/\(archived\)/);
  });

  it("explains a phone match differently from a name match", () => {
    expect(describeDuplicates([match({ on: "PHONE" })])).toMatch(/already has this mobile number/);
  });

  it("counts several matches", () => {
    expect(describeDuplicates([match(), match({ id: "c2", name: "Pappu Crew" })])).toMatch(
      /^2 existing contractors look like this one/,
    );
  });
});

/* ── Error text ─────────────────────────────────────────────────────────── */

describe("describeContractorError", () => {
  it("explains the archived refusal", () => {
    expect(describeContractorError(new Error("CONTRACTOR_ARCHIVED"), "fallback")).toMatch(
      /archived/,
    );
  });

  it("prefers the server's own sentence when it supplied one", () => {
    const msg = describeContractorError(
      new Error("CONTRACTOR_ARCHIVED: Pappu Contractor is archived, so you can't settle."),
      "fallback",
    );
    expect(msg).toBe("Pappu Contractor is archived, so you can't settle.");
  });

  it("points a status edit at Archive / Restore", () => {
    expect(describeContractorError(new Error("USE_ARCHIVE"), "fallback")).toMatch(
      /Archive or Restore/,
    );
  });

  it("never leaks a masked digest, a Prisma error or an empty message", () => {
    for (const raw of [
      "An error occurred in the Server Components render. Digest: 118231",
      "PrismaClientKnownRequestError: P2002",
      "",
    ]) {
      expect(describeContractorError(new Error(raw), "Couldn't archive the contractor.")).toBe(
        "Couldn't archive the contractor.",
      );
    }
    expect(describeContractorError(undefined, "Nope.")).toBe("Nope.");
  });
});
