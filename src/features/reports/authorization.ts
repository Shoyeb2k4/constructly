/**
 * The export gate's decision, as data.
 *
 * Kept in its own module — free of `"use server"` and of any server import — so
 * both the action and the client can name the same type without the client
 * pulling the server graph in behind it.
 */
export type ExportDenialReason =
  /** Cannot see the report at all: missing reports.view or its class permission. */
  | "CANNOT_VIEW"
  /** Can see it, but does not hold reports.export. Viewing never implies export. */
  | "CANNOT_EXPORT";

export type ExportDecision = { allowed: true } | { allowed: false; reason: ExportDenialReason };

/**
 * What went wrong when an export did not happen.
 *
 * Only `denied` is a permission problem. The others exist because the previous
 * implementation reported ALL of them as one — a bare `catch` around the
 * authorization call that showed "You don't have permission to export this
 * report" whether the server had refused, the session had expired, the request
 * had never arrived, or the spreadsheet had failed to serialise.
 *
 * Telling a user with every permission that they lack permission does not just
 * fail to help — it sends them to the wrong place, and it hides the real fault
 * from whoever they report it to.
 */
export type ExportFailure =
  | { kind: "denied"; reason: ExportDenialReason }
  /** No usable session — the server could not resolve who is asking. */
  | { kind: "signed-out" }
  /** The authorization request never got an answer (offline, deploy in flight). */
  | { kind: "unreachable" }
  /** Authorized, but building or saving the file failed. */
  | { kind: "generation-failed" };

export function describeExportFailure(failure: ExportFailure): string {
  switch (failure.kind) {
    case "denied":
      return failure.reason === "CANNOT_VIEW"
        ? "You don't have permission to view this report."
        : "You don't have permission to export this report.";
    case "signed-out":
      return "Your session has expired. Sign in again to export.";
    case "unreachable":
      // Deliberately says nothing about permissions: the server never got to
      // decide, so blaming access would be a guess dressed as a finding.
      return "Couldn't reach Constructly to authorize the export. Try again.";
    case "generation-failed":
      return "The report was authorized but the file couldn't be created.";
  }
}
