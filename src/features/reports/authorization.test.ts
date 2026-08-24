import { describe, it, expect } from "vitest";
import { describeExportFailure, type ExportFailure } from "./authorization";

/**
 * Regression cover for the defect that told an Owner they had no permissions.
 *
 * The export handler wrapped its authorization call in a bare `catch` and
 * reported "You don't have permission to export this report" for whatever came
 * out of it. Across a Server Action boundary that is unsound: in production Next
 * masks thrown errors behind an opaque digest, so a genuine denial, an expired
 * session, and a request that never arrived were indistinguishable — and all
 * three were blamed on the user's role.
 *
 * These tests pin the property that fixes it: each distinct failure gets its own
 * message, and only a real denial mentions permission.
 */

const ALL: ExportFailure[] = [
  { kind: "denied", reason: "CANNOT_VIEW" },
  { kind: "denied", reason: "CANNOT_EXPORT" },
  { kind: "signed-out" },
  { kind: "unreachable" },
  { kind: "generation-failed" },
];

describe("export failure messages", () => {
  it("gives every failure kind its own distinct message", () => {
    const messages = ALL.map(describeExportFailure);
    expect(new Set(messages).size).toBe(ALL.length);
  });

  it("only a genuine denial blames the user's permissions", () => {
    for (const failure of ALL) {
      const message = describeExportFailure(failure);
      const blamesPermission = /permission/i.test(message);
      expect(blamesPermission, `${failure.kind}: "${message}"`).toBe(failure.kind === "denied");
    }
  });

  it("distinguishes cannot-view from cannot-export", () => {
    // Different remedies: one needs access to the report, the other needs the
    // export grant on top of it.
    const view = describeExportFailure({ kind: "denied", reason: "CANNOT_VIEW" });
    const exp = describeExportFailure({ kind: "denied", reason: "CANNOT_EXPORT" });
    expect(view).not.toBe(exp);
    expect(view).toMatch(/view/i);
    expect(exp).toMatch(/export/i);
  });

  it("tells a signed-out user to sign in, not that they lack a role", () => {
    const message = describeExportFailure({ kind: "signed-out" });
    expect(message).toMatch(/sign in/i);
    expect(message).not.toMatch(/permission/i);
  });

  it("describes an unanswered request as a reachability problem", () => {
    const message = describeExportFailure({ kind: "unreachable" });
    expect(message).toMatch(/reach/i);
    expect(message).not.toMatch(/permission/i);
  });

  it("does not call a file-generation failure a permission problem", () => {
    // Authorized, then the spreadsheet failed to serialise. Saying "you don't
    // have permission" here sends the reader to the Roles screen for a bug in
    // the exporter.
    const message = describeExportFailure({ kind: "generation-failed" });
    expect(message).not.toMatch(/permission/i);
    expect(message).toMatch(/couldn't be created|authorized/i);
  });

  it("returns a non-empty, user-facing sentence for every kind", () => {
    for (const failure of ALL) {
      const message = describeExportFailure(failure);
      expect(message.length, failure.kind).toBeGreaterThan(20);
      expect(message.trim().endsWith("."), failure.kind).toBe(true);
    }
  });
});
