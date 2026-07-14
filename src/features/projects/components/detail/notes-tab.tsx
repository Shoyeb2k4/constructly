"use client";

import * as React from "react";
import { CloudOff, Send } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/patterns/empty-state";
import { StickyNote } from "lucide-react";
import type { ProjectDetail } from "../../types";
import { relativeTime } from "../../format";
import { useProjectDetailActions } from "../../hooks";

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

export function NotesTab({
  project,
  canEdit,
}: {
  project: ProjectDetail;
  canEdit: boolean;
}) {
  const { addNote } = useProjectDetailActions(project.id);
  const [body, setBody] = React.useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    addNote.mutate(body.trim());
    setBody("");
  }

  return (
    <div className="space-y-6">
      {canEdit && (
        <form onSubmit={submit} className="space-y-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a note about this project…"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(e);
            }}
          />
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs text-foreground-subtle">
              <CloudOff className="size-3.5" />
              Notes work offline and sync automatically
            </span>
            <Button type="submit" variant="secondary" size="sm" disabled={!body.trim()}>
              <Send className="size-3.5" />
              Add note
            </Button>
          </div>
        </form>
      )}

      {project.notes.length === 0 ? (
        <EmptyState
          icon={StickyNote}
          title="No notes yet"
          description="Capture decisions, site observations, and reminders here."
          className="border-0"
        />
      ) : (
        <ul className="space-y-4">
          {project.notes.map((n) => (
            <li key={n.id} className="flex gap-3">
              <Avatar className="size-8 shrink-0">
                <AvatarFallback className="text-[10px]">
                  {initials(n.authorName || "?")}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{n.authorName || "Someone"}</span>
                  <span className="text-xs text-foreground-subtle">
                    {relativeTime(n.createdAt)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground-muted">
                  {n.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
