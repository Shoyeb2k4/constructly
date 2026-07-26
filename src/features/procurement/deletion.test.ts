import { describe, it, expect } from "vitest";
import { poDeleteAction } from "./deletion";

describe("poDeleteAction", () => {
  const owner = { isOwner: true, isCreator: false };
  const creator = { isOwner: false, isCreator: true };
  const other = { isOwner: false, isCreator: false };

  it("DRAFT: owner or creator can delete; others cannot", () => {
    expect(poDeleteAction("DRAFT", owner)).toBe("DELETE");
    expect(poDeleteAction("DRAFT", creator)).toBe("DELETE");
    expect(poDeleteAction("DRAFT", other)).toBe("FORBIDDEN");
  });

  it("SUBMITTED: owner-only delete", () => {
    expect(poDeleteAction("SUBMITTED", owner)).toBe("DELETE");
    expect(poDeleteAction("SUBMITTED", creator)).toBe("FORBIDDEN");
    expect(poDeleteAction("SUBMITTED", other)).toBe("FORBIDDEN");
  });

  it("APPROVED: owner archives; never deletes", () => {
    expect(poDeleteAction("APPROVED", owner)).toBe("ARCHIVE");
    expect(poDeleteAction("APPROVED", creator)).toBe("FORBIDDEN");
    expect(poDeleteAction("APPROVED", other)).toBe("FORBIDDEN");
  });
});
