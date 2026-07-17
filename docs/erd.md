# Entity-Relationship Diagram

_Visual companion to [database.md](./database.md). Regenerate when the schema changes. Money columns are integer paise; every domain table carries `company_id` + timestamps and is protected by RLS._

```mermaid
erDiagram
  Company ||--o{ User : has
  Company ||--o{ Project : owns
  Company ||--o{ Vendor : owns
  Company ||--o{ Contractor : owns
  Company ||--o{ LabourCategory : owns
  Company ||--o{ ActivityLog : records

  User ||--o{ Project : manages
  User ||--o{ ProjectFavorite : pins
  User ||--o{ VendorFavorite : pins

  Project ||--o{ Deadline : has
  Project ||--o{ ProjectDocument : has
  Project ||--o{ Note : has
  Project ||--o{ LabourAttendance : records
  Project ||--o{ PurchaseOrder : purchases
  Project ||--o{ VendorPayment : pays
  Project ||--o{ GoodsReceipt : receives

  LabourCategory ||--o{ LabourSubcategory : contains
  LabourSubcategory ||--o{ LabourAttendance : "headcount per day"

  Vendor ||--o{ PurchaseOrder : supplies
  Vendor ||--o{ VendorPayment : "paid via"
  Vendor ||--o{ VendorDocument : has
  Vendor ||--o{ GoodsReceipt : delivers

  PurchaseOrder ||--o{ POLineItem : contains
  PurchaseOrder ||--o{ VendorPayment : "optionally settles"
  PurchaseOrder ||--o{ GoodsReceipt : "received against"
  PurchaseOrder ||--o| PurchaseOrder : "revised from"

  GoodsReceipt ||--o{ GoodsReceiptItem : contains
  POLineItem ||--o{ GoodsReceiptItem : "received as"

  Contractor {
    string name
    string phone
    enum status "dormant — future payouts"
  }

  Project {
    string code
    bigint budget_paise
    bigint procurement_budget_paise "dedicated, nullable"
    enum stage
  }
  Vendor {
    string business_name
    string gstin
    string pan
  }
  PurchaseOrder {
    string po_number
    enum status "DRAFT|SUBMITTED|APPROVED"
    date expected_delivery
    bigint subtotal_paise
    bigint gst_paise
    bigint total_paise "grand = subtotal + GST"
    uuid revised_from_id
  }
  POLineItem {
    string material
    string category
    decimal quantity
    int rate_paise "snapshot"
    int gst_rate_bps "basis points"
    bigint gst_paise "per-line rounded"
    bigint amount_paise "taxable"
  }
  VendorPayment {
    uuid purchase_order_id "OPTIONAL"
    bigint amount_paise
    enum payment_mode
    string reference_number
    date date
  }
  LabourAttendance {
    date date
    int quantity_present
    int daily_rate_paise_snapshot
    bigint estimated_cost_paise
  }
```

## Derived (never stored)

These are computed by pure functions from the tables above — no columns, no drift:

- **Budget used / remaining** = Σ labour snapshots + Σ counted PO grand totals (`src/features/budget/calc.ts`).
- **Vendor / project outstanding** = Σ counted PO grand totals − Σ payments (`src/features/procurement/calc.ts`).
- **PO payment status, aging buckets, vendor ledger** — all derived from PurchaseOrder + VendorPayment.

## Notes

- `GoodsReceipt` / `GoodsReceiptItem` are schema + RLS ready; receiving UI is deferred (ADR-0024).
- `Contractor` stays dormant for future payouts (ADR-0021) — no per-worker tracking in the MVP.
- Forward-compat (ADR-0025): CGST/SGST/IGST split, HSN codes, and tax-inclusive pricing attach as derived logic / nullable columns with no redesign.
