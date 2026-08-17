import * as React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { MobileApp } from "./app";
import { markMounted, markScreen } from "./boot-marker";
import { bootstrapNative } from "./native/bootstrap";
import { authLinkBus } from "./auth-link-bus";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root");

/**
 * Native services are configured BEFORE the first render so that the session
 * store is installed before any Supabase client can be constructed. Rendering
 * is not blocked on a native failure: a browser preview has no bridge at all,
 * and on a device a diagnostics write failing is not a reason to show nothing.
 */
bootstrapNative((result) => authLinkBus.emit(result))
  .then((boot) => {
    markScreen("native-boot", {
      platform: boot.bridge.platform,
      native: boot.bridge.isNative,
      storage: boot.storage.backend,
    });
  })
  .catch(() => {
    markScreen("native-boot", { platform: "unknown", native: false, storage: "unavailable" });
  })
  .finally(() => {
    createRoot(container).render(
      <React.StrictMode>
        <MobileApp />
      </React.StrictMode>,
    );
    markMounted();
  });
