import { Activity } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import type { ProjectDetail } from "../../types";
import { relativeTime } from "../../format";

export function ActivityTab({ project }: { project: ProjectDetail }) {
  if (project.activity.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No activity yet"
        description="Changes to this project will appear here."
        className="border-0"
      />
    );
  }

  return (
    <ul className="space-y-0">
      {project.activity.map((a, i) => (
        <li key={a.id} className="relative flex gap-4 pb-6 last:pb-0">
          {i < project.activity.length - 1 && (
            <span className="absolute left-[7px] top-4 h-full w-px bg-border" />
          )}
          <span className="mt-1 size-3.5 shrink-0 rounded-full border-2 border-surface bg-primary" />
          <div className="min-w-0">
            <p className="text-sm leading-snug">
              {a.actorName && <span className="font-medium">{a.actorName} </span>}
              <span className="text-foreground-muted">{a.summary}</span>
            </p>
            <span className="text-xs text-foreground-subtle">
              {relativeTime(a.createdAt)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
