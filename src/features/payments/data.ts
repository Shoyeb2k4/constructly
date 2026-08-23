import { isDemoMode } from "@/lib/env";
import { isNativeClient } from "@/lib/mobile/platform";
import { call } from "@/lib/mobile/rpc";
import { assemblePayments } from "./assemble";
import { gatherDemoPayments } from "./demo/gather";
import { gatherServerPayments } from "./server/gather";
import type { PaymentsSnapshot, PaymentsVisibility, RawPaymentsData } from "./types";

/**
 * The Payments Centre snapshot for one PERIOD.
 *
 * The period is a server parameter, not a client-side filter, and that is a
 * deliberate scale decision. Payment history grows without bound — every
 * advance, settlement, agreement payment and vendor payment, forever — so
 * fetching a lifetime of transactions to render one month of them would send
 * more data every year the company stays in business. Bounding the query means
 * the common case transfers one month regardless of company age.
 *
 * Everything else the user changes constantly — search, type, project, status,
 * payment mode — is a pure function over the period's rows and costs no round
 * trip. See assemble.ts.
 */
export async function getPayments(opts: {
  userId: string;
  isOwner: boolean;
  visibility: PaymentsVisibility;
  /** Inclusive YYYY-MM-DD bounds; null means unbounded on that side. */
  from: string | null;
  to: string | null;
}): Promise<PaymentsSnapshot> {
  // Only the period bounds cross the wire on the native path. Visibility is
  // NOT sent: `gatherServerPayments` derives what the caller may see from the
  // resolved session, so a device cannot widen its own scope by asking.
  const raw = isDemoMode
    ? await gatherDemoPayments(opts)
    : isNativeClient
      ? await call<RawPaymentsData>("payments", "gather", [{ from: opts.from, to: opts.to }])
      : await gatherServerPayments(opts);
  return assemblePayments(raw);
}

export const paymentsKeys = {
  snapshot: (userId: string, from: string | null, to: string | null) =>
    ["payments-centre", userId, from ?? "*", to ?? "*"] as const,
};
