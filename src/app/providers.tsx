"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ErrorReporter } from "@/components/error-reporter";
import { isDemoMode } from "@/lib/env";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            // Refetch when the network comes back — pairs with the offline
            // sync engine so views self-heal after a reconnect.
            refetchOnReconnect: true,
            retry: 1,
          },
          mutations: {
            // Server actions are the source of truth; a transient failure
            // retries once before surfacing to the user.
            retry: 1,
          },
        },
      }),
  );

  // DEV/DEMO DIAGNOSTIC. Three implementation passes were lost to the same
  // ambiguous symptom: a page showing a skeleton, with no way to tell whether
  // React had hydrated, whether the demo repository was in use, or whether a
  // route segment had simply never mounted. This stamps the answer onto the
  // document so the next person can read it in one line instead of bisecting.
  //
  // Read `document.documentElement.dataset` and the stuck layer names itself:
  //   no `constructlyHydrated`  → React never hydrated (bundle/boot problem)
  //   no `constructlyDemo`      → NEXT_PUBLIC_CONSTRUCTLY_DEMO missing from the
  //                               CLIENT bundle; the browser is calling real
  //                               server actions (see scripts/demo-env.mjs)
  //   no `constructlyQuery`     → QueryClientProvider never mounted
  //   no `constructlyRafShim`   → the head script did not run; a stuck route
  //                               skeleton may be the hidden-tab reveal bug
  //   no `constructlyAuth`      → session/company never resolved ((app) layout)
  // Never set in a real production build — `isDemoMode` is false there.
  React.useEffect(() => {
    if (!isDemoMode) return;
    const flags = document.documentElement.dataset;
    flags.constructlyHydrated = "1";
    flags.constructlyDemo = "1";
    flags.constructlyQuery = queryClient ? "1" : "0";
  }, [queryClient]);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>
          <ErrorReporter />
          {children}
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
