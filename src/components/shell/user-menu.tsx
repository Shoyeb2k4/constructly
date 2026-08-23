"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Settings } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SessionUser } from "@/lib/auth/types";

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  async function signOut() {
    const { isSupabaseConfigured } = await import("@/lib/env");
    if (!isSupabaseConfigured) {
      toast("You're in demo mode", {
        description: "Connect Supabase to enable authentication.",
      });
      return;
    }

    // The native app holds its session in the Keychain via the mobile Supabase
    // client, not in cookies — signing out through the SSR browser client would
    // leave that session (and its refresh token) intact. Dynamically imported so
    // the web bundle is unchanged.
    const { isNativeClient } = await import("@/lib/mobile/platform");
    if (isNativeClient) {
      const { signOutMobile } = await import("@/lib/mobile/session");
      await signOutMobile();
      // Drop every cached query so no authenticated data outlives the session,
      // then let the session gate fall back to the sign-in screen.
      queryClient.clear();
      return;
    }

    const { createClient } = await import("@/lib/supabase/client");
    await createClient().auth.signOut();
    router.push("/sign-in");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar>
          <AvatarFallback>{initials(user.fullName)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">
              {user.fullName}
            </span>
            <span className="text-xs font-normal text-foreground-subtle">
              {user.email}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/settings")}>
          <Settings />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
