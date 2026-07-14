"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Moon, Plus, Sun } from "lucide-react";
import { FolderKanban } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { NAV_ITEMS } from "@/config/nav";
import { useProjects } from "@/features/projects/hooks";

/** Open the command palette from anywhere (e.g. the topbar search button). */
export function openCommandPalette() {
  document.dispatchEvent(new Event("constructly:command-open"));
}

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { data: projects = [] } = useProjects({});

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("constructly:command-open", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("constructly:command-open", onOpen);
    };
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search or jump to…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {NAV_ITEMS.map((item) => (
            <CommandItem
              key={item.href}
              value={item.label}
              onSelect={() => go(item.href)}
            >
              <item.icon />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {projects.length > 0 && (
          <CommandGroup heading="Projects">
            {projects.slice(0, 50).map((p) => (
              <CommandItem
                key={p.id}
                value={`${p.name} ${p.code}`}
                onSelect={() => go(`/projects/${p.id}`)}
              >
                <FolderKanban />
                <span className="flex-1 truncate">{p.name}</span>
                <CommandShortcut>{p.code}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Actions">
          <CommandItem value="New project" onSelect={() => go("/projects")}>
            <Plus />
            New project
            <CommandShortcut>N</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="Toggle theme"
            onSelect={() => {
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
              setOpen(false);
            }}
          >
            {resolvedTheme === "dark" ? <Sun /> : <Moon />}
            Toggle theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
