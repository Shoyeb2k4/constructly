import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { isDemoMode } from "@/lib/env";
import { assemblePayments, resolvePeriod } from "@/features/payments/assemble";
import { gatherServerPayments } from "@/features/payments/server/gather";
import { paymentsVisibilityFor } from "@/features/payments/visibility";
import { PaymentsView } from "@/features/payments/components/payments-view";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage() {
  const user = await getCurrentUser();
  // `payments.view` gates the ROUTE. What the page then SHOWS is gated per
  // instrument by the module that owns it — see visibility.ts.
  if (!hasPermission(user, "payments.view")) redirect("/dashboard");

  const visibility = paymentsVisibilityFor(user);
  const today = new Date().toISOString().slice(0, 10);
  const period = resolvePeriod("THIS_MONTH", today);

  // Fetch the first period on the server so the page renders with data already
  // present. Demo mode reads localStorage and so must fetch client-side.
  const initialData =
    isDemoMode || !user
      ? undefined
      : assemblePayments(await gatherServerPayments({ from: period.from, to: period.to }));

  return (
    <PaymentsView
      userId={user?.id ?? ""}
      isOwner={user?.role === "OWNER"}
      visibility={visibility}
      initialData={initialData}
    />
  );
}
