"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ProjectListItem } from "../types";
import { useProjectActions } from "../hooks";

const ACK_TEXT = "I understand this action is permanent and cannot be undone.";

/**
 * Secure "Danger Zone" permanent-delete flow. Three independent gates must all
 * pass before the destructive button unlocks:
 *   1. the Owner types the exact project name,
 *   2. checks the acknowledgement box, and
 *   3. re-enters their account password (verified server-side).
 * The delete is a soft delete under the hood (recoverable by an Owner), but the
 * flow is intentionally heavyweight to make accidental data loss near-impossible.
 */
export function ProjectDeleteDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Pick<ProjectListItem, "id" | "name">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { remove } = useProjectActions();

  const [typedName, setTypedName] = React.useState("");
  const [ack, setAck] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Clear every field on close so a password/name is never carried into the next
  // open — the fields start empty, so the next open is always a clean slate.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setTypedName("");
      setAck(false);
      setPassword("");
      setReason("");
      setError(null);
    }
    onOpenChange(next);
  }

  const nameMatches = typedName.trim() === project.name.trim();
  const canDelete = nameMatches && ack && password.length > 0 && !remove.isPending;

  function submit() {
    if (!canDelete) return;
    setError(null);
    remove.mutate(
      { id: project.id, password, reason: reason.trim() || null },
      {
        onSuccess: () => {
          handleOpenChange(false);
          // If we deleted from the project's own detail page, leave it.
          if (pathname?.startsWith(`/projects/${project.id}`)) router.push("/projects");
        },
        onError: (e) => {
          const msg = e instanceof Error ? e.message : "";
          if (/INVALID_PASSWORD/i.test(msg)) {
            setError("Incorrect password. Please re-enter your account password.");
          } else if (/NOT_FOUND/i.test(msg)) {
            setError("This project could no longer be found.");
          } else {
            setError("Couldn't delete the project. Please try again.");
          }
          setPassword("");
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-danger-foreground">
            <AlertTriangle className="size-5" />
            Delete {project.name} permanently
          </DialogTitle>
          <DialogDescription className="sr-only">
            High-risk permanent project deletion. Requires name confirmation,
            acknowledgement, and your password.
          </DialogDescription>
        </DialogHeader>

        {/* High-risk warning */}
        <div className="rounded-[var(--radius)] border border-danger/40 bg-danger-subtle p-3.5 text-sm text-danger-foreground">
          <p className="font-semibold">This is a high-risk action.</p>
          <p className="mt-1 leading-relaxed">
            Deleting this project permanently removes it and all related data from
            your workspace, including:
          </p>
          <ul className="mt-2 grid list-disc grid-cols-2 gap-x-4 gap-y-0.5 pl-5">
            <li>Project details</li>
            <li>Purchase orders</li>
            <li>Labour records</li>
            <li>Payments</li>
            <li>Reports</li>
            <li>Documents</li>
          </ul>
        </div>

        <div className="space-y-4">
          {/* 1 — type the exact name */}
          <div className="space-y-1.5">
            <Label htmlFor="del-name">
              Type <span className="font-mono font-semibold">{project.name}</span> to confirm
            </Label>
            <Input
              id="del-name"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder={project.name}
              autoComplete="off"
              autoFocus
              aria-invalid={typedName.length > 0 && !nameMatches}
            />
          </div>

          {/* 2 — acknowledge */}
          <button
            type="button"
            role="checkbox"
            aria-checked={ack}
            onClick={() => setAck((v) => !v)}
            className="flex w-full items-start gap-2.5 text-left"
          >
            <span
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border transition-colors",
                ack
                  ? "border-danger bg-danger text-white"
                  : "border-border-strong bg-surface",
              )}
            >
              {ack && <Check className="size-3.5" />}
            </span>
            <span className="text-sm text-foreground">{ACK_TEXT}</span>
          </button>

          {/* 3 — re-authenticate */}
          <div className="space-y-1.5">
            <Label htmlFor="del-password">Enter your account password</Label>
            <Input
              id="del-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>

          {/* optional reason (stored for audit / recovery) */}
          <div className="space-y-1.5">
            <Label htmlFor="del-reason">
              Reason <span className="text-foreground-subtle">(optional)</span>
            </Label>
            <Input
              id="del-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. duplicate entry, cancelled project"
            />
          </div>

          {error && (
            <p className="text-sm font-medium text-danger-foreground" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="mt-1 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={remove.isPending}
          >
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} disabled={!canDelete}>
            {remove.isPending && <Loader2 className="size-4 animate-spin" />}
            Delete permanently
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
