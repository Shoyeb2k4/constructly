"use client";

import * as React from "react";
import { Check, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MoneyText } from "@/components/patterns/money-text";
import { cn } from "@/lib/utils";
import { useLaborers } from "../../hooks";

export function AddWorkersDialog({
  open,
  onOpenChange,
  crewIds,
  onAdd,
  isAdding,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  crewIds: Set<string>;
  onAdd: (ids: string[]) => void;
  isAdding: boolean;
}) {
  const { data: laborers = [] } = useLaborers({ status: "ACTIVE" });
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const available = laborers.filter(
    (l) =>
      !crewIds.has(l.id) &&
      (l.fullName.toLowerCase().includes(search.toLowerCase()) ||
        l.trade.toLowerCase().includes(search.toLowerCase())),
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    onAdd([...selected]);
    setSelected(new Set());
    setSearch("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Add workers to today</DialogTitle>
          <DialogDescription>
            They&apos;ll be marked present — adjust as needed.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search workers…"
              className="pl-9"
              autoFocus
            />
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto px-3 py-2">
          {available.length === 0 ? (
            <p className="py-8 text-center text-sm text-foreground-subtle">
              Everyone&apos;s already on the crew.
            </p>
          ) : (
            available.map((l) => {
              const on = selected.has(l.id);
              return (
                <button
                  key={l.id}
                  onClick={() => toggle(l.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-muted"
                >
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-md border",
                      on ? "border-primary bg-primary text-white" : "border-border-strong",
                    )}
                  >
                    {on && <Check className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{l.fullName}</span>
                    <span className="block truncate text-xs text-foreground-subtle">
                      {l.trade} · <MoneyText paise={l.dailyWagePaise} whole />
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={selected.size === 0 || isAdding}
            onClick={submit}
          >
            Add {selected.size > 0 ? selected.size : ""} worker{selected.size === 1 ? "" : "s"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
