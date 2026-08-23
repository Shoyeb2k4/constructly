"use client";

import * as XLSX from "xlsx";
import autoTable, { type RowInput } from "jspdf-autotable";
import { toRupees } from "@/lib/money";
import { createBrandedPdf } from "@/features/branding/pdf";
import { PO_STATUS_LABEL, PO_PAYMENT_STATUS_LABEL } from "./constants";
import type { PurchaseOrderListItem } from "./types";
import { saveWorkbook, saveGeneratedFile } from "@/lib/exports";

// jsPDF's built-in fonts lack the ₹ glyph — use "Rs." in the PDF export.
const rs = (paise: number) => `Rs. ${toRupees(paise).toLocaleString("en-IN")}`;
const stamp = () => new Date().toISOString().slice(0, 10);

const HEADERS = [
  "PO #",
  "Vendor",
  "Project",
  "Status",
  "Purchase date",
  "Expected delivery",
  "Subtotal (Rs.)",
  "GST (Rs.)",
  "Total (Rs.)",
  "Paid (Rs.)",
  "Payment",
  "Created by",
] as const;

/** Spreadsheet/CSV row — amounts as plain rupee numbers. */
function numericRow(p: PurchaseOrderListItem): (string | number)[] {
  return [
    p.poNumber,
    p.vendor.name,
    p.project.name,
    PO_STATUS_LABEL[p.status],
    p.purchaseDate,
    p.expectedDelivery ?? "",
    toRupees(p.subtotalPaise),
    toRupees(p.gstPaise),
    toRupees(p.totalPaise),
    toRupees(p.paidPaise),
    PO_PAYMENT_STATUS_LABEL[p.paymentStatus],
    p.createdBy?.name ?? "",
  ];
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportPOsCsv(items: PurchaseOrderListItem[]) {
  const lines = [HEADERS, ...items.map(numericRow)].map((r) => r.map(csvCell).join(","));
  await saveGeneratedFile(
    new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }),
    `purchase-orders-${stamp()}.csv`,
  );
}

export async function exportPOsExcel(items: PurchaseOrderListItem[]) {
  const aoa: (string | number)[][] = [[...HEADERS], ...items.map(numericRow)];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Purchase orders");
  await saveWorkbook(wb, `purchase-orders-${stamp()}.xlsx`);
}

export async function exportPOsPdf(items: PurchaseOrderListItem[]) {
  const { doc, startY, finalize } = await createBrandedPdf({
    title: "Purchase orders",
    subtitle: `${items.length} record${items.length === 1 ? "" : "s"}`,
    orientation: "landscape",
  });

  const totalPaise = items.reduce((s, p) => s + p.totalPaise, 0);
  const body: RowInput[] = items.map((p) => [
    p.poNumber,
    p.vendor.name,
    p.project.name,
    PO_STATUS_LABEL[p.status],
    p.purchaseDate,
    p.expectedDelivery ?? "—",
    rs(p.totalPaise),
    rs(p.paidPaise),
    PO_PAYMENT_STATUS_LABEL[p.paymentStatus],
  ]);

  autoTable(doc, {
    startY,
    head: [["PO #", "Vendor", "Project", "Status", "Purchased", "Expected", "Total", "Paid", "Payment"]],
    body,
    foot: [["", "", "", "", "", "Total", rs(totalPaise), "", ""]],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [46, 91, 255] },
  });
  finalize(`purchase-orders-${stamp()}.pdf`);
}
