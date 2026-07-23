"use client";

import * as React from "react";
import { CalendarDays, Pencil, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate, deadlineCountdown } from "../../format";
import { useProjectDetailActions } from "../../hooks";

/**
 * Inline editor for the project deadline (expected completion date).
 *
 * The date could previously only be set while creating a project — there was no
 * way to add or change it afterwards, so projects created without one were
 * stuck. Validates against the project start date before saving.
 */
export function DeadlineEditor({
  projectId,
  startDate,
  expectedCompletionDate,
  canEdit,
}: {
  projectId: string;
  startDate: string | null;
  expectedCompletionDate: string | null;
  canEdit: boolean;
}) {
  const { update } = useProjectDetailActions(projectId);
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(expectedCompletionDate ?? "");
  const [error, setError] = React.useState<string | null>(null);

  // Re-seed when the project changes underneath us (cache write, refetch).
  const [prev, setPrev] = React.useState(expectedCompletionDate);
  if (prev !== expectedCompletionDate) {
    setPrev(expectedCompletionDate);
    setValue(expectedCompletionDate ?? "");
  }

  function save() {
    if (value && startDate && value < startDate) {
      setError(`Cannot be before the start date (${formatDate(startDate)})`);
      return;
    }
    setError(null);
    update.mutate({ expectedCompletionDate: value || null });
    setEditing(false);
  }

  function cancel() {
    setValue(expectedCompletionDate ?? "");
    setError(null);
    setEditing(false);
  }

  const cd = deadlineCountdown(expectedCompletionDate);

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-4 py-2.5">
        <span className="flex items-center gap-2 text-sm text-foreground-muted">
          <CalendarDays className="size-4 text-foreground-subtle" />
          Completion
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">
            {formatDate(expectedCompletionDate) || "—"}
          </span>
          {expectedCompletionDate && (
            <span
              className={cn(
                "shrink-0 text-xs font-medium",
                cd.tone === "danger"
                  ? "text-danger-foreground"
                  : cd.tone === "warning"
                    ? "text-warning-foreground"
                    : "text-foreground-muted",
              )}
            >
              {cd.label}
            </span>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-foreground-subtle"
              onClick={() => setEditing(true)}
              aria-label={expectedCompletionDate ? "Edit deadline" : "Add deadline"}
            >
              <Pencil className="size-3.5" />
            </Button>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm text-foreground-muted">
          <CalendarDays className="size-4 text-foreground-subtle" />
          Completion
        </span>
        <div className="flex items-center gap-1">
          <Input
            type="date"
            value={value}
            min={startDate ?? undefined}
            onChange={(e) => setValue(e.target.value)}
            className="h-8 w-40"
            aria-label="Project deadline"
            autoFocus
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={save}
            disabled={update.isPending}
            aria-label="Save deadline"
          >
            <Check className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-foreground-subtle"
            onClick={cancel}
            aria-label="Cancel editing deadline"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
      {error && <p className="mt-1 text-right text-xs text-danger-foreground">{error}</p>}
    </div>
  );
}
