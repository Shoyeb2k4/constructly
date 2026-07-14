"use client";

import * as React from "react";
import { UploadCloud, FileText, ImageIcon, File as FileIcon, Trash2, FileSignature } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { DocumentCategory, ProjectDetail } from "../../types";
import { relativeTime } from "../../format";
import { useProjectDetailActions } from "../../hooks";

const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconFor(category: DocumentCategory) {
  if (category === "PHOTO") return ImageIcon;
  if (category === "PDF" || category === "DRAWING") return FileText;
  if (category === "CONTRACT") return FileSignature;
  return FileIcon;
}

export function DocumentsTab({
  project,
  canEdit,
}: {
  project: ProjectDetail;
  canEdit: boolean;
}) {
  const { addDocument, removeDocument } = useProjectDetailActions(project.id);
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function ingest(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((f) => {
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name} is too large`, { description: "Max 25 MB per file." });
        return;
      }
      if (f.type && !ACCEPT.includes(f.type)) {
        toast.error(`${f.name} isn't a supported type`);
        return;
      }
      addDocument.mutate({ filename: f.name, sizeBytes: f.size, mimeType: f.type || "application/octet-stream" });
    });
  }

  return (
    <div className="space-y-5">
      {canEdit && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            ingest(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
            dragging ? "border-primary bg-info-subtle/40" : "border-border-strong hover:bg-surface-muted/40",
          )}
        >
          <UploadCloud className="size-7 text-foreground-subtle" />
          <p className="mt-3 text-sm font-medium">Drop files here, or click to browse</p>
          <p className="mt-1 text-xs text-foreground-subtle">
            Drawings, PDFs, photos, contracts · up to 25 MB
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => ingest(e.target.files)}
          />
        </div>
      )}

      {project.documents.length === 0 ? (
        <p className="py-6 text-center text-sm text-foreground-subtle">
          No documents uploaded yet.
        </p>
      ) : (
        <Card>
          <CardContent className="divide-y divide-border py-0">
            {project.documents.map((doc) => {
              const Icon = iconFor(doc.category);
              return (
                <div key={doc.id} className="flex items-center gap-3 py-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-foreground-subtle">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{doc.filename}</p>
                    <p className="text-xs text-foreground-subtle">
                      {formatBytes(doc.sizeBytes)} · {relativeTime(doc.createdAt)}
                      {doc.uploadedByName ? ` · ${doc.uploadedByName}` : ""}
                    </p>
                  </div>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-foreground-subtle"
                      onClick={() => removeDocument.mutate(doc.id)}
                      aria-label="Delete document"
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
