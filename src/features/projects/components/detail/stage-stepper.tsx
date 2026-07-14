"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectStage } from "../../types";
import { STAGE_ORDER, STAGE_LABEL } from "../../constants";

export function StageStepper({
  current,
  onChange,
  disabled,
}: {
  current: ProjectStage;
  onChange: (stage: ProjectStage) => void;
  disabled?: boolean;
}) {
  const currentIdx = STAGE_ORDER.indexOf(current);

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {STAGE_ORDER.map((stage, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <button
            key={stage}
            disabled={disabled}
            onClick={() => onChange(stage)}
            className={cn(
              "group flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-default",
              active
                ? "bg-primary text-primary-foreground"
                : done
                  ? "text-foreground hover:bg-surface-muted"
                  : "text-foreground-subtle hover:bg-surface-muted",
            )}
            title={disabled ? undefined : `Set stage: ${STAGE_LABEL[stage]}`}
          >
            <span
              className={cn(
                "flex size-4 items-center justify-center rounded-full text-[10px]",
                active
                  ? "bg-primary-foreground/20"
                  : done
                    ? "bg-success text-white"
                    : "border border-border-strong",
              )}
            >
              {done ? <Check className="size-3" /> : i + 1}
            </span>
            {STAGE_LABEL[stage]}
          </button>
        );
      })}
    </div>
  );
}
