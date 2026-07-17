# Database Design

_Source of truth for the data model. Update with every schema change; migrations live in `prisma/migrations`._

## Conventions

- Every domain table: `id` (uuid), `company_id` (uuid, FK → Company), `created_at`, `updated_at`.
- Big entities: soft-delete via `deleted_at` (nullable).
- **Money: integer `paise`** (₹1 = 100 paise). Never float. Column names end in `_paise`.
- **RLS on every domain table** — no table ships without a policy.
- Offline-syncable rows carry `client_uuid` (unique) + `client_seq` for idempotent upsert.

## Entity map (MVP)

```
Company ─┬─< User            (OWNER | PROJECT_MANAGER)
         ├─< Project ─┬─< ProjectDocument
         │            ├─< Note
         │            └─< Deadline
         ├─< Contractor ─< Laborer
         ├─< Laborer
         ├─< Attendance     (Project × Laborer × date)
         ├─< Vendor
         ├─< PurchaseOrder ─< POLineItem
         └─< ActivityLog
```

## Core tables (Module 0 ships Company, User, membership, settings + RLS scaffold)

### Company
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text | |
| gstin | text? | 15-char, validated |
| settings | jsonb | `{ poApprovalRequired: bool, currency: 'INR', ... }` |
| created_at / updated_at | timestamptz | |

### User
| col | type | notes |
|---|---|---|
| id | uuid pk | = Supabase `auth.uid()` |
| company_id | uuid fk | |
| email | text | |
| full_name | text | |
| role | enum | `OWNER` \| `PROJECT_MANAGER` |
| status | enum | `ACTIVE` \| `INVITED` \| `DISABLED` |

### Project
Name, `code` (unique per company), client details, `type` (Residential/Commercial/Industrial/Infrastructure/Renovation/Interior), site address, `gps` (lat/lng), `budget_paise`, `contract_value_paise`, `start_date`, `expected_completion_date`, `stage`, `pm_id` (FK User), timestamps, soft-delete.
`stage` enum: `CREATED, PLANNING, ESTIMATION, PROCUREMENT, CONSTRUCTION, QUALITY_INSPECTION, COMPLETION, HANDOVER, CLOSED`.

### Deadline
`project_id`, `title`, `due_date`, `completed_at?`. Powers countdown + overdue logic.

### ProjectDocument
`project_id`, `category` (Drawing/PDF/Photo/Contract/Other), `storage_path`, `filename`, `size_bytes`, `uploaded_by`.

### Note
`project_id`, `body`, `author_id`, `client_uuid` (offline). Syncable.

### Contractor
`name`, `phone`, `status`. First-class now; **payout fields deferred** but table exists so it can extend without redesign.

### Laborer
`full_name`, `phone?`, `trade` (skill), `daily_wage_paise`, `contractor_id?` (FK), `status` (Active/Inactive), `notes?`.

### Attendance (syncable)
`project_id`, `laborer_id`, `date`, `status` (`PRESENT | ABSENT | HALF_DAY`), `ot_hours` (decimal, default 0), `wage_payable_paise` (computed & stored), `recorded_by`, `client_uuid` (unique), `client_seq`.
Unique constraint: `(company_id, project_id, laborer_id, date)` → drives last-write-wins.

**Wage formula (pure function, tested):**
```
base = status==PRESENT ? daily_wage
     : status==HALF_DAY ? daily_wage/2
     : 0                              # ABSENT
ot   = ot_hours * (daily_wage / 8)    # OT rate = hourly day-rate (configurable later)
wage_payable = round(base + ot)       # in paise
```
Aggregations: project-wise labor cost = Σ wage_payable by project; contractor-wise = Σ by laborer.contractor_id.

### Vendor
`business_name`, `contact_person`, `phone`, `email?`, `gstin?`, `address?`, `materials_supplied` (text[]), `payment_terms?`, `status` (Active/Inactive), `notes?`. Purchase history derived from PurchaseOrders.

### PurchaseOrder (quick-create syncable)
`vendor_id`, `project_id`, `po_number` (unique per company), `status` (`DRAFT | SUBMITTED | APPROVED`), `invoice_number?`, `purchase_date`, `notes?`, `created_by`, `approved_by?`, `client_uuid`.
Approval flow active only when `Company.settings.poApprovalRequired = true`; otherwise POs are effectively final on create.

### POLineItem
`purchase_order_id`, `material`, `quantity` (decimal), `unit`, `rate_paise`, `amount_paise` (= quantity × rate).

### ActivityLog (audit)
`actor_id`, `action`, `entity_type`, `entity_id`, `meta` (jsonb), `created_at`. Immutable. Feeds dashboard "Recent Activities" + audit trail. Written on financial and status changes.

## Budget derivation (ADR-0010)
`budget_used = Σ approved PO amounts (for project) + Σ project labor cost`.
`budget_remaining = project.budget_paise − budget_used`.
Overrun → **soft warning** in UI, never a hard block. (Exact PO-status inclusion rules to confirm in Module 3.)

## RLS policy shape (applied per table)
```sql
-- read/write limited to the caller's company
USING (company_id = (select company_id from users where id = auth.uid()))
-- PROJECT_MANAGER additionally scoped to assigned projects on project-linked tables
```

## Module 2 — Labour (Category → Subcategory hierarchy · ADR-0021/0022/0023)
```
LabourCategory (name, color?, display_order)
  └─< LabourSubcategory (name, daily_rate_paise?, display_order)
        └─< LabourAttendance (project, date, quantity_present,
              daily_rate_paise_snapshot, estimated_cost_paise, notes,
              client_uuid unique + client_seq for offline sync)
```
Unique keys: category name per company, subcategory name per category, and
`(project_id, date, labour_subcategory_id)` per attendance row. No individual laborers,
wages, or payroll. Labour cost is a stored **snapshot** (`estimated_cost_paise` =
quantity × rate-at-record-time) — later rate edits never rewrite history; budget sums it
directly. Ordering via `display_order` (drag-and-drop). Migration from the flat model:
`prisma/migration-labour-hierarchy.sql` (each category → default subcategory, attendance
repointed). `Contractor` remains (lean, dormant) for future payments/ledger. RLS scopes
attendance via `can_access_project`; categories + subcategories are tenant-scoped.

## Module 3 — Vendors & Procurement v2 (ADR-0024)
Many-to-many `Vendor ↔ Project` through purchase orders. Budget/outstanding are **derived, not stored**.
```
Vendor (…, pan?)
  ├─< PurchaseOrder (project, status DRAFT|SUBMITTED|APPROVED,
  │     expected_delivery?, subtotal_paise, gst_paise, total_paise = subtotal + GST,
  │     revised_from_id self-relation)
  │      └─< POLineItem (material, category?, quantity Decimal, unit,
  │            rate_paise, gst_rate_bps, gst_paise, amount_paise, sort_order)
  ├─< VendorPayment (project, purchase_order_id? OPTIONAL, amount_paise,
  │     payment_mode enum, reference_number?, date, remarks, created_by)
  ├─< VendorDocument (category, storage_path, filename, size_bytes, …)
  └─< GoodsReceipt ─< GoodsReceiptItem   (schema-ready; UI deferred)
```
- **Money:** `POLineItem.amount_paise` = taxable (qty × rate, ex-GST); `gst_paise` rounded **per line**
  (`round(qty × rate × gst_rate_bps / 10000)`); PO `total_paise` (grand, incl. GST) feeds budget + outstanding.
- **GST rate** stored as integer **basis points** (`gst_rate_bps`, 1800 = 18%) — no float tax math.
  Forward-compat (ADR-0025, not built yet): CGST/SGST/IGST are a derived split of this one rate;
  `hsn_code` + a PO `tax_inclusive` flag attach as nullable columns — no redesign.
- **Rate snapshot:** `rate_paise` is frozen at entry; approved POs are immutable (Revise clones to a linked
  draft via `revised_from_id`; Duplicate clones to an unlinked draft dated today).
- **Outstanding (derived, ADR-0024):** `Σ counted PO grand totals − Σ payments`, scoped by vendor/project;
  payment status (UNPAID/PARTIAL/PAID) and aging (0–30/31–60/60+, advances applied FIFO) come from pure calc.
- **VendorPayment** is always project-aware; the PO link is optional (advances / on-account / settlements).
  DELETE is owner-only + audited.
- **Material categories** live in `Company.settings.materialCategories` (seeded presets; Settings-managed).
- **Project.procurement_budget_paise?** — dedicated procurement budget, independent of `budget_paise`.
- **RLS:** vendors + vendor_documents tenant-scoped; purchase_orders / po_line_items / vendor_payments /
  goods_receipts PM-scoped via `can_access_project`; vendor_payments UPDATE/DELETE additionally owner-only.
- **Migration:** `prisma/migration-procurement-v2.sql` (backfill `subtotal = total, gst = 0`; seed categories);
  demo v1 → v2 auto-migration. `PaymentMode`: CASH | UPI | BANK_TRANSFER | CHEQUE | CARD | OTHER.
- Online-only (financial integrity); labour attendance is the sole offline entity.

## Deferred (post-MVP, schema-ready)
Contractor payouts · payroll · inventory · multi-currency · client portal.
`GoodsReceipt`/`GoodsReceiptItem` tables + RLS ship now (ADR-0024) with repository stubs; receiving UI is deferred.
