import type { PaymentMode, PurchaseOrderStatus, VendorDocumentCategory, VendorStatus } from "../types";
import { lineAmountPaise, lineGstPaise } from "../calc";
import { toPaise } from "@/lib/money";

export interface VendorRecord {
  id: string;
  businessName: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  materialsSupplied: string[];
  paymentTerms: string | null;
  status: VendorStatus;
  notes: string | null;
  isFavorite: boolean;
}

export interface POLineRecord {
  id: string;
  material: string;
  category: string | null;
  quantity: number;
  unit: string;
  ratePaise: number;
  gstRateBps: number;
  gstPaise: number;
  /** Taxable amount = quantity × rate (ex-GST). */
  amountPaise: number;
  sortOrder: number;
}

export interface PORecord {
  id: string;
  poNumber: string;
  vendorId: string;
  projectId: string;
  status: PurchaseOrderStatus;
  invoiceNumber: string | null;
  purchaseDate: string;
  expectedDelivery: string | null;
  notes: string | null;
  subtotalPaise: number;
  gstPaise: number;
  /** Grand total = subtotal + GST. */
  totalPaise: number;
  createdByName: string;
  approvedByName: string | null;
  approvedAt: string | null;
  revisedFromId: string | null;
  /** Set when archived (approved POs). Hidden from lists + budget, kept for audit. */
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  lineItems: POLineRecord[];
}

export interface PaymentRecord {
  id: string;
  vendorId: string;
  projectId: string;
  purchaseOrderId: string | null;
  amountPaise: number;
  paymentMode: PaymentMode;
  referenceNumber: string | null;
  date: string;
  remarks: string | null;
  clientUuid?: string | null;
  createdByName: string;
  createdAt: string;
}

export interface VendorDocRecord {
  id: string;
  vendorId: string;
  category: VendorDocumentCategory;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  storagePath: string;
  createdAt: string;
}

const V1 = "40000000-0000-0000-0000-0000000000v1";
const V2 = "40000000-0000-0000-0000-0000000000v2";
const V3 = "40000000-0000-0000-0000-0000000000v3";
const V4 = "40000000-0000-0000-0000-0000000000v4";
const V5 = "40000000-0000-0000-0000-0000000000v5";
const SKYLINE = "10000000-0000-0000-0000-000000000001";
const ORION = "10000000-0000-0000-0000-000000000002";
const VERMILLION = "10000000-0000-0000-0000-000000000003";

export const DEMO_VENDORS: VendorRecord[] = [
  { id: V1, businessName: "UltraTech Cement", contactPerson: "Rajesh Iyer", phone: "+919845011001", email: "sales@ultratech.example", gstin: "29AAACL1234M1Z5", pan: "AAACL1234M", address: "Peenya, Bengaluru", materialsSupplied: ["Cement", "Concrete", "AAC Blocks"], paymentTerms: "30 days", status: "ACTIVE", notes: null, isFavorite: true },
  { id: V2, businessName: "Sanghvi Steel", contactPerson: "Amit Sanghvi", phone: "+919845011002", email: "orders@sanghvisteel.example", gstin: "27AABCS4567P1Z3", pan: "AABCS4567P", address: "Hospet, Karnataka", materialsSupplied: ["TMT Steel", "Structural Steel", "Binding Wire"], paymentTerms: "15 days", status: "ACTIVE", notes: null, isFavorite: true },
  { id: V3, businessName: "Asian Paints", contactPerson: "Divya Nair", phone: "+919845011003", email: null, gstin: null, pan: null, address: "Whitefield, Bengaluru", materialsSupplied: ["Paints", "Primers", "Putty"], paymentTerms: "COD", status: "ACTIVE", notes: null, isFavorite: false },
  { id: V4, businessName: "Bharat Sand & Aggregates", contactPerson: null, phone: "+919845011004", email: null, gstin: null, pan: null, address: "Anekal, Bengaluru", materialsSupplied: ["River Sand", "M-Sand", "Aggregate"], paymentTerms: "COD", status: "ACTIVE", notes: null, isFavorite: false },
  { id: V5, businessName: "Krishna Electricals", contactPerson: "Suresh K", phone: "+919845011005", email: "krishna.elec@example", gstin: null, pan: null, address: "SP Road, Bengaluru", materialsSupplied: ["Wiring", "Switches", "Fixtures"], paymentTerms: "45 days", status: "INACTIVE", notes: "Slow deliveries last quarter.", isFavorite: false },
];

const ymd = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);
const iso = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString();

let seq = 0;
function line(
  material: string,
  category: string | null,
  quantity: number,
  unit: string,
  rateRupees: number,
  gstPercent: number,
): POLineRecord {
  const ratePaise = toPaise(rateRupees);
  const gstRateBps = Math.round(gstPercent * 100);
  return {
    id: `line-${seq++}`,
    material,
    category,
    quantity,
    unit,
    ratePaise,
    gstRateBps,
    gstPaise: lineGstPaise(quantity, ratePaise, gstRateBps),
    amountPaise: lineAmountPaise(quantity, ratePaise),
    sortOrder: 0,
  };
}

function po(
  n: number,
  vendorId: string,
  projectId: string,
  status: PurchaseOrderStatus,
  createdOffset: number,
  lineItems: POLineRecord[],
): PORecord {
  lineItems.forEach((l, i) => (l.sortOrder = i));
  const subtotal = lineItems.reduce((s, l) => s + l.amountPaise, 0);
  const gst = lineItems.reduce((s, l) => s + l.gstPaise, 0);
  return {
    id: `50000000-0000-0000-0000-0000000${String(n).padStart(5, "0")}`,
    poNumber: `PO-${String(n).padStart(4, "0")}`,
    vendorId,
    projectId,
    status,
    invoiceNumber: status === "APPROVED" ? `INV-${2000 + n}` : null,
    purchaseDate: ymd(createdOffset),
    expectedDelivery: status === "APPROVED" ? ymd(createdOffset + 7) : ymd(createdOffset + 10),
    notes: null,
    subtotalPaise: subtotal,
    gstPaise: gst,
    totalPaise: subtotal + gst,
    createdByName: "Priya Nair",
    approvedByName: status === "APPROVED" ? "Aarav Mehta" : null,
    approvedAt: status === "APPROVED" ? iso(createdOffset + 1) : null,
    revisedFromId: null,
    createdAt: iso(createdOffset),
    updatedAt: iso(createdOffset),
    lineItems,
  };
}

/**
 * Purchase history spans ~11 weeks so the outstanding aging buckets
 * (0–30 / 31–60 / 60+) and the monthly trend all have real data.
 */
export function demoPurchaseOrders(): PORecord[] {
  seq = 0;
  return [
    po(227, V1, SKYLINE, "APPROVED", -75, [line("OPC 53 Cement", "Cement", 5000, "bag", 380, 28)]),
    po(228, V2, ORION, "APPROVED", -45, [line("TMT Steel Fe500", "Steel", 25, "ton", 60000, 18)]),
    po(229, V4, SKYLINE, "APPROVED", -22, [line("River Sand", "Sand & Aggregate", 800, "ton", 2600, 5)]),
    po(230, V2, SKYLINE, "APPROVED", -18, [line("TMT Steel Fe500", "Steel", 40, "ton", 62000, 18)]),
    po(231, V1, SKYLINE, "APPROVED", -12, [
      line("OPC 53 Cement", "Cement", 8000, "bag", 380, 28),
      line("AAC Blocks", "Cement", 1200, "nos", 55, 12),
    ]),
    po(232, V2, ORION, "SUBMITTED", -3, [line("Structural Steel", "Steel", 20, "ton", 61000, 18)]),
    po(233, V3, VERMILLION, "DRAFT", -1, [
      line("Emulsion Paint", "Paint", 200, "litre", 320, 18),
      line("Wall Putty", "Paint", 40, "bag", 1050, 18),
    ]),
  ];
}

/** Payments: full + partial + an unlinked advance — every state represented. */
export function demoPayments(): PaymentRecord[] {
  const pos = demoPurchaseOrders();
  const total = (n: number) => pos.find((p) => p.poNumber === `PO-${String(n).padStart(4, "0")}`)!.totalPaise;
  const id = (n: number) => `50000000-0000-0000-0000-0000000${String(n).padStart(5, "0")}`;
  let i = 0;
  const pay = (
    vendorId: string,
    projectId: string,
    purchaseOrderId: string | null,
    amountPaise: number,
    mode: PaymentMode,
    ref: string | null,
    offset: number,
    remarks: string | null,
  ): PaymentRecord => ({
    id: `70000000-0000-0000-0000-0000000000${String(++i).padStart(2, "0")}`,
    vendorId,
    projectId,
    purchaseOrderId,
    amountPaise,
    paymentMode: mode,
    referenceNumber: ref,
    date: ymd(offset),
    remarks,
    createdByName: "Aarav Mehta",
    createdAt: iso(offset),
  });
  return [
    pay(V1, SKYLINE, id(227), total(227), "BANK_TRANSFER", "UTR90112034", -70, "Cleared in full"),
    pay(V2, ORION, null, toPaise(500_000), "UPI", "UPI-88231", -40, "Advance for Orion steel"),
    pay(V4, SKYLINE, id(229), total(229), "BANK_TRANSFER", "UTR90244810", -15, null),
    pay(V2, SKYLINE, id(230), toPaise(1_500_000), "CHEQUE", "CHQ 004417", -10, "Part payment"),
    pay(V1, SKYLINE, id(231), toPaise(2_000_000), "BANK_TRANSFER", "UTR90312001", -8, "Part payment"),
  ];
}

export function demoVendorDocs(): VendorDocRecord[] {
  return [
    { id: "80000000-0000-0000-0000-000000000001", vendorId: V1, category: "CONTRACT", filename: "UltraTech-rate-contract-FY26.pdf", sizeBytes: 482_112, mimeType: "application/pdf", storagePath: "demo/vendors/ultratech-rate-contract.pdf", createdAt: iso(-80) },
    { id: "80000000-0000-0000-0000-000000000002", vendorId: V2, category: "PDF", filename: "Sanghvi-GST-certificate.pdf", sizeBytes: 210_774, mimeType: "application/pdf", storagePath: "demo/vendors/sanghvi-gst-cert.pdf", createdAt: iso(-60) },
  ];
}
