"use client";

import * as React from "react";
import { ErrorState } from "@/components/patterns/error-state";
import { reportError } from "@/lib/logger";

/** Route-level error boundary for the authenticated app. Keeps the shell
 *  (sidebar/topbar) mounted and offers a retry without a full reload. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    reportError(error, { scope: "route-boundary", digest: error.digest });
  }, [error]);

  return (
    <div className="py-10">
      <ErrorState
        title="This page hit a snag"
        description="Something went wrong loading this view. Your data is safe — try again."
        onRetry={reset}
        detail={process.env.NODE_ENV === "production" ? undefined : error.message}
      />
    </div>
  );
}
