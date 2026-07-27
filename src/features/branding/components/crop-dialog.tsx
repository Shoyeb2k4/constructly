"use client";

import * as React from "react";
import ReactCrop, {
  type Crop,
  type PixelCrop,
  centerCrop,
  makeAspectCrop,
} from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cropImage } from "../process-image";

export function CropDialog({
  file,
  aspect,
  onCancel,
  onCropped,
}: {
  /** When set, the dialog is open and crops this file. */
  file: File | null;
  aspect?: number;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
}) {
  const [crop, setCrop] = React.useState<Crop>();
  const [completed, setCompleted] = React.useState<PixelCrop>();
  const [busy, setBusy] = React.useState(false);
  const imgRef = React.useRef<HTMLImageElement | null>(null);

  // Object URL for the selected file, revoked when it changes or unmounts.
  const src = React.useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  React.useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    setCompleted(undefined);
    const { width, height } = e.currentTarget;
    setCrop(
      centerCrop(
        makeAspectCrop({ unit: "%", width: 90 }, aspect ?? width / height, width, height),
        width,
        height,
      ),
    );
  }

  async function apply() {
    if (!file) return;
    const img = imgRef.current;
    if (!img || !completed || completed.width === 0) {
      onCropped(file); // nothing selected — use the whole image
      return;
    }
    setBusy(true);
    const scaleX = img.naturalWidth / img.width;
    const scaleY = img.naturalHeight / img.height;
    const blob = await cropImage(file, {
      x: completed.x * scaleX,
      y: completed.y * scaleY,
      width: completed.width * scaleX,
      height: completed.height * scaleY,
    });
    setBusy(false);
    onCropped(blob);
  }

  return (
    <Dialog open={!!file} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Crop image</DialogTitle>
          <DialogDescription>Drag to adjust the crop, then apply.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] justify-center overflow-auto rounded-lg bg-surface-muted/40 p-2">
          {src && (
            <ReactCrop
              crop={crop}
              onChange={(_, percent) => setCrop(percent)}
              onComplete={(c) => setCompleted(c)}
              aspect={aspect}
              keepSelection
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL for cropping */}
              <img
                ref={imgRef}
                src={src}
                alt="Crop preview"
                onLoad={onImageLoad}
                style={{ maxWidth: "100%", maxHeight: "50vh" }}
              />
            </ReactCrop>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={apply} disabled={busy}>
            Apply crop
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
