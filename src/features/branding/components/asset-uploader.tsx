"use client";

import * as React from "react";
import { toast } from "sonner";
import { UploadCloud, Trash2, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ASSET_SPECS } from "../constants";
import { validateAsset } from "../assets";
import { useUploadAsset, useRemoveAsset } from "../hooks";
import type { BrandAssetKind } from "../types";

export function AssetUploader({
  kind,
  currentUrl,
  label,
  hint,
  previewClassName,
  previewBg = "muted",
}: {
  kind: BrandAssetKind;
  currentUrl: string | null | undefined;
  label?: string;
  hint?: string;
  previewClassName?: string;
  /** Backdrop behind the preview — "dark" helps when previewing light logos. */
  previewBg?: "muted" | "dark" | "light";
}) {
  const upload = useUploadAsset();
  const remove = useRemoveAsset();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const spec = ASSET_SPECS[kind];
  const busy = upload.isPending || remove.isPending;

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const err = validateAsset(kind, { type: file.type, size: file.size });
    if (err) {
      toast.error(err);
      return;
    }
    upload.mutate({ kind, file });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-2">
      {label && <p className="text-sm font-medium">{label}</p>}
      <div
        role="button"
        tabIndex={0}
        aria-label={`Upload ${spec.label}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        className={cn(
          "relative flex h-32 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed border-border p-4 text-center outline-none transition-colors hover:border-border-strong focus-visible:border-primary",
          previewBg === "dark" && "bg-neutral-900",
          previewBg === "light" && "bg-white",
          previewBg === "muted" && "bg-surface-muted/30",
          dragOver && "border-primary bg-primary/5",
        )}
      >
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL
          <img
            src={currentUrl}
            alt={`${spec.label} preview`}
            className={cn("max-h-full max-w-full object-contain", previewClassName)}
          />
        ) : (
          <>
            <UploadCloud className="size-6 text-foreground-subtle" />
            <p className="text-xs text-foreground-muted">Drag &amp; drop, or click to upload</p>
          </>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/70">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={spec.mimeTypes.join(",")}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
          <RefreshCw className="size-3.5" />
          {currentUrl ? "Replace" : "Upload"}
        </Button>
        {currentUrl && (
          <Button
            variant="ghost"
            size="sm"
            className="text-danger-foreground"
            onClick={() => remove.mutate(kind)}
            disabled={busy}
          >
            <Trash2 className="size-3.5" />
            Remove
          </Button>
        )}
        <span className="ml-auto text-xs text-foreground-subtle">
          {hint ?? `Max ${Math.round(spec.maxBytes / 1024)} KB`}
        </span>
      </div>
    </div>
  );
}
