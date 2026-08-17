import { configureMobileAuth } from "@/lib/mobile/session";
import { configureFileSaver } from "@/lib/mobile/save-file";
import { Keyboard, KeyboardResize } from "@capacitor/keyboard";
import { Capacitor } from "@capacitor/core";
import { nativeAuthStorage, describeStorage } from "./secure-storage";
import { nativeFileSaver, nativeFileSaverAvailable } from "./file-saver";
import { publishBridgeDiagnostics, type BridgeStatus } from "./bridge";
import { listenForAuthLinks } from "./auth";
import type { AuthCallback } from "@/lib/mobile/auth-callback";

/**
 * Native start-up, run before React renders.
 *
 * Order matters. `configureMobileAuth` must happen before anything constructs a
 * Supabase client, because supabase-js binds its storage at construction: if a
 * client is created first, the session silently lands in WebView localStorage
 * instead of the Keychain and the mistake is invisible until a security review.
 */
export interface NativeBoot {
  bridge: BridgeStatus;
  storage: { backend: string; secure: boolean };
}

let booted: NativeBoot | null = null;

export async function bootstrapNative(
  onAuthLink: (result: AuthCallback) => void,
): Promise<NativeBoot> {
  if (booted) return booted;

  configureMobileAuth({ storage: nativeAuthStorage });

  // Exports and PDFs use `<a download>`, which WKWebView ignores — without this
  // every export silently produces nothing on a device.
  if (nativeFileSaverAvailable()) {
    configureFileSaver(nativeFileSaver);
  }

  // Keyboard handling. `Native` resize shrinks the WebView rather than sliding
  // it, so a focused field is never left underneath the keyboard, and the
  // accessory bar is hidden because Constructly's forms have their own actions.
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("Keyboard")) {
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native }).catch(() => {});
    await Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});
  }

  // Registered before render so a cold start *caused by* a deep link is not
  // dropped while React is still mounting.
  await listenForAuthLinks(onAuthLink);

  const bridge = await publishBridgeDiagnostics();
  booted = { bridge, storage: describeStorage() };
  return booted;
}

export function nativeBootState(): NativeBoot | null {
  return booted;
}
