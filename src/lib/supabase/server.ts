import { createServerClient as createSSRClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseUrl, supabasePublishableKey } from "@/lib/env";

/** Server-side Supabase client bound to the request cookie store. */
export async function createServerClient() {
  const cookieStore = await cookies();
  return createSSRClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // `setAll` from a Server Component — safe to ignore when middleware
          // refreshes the session.
        }
      },
    },
  });
}
