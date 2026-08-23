import { NextResponse } from "next/server";
import { z } from "zod";
import { lookupRpcMethod } from "../../registry";
import { bearerTokenFrom, verifyBearerToken } from "@/lib/supabase/bearer";
import { resolveSessionUser } from "@/lib/auth/current-user";
import { runWithSession } from "@/lib/auth/request-context";
import { isDemoMode } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/logger";

/**
 * Mobile RPC boundary.
 *
 * The Capacitor app bundles the same React UI as the web app but is served from
 * `capacitor://localhost`, so it can neither invoke Server Actions (which need a
 * same-origin Next server) nor present session cookies. This route is the ONLY
 * transport difference: it authenticates with a bearer token, then calls the
 * exact same server functions the web Server Actions call.
 *
 * It is transport, not policy:
 *  - the callable surface is a hand-written allowlist (see ../../registry.ts);
 *  - authorization is whatever the underlying action already enforces
 *    (`requirePermission` / `requireProjectWrite`), run under the caller's real
 *    resolved session — never re-implemented or relaxed here.
 *
 * Web authentication is completely untouched: cookies remain the web path, and
 * this route is the only caller of `runWithSession`.
 */

const RPC_LIMIT = { limit: 240, windowMs: 60_000 };

const bodySchema = z.object({ args: z.array(z.unknown()).max(8).default([]) });

/** Domain errors thrown by the actions, mapped to HTTP without leaking internals. */
const ERROR_STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_RETENTION: 400,
};

export async function POST(
  request: Request,
  ctx: { params: Promise<{ feature: string; method: string }> },
) {
  const { feature, method } = await ctx.params;

  const fn = lookupRpcMethod(feature, method);
  // Unregistered names are indistinguishable from unknown routes — no probing
  // the server-action surface for what exists.
  if (!fn) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  let body: { args: unknown[] };
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  // Demo mode has no real auth at all: getCurrentUser() already returns the
  // seeded demo owner, so nothing is injected and the actions resolve normally.
  if (isDemoMode) {
    return dispatch(fn, body.args, `demo:${feature}.${method}`);
  }

  const token = bearerTokenFrom(request.headers.get("authorization"));
  if (!token) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const authUserId = await verifyBearerToken(token);
  if (!authUserId) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  // Rate-limit per authenticated user, not per token — refreshing a token must
  // not reset the budget.
  const limited = rateLimit(`mobile-rpc:${authUserId}`, RPC_LIMIT);
  if (!limited.ok) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  // A verified auth user without an ACTIVE application row (not onboarded,
  // invited-but-unaccepted, or deactivated) is not a session — same rule the
  // web app applies in src/app/(app)/layout.tsx.
  const user = await resolveSessionUser(authUserId);
  if (!user) {
    return NextResponse.json({ error: "NO_WORKSPACE" }, { status: 403 });
  }

  return runWithSession(user, () => dispatch(fn, body.args, `${feature}.${method}`));
}

async function dispatch(
  fn: (args: unknown[]) => Promise<unknown>,
  args: unknown[],
  scope: string,
): Promise<Response> {
  try {
    const data = await fn(args);
    // `data` may legitimately be undefined (void actions); normalise to null so
    // the response is always valid JSON.
    return NextResponse.json({ data: data ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const status = ERROR_STATUS[message];
    if (status) return NextResponse.json({ error: message }, { status });

    // Unexpected failures are logged server-side and reported opaquely, exactly
    // as Server Actions mask thrown errors in production.
    reportError(err, { scope: `mobile-rpc:${scope}` });
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
