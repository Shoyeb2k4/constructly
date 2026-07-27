"use client";

/** Client-side image processing: crop + optimize before upload. */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Downscale (cap the longest side) and re-encode a raster image. Vector SVGs
 * pass through untouched. PNGs keep PNG (transparency); others become WebP.
 * Falls back to the original blob on any failure.
 */
export async function optimizeImage(
  source: Blob,
  opts: { maxDim?: number; quality?: number } = {},
): Promise<Blob> {
  if (source.type === "image/svg+xml") return source;
  const maxDim = opts.maxDim ?? 1024;
  const url = URL.createObjectURL(source);
  try {
    const img = await loadImage(url);
    const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1;
    const scale = Math.min(1, maxDim / longest);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return source;
    ctx.drawImage(img, 0, 0, w, h);
    const type = source.type === "image/png" ? "image/png" : "image/webp";
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, opts.quality ?? 0.85));
    // Keep whichever is smaller (optimization shouldn't inflate).
    return blob && blob.size < source.size ? blob : source;
  } catch {
    return source;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Crop a source image to a pixel rectangle, returning a PNG blob. */
export async function cropImage(source: Blob, rect: PixelRect): Promise<Blob> {
  const url = URL.createObjectURL(source);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) return source;
    ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png", 0.92));
    return blob ?? source;
  } catch {
    return source;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Wrap a blob as a File (upload API expects File). */
export function blobToFile(blob: Blob, name: string): File {
  const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
  const base = name.replace(/\.[^.]+$/, "");
  return new File([blob], `${base}.${ext}`, { type: blob.type });
}
