"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

/** The pencil that opens a section's edit panel — sits in each card header. */
export function SectionEditButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 text-foreground-subtle"
      onClick={onClick}
      aria-label={label}
    >
      <Pencil className="size-3.5" />
    </Button>
  );
}

/**
 * Shared shell for the project-detail section edit panels (Budget, Client & site,
 * Details, Location). Keeps the Sheet chrome, scroll area, and footer consistent;
 * each section supplies its own fields + submit handler.
 */
export function SectionEditSheet({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  saving,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  saving: boolean;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">{children}</div>
          <SheetFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
