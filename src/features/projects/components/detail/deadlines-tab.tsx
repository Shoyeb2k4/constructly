"use client";

import * as React from "react";
import { Plus, Trash2, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";
import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectDetail } from "../../types";
import { deadlineCountdown, formatDate } from "../../format";
import { useProjectDetailActions } from "../../hooks";

export function DeadlinesTab({
  project,
  canEdit,
}: {
  project: ProjectDetail;
  canEdit: boolean;
}) {
  const { addDeadline, toggleDeadline, removeDeadline } = useProjectDetailActions(project.id);
  const [title, setTitle] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !dueDate) return;
    addDeadline.mutate({ title: title.trim(), dueDate });
    setTitle("");
    setDueDate("");
  }

  return (
    <div className="space-y-5">
      {canEdit && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Milestone (e.g. Slab casting — 8th floor)"
            className="min-w-56 flex-1"
          />
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-44"
          />
          <Button type="submit" variant="secondary" disabled={!title.trim() || !dueDate}>
            <Plus />
            Add
          </Button>
        </form>
      )}

      {project.deadlines.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No deadlines"
          description="Add milestones to track this project against its schedule."
        />
      ) : (
        <Card>
          <CardContent className="divide-y divide-border py-0">
            {project.deadlines.map((d) => {
              const cd = deadlineCountdown(d.dueDate, !!d.completedAt);
              return (
                <div key={d.id} className="flex items-center gap-3 py-3">
                  <button
                    onClick={() => canEdit && toggleDeadline.mutate(d.id)}
                    disabled={!canEdit}
                    aria-label={d.completedAt ? "Mark incomplete" : "Mark complete"}
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                      d.completedAt
                        ? "border-success bg-success text-white"
                        : "border-border-strong hover:border-primary",
                    )}
                  >
                    {d.completedAt && <Check className="size-3.5" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-medium", d.completedAt && "text-foreground-subtle line-through")}>
                      {d.title}
                    </p>
                    <p className="text-xs text-foreground-subtle">{formatDate(d.dueDate)}</p>
                  </div>
                  <span
                    className={cn(
                      "text-xs font-medium",
                      cd.tone === "danger"
                        ? "text-danger-foreground"
                        : cd.tone === "warning"
                          ? "text-warning-foreground"
                          : cd.tone === "done"
                            ? "text-success-foreground"
                            : "text-foreground-muted",
                    )}
                  >
                    {cd.label}
                  </span>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-foreground-subtle"
                      onClick={() => removeDeadline.mutate(d.id)}
                      aria-label="Remove deadline"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
