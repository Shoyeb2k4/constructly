"use client";

import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import { toRupees } from "@/lib/money";
import { PO_STATUS_LABEL, PO_PAYMENT_STATUS_LABEL } from "./constants";
import type { PurchaseOrderListItem } from "./types";

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

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportPOsCsv(items: PurchaseOrderListItem[]) {
  const lines = [HEADERS, ...items.map(numericRow)].map((r) => r.map(csvCell).join(","));
  download(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }), `purchase-orders-${stamp()}.csv`);
}

export function exportPOsExcel(items: PurchaseOrderListItem[]) {
  const aoa: (string | number)[][] = [[...HEADERS], ...items.map(numericRow)];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Purchase orders");
  XLSX.writeFile(wb, `purchase-orders-${stamp()}.xlsx`);
}

export function exportPOsPdf(items: PurchaseOrderListItem[]) {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Constructly", 14, 16);
  doc.setFontSize(12);
  doc.text("Purchase orders", 14, 24);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`${items.length} record${items.length === 1 ? "" : "s"} · generated ${new Date().toLocaleString("en-IN")}`, 14, 30);
  doc.setTextColor(0);

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
    startY: 36,
    head: [["PO #", "Vendor", "Project", "Status", "Purchased", "Expected", "Total", "Paid", "Payment"]],
    body,
    foot: [["", "", "", "", "", "Total", rs(totalPaise), "", ""]],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [46, 91, 255] },
  });
  doc.save(`purchase-orders-${stamp()}.pdf`);
}
