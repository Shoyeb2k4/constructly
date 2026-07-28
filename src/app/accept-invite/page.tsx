import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getPendingInviteForMe } from "@/features/team/server/actions";
import { AcceptInviteForm } from "./accept-invite-form";

export const metadata: Metadata = { title: "Accept invitation" };

export default async function AcceptInvitePage() {
  const info = await getPendingInviteForMe();
  // No pending invite ⇒ either an already-onboarded member (send to the app,
  // which will route them) or an anonymous visitor (the app layout bounces to
  // sign-in).
  if (!info) redirect("/dashboard");
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <AcceptInviteForm info={info} />
    </div>
  );
}
