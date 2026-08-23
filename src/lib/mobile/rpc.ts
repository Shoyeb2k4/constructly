import { mobileApiBase } from "./platform";
import { getAccessToken } from "./session";

/**
 * HTTP transport for the native app: the mobile equivalent of invoking a Server
 * Action. One `call()` maps to one registered method in
 * `src/app/api/mobile/registry.ts`, which then runs the very same server
 * function the web app calls — so business logic and RBAC are shared, not
 * duplicated.
 */

export class RpcError extends Error {
  constructor(
    /** Domain code from the server: UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, … */
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "RpcError";
  }
}

export async function call<T>(feature: string, method: string, args: unknown[] = []): Promise<T> {
  const token = await getAccessToken();

  const res = await fetch(`${mobileApiBase}/api/mobile/${feature}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ args }),
  });

  const payload = (await res.json().catch(() => ({}))) as { data?: T; error?: string };

  if (!res.ok) {
    throw new RpcError(payload.error ?? "INTERNAL", res.status);
  }
  return payload.data as T;
}
