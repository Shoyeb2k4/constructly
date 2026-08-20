"use client";

/**
 * DEV/DEMO diagnostic. Stamps auth + company + permission readiness onto the
 * document element, alongside the hydration/demo/query flags set in
 * `providers.tsx` and the animation-frame flag set by the head script.
 *
 * Rendered from the `(app)` layout, so its presence proves the protected shell
 * resolved a session and a company — the layer a stuck route skeleton is most
 * often wrongly blamed on. Never rendered when `isDemoMode` is false.
 */

import * as React from "react";

export function DemoHealthSignal({
  companyName,
  permissionCount,
}: {
  companyName: string;
  permissionCount: number;
}) {
  React.useEffect(() => {
    const flags = document.documentElement.dataset;
    flags.constructlyAuth = "1";
    flags.constructlyCompany = companyName;
    flags.constructlyPermissions = String(permissionCount);
  }, [companyName, permissionCount]);

  return null;
}
