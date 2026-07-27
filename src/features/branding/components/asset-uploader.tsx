"use client";

import * as React from "react";
import { toast } from "sonner";
import { UploadCloud, Trash2, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ASSET_SPECS } from "../constants";
import { validateAsset } from "../assets";
import { optimizeImage, blobToFile } from "../process-image";
import { useUploadAsset, useRemoveAsset } from "../hooks";
import type { BrandAssetKind } from "../types";
import { CropDialog } from "./crop-dialog";

// Square assets get a fixed crop aspect; others crop freely.
const CROP_ASPECT: Partial<Record<BrandAssetKind, number>> = {
  photo: 1,
  squareLogo: 1,
  favicon: 1,
};
// Cap the longest side when re-encoding (favicons stay tiny).
const MAX_DIM: Partial<Record<BrandAssetKind, number>> = { favicon: 256 };

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
  const [cropFile, setCropFile] = React.useState<File | null>(null);
  const spec = ASSET_SPECS[kind];
  const busy = upload.isPending || remove.isPending;

  async function startUpload(file: File) {
    let out = file;
    try {
      const optimized = await optimizeImage(file, { maxDim: MAX_DIM[kind] });
      if (optimized !== file) out = blobToFile(optimized, file.name);
    } catch {
      /* fall back to the original file */
    }
    upload.mutate({ kind, file: out });
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    const err = validateAsset(kind, { type: file.type, size: file.size });
    if (err) {
      toast.error(err);
      return;
    }
    // Vector images can't be cropped/rasterized — upload as-is. Everything else
    // opens the crop dialog first.
    if (file.type === "image/svg+xml") {
      void startUpload(file);
    } else {
      setCropFile(file);
    }
  }

  function onCropped(blob: Blob) {
    const name = cropFile?.name ?? `${kind}.png`;
    setCropFile(null);
    void startUpload(blobToFile(blob, name));
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

      <CropDialog
        file={cropFile}
        aspect={CROP_ASPECT[kind]}
        onCancel={() => setCropFile(null)}
        onCropped={onCropped}
      />
    </div>
  );
}
