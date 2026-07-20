"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseUrl, supabasePublishableKey } from "@/lib/env";

/** Browser-side Supabase client (auth in client components). */
export function createClient() {
  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
