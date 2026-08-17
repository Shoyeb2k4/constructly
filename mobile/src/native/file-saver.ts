import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { NativeFileSaver } from "@/lib/mobile/save-file";

/**
 * Native implementation of "save this generated file".
 *
 * iOS has no download folder a web page can write to, so the honest equivalent
 * is: write into the app's own cache directory, then hand the file to the share
 * sheet. From there the user can save to Files, mail it, send it to WhatsApp —
 * which is what people actually do with an exported CSV or a PDF on a phone.
 *
 * Cache (not Documents) on purpose: these are regenerable artefacts, and iOS is
 * allowed to reclaim the space. Keeping every export forever in Documents would
 * bloat the app's storage for no benefit.
 */

/** Blob → base64, which is what Filesystem.writeFile expects. */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the generated file"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      // Strip the "data:<mime>;base64," prefix.
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

/** Strip anything that could escape the cache directory or upset the filesystem. */
function safeName(filename: string): string {
  return filename.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 120) || "constructly-export";
}

export const nativeFileSaver: NativeFileSaver = {
  async save(blob, filename) {
    const name = safeName(filename);
    const data = await toBase64(blob);

    const written = await Filesystem.writeFile({
      path: name,
      data,
      directory: Directory.Cache,
    });

    const canShare = await Share.canShare().catch(() => ({ value: false }));
    if (!canShare.value) {
      // Nothing more we can honestly do — the file exists but iOS gave us no way
      // to present it. Better to say so than to claim it was saved.
      throw new Error("Sharing is unavailable on this device");
    }

    await Share.share({
      title: name,
      // `url` is the file URI returned by writeFile; iOS shares the actual file
      // rather than a link.
      url: written.uri,
      dialogTitle: "Save or send",
    });
  },
};

/** True when the native saver can actually be used. */
export function nativeFileSaverAvailable(): boolean {
  return (
    Capacitor.isNativePlatform() &&
    Capacitor.isPluginAvailable("Filesystem") &&
    Capacitor.isPluginAvailable("Share")
  );
}
