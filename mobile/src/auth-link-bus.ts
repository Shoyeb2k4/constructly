import type { AuthCallback } from "@/lib/mobile/auth-callback";

/**
 * Hands deep-link results from the native listener (registered before React
 * mounts) to whichever component is currently on screen.
 *
 * A plain event emitter rather than React state because the producer exists
 * outside the React tree and can fire before the tree exists — a cold start
 * caused by tapping an OAuth or reset link. Late subscribers still get the last
 * result, so nothing is lost in that race.
 */
type Listener = (result: AuthCallback) => void;

class AuthLinkBus {
  private listeners = new Set<Listener>();
  private last: AuthCallback | null = null;

  emit(result: AuthCallback): void {
    // "ignored" is not an event anyone needs to react to.
    if (result.kind === "ignored") return;
    this.last = result;
    for (const listener of this.listeners) listener(result);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.last) listener(this.last);
    return () => void this.listeners.delete(listener);
  }

  /** Consume the buffered result so a later mount does not replay it. */
  clear(): void {
    this.last = null;
  }
}

export const authLinkBus = new AuthLinkBus();
