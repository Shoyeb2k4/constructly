/**
 * Saving a generated file, on both platforms.
 *
 * The web app creates an object URL and clicks a hidden `<a download>`. That is
 * completely inert in WKWebView: the anchor's `download` attribute is ignored,
 * nothing is saved, and — worst of all — nothing fails. Every CSV export and
 * generated PDF would silently do nothing on an iPhone.
 *
 * So the browser path stays exactly as it was, and the native path is injected
 * by `mobile/src/native/` (write to the app's cache directory, then hand the
 * file to the iOS share sheet, which is how a user actually "saves" or sends a
 * file on iOS).
 *
 * DELIBERATELY FREE OF CAPACITOR IMPORTS — this module is reachable from the
 * ordinary web bundle.
 */

export interface NativeFileSaver {
  /** Persist `blob` and present it to the user. Rejects if it could not. */
  save(blob: Blob, filename: string): Promise<void>;
}

let nativeSaver: NativeFileSaver | undefined;

/** Installed once during native bootstrap. */
export function configureFileSaver(saver: NativeFileSaver): void {
  nativeSaver = saver;
}

export function hasNativeFileSaver(): boolean {
  return nativeSaver !== undefined;
}

/**
 * Save a generated file. Returns how it was handled so callers can tailor their
 * confirmation message — "Downloaded" is a lie on iOS, where the file went to a
 * share sheet.
 */
export async function saveGeneratedFile(
  blob: Blob,
  filename: string,
): Promise<"downloaded" | "shared"> {
  if (nativeSaver) {
    await nativeSaver.save(blob, filename);
    return "shared";
  }

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return "downloaded";
}
