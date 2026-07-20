"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { supabaseUrl } from "@/lib/env";
import { prisma } from "@/lib/db/prisma";
import { reportError } from "@/lib/logger";

/* ── Sign-up ───────────────────────────────────────────────────────────
 * Two modes, chosen server-side:
 *  • AUTH_AUTOCONFIRM=1 (dev / internal): create the user already-confirmed via
 *    the Admin API — NO email is sent, so the shared-SMTP rate limit is never
 *    touched. The client then signs in normally.
 *  • Otherwise (production default): tell the client to use the standard
 *    Supabase email-verification flow (a confirmation email is sent by whatever
 *    SMTP is configured; use a custom SMTP for real volume).
 * The service-role key stays server-only and is never returned to the client. */

const signUpSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your name").max(120),
  companyName: z.string().trim().min(2, "Enter your company name").max(120),
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export type SignUpResult =
  | { mode: "confirmed" } // created + confirmed; client should sign in
  | { mode: "email" } // client should run the standard email-verification signup
  | { mode: "error"; error: string };

function autoconfirmEnabled(): boolean {
  return process.env.AUTH_AUTOCONFIRM === "1" && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export async function signUpAccount(input: {
  fullName: string;
  companyName: string;
  email: string;
  password: string;
}): Promise<SignUpResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return { mode: "error", error: parsed.error.issues[0]?.message ?? "Check the form" };
  }
  if (!autoconfirmEnabled()) {
    // Production email-verification path is owned by the client SDK.
    return { mode: "email" };
  }

  // Admin create, pre-confirmed. No email is sent.
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: parsed.data.email,
        password: parsed.data.password,
        email_confirm: true,
        user_metadata: { full_name: parsed.data.fullName, company_name: parsed.data.companyName },
      }),
    });
    if (res.ok) return { mode: "confirmed" };

    const body = (await res.json().catch(() => ({}))) as { msg?: string; error_code?: string };
    const msg = `${body.msg ?? ""} ${body.error_code ?? ""}`.toLowerCase();
    if (res.status === 422 || msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      return { mode: "error", error: "That email is already registered. Try signing in." };
    }
    reportError(new Error(`admin signup ${res.status}: ${body.msg ?? ""}`), { scope: "signup" });
    return { mode: "error", error: "Couldn't create your account. Please try again." };
  } catch (err) {
    reportError(err, { scope: "signup" });
    return { mode: "error", error: "Couldn't reach the auth service. Please try again." };
  }
}

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
