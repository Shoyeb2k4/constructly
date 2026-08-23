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

/**
 * A repository method that forwards to the RPC allowlist.
 *
 * Used to build the `http-repository.ts` of each feature. The point is not
 * brevity — it is that the object literal is still declared as the feature's
 * Repository interface, so TypeScript checks the whole surface: a missing
 * method, a misspelled key or a signature that drifted from the interface is a
 * compile error, not a runtime 404 discovered on a phone.
 *
 * The method name given here must match the key registered in
 * `src/app/api/mobile/registry.ts`. That pairing is the one thing the compiler
 * cannot check, so `registry.test.ts` asserts it instead.
 */
export function rpcMethod<F extends (...args: never[]) => Promise<unknown>>(
  feature: string,
  method: string,
): F {
  // Double assertion: the forwarder is uniformly variadic, which TypeScript
  // cannot prove is assignable to every specific F the interfaces ask for.
  // Safety comes from the call site — the object literal is annotated with the
  // Repository interface, so each method is still checked against it there.
  return ((...args: unknown[]) => call(feature, method, args)) as unknown as F;
}
