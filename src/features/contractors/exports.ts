"use client";

import * as XLSX from "xlsx";
import autoTable, { type RowInput } from "jspdf-autotable";
import { toRupees } from "@/lib/money";
import { createBrandedPdf } from "@/features/branding/pdf";
import type {
  ContractorCostRow,
  ContractorLedger,
  ContractorLedgerType,
  ContractorSettlement,
  OutstandingAdvanceRow,
} from "./types";

// jsPDF's core fonts lack ₹ — use "Rs." in PDFs; spreadsheets use plain numbers.
const rs = (p: number) => `Rs. ${toRupees(p).toLocaleString("en-IN")}`;
const stamp = () => new Date().toISOString().slice(0, 10);

const TYPE_LABEL: Record<ContractorLedgerType, string> = {
  OPENING_ADVANCE: "Opening advance",
  ADVANCE: "Advance paid",
  LABOUR_BILL: "Labour bill",
  ADJUSTMENT: "Advance adjusted",
  PAYMENT: "Payment made",
  SETTLEMENT_REVERSAL: "Settlement reversed",
  // Exports keep both rows so the file reconciles to the ledger; the label says
  // plainly that no cash moved.
  SCOPE_TRANSFER_OUT: "Advance re-scoped (out)",
  SCOPE_TRANSFER_IN: "Advance re-scoped (in)",
};

function excel(aoa: (string | number)[][], sheetName: string, filename: string) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename);
}

async function pdf(
  title: string,
  subtitle: string,
  head: string[],
  body: RowInput[],
  foot?: RowInput[],
  filename?: string,
) {
  const { doc, startY, finalize } = await createBrandedPdf({ title, subtitle, orientation: "landscape" });
  autoTable(doc, {
    startY,
    head: [head],
    body,
    foot,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [46, 91, 255] },
  });
  finalize(filename ?? `${title.toLowerCase().replace(/\s+/g, "-")}-${stamp()}.pdf`);
}

// ── 1. Contractor ledger ──────────────────────────────────────────────
const LEDGER_HEAD = ["Date", "Entry", "Reference", "Amount", "Advance balance"];
function ledgerAoa(l: ContractorLedger): (string | number)[][] {
  return [
    LEDGER_HEAD,
    ...l.entries.map((e) => [
      e.date,
      TYPE_LABEL[e.type],
      e.projectName ?? e.notes ?? "",
      toRupees(e.amountPaise),
      toRupees(e.advanceBalanceAfterPaise),
    ]),
  ];
}
export function exportLedgerExcel(l: ContractorLedger) {
  excel(ledgerAoa(l), "Ledger", `ledger-${l.contractor.name}-${stamp()}.xlsx`);
}
export async function exportLedgerPdf(l: ContractorLedger) {
  await pdf(
    "Contractor ledger",
    `${l.contractor.name} · balance ${rs(l.contractor.advanceBalancePaise)} · ${stamp()}`,
    LEDGER_HEAD,
    l.entries.map((e) => [
      e.date,
      TYPE_LABEL[e.type],
      e.projectName ?? e.notes ?? "—",
      rs(e.amountPaise),
      rs(e.advanceBalanceAfterPaise),
    ]),
    undefined,
    `ledger-${l.contractor.name}-${stamp()}.pdf`,
  );
}

// ── 2. Weekly settlement report ───────────────────────────────────────
const SETTLE_HEAD = ["Contractor", "Project", "Period", "Labour bill", "Adjustment", "Net paid"];
export function exportSettlementsExcel(rows: ContractorSettlement[]) {
  excel(
    [
      SETTLE_HEAD,
      ...rows.map((s) => [
        s.contractorName,
        s.projectName,
        `${s.periodStart} → ${s.periodEnd}`,
        toRupees(s.labourBillPaise),
        toRupees(s.advanceAdjustmentPaise),
        toRupees(s.netPaymentPaise),
      ]),
    ],
    "Settlements",
    `settlements-${stamp()}.xlsx`,
  );
}
export async function exportSettlementsPdf(rows: ContractorSettlement[]) {
  const net = rows.reduce((s, r) => s + r.netPaymentPaise, 0);
  await pdf(
    "Weekly settlement report",
    `${rows.length} settlement(s) · ${stamp()}`,
    SETTLE_HEAD,
    rows.map((s) => [
      s.contractorName,
      s.projectName,
      `${s.periodStart} → ${s.periodEnd}`,
      rs(s.labourBillPaise),
      rs(s.advanceAdjustmentPaise),
      rs(s.netPaymentPaise),
    ]),
    [["", "", "", "", "Total net", rs(net)]],
  );
}

// ── 3. Outstanding advances ───────────────────────────────────────────
const OUT_HEAD = ["Contractor", "Mobile", "Outstanding advance"];
export function exportOutstandingExcel(rows: OutstandingAdvanceRow[]) {
  excel(
    [OUT_HEAD, ...rows.map((r) => [r.name, r.phone ?? "", toRupees(r.advanceBalancePaise)])],
    "Outstanding",
    `outstanding-advances-${stamp()}.xlsx`,
  );
}
export async function exportOutstandingPdf(rows: OutstandingAdvanceRow[]) {
  const total = rows.reduce((s, r) => s + r.advanceBalancePaise, 0);
  await pdf(
    "Outstanding advances",
    `${rows.length} contractor(s) · ${stamp()}`,
    OUT_HEAD,
    rows.map((r) => [r.name, r.phone ?? "—", rs(r.advanceBalancePaise)]),
    [["", "Total", rs(total)]],
  );
}

// ── 4. Contractor cost summary ────────────────────────────────────────
const COST_HEAD = ["Contractor", "Settlements", "Labour billed", "Adjusted", "Net paid", "Advance bal."];
export function exportCostSummaryExcel(rows: ContractorCostRow[]) {
  excel(
    [
      COST_HEAD,
      ...rows.map((r) => [
        r.name,
        r.settlementCount,
        toRupees(r.totalBillPaise),
        toRupees(r.totalAdjustedPaise),
        toRupees(r.totalPaidPaise),
        toRupees(r.advanceBalancePaise),
      ]),
    ],
    "Cost summary",
    `contractor-cost-summary-${stamp()}.xlsx`,
  );
}
export async function exportCostSummaryPdf(rows: ContractorCostRow[]) {
  await pdf(
    "Contractor cost summary",
    `${rows.length} contractor(s) · ${stamp()}`,
    COST_HEAD,
    rows.map((r) => [
      r.name,
      r.settlementCount,
      rs(r.totalBillPaise),
      rs(r.totalAdjustedPaise),
      rs(r.totalPaidPaise),
      rs(r.advanceBalancePaise),
    ]),
  );
}
