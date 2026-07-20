"use server";

import { requireUser } from "@/lib/auth/current-user";
import { createServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db/prisma";
import { reportError } from "@/lib/logger";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.ms-excel",
  "text/csv",
  "application/zip",
]);

function categoryFor(mime: string): "PHOTO" | "PDF" | "OTHER" {
  if (mime.startsWith("image/")) return "PHOTO";
  if (mime === "application/pdf") return "PDF";
  return "OTHER";
}

/** Server-side validation — never trust the client's checks. */
function validate(file: File): string | null {
  if (!(file instanceof File) || file.size === 0) return "Empty file";
  if (file.size > MAX_BYTES) return "File exceeds the 25 MB limit";
  if (file.type && !ALLOWED_MIME.has(file.type)) return "Unsupported file type";
  return null;
}

function sanitizeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(-120) || "file";
}

/**
 * Upload a project document: bytes to the private `documents` bucket
 * (path <companyId>/<projectId>/…, enforced by Storage RLS via the caller's
 * session), then the metadata row. Storage write happens first so a metadata
 * row never points at a missing object.
 */
export async function uploadProjectDocument(
  projectId: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      companyId: user.company.id,
      deletedAt: null,
      ...(user.role !== "OWNER" ? { pmId: user.id } : {}),
    },
    select: { id: true },
  });
  if (!project) return { ok: false, error: "Forbidden" };

  const file = formData.get("file") as File | null;
  const invalid = file ? validate(file) : "No file";
  if (!file || invalid) return { ok: false, error: invalid ?? "No file" };

  const path = `${user.company.id}/${projectId}/${Date.now()}-${sanitizeName(file.name)}`;
  const supabase = await createServerClient();
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(path, file, { contentType: file.type || "application/octet-stream" });
  if (uploadError) {
    reportError(uploadError, { scope: "upload", projectId });
    return { ok: false, error: "Upload failed. Please try again." };
  }

  await prisma.projectDocument.create({
    data: {
      companyId: user.company.id,
      projectId,
      category: categoryFor(file.type),
      storagePath: path,
      filename: file.name,
      sizeBytes: file.size,
      mimeType: file.type || "application/octet-stream",
      uploadedById: user.id,
    },
  });
  return { ok: true };
}

/** Upload a vendor document (path <companyId>/vendors/<vendorId>/…). */
export async function uploadVendorDocument(
  vendorId: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, companyId: user.company.id },
    select: { id: true },
  });
  if (!vendor) return { ok: false, error: "Forbidden" };

  const file = formData.get("file") as File | null;
  const invalid = file ? validate(file) : "No file";
  if (!file || invalid) return { ok: false, error: invalid ?? "No file" };

  const path = `${user.company.id}/vendors/${vendorId}/${Date.now()}-${sanitizeName(file.name)}`;
  const supabase = await createServerClient();
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(path, file, { contentType: file.type || "application/octet-stream" });
  if (uploadError) {
    reportError(uploadError, { scope: "upload", vendorId });
    return { ok: false, error: "Upload failed. Please try again." };
  }

  await prisma.vendorDocument.create({
    data: {
      companyId: user.company.id,
      vendorId,
      category: categoryFor(file.type),
      storagePath: path,
      filename: file.name,
      sizeBytes: file.size,
      mimeType: file.type || "application/octet-stream",
      uploadedById: user.id,
    },
  });
  return { ok: true };
}

/** Short-lived signed URL for downloading a document the caller can see. */
export async function getDocumentUrl(
  storagePath: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await requireUser();
  // Path must belong to the caller's company (defense in depth on top of
  // Storage RLS, which enforces the same prefix).
  if (!storagePath.startsWith(`${user.company.id}/`)) {
    return { ok: false, error: "Forbidden" };
  }
  const supabase = await createServerClient();
  const { data, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(storagePath, 60 * 10);
  if (error || !data) return { ok: false, error: "Couldn't create a download link" };
  return { ok: true, url: data.signedUrl };
}
