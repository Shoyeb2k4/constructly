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

## Deferred (post-MVP, schema-ready)
Contractor payouts · payroll · inventory · multi-currency · PO receipts/GRN · client portal.
