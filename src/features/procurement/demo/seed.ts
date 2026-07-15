import type { PurchaseOrderStatus, VendorStatus } from "../types";
import { toPaise } from "@/lib/money";

export interface VendorRecord {
  id: string;
  businessName: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
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
  quantity: number;
  unit: string;
  ratePaise: number;
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
  notes: string | null;
  totalPaise: number;
  createdByName: string;
  approvedByName: string | null;
  approvedAt: string | null;
  revisedFromId: string | null;
  createdAt: string;
  updatedAt: string;
  lineItems: POLineRecord[];
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
  { id: V1, businessName: "UltraTech Cement", contactPerson: "Rajesh Iyer", phone: "+919845011001", email: "sales@ultratech.example", gstin: "29AAACL1234M1Z5", address: "Peenya, Bengaluru", materialsSupplied: ["Cement", "Concrete", "AAC Blocks"], paymentTerms: "30 days", status: "ACTIVE", notes: null, isFavorite: true },
  { id: V2, businessName: "Sanghvi Steel", contactPerson: "Amit Sanghvi", phone: "+919845011002", email: "orders@sanghvisteel.example", gstin: "27AABCS4567P1Z3", address: "Hospet, Karnataka", materialsSupplied: ["TMT Steel", "Structural Steel", "Binding Wire"], paymentTerms: "15 days", status: "ACTIVE", notes: null, isFavorite: true },
  { id: V3, businessName: "Asian Paints", contactPerson: "Divya Nair", phone: "+919845011003", email: null, gstin: null, address: "Whitefield, Bengaluru", materialsSupplied: ["Paints", "Primers", "Putty"], paymentTerms: "COD", status: "ACTIVE", notes: null, isFavorite: false },
  { id: V4, businessName: "Bharat Sand & Aggregates", contactPerson: null, phone: "+919845011004", email: null, gstin: null, address: "Anekal, Bengaluru", materialsSupplied: ["River Sand", "M-Sand", "Aggregate"], paymentTerms: "COD", status: "ACTIVE", notes: null, isFavorite: false },
  { id: V5, businessName: "Krishna Electricals", contactPerson: "Suresh K", phone: "+919845011005", email: "krishna.elec@example", gstin: null, address: "SP Road, Bengaluru", materialsSupplied: ["Wiring", "Switches", "Fixtures"], paymentTerms: "45 days", status: "INACTIVE", notes: "Slow deliveries last quarter.", isFavorite: false },
];

const ymd = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);
const iso = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString();

let seq = 0;
function line(material: string, quantity: number, unit: string, rateRupees: number): POLineRecord {
  const ratePaise = toPaise(rateRupees);
  return {
    id: `line-${seq++}`,
    material,
    quantity,
    unit,
    ratePaise,
    amountPaise: Math.round(quantity * ratePaise),
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
  const total = lineItems.reduce((s, l) => s + l.amountPaise, 0);
  return {
    id: `50000000-0000-0000-0000-0000000${String(n).padStart(5, "0")}`,
    poNumber: `PO-${String(n).padStart(4, "0")}`,
    vendorId,
    projectId,
    status,
    invoiceNumber: status === "APPROVED" ? `INV-${2000 + n}` : null,
    purchaseDate: ymd(createdOffset),
    notes: null,
    totalPaise: total,
    createdByName: "Priya Nair",
    approvedByName: status === "APPROVED" ? "Aarav Mehta" : null,
    approvedAt: status === "APPROVED" ? iso(createdOffset + 1) : null,
    revisedFromId: null,
    createdAt: iso(createdOffset),
    updatedAt: iso(createdOffset),
    lineItems,
  };
}

export function demoPurchaseOrders(): PORecord[] {
  seq = 0;
  return [
    po(229, V4, SKYLINE, "APPROVED", -22, [line("River Sand", 800, "ton", 2600)]),
    po(230, V2, SKYLINE, "APPROVED", -18, [line("TMT Steel Fe500", 40, "ton", 62000)]),
    po(231, V1, SKYLINE, "APPROVED", -12, [
      line("OPC 53 Cement", 8000, "bag", 380),
      line("AAC Blocks", 1200, "nos", 55),
    ]),
    po(232, V2, ORION, "SUBMITTED", -3, [line("Structural Steel", 20, "ton", 61000)]),
    po(233, V3, VERMILLION, "DRAFT", -1, [
      line("Emulsion Paint", 200, "litre", 320),
      line("Wall Putty", 40, "bag", 1050),
    ]),
  ];
}
