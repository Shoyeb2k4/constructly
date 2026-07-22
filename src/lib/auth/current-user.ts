import { cache } from "react";
import { isDemoMode } from "@/lib/env";
import { DEMO_USER } from "./demo";
import type { Role, SessionUser } from "./types";

/**
 * Resolve the authenticated user for the current request. In demo mode returns
 * the seeded demo owner; otherwise reads the Supabase session and joins the
 * application user + company. Server-only.
 *
 * Wrapped in React.cache so repeated calls within a single server render
 * (layout + page + nested server components) share one auth + DB round-trip
 * instead of re-resolving the session each time.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  if (isDemoMode) return DEMO_USER;

  const { createServerClient } = await import("@/lib/supabase/server");
  const { prisma } = await import("@/lib/db/prisma");

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const appUser = await prisma.user.findUnique({
    where: { id: user.id },
    include: { company: true },
  });
  if (!appUser) return null;

  return {
    id: appUser.id,
    email: appUser.email,
    fullName: appUser.fullName,
    role: appUser.role as Role,
    company: { id: appUser.company.id, name: appUser.company.name },
  };
});

/** Throw-if-absent variant for guarded server routes/actions. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}
