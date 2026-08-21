"use client";

import type { jsPDF } from "jspdf";
import { brandingApi } from "./data";
import { CONSTRUCTLY_NAME } from "./constants";
import type { PdfCompany } from "./types";

interface PdfImage {
  dataUrl: string;
  width: number;
  height: number;
}

interface PdfBranding {
  company: PdfCompany;
  preparedBy: string;
  logo: PdfImage | null;
  stamp: PdfImage | null;
  signature: PdfImage | null;
}

const CONSTRUCTLY_COMPANY: PdfCompany = {
  name: CONSTRUCTLY_NAME,
  legalName: null,
  gstin: null,
  addressLine: null,
  city: null,
  state: null,
  country: null,
  pincode: null,
  phone: null,
  email: null,
  website: null,
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Fetch a signed asset URL and rasterize it to a PNG data URL (also normalizes
 * SVG, which jsPDF can't embed directly). Returns null on any failure so a
 * missing/broken asset never blocks the export.
 */
async function rasterize(url: string | null): Promise<PdfImage | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = await loadImage(objectUrl);
      const w = img.naturalWidth || 320;
      const h = img.naturalHeight || 120;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);
      return { dataUrl: canvas.toDataURL("image/png"), width: w, height: h };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}

/** Load company branding + rasterized assets for a PDF. Never throws. */
async function loadPdfBranding(): Promise<PdfBranding> {
  let data = null;
  try {
    data = await brandingApi.getPdfBrandingData();
  } catch {
    /* fall back to Constructly */
  }
  const [logo, stamp, signature] = await Promise.all([
    rasterize(data?.logoUrl ?? null),
    rasterize(data?.stampUrl ?? null),
    rasterize(data?.signatureUrl ?? null),
  ]);
  return {
    company: data?.company ?? CONSTRUCTLY_COMPANY,
    preparedBy: data?.preparedBy ?? "",
    logo,
    stamp,
    signature,
  };
}

function companyLines(c: PdfCompany): string[] {
  const lines: string[] = [];
  if (c.addressLine) lines.push(c.addressLine);
  const cityLine = [c.city, [c.state, c.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (cityLine) lines.push(cityLine);
  if (c.country) lines.push(c.country);
  if (c.gstin) lines.push(`GSTIN: ${c.gstin}`);
  const contact = [c.phone, c.email].filter(Boolean).join("  ·  ");
  if (contact) lines.push(contact);
  if (c.website) lines.push(c.website);
  return lines;
}

const MARGIN = 14;

function drawHeader(doc: jsPDF, b: PdfBranding, opts: BrandedPdfOptions): number {
  const pageW = doc.internal.pageSize.getWidth();
  let logoW = 0;
  const logoH = 14;
  if (b.logo) {
    logoW = Math.min(40, (logoH * b.logo.width) / b.logo.height);
    doc.addImage(b.logo.dataUrl, "PNG", MARGIN, 12, logoW, logoH);
  }
  const nameX = b.logo ? MARGIN + logoW + 4 : MARGIN;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(0);
  doc.text(b.company.name, nameX, 20);
  if (b.company.legalName && b.company.legalName !== b.company.name) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(b.company.legalName, nameX, 25);
  }

  // Company details block, right-aligned.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(90);
  let ry = 14;
  for (const line of companyLines(b.company)) {
    doc.text(line, pageW - MARGIN, ry, { align: "right" });
    ry += 3.8;
  }
  doc.setTextColor(0);

  const dividerY = Math.max(12 + logoH, ry) + 2;
  doc.setDrawColor(220);
  doc.line(MARGIN, dividerY, pageW - MARGIN, dividerY);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(opts.title, MARGIN, dividerY + 8);
  let y = dividerY + 8;
  if (opts.subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(opts.subtitle, MARGIN, dividerY + 13);
    doc.setTextColor(0);
    y = dividerY + 13;
  }
  return y + 6;
}

/** Signature (right) + stamp (left) near the end of the document. */
function drawSignatureAndStamp(doc: jsPDF, b: PdfBranding): void {
  if (!b.signature && !b.stamp) return;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const lastAutoTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  let y = (lastAutoTable?.finalY ?? 40) + 14;
  if (y + 40 > pageH - 16) {
    doc.addPage();
    y = 24;
  } else {
    doc.setPage(doc.getNumberOfPages());
  }

  if (b.stamp) {
    const h = 26;
    const w = Math.min(42, (h * b.stamp.width) / b.stamp.height);
    doc.addImage(b.stamp.dataUrl, "PNG", MARGIN, y, w, h);
  }
  if (b.signature) {
    const h = 16;
    const w = Math.min(55, (h * b.signature.width) / b.signature.height);
    const rightX = pageW - MARGIN;
    doc.addImage(b.signature.dataUrl, "PNG", rightX - w, y, w, h);
    doc.setDrawColor(180);
    doc.line(rightX - 55, y + h + 2, rightX, y + h + 2);
    doc.setFontSize(8);
    doc.setTextColor(90);
    doc.text("Authorised signatory", rightX, y + h + 6.5, { align: "right" });
    if (b.preparedBy) doc.text(b.preparedBy, rightX, y + h + 10.5, { align: "right" });
    doc.setTextColor(0);
  }
}

/** Footer on every page: company · prepared by · generated · page X of Y. */
function drawFooters(doc: jsPDF, b: PdfBranding): void {
  const total = doc.getNumberOfPages();
  const generated = `Generated ${new Date().toLocaleString("en-IN")}`;
  const left = b.preparedBy ? `${b.company.name}  ·  Prepared by ${b.preparedBy}` : b.company.name;
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const fy = pageH - 8;
    doc.setDrawColor(230);
    doc.line(MARGIN, fy - 3.5, pageW - MARGIN, fy - 3.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(130);
    doc.text(left, MARGIN, fy);
    doc.text(generated, pageW / 2, fy, { align: "center" });
    doc.text(`Page ${i} of ${total}`, pageW - MARGIN, fy, { align: "right" });
    doc.setTextColor(0);
  }
}

export interface BrandedPdfOptions {
  title: string;
  subtitle?: string;
  orientation?: "portrait" | "landscape";
}

export interface BrandedDoc {
  doc: jsPDF;
  /** Y coordinate to begin body content below the header. */
  startY: number;
  /** Draw signature/stamp + footers on all pages, then save. */
  finalize: (filename: string) => void;
}

/**
 * The single entry point every PDF exporter uses. Loads company branding
 * (Constructly fallback), creates the document, draws the branded header, and
 * hands back the doc + a startY and a finalize() that stamps the footer and
 * signature/stamp before saving.
 */
export async function createBrandedPdf(opts: BrandedPdfOptions): Promise<BrandedDoc> {
  const { jsPDF } = await import("jspdf");
  const branding = await loadPdfBranding();
  const doc = new jsPDF({ orientation: opts.orientation ?? "portrait" });
  const startY = drawHeader(doc, branding, opts);
  return {
    doc,
    startY,
    finalize: (filename: string) => {
      drawSignatureAndStamp(doc, branding);
      drawFooters(doc, branding);
      doc.save(filename);
    },
  };
}
