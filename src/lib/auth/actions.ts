"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db/prisma";
import { reportError } from "@/lib/logger";

const onboardSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your name").max(120),
  companyName: z.string().trim().min(2, "Enter your company name").max(120),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, "Invalid GSTIN")
    .optional()
    .or(z.literal("")),
});

export interface OnboardState {
  error?: string;
}

/**
 * First-login workspace provisioning: creates the Company and the caller's
 * OWNER user row (id = auth.uid), then enters the app. Idempotent — a caller
 * who already has a workspace is simply redirected. Prisma connects as the
 * table owner, so this is the one sanctioned path that writes across RLS;
 * every input is validated and the ids come from the verified session.
 */
export async function onboardCompany(
  _prev: OnboardState,
  formData: FormData,
): Promise<OnboardState> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const existing = await prisma.user.findUnique({ where: { id: user.id } });
  if (existing) redirect("/dashboard");

  const parsed = onboardSchema.safeParse({
    fullName: formData.get("fullName"),
    companyName: formData.get("companyName"),
    gstin: formData.get("gstin") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  }

  // A user id can only ever belong to one email; the unique email constraint
  // guards against a stale auth user re-onboarding under a new company.
  try {
    await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: parsed.data.companyName,
          gstin: parsed.data.gstin ? parsed.data.gstin : null,
          settings: { poApprovalRequired: false, currency: "INR" },
        },
      });
      await tx.user.create({
        data: {
          id: user.id,
          companyId: company.id,
          email: user.email ?? `${user.id}@unknown.local`,
          fullName: parsed.data.fullName,
          role: "OWNER",
          status: "ACTIVE",
        },
      });
      await tx.activityLog.create({
        data: {
          companyId: company.id,
          actorId: user.id,
          action: "company.created",
          entityType: "company",
          entityId: company.id,
          summary: `created ${company.name}`,
        },
      });
    });
  } catch (err) {
    reportError(err, { scope: "onboarding", userId: user.id });
    return { error: "Couldn't create your workspace. Please try again." };
  }

  redirect("/dashboard");
}
