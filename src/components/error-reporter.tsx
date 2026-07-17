"use client";

import * as React from "react";
import { reportError } from "@/lib/logger";

/**
 * Catches otherwise-unhandled client errors (runtime throws that escape React,
 * and rejected promises) and routes them through the same `reportError` sink as
 * the server + error boundaries. Renders nothing. Mount once, high in the tree.
 */
export function ErrorReporter() {
  React.useEffect(() => {
    const onError = (e: ErrorEvent) => {
      reportError(e.error ?? e.message, { scope: "window.onerror", source: e.filename });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      reportError(e.reason, { scope: "unhandledrejection" });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
