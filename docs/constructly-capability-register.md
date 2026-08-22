# Constructly — Capability & Workflow Register

**Status:** authoritative source of truth for what Constructly does today.
**Compiled:** 22 August 2026, by direct audit of the repository at `wip/phase7-reports` (Phase 8.5 working tree).
**Maintained by:** whoever changes the product. A change that adds, removes or alters a capability is not finished until this file matches it.

---

## How to read this document

This is not a feature list for a website. It is the operating description of a
construction ERP that moves real money, and it is written to be checked against
the code rather than believed.

Three statuses are tracked **separately**, because conflating them is how a team
talks itself into believing something is ready:

| Axis | Question it answers |
|---|---|
| **Code status** | Does the capability exist in the repository and work? |
| **Deployment status** | Is that code running in production right now? |
| **Validation status** | Has a real company used it on real data and confirmed it? |

A capability can be `IMPLEMENTED` + `NOT DEPLOYED`, or `DEPLOYED` + `NOT E2E
VALIDATED`. Both are normal. Neither is "done".

### Status vocabulary

**Code:** `IMPLEMENTED` · `PARTIAL` · `UNWIRED` (code exists but nothing reaches it) · `NOT IMPLEMENTED`
**Demo:** `DEMO VERIFIED` (exercised in demo mode) · `DEMO AVAILABLE` (demo repository exists, not specifically exercised) · `NOT VERIFIED` · `NOT APPLICABLE`
**Deployment:** `DEPLOYED` · `NOT DEPLOYED`
**Production verification:** `PRODUCTION VERIFIED` · `DEPLOYED NOT VERIFIED` · `NOT DEPLOYED`
**E2E (real company):** `NOT TESTED` · `PASS` · `FAIL` · `PARTIAL` · `BLOCKED` · `NOT APPLICABLE`

Automated tests passing is **not** `PASS`. Every E2E cell in this document reads
`NOT TESTED` until a real company has done the thing on real data.

---

## 1. Deployment reality — read this first

This is the single most important fact in the document, and it is established
from git rather than from memory.

```
origin/main = main = ff36ae5   "UI/UX redesign — design system, five modules, and the Payments Centre"
```

Everything since then lives **only** on the working branch `wip/phase7-reports`
and has never been merged or deployed:

| Commit | Contents | Deployed? |
|---|---|---|
| `ff36ae5` | Design system, five redesigned modules, **Payments Centre** | ✅ **Yes — this is production** |
| `d97c845` | Phase 7 Reports WIP | ❌ No |
| `c3782b1` | Phase 7 — Reports as canonical analysis & export centre | ❌ No |
| `5b073c1` | Phase 8 — Users, Roles, Company Settings redesign | ❌ No |
| *(uncommitted)* | Phase 8.5 — governance, money input, role safety | ❌ No, and not yet committed |

**What this means in practice.** Production today runs the Phase 6 product. It
already has all sixteen application routes, including `/reports` and
`/settings` — but the deployed `/reports` carries **6 reports**, not the 10 in
this branch, and the deployed Settings carries the pre-Phase-8 Users and Roles
screens, in which **built-in roles were still editable** (the reconcile trap
Phase 8.5 closed).

So the honest summary is: the modules exist in production, three phases of work
on top of them do not, and no part of the product has been validated by a real
company.

---

## 2. Production matrix

| Module | Implemented | Demo verified | Deployed | Production verified | Real-company E2E |
|---|---|---|---|---|---|
| Authentication & session | ✅ | ✅ | ✅ | ✅ | **NOT STARTED** |
| Dashboard | ✅ | ✅ | ✅ | ✅ | **NOT STARTED** |
| Projects | ✅ | ✅ | ✅ | ✅ | **NOT STARTED** |
| Labour & Attendance | ✅ | ✅ | ✅ | ✅ | **NOT STARTED** |
| Contractors & Agreements | ✅ | ✅ | ✅ | ✅ | **NOT STARTED** |
| Procurement & Vendors | ✅ | ✅ | ✅ | ✅ | **NOT STARTED** |
| Payments Centre | ✅ | ✅ | ✅ | ✅ | **NOT STARTED** |
| Reports — 6 deployed | ✅ | ✅ | ✅ | ✅ | **NOT STARTED** |
| Reports — 4 added in Phase 7 | ✅ | ✅ | ❌ | NOT DEPLOYED | **NOT STARTED** |
| Reports redesign (exports, periods, source links) | ✅ | ✅ | ❌ | NOT DEPLOYED | **NOT STARTED** |
| Users & Invitations (Phase 8 redesign) | ✅ | ✅ | ❌ | NOT DEPLOYED | **NOT STARTED** |
| Roles & Permissions (Phase 8 redesign) | ✅ | ✅ | ❌ | NOT DEPLOYED | **NOT STARTED** |
| Company Settings & Branding (Phase 8 redesign) | ✅ | ✅ | ❌ | NOT DEPLOYED | **NOT STARTED** |
| Built-in role read-only + Duplicate (Phase 8.5) | ✅ | ✅ | ❌ | NOT DEPLOYED | **NOT STARTED** |
| Indian money input (Phase 8.5) | ✅ | ✅ | ❌ | NOT DEPLOYED | **NOT STARTED** |
| Governed deletion (Phase 8.5) | ✅ | ✅ | ❌ | NOT DEPLOYED | **NOT STARTED** |
| Offline attendance capture | **UNWIRED** | ❌ | ❌ | NOT DEPLOYED | **BLOCKED** |
| Bills / invoices | **NOT IMPLEMENTED** | — | — | — | **NOT APPLICABLE** |
| Goods receipt / receiving | **NOT IMPLEMENTED** | — | — | — | **NOT APPLICABLE** |

"Production verified" for the deployed modules refers to the post-deployment
verification carried out after Phase 6: the build, database and RBAC were
checked against production. It does **not** mean a construction company has run
its operations through them.

---

# PART A — MODULE REGISTER

Each capability records what it is for, how it behaves, what it changes, what it
explicitly does **not** change, and how it can be undone.

---

## A1. Authentication, session and company context

### A1.1 Email + password sign-in
- **Module:** Auth · **Location:** `/sign-in`
- **Roles:** anyone with an account. **Purpose:** get a person into their company's workspace.
- **How it works:** Supabase email/password. On success the session cookie is set and the user lands on `/dashboard`.
- **Preconditions:** an account exists and is not disabled.
- **Changes:** session only. **Does not change:** any business data.
- **Blockers:** a disabled member is routed to `/deactivated` rather than into the app.
- **Audit:** sign-in is not written to ActivityLog; Supabase holds auth logs.
- Code `IMPLEMENTED` · Demo `NOT APPLICABLE` (demo bypasses auth) · `DEPLOYED` · `PRODUCTION VERIFIED` · E2E `NOT TESTED`

### A1.2 Google OAuth sign-in
- **Location:** `/sign-in` → *Continue with Google*
- **How it works:** `signInWithOAuth({ provider: "google" })` → `/auth/callback`.
- **Note:** requires Supabase provider configuration; without it the button reports that configuration is missing rather than failing silently.
- Code `IMPLEMENTED` · Demo `NOT APPLICABLE` · `DEPLOYED` · **`DEPLOYED NOT VERIFIED`** — Google provider configuration in the production Supabase project was not confirmed by this audit · E2E `NOT TESTED`

### A1.3 Sign-up and company creation
- **Location:** `/sign-up` → `/onboarding`
- **Purpose:** the first user of a company creates the company and becomes its Owner.
- **Changes:** creates the Company, creates the User as Owner, seeds the built-in roles.
- Code `IMPLEMENTED` · Demo `NOT APPLICABLE` · `DEPLOYED` · `PRODUCTION VERIFIED` · E2E `NOT TESTED`

### A1.4 Password reset
- **Location:** `/forgot-password` → emailed link → `/reset-password`
- Code `IMPLEMENTED` · `DEPLOYED` · **`DEPLOYED NOT VERIFIED`** — depends on Supabase email template configuration · E2E `NOT TESTED`

### A1.5 Invitation acceptance
- **Location:** `/accept-invite`
- **How it works:** an invited person follows the emailed link, sets a password, and joins the company on the role they were invited to.
- **Blockers:** expired or cancelled invitations are refused.
- Code `IMPLEMENTED` · **`DEPLOYED NOT VERIFIED`** — the invite email template must be configured in Supabase; flagged when Team Management shipped and still unconfirmed · E2E `NOT TESTED`

### A1.6 Session, company context and authorization
- **How it works:** every server action resolves the current user, their company, their role and their permission list. `requirePermission(...)` gates each action. Owner is `isOwner` and holds all permissions implicitly rather than storing them.
- **Does not change:** anything — this is the gate, not an action.
- Code `IMPLEMENTED` · `DEPLOYED` · `PRODUCTION VERIFIED` · E2E `NOT TESTED`

### A1.7 Sign out and deactivated accounts
- **Location:** avatar menu → *Sign out*; `/deactivated` for a disabled member.
- Code `IMPLEMENTED` · `DEPLOYED` · `PRODUCTION VERIFIED` · E2E `NOT TESTED`

---

## A2. Dashboard

- **Location:** `/dashboard` · **Permission:** any authenticated member; each widget respects its own module permission.
- **Purpose:** answer "what needs me today?" before "how are we doing?"
- **Scope rule:** a user without a `*.view_all` grant sees only their assigned projects, and every figure is folded over that set rather than the company.

### A2.1 KPI strip — 8 measures
Active projects · upcoming deadlines · overdue · today's labour count · today's wages · budget used · budget total · pending approvals. Money renders through `MoneyText` — full Indian amounts, never abbreviated.

### A2.2 Attention centre — 5 attention types
Overdue projects · upcoming deadlines · pending POs · budget warnings · stale projects.
This is the only place in the product that tells the user what to do rather than what happened.

### A2.3 Widgets
Spend trend (weekly labour vs procurement) · cost split · labour card (today by category) · procurement card · budget health per project · recent activity feed · quick actions · a distinct onboarding dashboard for an empty company.

- **Changes:** nothing. The dashboard is read-only throughout.
- Code `IMPLEMENTED` · Demo `DEMO VERIFIED` · `DEPLOYED` · `PRODUCTION VERIFIED` · E2E `NOT TESTED`

---

## A3. Projects

- **Location:** `/projects`, `/projects/[id]` · **Permissions:** `projects.*` (8 keys)

### A3.1 List, search, filters, favourites
Search by name or code; filter by stage and status; pin a favourite; a recently-viewed list.

### A3.2 Create project
- **Permission:** `projects.create`
- **Fields:** name, code (auto `PRJ-####` when blank), type, PM, dates, client, and three money fields — budget, contract value, procurement budget.
- **Blockers:** a duplicate project code returns a typed result, not a 500.
- **Changes:** creates the project and its budget baseline. **Does not change:** contractor, labour or procurement data.

### A3.3 Nine stages
Created · Planning · Estimation · Procurement · Construction · Quality inspection · Completion · Handover · Closed — a stepper, changeable with `projects.edit`.

### A3.4 Per-section editing
Budget · Client & site · Details · Location (GPS). Each is its own sheet writing only its own fields.
- **Budget changes:** budget, contract value, procurement budget. **Does not change:** recorded spend, orders, attendance or settlements. A budget is a target, never a ledger.

### A3.5 Project tabs
Overview · Contractors · Labour · Procurement · Deadlines · Documents · Notes · Activity.

### A3.6 Contractor assignment
- **Purpose:** decide which contractors work on this project and at what day rates.
- **Changes:** the assignment set and per-labour-type rates.
- **Removal blockers:** `HAS_ATTENDANCE`, `HAS_SETTLEMENTS`, `HAS_LIVE_AGREEMENT`. The relationship cannot be removed once work or money depends on it.

### A3.7 Deadlines · Notes · Documents · Activity
- **Deadlines:** add, complete, remove. A reminder — no financial effect.
- **Notes:** free text, appended.
- **Documents:** real uploads to Supabase Storage in production (25 MB cap; PDF, PNG, JPEG allow-list). Demo records metadata only.
- **Activity:** the project's audit trail, read-only.

### A3.8 Archive, delete, restore
- **Archive:** removes from active lists; fully reversible.
- **Delete:** Danger Zone — type the project name, tick the acknowledgement, confirm with your password. A **soft delete**: the project moves to the Owner's deleted list with labour, orders, payments and agreements intact and restorable. There is no hard cascade.
- **Retention:** a configurable window governs the deleted list.

Code `IMPLEMENTED` · Demo `DEMO VERIFIED` · `DEPLOYED` · `PRODUCTION VERIFIED` · E2E `NOT TESTED`

---

## A4. Labour and Attendance

- **Location:** `/labor`, `/labor/summary`, `/labor/categories` · **Permissions:** `attendance.*` (7), `labour.*` (4)

### A4.1 Daily attendance sheet
- **Location:** Labor → date → project.
- **Structure:** grouped by **contractor**, then by labour type. This is the site's mental model — "Pappu brought 12 masons" — not a flat list of trades.
- **Entry:** a stepper in half-day increments, plus a free-text note per row.
- **Rate snapshot:** each row is priced at the rate in force *on that date* for that contractor and, where applicable, that agreement. Changing a rate later never reprices a recorded day.
- **Totals:** per row, per contractor group, per sheet.
- **Changes:** attendance quantity and its snapshot value, which feed **Attendance value** and **Unsettled labour**.
- **Does not change:** cash, Advance, Earned, Credited, or anything on an agreement. Attendance is work recorded, not money owed.
- **Blockers:** `ATTENDANCE_SETTLED` (reverse the settlement first), `ATTENDANCE_LOCKED`.

### A4.2 Date navigation
Previous day · next day · **Today** · date picker. Dates are pinned to IST so a late-evening entry does not land on tomorrow.

### A4.3 Copy previous day
- **Purpose:** the same crew usually returns, and retyping it is the commonest cause of missed attendance.
- **Changes:** creates today's rows from yesterday's, priced at **today's** rates.

### A4.4 Labour categories and types
- **Location:** `/labor/categories` · **Permission:** `labour.*`
- Categories contain subcategories (trades), each with a company default day rate; drag to reorder.
- **Delete:** a type with recorded attendance is archived, not removed. The **Owner Force Delete** flow shows an impact preview and requires a typed acknowledgement; it removes current configuration while preserving attendance and financial history.

### A4.5 Labour summary
- **Location:** `/labor/summary` — man-days and attendance value by category and by contractor over a period, with unattributed labour called out rather than hidden.

### A4.6 Offline capture — UNWIRED
- **What exists:** a Dexie outbox, a sync engine with idempotent flush, an `/api/sync` endpoint with a working `labour_attendance` handler, an online/offline indicator, and a sync chip.
- **What does not:** nothing ever calls `enqueue()`. `features/labor/sync.ts`, which registers the entity, is **never imported**, so registration never runs. Attendance writes go straight to a server action.
- **Consequence:** offline, the write fails, the optimistic number reverts, and the user sees *"Couldn't save — will retry"* while the chip reads *"Offline · saved on device"*. Nothing is saved and nothing retries.
- Code **`UNWIRED`** · Demo `NOT VERIFIED` · `NOT DEPLOYED` · E2E **`BLOCKED`** — see **L-01**

---

## A5. Contractors, Agreements and the commercial chain

- **Location:** `/labor/contractors`, `/labor/contractors/[id]` · **Permissions:** `contractors.*` (11), `contracts.*` (9)

The contractor record is the spine of the product. Its detail view carries ten sections:
Overview · Agreements · Scope & Labour · Rates · Milestones · Amendments · Payments · Reconciliation · Advance ledger · History.

### A5.1 Create and edit a contractor
- **Fields:** name, phone, opening advance. Duplicate detection warns on a matching name or mobile.
- **Changes:** an opening advance raises the Advance balance and writes an `OPENING_ADVANCE` ledger entry, which appears in the Payments Centre as cash.

### A5.2 Archive · Restore · Owner Delete
- **Archive** (`contractors.archive`): stops new work — no new agreements, advances, attendance or project assignments. Everything historical stays readable, and they can be restored.
- **Owner Delete** *(Phase 8.5)*: the Owner sees *Delete contractor*, which opens the same dialog with an explanation that a contractor is **never permanently deleted**, plus an impact summary — projects, agreements, advance ledger entries. The confirm button performs the archive and says so.
- **Does not change:** advance balance, settlements, attendance, agreements, or any report.

### A5.3 Agreement
- **Location:** Contractor → Agreements → *Create agreement*
- **Fields:** title, project, scope description, quantity and unit, agreement value, dates.
- **Statuses:** Not started · In progress · On hold · Completed · Settled · Cancelled.
- **Changes:** **Authorised value**. **Does not change:** cash, Earned, Credited, attendance.
- **Delete:** only when there are no payments, no completed milestones, no settled attendance and no approved amendments. Otherwise **Cancel**, which freezes it and keeps everything recorded.

### A5.4 Scope and Labour
- Which labour types this agreement covers, and the agreed rate for each.
- **Removal blocker:** `SCOPE_IN_USE` once attendance has been priced against that type on that agreement.

### A5.5 Rates and rate revisions
- **Append-only and effective-dated.** A revision states the new rate and the date it takes effect, with a mandatory reason, and may not predate the agreement.
- **Does not change:** attendance already recorded, which keeps the rate it was valued at.
- **Delete:** refused for any revision that priced historical attendance.

### A5.6 Milestones
- Per-agreement milestones with a value each; create singly or in bulk; reorder; complete.
- **Completing one changes:** **Earned**. **Does not change:** cash, Credited, Authorised.
- **Delete blockers:** `MILESTONE_HAS_HISTORY`, `MILESTONE_HAS_PAYMENTS`.

### A5.7 Amendments
- Propose, then approve or reject. The delta may be **negative** — the only signed money field in the product.
- **Approval changes:** **Authorised value**. **Does not change:** Earned, Credited, cash.
- **Delete blocker:** `AMENDMENT_APPROVED`.

### A5.8 Agreement payments and reversal
- **Record payment** (`contracts.pay`): commercial cash against an agreement.
- **Changes:** cash out, **Credited**.
- **Reverse payment** (`contracts.pay_delete`): the payment stays visible at its original amount and stops counting toward Credited. A reason is required.
- **Blocker:** `ALREADY_REVERSED`. There is no hard delete.

### A5.9 Advances
- **Record advance** (`contractors.advance`): prepaid labour cash, scoped to the contractor generally, to a specific project, or to a specific agreement.
- **Changes:** cash out, **Advance balance**, **Available advance** within that scope.
- **Does not change:** Earned, Credited, Authorised. An advance is not payment for work; it is money handed over before the work is settled.
- **Delete:** refused permanently (`ADVANCE_IS_CASH`). The ledger is append-only — there is no delete method on the repository at all.

### A5.10 Advance re-scope and its reversal
- **Purpose:** move unused advance from one scope to another — say from the compound wall agreement to the structure agreement — without pretending new cash moved.
- **Changes:** the advance's **allocation scope**, and nothing else.
- **Does not change:** cash paid, the contractor's total advance, Earned, or Credited. It is deliberately **excluded from the Payments Centre** for exactly this reason.
- **Reverse re-scope:** puts the money back where it came from. **Blocker:** `RESCOPE_CONSUMED` — refused once a settlement has drawn on it.

### A5.11 Settlement and its reversal
- **Location:** Contractor → *New settlement* · **Permission:** `contractors.settle`
- **How it works:** choose a project and period; the sheet computes unsettled attendance value; choose how much advance to recover; the balance is net cash.
- **Changes:** **Unsettled labour** falls; **Advance balance** falls by the amount recovered; cash out by the net; **Credited** rises.
- **Does not change:** Authorised or Earned.
- **Reverse settlement** (`contractors.settle_reverse`): returns the advance it drew and the cash it paid, unlocks the attendance, and stays visible marked reversed with its reason. **Blocker:** `ALREADY_REVERSED`.

### A5.12 Settled-labour attribution and its reversal
- **Purpose:** assign settled labour to the agreement it belongs to, after the fact.
- **Permission:** `contractors.attribute_history`
- **Changes:** which agreement the settled labour counts toward, which affects Earned attribution and reconciliation.
- **Does not change:** cash, the settlement itself, or the total settled value.
- **Reversal:** supported.

### A5.13 Reconciliation view
The canonical commercial position per agreement — Authorised, Earned, Credited, **Currently due**, **Paid ahead** — with unattributed settled labour shown separately rather than folded in.

### A5.14 Advance ledger and History
- **Advance ledger:** every advance, re-scope and settlement drawdown with the running balance. A re-scope renders as one transfer row, not as cash leaving and arriving.
- **Partial ledger:** a project-scoped user sees only the entries they may inspect, is told how many are hidden, and sees the figure labelled *"Visible project advance balance"* — never as *the* advance balance.
- **History:** the agreement's audit trail.

Code `IMPLEMENTED` · Demo `DEMO VERIFIED` · `DEPLOYED` (Phase 8.5 governance additions are not) · E2E `NOT TESTED`

---

## A6. Procurement and Vendors

- **Location:** `/vendors`, `/vendors/[id]`, `/procurement`, `/procurement/[id]` · **Permissions:** `vendors.*` (9), `purchase_orders.*` (9), `payments.*` (8)

### A6.1 Vendors
- Create, edit, favourite, filter by status and material, attach documents.
- **Archive:** the vendor stops appearing for new work; every order and payment keeps them as counterparty; reversible.
- **There is no vendor delete and no vendor merge**, although `vendors.delete` and `vendors.merge` exist as permission keys. See **L-06**.
- **Vendor detail tabs:** Overview · Projects · Purchase Orders · Payments · Documents · Outstanding (with ageing buckets 0–30, 31–60, 60+).

### A6.2 Purchase orders
- **Lifecycle:** Draft → Submitted → Approved. Whether approval is required is a workspace setting; with it off, a created PO is approved immediately.
- **Line items:** material, category, quantity, unit, rate, and GST % per line.
- **Totals:** subtotal (ex-GST) plus per-line rounded GST equals the grand total. GST is rounded per line and that rounded figure is the source of truth.
- **Numbering:** automatic `PO-####`.
- **Immutability:** an approved PO cannot be edited. **Revise** creates a linked new draft; **Duplicate** creates an unlinked one dated today.
- **Approval changes:** **Ordered value**, which flows into project procurement spend and Budget used.
- **Does not change:** cash, or anything about delivery.
- **Delete:** permitted only when no payments are recorded. **Blocker:** `PO_HAS_PAYMENTS` *(added in Phase 8.5 — this previously deleted the order and orphaned its payments)*. There is **no archive or cancel** for a PO.

### A6.3 Vendor payments
- **Record payment:** against a PO, or **on account** for an advance not tied to an order. Fields: vendor, project, PO (optional), amount, mode, date, reference, remarks.
- **Changes:** cash out, **Paid against orders** rises, **Still owed** falls.
- **Does not change:** Ordered value, or receipt of goods.
- **Correction: none exists.** A recorded vendor payment cannot be edited, reversed or deleted (`VENDOR_PAYMENT_IMMUTABLE`). The UI states this where the delete control used to be. See **L-02**.

### A6.4 Receiving / goods receipt — NOT IMPLEMENTED
The `GoodsReceipt` and `GoodsReceiptItem` tables exist in the schema, deliberately, so receiving can ship later without a redesign. There is no UI, no action and no hook.
Code `NOT IMPLEMENTED` · E2E `NOT APPLICABLE`

Code `IMPLEMENTED` · Demo `DEMO VERIFIED` · `DEPLOYED` · `PRODUCTION VERIFIED` · E2E `NOT TESTED`

---

## A7. Payments Centre

- **Location:** `/payments` · **Permission:** `payments.view`, plus `payments.view_all` for company-wide visibility.
- **Purpose:** one place to find any transaction, without pretending all financial instruments mean the same thing.

### A7.1 The four transaction types

| Type | Source record | What it means |
|---|---|---|
| **Contractor advance** | advance ledger | prepaid labour cash |
| **Contractor payment** | agreement payment | commercial payment against an agreement |
| **Labour settlement** | settlement | the **net cash** a weekly settlement paid out |
| **Vendor payment** | vendor payment | paid to a supplier, against a PO or on account |

### A7.2 Deliberate exclusions — the rules that keep the total honest
- A settlement contributes its **net cash only**. The advance it recovered is not counted again, because that cash left when the advance was paid. **No double counting.**
- **Advance re-scope is excluded entirely** — it changes allocation, not money.
- Internal allocation between scopes is excluded for the same reason.

### A7.3 Filters and behaviour
Search · type · party type (contractor or vendor) · project · status (active or reversed) · payment mode · period. Every row deep-links to its canonical source record. Reversed rows are visibly marked and excluded from the paid total.

Code `IMPLEMENTED` · Demo `DEMO VERIFIED` · `DEPLOYED` · `PRODUCTION VERIFIED` · E2E `NOT TESTED`

---

## A8. Reports

- **Location:** `/reports`, `/reports/[id]` · **Permissions:** `reports.view`, plus **`reports.view_financial`** or **`reports.view_operational`** according to the report's class.
- **Canonical-source rule:** every report calls the owning module's own repository and aggregation. **No report owns a financial formula.**

### The catalogue — 10 reports in 5 categories

| # | Report | Category | Class | Filters | Deployed |
|---|---|---|---|---|---|
| 1 | **Cash movement** ★ | Payments | financial | period, project, type, status | ❌ Phase 7 |
| 2 | **Budget vs Actual** ★ | Projects | financial | project | ✅ |
| 3 | Project summary | Projects | operational | project | ✅ |
| 4 | Deadlines | Projects | operational | project | ✅ |
| 5 | **Contractor position** ★ | Contractors | financial | contractor | ❌ Phase 7 |
| 6 | Advances & settlements | Contractors | financial | contractor | ❌ Phase 7 |
| 7 | Labour cost | Labour | operational | period, project | ✅ |
| 8 | Labour by contractor | Labour | operational | period, project | ❌ Phase 7 |
| 9 | Purchase orders | Procurement | operational | period, project, vendor | ✅ |
| 10 | Vendor summary | Procurement | operational | vendor | ✅ |

★ = flagship. **4 financial, 6 operational. 6 deployed, 4 not.**

Each report carries the business question it answers, KPI tiles (money rendered in full, never abbreviated), a chart where one helps, a table, deep links to source records, and three exports.

### A8.1 Exports — 3 formats
**PDF** (branded with the company's logo and colours) · **Excel** (`.xlsx`) · **CSV**. All three run client-side from the same result model, so no export can disagree with the report on screen.

Code `IMPLEMENTED` · Demo `DEMO VERIFIED` · 6 of 10 `DEPLOYED` · E2E `NOT TESTED`

---

## A9. Users and invitations

- **Location:** Settings → Users · **Permissions:** `users.*` (5), `roles.assign`

| Capability | Notes |
|---|---|
| List members | name, email, role, status |
| Invite | email plus role; the invite email needs a Supabase template |
| Resend invitation | |
| Cancel invitation | an unaccepted invite carries no history, so it is genuinely removed |
| Expired invitation | refused at acceptance |
| Assign role | via `roles.assign` |
| Disable / enable | a disabled member is routed to `/deactivated` |
| Remove from company | **blockers:** `LAST_OWNER`, `SELF` |

**Owner safeguards, enforced server-side:** the last active Owner cannot be removed, disabled or demoted, and nobody can remove themselves.

`users.edit` exists as a permission key but nothing enforces it, and a `useChangeMemberRole` hook exists but is never used — role assignment goes through `useAssignUserRole`. See **L-06** and **L-07**.

Code `IMPLEMENTED` · Demo `DEMO VERIFIED` · Phase 8 redesign `NOT DEPLOYED` · E2E `NOT TESTED`

---

## A10. Roles and RBAC

- **Location:** Settings → Roles & permissions · **Permissions:** `roles.*` (6)

### A10.1 The seven built-in roles

| Role | Permissions | Semantics |
|---|---|---|
| **Owner** | **97 (implicit)** | Stores **zero** permissions; access is implicit via `is_owner`. Cannot be deleted, demoted, or removed as the last one. |
| **Admin** | **94** | Everything except `company.billing`, `company.subscription`, `company.api_keys`. |
| **Project Manager** | **28** | Assigned projects only — no `_all` grants except `reports.view_all`. |
| **Accountant** | **15** | Money-facing: payments, financial reports, contractor cash. |
| **Purchase Manager** | **8** | Vendors and purchase orders. |
| **Site Engineer** | **5** | Attendance, and the projects they are on. |
| **Supervisor** | **4** | View projects, view and mark attendance, view agreements. |

### A10.2 Built-in roles are read-only *(Phase 8.5)*
- Enforced at the **server action** (`assertRoleEditable` throws `BUILT_IN_ROLE`), not in the UI.
- **Why:** `prisma/reconcile-rbac.ts` rewrites every system role to its code preset, so a customer's edit would have vanished silently on the next update — with a security consequence.
- The UI shows *Built-in* and *Managed by Constructly*, states the reason plainly, and offers **Duplicate to customise** as the primary action.

### A10.3 Custom roles
Create from scratch or duplicate a built-in one; edit permissions freely; delete when nobody holds it (`ROLE_IN_USE`). **Reconciliation never touches a custom role** — proven byte-for-byte.

A duplicate of Owner receives today's full permission list but is **not** an owner role: it will not silently gain future permissions, and it can be edited and deleted like any other custom role.

### A10.4 Permission model — 97 keys across 13 modules

| Module | Keys | Module | Keys |
|---|---|---|---|
| projects | 8 | contracts | 9 |
| purchase_orders | 9 | vendors | 9 |
| labour | 4 | reports | 7 |
| attendance | 7 | users | 5 |
| bills | 6 *(no such module exists)* | roles | 6 |
| payments | 8 | company | 8 |
| contractors | 11 | | |

- **26 keys are marked HIGH IMPACT** and are labelled as such in the editor.
- **Project versus company-wide scope:** a `*_all` grant is what turns "your assigned projects" into "the whole company". Every one is marked company-scope and high-impact so it cannot be granted blind.
- **Financial and operational reports are separate grants.**
- **Payments visibility does not cascade:** holding `payments.view` does not reveal company-wide contractor advances; that needs `contractors.view_all`.
- **21 of the 97 keys are enforced nowhere.** See **L-06**.

Code `IMPLEMENTED` · Demo `DEMO VERIFIED` · Phase 8 and 8.5 changes `NOT DEPLOYED` · E2E `NOT TESTED`

---

## A11. Company settings

- **Location:** `/settings`, deep-linkable by `?section=` · **Permissions:** `company.*` (8)

| Section | What it does | Status |
|---|---|---|
| **Company** | legal name, GSTIN/PAN, address, contact | `IMPLEMENTED` |
| **Documents** | company stamp and signature images, used on exports | `IMPLEMENTED` |
| **Appearance** | logo and brand colours; drives branded PDFs | `IMPLEMENTED` |
| **Users** | see A9 | `IMPLEMENTED` |
| **Roles & permissions** | see A10 | `IMPLEMENTED` |
| **My profile** | own name, avatar, password | `IMPLEMENTED` |
| **Workspace** | defaults and presets, including whether PO approval is required | `IMPLEMENTED` |
| Billing | — | **NOT IMPLEMENTED** (`company.billing` is Owner-only and gates nothing) |
| Subscription | — | **NOT IMPLEMENTED** |
| API keys | — | **NOT IMPLEMENTED** |
| Integrations | — | **NOT IMPLEMENTED** |
| Security settings | — | **NOT IMPLEMENTED** |

Code `IMPLEMENTED` for the seven wired sections · Phase 8 redesign `NOT DEPLOYED` · E2E `NOT TESTED`

---

## A12. Demo mode

- **Commands:** `npm run dev:demo`, `npm run build:demo`, `npm run start:demo` — all through `scripts/*-demo.mjs`, which own the environment in one place.
- **Architecture (ADR-0016):** `repository.ts` (interface) plus `demo/demo-repository.ts` (localStorage) plus `data.ts` choosing between them. The switch happens **client-side**, because a `"use server"` action runs where there is no localStorage.
- **Coverage:** 10 of 15 feature modules ship a demo repository — branding, contractors, contracts, dashboard, labor, payments, procurement, projects, rbac, team. The other five (budget, documents, governance, reports, settings) derive from those or hold no data of their own.
- **Separation:** no demo identity ever reaches Prisma, and every governed refusal exists in the demo with the same error code as the server.
- **Persistence:** localStorage, so a custom role or a recorded advance survives a reload.

Code `IMPLEMENTED` · deployment `NOT APPLICABLE` · E2E `NOT APPLICABLE`

---

## A13. Accessibility (product behaviour)

- Every form control is labelled through a single `Field` primitive that owns the id — including controls nested inside render props, which is exactly where four money fields silently lost their labels during Phase 8.5.
- Money fields announce their currency; the ₹ glyph is decorative.
- Status is never conveyed by colour alone — badges carry text.
- Dialogs manage focus, and no destructive dialog carries two identically named buttons.
- Skip-to-content link, and keyboard navigation throughout.
- **59 automated scans** across light, dark and 375 px report **0 serious or critical violations**.

Code `IMPLEMENTED` · E2E `NOT TESTED` — no assistive-technology user has validated the product.

---

## A14. Responsive and mobile web

- Verified at **375, 768, 1130, 1280 and 1440 px**.
- Tables render as tables on wide viewports and as stacked cards on narrow ones.
- Attendance is designed for a phone held on site: large tap targets, half-day steppers, no horizontal scrolling.
- **This is responsive web, not a native app.** A Capacitor iOS shell exists on a separate branch (`ios-app`) and is not part of this product.

Code `IMPLEMENTED` · E2E `NOT TESTED`

---

## A15. Audit and history

- **What is logged:** project lifecycle, agreement lifecycle, settlements and their reversals, payments and their reversals, advances and re-scopes, PO lifecycle, role and permission changes, member changes.
- **Where it surfaces:** project Activity tab, contractor History tab, agreement history, dashboard recent activity.
- **Immutability:** `ActivityLog` is **REFUSE** — never deletable, by anyone, including the Owner. No UI, action or repository exposes a path.

Code `IMPLEMENTED` · `DEPLOYED` · `PRODUCTION VERIFIED` · E2E `NOT TESTED`

---

# PART B — MINOR CAPABILITY INDEX

Small things people rely on daily. Counting "Projects" as one feature hides most
of what the product actually is.

## B1. Navigation and finding things

| # | Capability | Where | Status |
|---|---|---|---|
| 1 | Global search (⌘K command palette) | topbar | `IMPLEMENTED` |
| 2 | Sidebar module navigation, permission-gated | shell | `IMPLEMENTED` |
| 3 | Module visibility follows permissions (`useCanAccessModule`) | shell | `IMPLEMENTED` |
| 4 | Recently viewed projects | `/projects` | `IMPLEMENTED` |
| 5 | Recently used vendors | `/vendors` | `IMPLEMENTED` |
| 6 | Favourite / pin a project | `/projects` | `IMPLEMENTED` |
| 7 | Favourite a vendor | `/vendors` | `IMPLEMENTED` |
| 8 | Breadcrumbs and back links | detail pages | `IMPLEMENTED` |
| 9 | Deep links with `?section=` / `?tab=` | settings, details | `IMPLEMENTED` |
| 10 | Source links from a report row to its record | reports | `IMPLEMENTED` |
| 11 | Source links from a payment row to its record | `/payments` | `IMPLEMENTED` |
| 12 | Record navigation (previous/next within a list) | detail pages | `IMPLEMENTED` |
| 13 | Skip-to-content link | shell | `IMPLEMENTED` |

## B2. Filtering, periods and search

| # | Capability | Where | Status |
|---|---|---|---|
| 14 | Text search within a list | projects, vendors, contractors, POs, payments | `IMPLEMENTED` |
| 15 | "More filters" sheet | procurement, payments | `IMPLEMENTED` |
| 16 | Active filter count badge | procurement, payments | `IMPLEMENTED` |
| 17 | Clear all filters | filter sheets | `IMPLEMENTED` |
| 18 | Period presets — 8 | reports, payments, labour | `IMPLEMENTED` |
| 19 | **Indian financial year** (April–March, labelled `FY 2026–27`) | period picker | `IMPLEMENTED` |
| 20 | Custom date range | period picker | `IMPLEMENTED` |
| 21 | All-time (unbounded, and stated as such) | period picker | `IMPLEMENTED` |
| 22 | Amount-range filter (min/max, Indian input) | procurement | `IMPLEMENTED` |
| 23 | Status / stage filters | projects, POs, vendors, contractors | `IMPLEMENTED` |
| 24 | Today / previous day / next day | attendance | `IMPLEMENTED` |
| 25 | IST date pinning | attendance, dashboard | `IMPLEMENTED` |

## B3. Money presentation and entry

| # | Capability | Where | Status |
|---|---|---|---|
| 26 | **Indian live money input** — 24 declaration sites, 20 files | every editable rupee field | `IMPLEMENTED` *(Phase 8.5, not deployed)* |
| 27 | Lakh/crore grouping while typing | money inputs | `IMPLEMENTED` |
| 28 | Caret preserved when a separator appears | money inputs | `IMPLEMENTED` |
| 29 | Paste accepting `₹`, `Rs.`, `INR`, commas | money inputs | `IMPLEMENTED` |
| 30 | Empty distinguished from zero | money inputs | `IMPLEMENTED` |
| 31 | Negative entry only where the domain allows it (amendments) | amendment delta | `IMPLEMENTED` |
| 32 | Unit suffix outside the number (`/ day`, `per sq.ft`) | rate fields | `IMPLEMENTED` |
| 33 | `MoneyText` — full amounts, hides bare `.00`, keeps paise, never wraps | everywhere money is shown | `IMPLEMENTED` |
| 34 | Tabular figures so columns of money line up | tables | `IMPLEMENTED` |
| 35 | Integer paise storage end to end | domain | `IMPLEMENTED` |

## B4. Tables and lists

| # | Capability | Where | Status |
|---|---|---|---|
| 36 | `DataTable` primitive | lists | `IMPLEMENTED` |
| 37 | Responsive table → stacked cards | all lists | `IMPLEMENTED` |
| 38 | Row virtualisation | payments, projects | `IMPLEMENTED` |
| 39 | Column visibility, persisted to localStorage | procurement | `IMPLEMENTED` |
| 40 | Numeric/money columns right-aligned | tables | `IMPLEMENTED` |
| 41 | Column dropped rather than squeezed on narrow screens | tables | `IMPLEMENTED` |
| 42 | Row click opens the record, first cell is a real link | tables | `IMPLEMENTED` |
| — | Sorting engine, column resizing | — | **NOT IMPLEMENTED** — a deliberate decision; this is not a data grid |

## B5. State, feedback and safety

| # | Capability | Where | Status |
|---|---|---|---|
| 43 | Skeleton loading states | everywhere | `IMPLEMENTED` |
| 44 | Empty states with a next action | everywhere | `IMPLEMENTED` |
| 45 | Error states with a retry | everywhere | `IMPLEMENTED` |
| 46 | Optimistic updates with rollback | attendance | `IMPLEMENTED` |
| 47 | Toast confirmations and failures | mutations | `IMPLEMENTED` |
| 48 | Status badges carrying text, not colour alone | everywhere | `IMPLEMENTED` |
| 49 | Online / offline indicator | topbar | `IMPLEMENTED` |
| 50 | Attendance sync chip | attendance | `IMPLEMENTED` *(reports a promise the product does not keep — see L-01)* |
| 51 | Dark mode, light mode, system | topbar, palette | `IMPLEMENTED` |
| 52 | Hydration-safe deep links | settings, details | `IMPLEMENTED` |

## B6. Destructive and corrective grammar *(Phase 8.5)*

| # | Capability | Status |
|---|---|---|
| 53 | Governed delete policy — 20 entities, one written matrix | `IMPLEMENTED` |
| 54 | `GovernedDeleteDialog` reading the matrix, so a screen cannot rename an outcome | `IMPLEMENTED` |
| 55 | Reversal named as reversal, never "delete" | `IMPLEMENTED` |
| 56 | Blocked delete shown disabled **with its reason** | `IMPLEMENTED` |
| 57 | Impact preview before a meaningful deletion | `IMPLEMENTED` |
| 58 | Mandatory reason on a reversal | `IMPLEMENTED` |
| 59 | Password + typed name + acknowledgement for a project delete | `IMPLEMENTED` |
| 60 | Typed acknowledgement for Owner Force Delete of a labour type | `IMPLEMENTED` |
| 61 | Archive and restore | contractors, vendors, projects, labour types | `IMPLEMENTED` |
| 62 | **Duplicate to customise** for a built-in role | `IMPLEMENTED` |
| 63 | HIGH IMPACT permission indicator | roles editor | `IMPLEMENTED` |
| 64 | Assigned-project vs company-wide scope badges | roles editor | `IMPLEMENTED` |
| 65 | Per-permission plain-English explanation (all 97) | roles editor | `IMPLEMENTED` |

## B7. Exports and documents

| # | Capability | Status |
|---|---|---|
| 66 | PDF export, branded with company logo and colours | `IMPLEMENTED` |
| 67 | Excel (`.xlsx`) export | `IMPLEMENTED` |
| 68 | CSV export | `IMPLEMENTED` |
| 69 | Attendance export | `IMPLEMENTED` |
| 70 | Company stamp and signature on documents | `IMPLEMENTED` |
| 71 | Project document upload (Supabase Storage, 25 MB, PDF/PNG/JPEG) | `IMPLEMENTED` |
| 72 | Vendor document upload | `IMPLEMENTED` |

**72 minor capabilities recorded.**

---

# PART C — WORKFLOW REGISTER

Sixteen workflows, each traced through the product as it exists.

### WF-01 · Company onboarding
`Sign up → Onboarding (company created, Owner assigned, built-in roles seeded) → Settings → Company (legal name, GSTIN) → Appearance (logo, colours) → Users (invite) → Roles (duplicate to customise if needed) → create the first Project`
**Roles:** Owner. **Status:** `IMPLEMENTED`; the invite email depends on Supabase configuration. **E2E `NOT TESTED`.**

### WF-02 · New project setup
`Projects → New project (name, code, type, dates, client) → budget / contract value / procurement budget → assign a Project Manager → Contractors tab → assign contractors → set per-labour-type day rates`
**Roles:** Owner, Admin, PM with `projects.create`. **Status:** `IMPLEMENTED`. **E2E `NOT TESTED`.**

### WF-03 · Attendance-only contractor (no agreement)
`Contractors → Add contractor → Project → Contractors tab → assign → labour types and rates → Labor → mark attendance`
**Why it matters:** most Indian site labour runs this way. **No agreement is required** — attendance, attendance value and weekly settlement all work without one.
**Status:** `IMPLEMENTED`. **E2E `NOT TESTED`.**

### WF-04 · Commercial contractor setup (with agreement)
`Contractor → Agreements → Create agreement (value, project, dates) → Scope & Labour (which trades) → Rates (agreed rate each) → Milestones (value each)`
**Status:** `IMPLEMENTED`. **E2E `NOT TESTED`.**

### WF-05 · Daily attendance
`Labor → pick the date → pick the project → contractor group → labour type → quantity in half-days → rate snapshot applied → Attendance value updates per row, per group, per sheet`
**Roles:** Site Engineer, Supervisor, PM, Admin, Owner. **Status:** `IMPLEMENTED` online; **offline is `UNWIRED`** (L-01). **E2E `NOT TESTED`.**

### WF-06 · Weekly contractor settlement
`Contractor → New settlement → project + period → unsettled attendance value computed → choose advance to recover → net cash → record → Credited rises, Advance falls, attendance locks → Reconciliation updates`
**Roles:** `contractors.settle`. **Status:** `IMPLEMENTED`. **E2E `NOT TESTED`.**

### WF-07 · Settlement correction
`Contractor → Payments/Settlements → Reverse settlement (reason required) → advance returned, cash returned, attendance unlocked → correct the attendance → settle again`
**Blocker:** `ALREADY_REVERSED`. **Status:** `IMPLEMENTED`. **E2E `NOT TESTED`.**

### WF-08 · Advance lifecycle
`Record advance (scope: contractor / project / agreement) → available balance within that scope → drawn down by a settlement → unused funds re-scoped → optionally reversed`
**Blocker on reversal:** `RESCOPE_CONSUMED`. **Status:** `IMPLEMENTED`. **E2E `NOT TESTED`.**

### WF-09 · Milestone commercial lifecycle
`Agreement → Milestones → mark complete → Earned rises → Reconciliation shows Currently due or Paid ahead`
**Status:** `IMPLEMENTED`. **E2E `NOT TESTED`.**

### WF-10 · Amendment
`Agreement → Propose amendment (delta, may be negative, with reason) → approve or reject → on approval Authorised value moves`
**Roles:** propose with `contracts.edit`; approve with `contracts.amend_approve`. **Status:** `IMPLEMENTED`. **E2E `NOT TESTED`.**

### WF-11 · Procurement
`Vendors → Add vendor → Procurement → New purchase order (lines, rates, GST) → Submit → Approve → Ordered value counts → Record vendor payment → Paid rises, Still owed falls`
**Status:** `IMPLEMENTED`. **No receiving step exists** (L-03), and **a vendor payment cannot be corrected** (L-02). **E2E `NOT TESTED`.**

### WF-12 · Payments oversight
`Any source transaction → /payments → filter by type, party, project, mode, status, period → open the canonical source record`
**Status:** `IMPLEMENTED`. **E2E `NOT TESTED`.**

### WF-13 · Reporting
`Operational source → the owning module's canonical calculation → Reports → choose report → filter and period → read KPIs, chart, table → export to PDF, Excel or CSV`
**Status:** `IMPLEMENTED`; 6 of 10 reports deployed. **E2E `NOT TESTED`.**

### WF-14 · User access
`Settings → Users → Invite (email + role) → invitee accepts → role grants permissions → project scope limits what they see → every server action re-checks`
**Status:** `IMPLEMENTED`; invite email needs Supabase configuration. **E2E `NOT TESTED`.**

### WF-15 · Custom role
`Settings → Roles → select a built-in role (read-only) → Duplicate to customise → the copy is selected and editable → adjust permissions → assign to a user → reconciliation never touches it`
**Status:** `IMPLEMENTED` *(Phase 8.5, not deployed)*. **E2E `NOT TESTED`.**

### WF-16 · Owner deletion / governance
`Owner → destructive action → impact preview → the domain decides: Delete (hard), Archive/Soft delete, Reverse, or Refuse with a reason`
**Status:** `IMPLEMENTED` *(Phase 8.5, not deployed)*. **E2E `NOT TESTED`.**

### WF-17 · Settled-labour attribution *(found during the audit; not in the original list)*
`Contractor → Reconciliation → unattributed settled labour → attribute to an agreement → Earned attribution updates → reversible`
**Roles:** `contractors.attribute_history`. **Status:** `IMPLEMENTED`. **E2E `NOT TESTED`.**

### WF-18 · Project closure *(found during the audit)*
`Project → stage stepper → Completion → Handover → Closed`, with budget and deadline positions preserved.
**Status:** `IMPLEMENTED`. **E2E `NOT TESTED`.**

**18 workflows.**

---

# PART D — WORKED EXAMPLES

Numbers are integer paise internally; shown here as a person would read them.

## D1. Pappu Contractor on Skyline Residency — the full commercial chain

**Setup.** Pappu is assigned to Skyline Residency. An agreement is created:

- Agreement: **Structure — Skyline Residency**
- Authorised value: **₹60,00,000**
- Six milestones at **₹10,00,000** each
- Scope: Mason ₹900/day, Helper ₹600/day

**Step 1 — An advance.** On 1 July the office pays Pappu **₹8,00,000** as an advance, scoped to this agreement.

| Measure | Before | After |
|---|---|---|
| Cash out | — | **₹8,00,000** |
| Advance balance | ₹0 | **₹8,00,000** |
| Available advance (this agreement) | ₹0 | **₹8,00,000** |
| Authorised / Earned / Credited | 60,00,000 / 0 / 0 | **unchanged** |

The advance appears in the Payments Centre as *Contractor advance*. It is **not** a payment for work.

**Step 2 — A week of attendance.** 1–7 July: 40 mason-days and 30 helper-days.

`40 × ₹900 = ₹36,000` · `30 × ₹600 = ₹18,000` → **Attendance value ₹54,000**

| Measure | After |
|---|---|
| Attendance value | **₹54,000** |
| Unsettled labour | **₹54,000** |
| Cash, Advance, Earned, Credited | **all unchanged** |

Attendance is work recorded. Nobody owes anybody anything yet.

**Step 3 — Two milestones complete.** Milestones 1 and 2 are marked complete.

| Measure | After |
|---|---|
| Authorised | ₹60,00,000 (unchanged) |
| **Earned** | **₹20,00,000** |
| Credited | ₹0 |
| **Currently due** | **₹20,00,000** |

**Step 4 — The weekly settlement.** On 8 July the week is settled. Unsettled labour is ₹54,000; the office recovers **₹50,000** of advance and pays the balance in cash.

| Measure | Before | After |
|---|---|---|
| Unsettled labour | ₹54,000 | **₹0** |
| Advance balance | ₹8,00,000 | **₹7,50,000** |
| Cash out (this settlement) | — | **₹4,000** *(net)* |
| **Credited** | ₹0 | **₹54,000** |
| **Currently due** | ₹20,00,000 | **₹19,46,000** |

The Payments Centre records **₹4,000** for this settlement — the net cash. The ₹50,000 of advance is **not** counted again: that cash left the company on 1 July.

**Step 5 — A commercial payment.** On 10 July, ₹19,46,000 is paid against the agreement.

| Measure | After |
|---|---|
| Cash out | ₹19,46,000 |
| **Credited** | **₹20,00,000** |
| **Currently due** | **₹0** |

**Step 6 — Paying ahead.** On 12 July a further ₹5,00,000 is paid, though only ₹20,00,000 has been earned.

| Measure | After |
|---|---|
| Earned | ₹20,00,000 |
| Credited | **₹25,00,000** |
| Currently due | ₹0 |
| **Paid ahead** | **₹5,00,000** |

Constructly never shows a negative "due". Money credited beyond what has been earned is **Paid ahead** — a distinct fact with a distinct name.

**Step 7 — A correction.** The 8 July settlement was recorded against the wrong project. It is **reversed** with the reason "wrong project".

| Measure | After the reversal |
|---|---|
| Advance balance | back to **₹8,00,000** |
| Cash | ₹4,000 returned |
| Unsettled labour | back to **₹54,000** |
| Attendance | **unlocked and correctable** |
| The settlement itself | **still visible, marked reversed, reason recorded** |
| Credited | falls by ₹54,000 |

Nothing was erased. The record of what happened, and of the correction, both survive.

**Step 8 — Re-scoping an advance.** ₹3,00,000 of Pappu's remaining advance is moved from *Structure* to a new *Compound Wall* agreement.

| Measure | Effect |
|---|---|
| Available advance — Structure | **falls ₹3,00,000** |
| Available advance — Compound Wall | **rises ₹3,00,000** |
| **Cash paid** | **unchanged** |
| **Total advance balance** | **unchanged at ₹8,00,000** |
| Earned, Credited, Authorised | **unchanged** |
| Payments Centre | **shows nothing — this is not a movement of money** |

## D2. Procurement — Sanghvi Steel on Skyline Residency

- **PO-0230**, Sanghvi Steel, Skyline Residency, 4 August
- One line: TMT Steel Fe500, 40 ton at **₹62,000**, GST 18%

`40 × ₹62,000 = ₹24,80,000` subtotal · GST `₹4,46,400` · **Grand total ₹29,26,400**

On approval: **Ordered value ₹29,26,400** counts toward the project's procurement spend and Budget used. No cash has moved.

A part payment of **₹15,00,000** is recorded.

| Measure | Value |
|---|---|
| Ordered value | ₹29,26,400 |
| **Paid against orders** | **₹15,00,000** |
| **Still owed** | **₹14,26,400** |
| Goods received | **not tracked — Constructly cannot tell you whether the steel arrived** |

**If that payment was wrong:** it cannot be corrected. There is no reversal and no delete. The only path today is a compensating payment recorded separately (L-02).

**If someone tries to delete PO-0230:** refused, because payments exist against it. The menu says *"Paid against — the order stays."* Deleting it would leave ₹15,00,000 of cash pointing at nothing and take ₹29,26,400 of ordered value out of the budget.

## D3. Project Manager access

Priya is a **Project Manager** (28 permissions) assigned to Skyline Residency only.

| She sees | She does not see |
|---|---|
| Skyline Residency in Projects | Orion Tech Park or any other project |
| Skyline attendance, contractors, POs | company-wide contractor advances |
| A contractor's **visible project advance balance**, labelled as such, with the count of hidden entries disclosed | the company-wide advance balance |
| Operational reports | financial reports (unless granted separately) |

Her dashboard KPIs fold over her assigned projects only. The **`_all` grants** are what would change this, and each is marked HIGH IMPACT and company-scope in the editor so it cannot be granted without noticing.

## D4. Custom role

The company wants an Admin who cannot delete projects.

1. Settings → Roles → **Admin** — read-only, badged *Built-in* and *Managed by Constructly*, 94 of 97 permissions, no checkboxes.
2. **Duplicate to customise** → *"Admin (copy)"* is created, selected, and editable with the same 94 grants.
3. Untick `projects.delete` → 93 permissions.
4. Assign the copy to the person.
5. When Constructly next reconciles built-in roles, **Admin** returns to its canonical template and **the copy is untouched, byte for byte.**

Before Phase 8.5 the customer would have edited Admin directly and lost the change silently on the next update — with the person quietly regaining the ability to delete projects.

## D5. Governed delete

The Owner opens Pappu Contractor and chooses **Delete contractor**.

The dialog says:

> **A contractor is never permanently deleted**
> Their record is referenced by settlements, payments, attendance and every report that has ever counted them, so erasing it would change history that has already been acted on. Archiving is the governed equivalent: they stop taking new work and everything they did stays readable.
>
> Projects **2** · Agreements **4** · Advance ledger entries **2**

The confirm button reads **Archive contractor** — the operation that will actually happen. After it:

| | |
|---|---|
| New agreements, advances, attendance, assignments | **blocked** |
| Every historical record and report | **unchanged and readable** |
| Advance balance of ₹7,00,000 | **still on the ledger** — archiving does not settle or write off |
| Restore | **available** |

---

# PART E — FINANCIAL GLOSSARY

These are the canonical definitions. Where two terms sound alike, the difference
between them is the whole point — most financial confusion in construction comes
from treating work recorded, money owed and cash paid as the same thing.

### Project Budget
- **Meaning:** what the company intends to spend on a project.
- **Source:** set on the project; edited in Budget.
- **Appears:** project Overview, dashboard budget health, Budget vs Actual.
- **Not to be confused with:** Contract value (what the client pays) or Budget used (what has been committed and spent).

### Budget used
- **Meaning:** labour plus procurement committed against the project.
- **Source:** the shared budget source (ADR-0018) — the same figures the dashboard, project Overview and Budget vs Actual all read.
- **Not:** cash paid. An approved unpaid PO is in Budget used.

### Ordered value *(Procurement)*
- **Meaning:** the grand total of approved purchase orders, GST inclusive.
- **Formula:** Σ (subtotal + per-line rounded GST) for approved POs.
- **Not:** **Paid** — no cash has necessarily moved. **Not: Received** — Constructly does not track delivery at all.

### Paid against orders
- **Meaning:** vendor payments recorded, whether against a PO or on account.
- **Not:** proof of delivery, and not reducible — a vendor payment cannot be reversed.

### Still owed *(Procurement)*
- **Formula:** Ordered value − Paid against orders.
- **Appears:** vendor Outstanding tab (with ageing), PO detail, Vendor summary report.
- **Not:** an invoice position. Constructly has no bills module.

### Attendance value *(Labour)*
- **Meaning:** the value of labour recorded on the attendance sheet, priced at the rate in force on that date.
- **Formula:** Σ (quantity × snapshot rate) per row.
- **Appears:** attendance sheet totals, Labour summary, Labour cost report.
- **Explicitly NOT:** Contractor Due. **NOT:** Payable. **NOT:** cash paid. It is work recorded — nothing more.

### Unsettled labour
- **Meaning:** attendance value not yet recognised by a settlement.
- **Formula:** Attendance value − settled attendance value.
- **Appears:** contractor Overview, settlement sheet, Labour summary.
- **Not:** a debt. It becomes a commercial fact only when settled.

### Agreement Authorised value
- **Meaning:** what the agreement currently permits, including approved amendments.
- **Formula:** original agreement value + Σ approved amendment deltas.
- **Moved only by:** creating the agreement, and approving an amendment.
- **Not:** Earned, and not a cap on cash.

### Earned
- **Meaning:** value the contractor has become entitled to.
- **Source:** completed milestones, plus attributed settled labour.
- **Moved only by:** completing a milestone, and attributing settled labour.
- **Not:** Credited. Earning is not being paid.

### Attendance credit
- **Meaning:** the portion of Credited that arose from a labour settlement rather than a commercial payment.
- **Why it is separate:** a settlement pays for days worked; an agreement payment pays against the contract. Folding them together loses which is which.

### Other Agreement payments
- **Meaning:** commercial payments recorded directly against the agreement, outside a settlement.

### Credited
- **Formula:** Attendance credit + Other agreement payments − reversed amounts.
- **Meaning:** everything counted as paid toward this agreement.
- **Not:** cash out of the company for the period (an advance is cash that is not yet Credited).

### Currently due
- **Formula:** max(0, Earned − Credited).
- **Meaning:** what the contractor is owed right now.
- **Never negative** — the surplus case is Paid ahead.

### Paid ahead
- **Formula:** max(0, Credited − Earned).
- **Meaning:** credited beyond what has been earned.
- **Why it has its own name:** "negative due" is not a thing a site office can act on.

### Advance
- **Meaning:** cash handed to a contractor before the work is settled.
- **Source:** the advance ledger — append-only.
- **Appears:** contractor Overview, Advance ledger, Payments Centre (as *Contractor advance*).
- **Not:** Credited, not Earned, not a payment against an agreement.

### Available advance
- **Meaning:** advance balance still usable within a particular scope — contractor-wide, a project, or an agreement.
- **Not:** the total advance balance. A ₹8,00,000 balance with ₹3,00,000 scoped to another agreement leaves ₹5,00,000 available here.

### Advance balance
- **Formula:** Σ advances − Σ amounts recovered by settlements ± re-scope movements.
- **Not:** a debt in the accounting sense; it is company cash sitting with the contractor.

### Labour Settlement
- **Meaning:** the weekly reckoning — attendance value recognised, some advance recovered, the balance paid in cash.
- **Changes:** Unsettled labour falls, Advance falls, cash out by the net, Credited rises.

### Net cash *(of a settlement)*
- **Formula:** settled attendance value − advance recovered.
- **Why it matters:** this, and only this, is what the settlement contributes to the Payments Centre. Counting the recovered advance again would double-count cash that left when the advance was paid.

### Reversed
- **Meaning:** a settlement, payment, re-scope or attribution that has been undone by an opposing entry.
- **Behaviour:** the original stays visible with its original amount and its reason, and stops counting toward any total.
- **Not:** deleted. Nothing is erased.

### Unattributed settled labour
- **Meaning:** labour that has been settled but not yet assigned to an agreement.
- **Why it is shown separately:** folding it into an agreement's Earned would assert a link nobody has made. It is displayed as its own line.

---

## Three distinctions stated explicitly

> **Attendance value ≠ Contractor Due ≠ Payable ≠ cash paid.**
> Attendance value is work recorded. Due is Earned minus Credited on an agreement. Cash paid is what left the bank. A week of attendance can be worth ₹54,000 while Due is ₹19,46,000 and cash paid that day is ₹4,000 — all three correct, all three different.

> **Ordered value ≠ Paid ≠ Received.**
> Ordering commits budget. Paying moves cash. Receiving is **not tracked at all** — Constructly cannot tell you whether the steel arrived.

> **Advance re-scope ≠ new cash movement.**
> It changes which work an existing advance is available against. No cash moves, the total advance is unchanged, and the Payments Centre deliberately shows nothing.

---

# PART F — FEATURE DEPENDENCY MAP

Why the order of operations matters, and why deletion is governed rather than universal.

```
Project
  └─ Contractor assignment          (blocked from removal by attendance / settlements / live agreement)
       └─ Labour type mapping
            └─ Rates  (effective-dated, append-only)
                 └─ Attendance      (priced by the rate in force ON THAT DATE)
                      └─ Settlement (recognises attendance, recovers advance, pays net cash)
                           └─ Credited
                                └─ Reconciliation

Agreement
  ├─ Scope & Labour   (blocked from removal once attendance is priced against it)
  ├─ Rates            (append-only)
  ├─ Milestones       → Earned
  ├─ Amendments       → Authorised value
  └─ Agreement payments → Credited  (reversible, never deletable)

Advance
  ├─ scoped to contractor / project / agreement
  ├─ drawn down by Settlement
  └─ Re-scope (allocation only; reversible until consumed)

Vendor
  └─ Purchase Order   → Ordered value
       └─ Vendor Payment → Paid against orders → Still owed
                          (no reversal exists)

Operational modules ──→ Payments Centre   (reads them; owns no formula)
                   └──→ Reports           (reads them; owns no formula)

Roles ──→ Users ──→ server-enforced access on every action
```

### How these dependencies force the delete rules

| Dependency | Consequence for deletion |
|---|---|
| Attendance is priced by a dated rate | a used rate revision can never be deleted — it would reprice recorded work |
| Settlement recognises attendance | settled attendance cannot be cleared; reverse the settlement first |
| Settlement consumes advance | an advance cannot be deleted; a re-scope cannot be reversed once consumed |
| Credited derives from payments and settlements | neither may be hard-deleted; both reverse |
| Ordered value derives from approved POs | a PO with payments cannot be deleted — the cash would point at nothing |
| Vendor payments have no reversal | they are immutable, because refusal is safer than a hole in the ledger |
| Everything references the contractor | a contractor can only be archived, never deleted |
| Reports and Payments read the modules | destroying a source record would silently change history in both |
| ActivityLog records all of it | it is deletable by nobody, including the Owner |

**The rule that falls out of the map:** an operation may not change what already
happened. Cash that moved, work that was recognised, and rates that priced
historical labour are corrected by appending a reversal, never by erasure.

---

# PART G — LIMITATIONS REGISTER

Kept deliberately separate from the capabilities above. Each item is classified,
with reasoning rather than reassurance.

## G1. PILOT BLOCKERS

### L-01 · Offline attendance capture is unwired, and the UI claims otherwise
- **What:** the outbox, sync engine, `/api/sync` endpoint and handler all exist, but nothing calls `enqueue()`, and the file that registers the entity is never imported. Attendance writes go straight to a server action.
- **What the user sees offline:** the chip reads *"Offline · saved on device"*; the toast reads *"Couldn't save — will retry"*; the number reverts. Nothing is saved and nothing retries.
- **Why this is a blocker:** attendance is the highest-frequency field activity in the product, performed on construction sites where signal is unreliable. A site engineer marking 40 mason-days in a basement will be told their data is safe when it is gone. Losing a day of attendance corrupts the week's settlement, which corrupts Credited, which corrupts the contractor's position.
- **Smallest honest fix:** either wire the outbox (import the registration and enqueue on failure) or change the two strings so the product stops promising what it does not do. **The second is a ten-minute change and should not ship without one of them.**
- **Classification: PILOT BLOCKER.**

### L-02 · Vendor payments cannot be corrected
- **What:** no reversal, no edit, no delete. Unlike contractor payments, settlements and re-scopes, the domain has no correcting entry.
- **Why this matters in a pilot:** somebody will mistype an amount or pick the wrong vendor in the first week. Today the only workaround is a compensating payment recorded separately, which leaves both the error and the correction in the ledger with nothing linking them, and permanently overstates *Paid against orders* and understates *Still owed* for that vendor.
- **Note:** the product is now honest about this — it refuses rather than pretending to delete. That makes it safe, not sufficient.
- **Classification: PILOT BLOCKER** for a company running real procurement. Constructly's own instruction deferred the implementation, which is a reasonable sequencing decision — but it should be understood as a blocker to *procurement* validation, not as a nice-to-have.

## G2. IMPORTANT LATER

### L-03 · No goods receipt / receiving lifecycle
- Ordered and Paid are tracked; **Received is not**. A company cannot tell from Constructly whether the material arrived, and cannot three-way match.
- Schema tables exist so this can ship without redesign.
- **Classification: IMPORTANT LATER** — it does not block validating what exists, but it is the largest missing piece of procurement.

### L-04 · A purchase order has no archive or cancel
- A PO with payments correctly cannot be deleted, but there is no lifecycle to retire it either. Cancelled orders stay open forever and keep counting toward Ordered value.
- **Classification: IMPORTANT LATER.**

### L-05 · Contractor advances and settlements lack structured payment mode and reference
- Vendor payments capture mode, reference number and remarks. Contractor advances and settlement cash do not to the same standard, so bank reconciliation is harder on the labour side than the supplier side.
- **Classification: IMPORTANT LATER** — it affects reconciliation quality, not correctness.

### L-06 · 21 of 97 permissions are enforced nowhere
- `bills.*` (6 keys — **no bills module exists at all**), `attendance.lock`, `attendance.unlock`, `purchase_orders.reject`, `purchase_orders.archive`, `payments.approve`, `payments.cancel`, `payments.export`, `vendors.merge`, `vendors.delete`, `vendors.view_all`, `vendors.edit_all`, `reports.schedule`, `users.edit`, `company.integrations`, `company.security`.
- **Why it matters:** an Owner configuring a custom role sees switches that promise control they do not deliver. Granting `vendors.delete` grants nothing; withholding it protects nothing. In a permission editor, a switch that does nothing is worse than an absent one — it invites false confidence about who can do what.
- **Classification: IMPORTANT LATER**, verging on blocker for the *Roles* part of validation. The cheap remedy is to hide unimplemented keys from the editor rather than remove them from the catalogue.

### L-07 · Dead code found by the audit
- `useContracts`, `useMilestones` (`features/contracts/hooks.ts`) and `useChangeMemberRole` (`features/team/hooks.ts`) are exported and referenced nowhere, including tests.
- `features/labor/sync.ts` is never imported (see L-01).
- **Classification: IMPORTANT LATER** — no user impact, but each is a trap for the next reader.

### L-08 · Vendor delete and merge do not exist
- The permission keys exist; the operations do not. **The Phase 8.5 delete policy asserted that an unused vendor "can be deleted outright", which was false.** This audit corrected the policy entry; the register now matches the code.
- **Classification: IMPORTANT LATER.**

## G3. NICE TO HAVE

### L-09 · Administration polish
Users list is not a `DataTable`; per-user project assignment cannot be edited from the user record; there are no permission dependency hints and no role diff preview before saving.
**Classification: NICE TO HAVE.**

### L-10 · Billing, subscription, API keys, integrations, security settings
Permission keys exist and are Owner-only; no UI exists. Constructly is not yet a self-serve SaaS.
**Classification: NICE TO HAVE** for a pilot with an invoiced customer; a blocker for self-serve sign-up.

### L-11 · Tier-2 rate history
Deeper rate-history work deferred in an earlier phase.
**Classification: NICE TO HAVE.**

### L-12 · No sorting engine or column resizing on tables
A deliberate decision — this is not a data grid — recorded here so it is not rediscovered as a defect.
**Classification: NICE TO HAVE.**

## G4. UNVALIDATED AT SCALE

### L-13 · Volume
All-time views over a large company's data, and file storage at real volume, have not been measured. The demo dataset is small. Row virtualisation exists on the two heaviest lists.
**Classification: IMPORTANT LATER** — and it is a genuine unknown, which is different from a known limit. **This should be measured early in the pilot rather than discovered late.**

### L-14 · Test-runner contention
`vitest` at default worker count produces rotating five-second timeouts on this machine; `--maxWorkers=4` is green at 1,804/1,804. Pin it in `vitest.config.ts` before CI inherits the flakiness.
**Classification: NICE TO HAVE** — tooling, not product.

---

# PART H — WHAT CONSTRUCTLY CAN DO TODAY

*Written for the product Owner. No implementation detail.*

## What a construction company can run inside Constructly

You can run the **money and the workforce** of a construction business.

Set up your company, invite your team, and give each person exactly the access
their job needs. Create projects with a budget, a manager and a client, and move
them through nine stages from Created to Closed.

For each project, decide which labour contractors work on it and what their
trades are paid per day. Every morning, your site engineer opens the day on a
phone and records who turned up — grouped by contractor, in half-days, with a
note where it matters. Each day is priced at the rate that applied **that day**,
so a rate change next month never quietly rewrites last month.

At the end of the week you settle: the system tells you what the labour was
worth, you decide how much of the advance you already paid to recover, and it
tells you the cash to hand over. Your contractor's position updates itself.

For contractors on commercial agreements, you can record the agreed value, break
it into milestones, set the trades and rates it covers, propose and approve
amendments when the scope changes, and see at any moment what was authorised,
what has been earned, what you have credited, and whether you owe them or have
paid them ahead.

On the buying side, keep your vendors, raise purchase orders with GST per line,
route them through approval, and record what you have paid — against an order or
on account. You can see what you ordered, what you paid, and what you still owe,
with ageing.

Everything that moved money lands in one place, **Payments**, where you can
search and filter it and click straight through to the record it came from.

Ten reports answer the questions you actually ask, and each exports to PDF,
Excel or CSV.

## What financial control you have

Every figure has one definition and one source, and the words stay distinct:
what the work was **worth**, what the contractor has **earned**, what you have
**credited**, what is **due now**, what you have **paid ahead**, and what
**advance** they are still holding. The product refuses to blur those.

Cash that moved is never counted twice — a settlement contributes only the cash
it actually paid, not the advance it recovered.

## What you cannot undo, and what you can

You can **reverse** a settlement, a contractor payment, an advance re-scope, and
a labour attribution — each keeps the original visible, records your reason, and
stops counting. You can **archive** a contractor, a vendor, a project or a
labour type, and bring it back. You can **cancel** an agreement and keep all its
history.

You cannot delete an advance, a rate that priced real work, or audit history —
by design, and that includes you as Owner. **And today you cannot correct a
vendor payment at all**, which is the one gap you should plan around.

## What you cannot do yet

- **Record that materials arrived.** You can order and you can pay; receiving does not exist.
- **Correct a vendor payment.**
- **Work offline.** Attendance needs a connection, and the app currently implies otherwise — fix that before anyone takes it to a basement.
- **Track bills or invoices**, or run billing, subscriptions or integrations.

## What is live, and what is not

**Live in production today:** the whole operational product — projects, labour,
contractors and agreements, procurement, the Payments centre, six reports, and
the settings and user screens as they were before this year's admin redesign.

**Built but not deployed:** four more reports and the reports redesign; the new
Users, Roles and Settings screens; the rule that built-in roles cannot be edited;
Indian money formatting in every amount field; and the governed delete
behaviour. Three phases of work are finished, tested, and sitting on a branch.

## What is ready for the pilot

The operational core is ready to be used by a real company **on real data**, with
two conditions: fix the offline claim on attendance, and plan around vendor
payments being uncorrectable. Everything else can be validated as it stands.

Nothing in this product has yet been used by a construction company on its own
money. That is the next step, and it is the only one that will tell you whether
this is right.

---

# PART I — E2E VALIDATION MATRIX

This register is now the master checklist. Every capability starts at
**`NOT TESTED`**. Automated tests being green is not validation.

**How to fill this in:** one row per session, with the role used, whether the
data was real production data, one line of evidence, and a defect id or "none".

| # | Capability | Test roles | Prod data | E2E status | Evidence | Defect |
|---|---|---|---|---|---|---|
| 1 | Sign in (password) | all | — | NOT TESTED | | |
| 2 | Sign in (Google) | Owner | — | NOT TESTED | | |
| 3 | Sign up + company creation | Owner | — | NOT TESTED | | |
| 4 | Password reset | any | — | NOT TESTED | | |
| 5 | Invite → accept → first login | Owner, invitee | — | NOT TESTED | | |
| 6 | Disable / re-enable a member | Owner, Admin | — | NOT TESTED | | |
| 7 | Remove a member (+ last-Owner guard) | Owner | — | NOT TESTED | | |
| 8 | Dashboard KPIs vs reality | Owner, PM | — | NOT TESTED | | |
| 9 | Attention centre items are actionable | Owner, PM | — | NOT TESTED | | |
| 10 | Create a project | Owner, Admin, PM | — | NOT TESTED | | |
| 11 | Edit budget / client / details / location | Owner, PM | — | NOT TESTED | | |
| 12 | Stage progression | PM | — | NOT TESTED | | |
| 13 | Assign contractors + rates | Owner, PM | — | NOT TESTED | | |
| 14 | Contractor removal blockers | Owner | — | NOT TESTED | | |
| 15 | Deadlines / notes / documents | PM | — | NOT TESTED | | |
| 16 | Project archive / delete / restore | Owner | — | NOT TESTED | | |
| 17 | Daily attendance entry | Site Engineer, Supervisor | — | NOT TESTED | | |
| 18 | Rate snapshot correctness across a rate change | PM, Accountant | — | NOT TESTED | | |
| 19 | Copy previous day | Site Engineer | — | NOT TESTED | | |
| 20 | **Attendance offline** | Site Engineer | — | **BLOCKED (L-01)** | | L-01 |
| 21 | Labour categories / types + Force Delete | Owner | — | NOT TESTED | | |
| 22 | Labour summary accuracy | Accountant | — | NOT TESTED | | |
| 23 | Create contractor + opening advance | Owner, Admin | — | NOT TESTED | | |
| 24 | Record advance (3 scopes) | Owner, Accountant | — | NOT TESTED | | |
| 25 | Advance re-scope | Owner | — | NOT TESTED | | |
| 26 | Reverse a re-scope (+ consumed blocker) | Owner | — | NOT TESTED | | |
| 27 | Weekly settlement | Owner, Accountant | — | NOT TESTED | | |
| 28 | Reverse a settlement + re-settle | Owner | — | NOT TESTED | | |
| 29 | Create agreement | Owner, PM | — | NOT TESTED | | |
| 30 | Scope & labour + removal blocker | PM | — | NOT TESTED | | |
| 31 | Rate revision (effective-dated) | Owner, PM | — | NOT TESTED | | |
| 32 | Milestones incl. bulk | PM | — | NOT TESTED | | |
| 33 | Amendment propose / approve / reject | Owner, PM | — | NOT TESTED | | |
| 34 | Agreement payment + reversal | Owner, Accountant | — | NOT TESTED | | |
| 35 | Settled-labour attribution + reversal | Owner | — | NOT TESTED | | |
| 36 | Reconciliation: Due / Ahead correctness | Owner, Accountant | — | NOT TESTED | | |
| 37 | Advance ledger incl. partial-ledger scoping | PM, Accountant | — | NOT TESTED | | |
| 38 | Contractor archive + Owner Delete governance | Owner | — | NOT TESTED | | |
| 39 | Vendor create / edit / archive | Purchase Manager | — | NOT TESTED | | |
| 40 | PO create → submit → approve | Purchase Manager, Owner | — | NOT TESTED | | |
| 41 | GST per line, rounding, grand total | Accountant | — | NOT TESTED | | |
| 42 | PO revise / duplicate | Purchase Manager | — | NOT TESTED | | |
| 43 | PO delete + `PO_HAS_PAYMENTS` blocker | Owner | — | NOT TESTED | | |
| 44 | Vendor payment (PO-linked and on account) | Accountant | — | NOT TESTED | | |
| 45 | **Vendor payment correction** | Accountant | — | **BLOCKED (L-02)** | | L-02 |
| 46 | Still owed + ageing accuracy | Accountant | — | NOT TESTED | | |
| 47 | Payments Centre: all four types present | Owner, Accountant | — | NOT TESTED | | |
| 48 | Settlement counted at net only (no double count) | Accountant | — | NOT TESTED | | |
| 49 | Re-scope absent from Payments | Accountant | — | NOT TESTED | | |
| 50 | Payments filters + source links | Owner | — | NOT TESTED | | |
| 51–60 | Each of the 10 reports vs source records | Owner, Accountant, PM | — | NOT TESTED | | |
| 61 | PDF export (branding correct) | Owner | — | NOT TESTED | | |
| 62 | Excel export | Accountant | — | NOT TESTED | | |
| 63 | CSV export | Accountant | — | NOT TESTED | | |
| 64 | Financial vs operational report gating | PM, Supervisor | — | NOT TESTED | | |
| 65 | Built-in role read-only | Owner, Admin | — | NOT TESTED | | |
| 66 | Duplicate to customise → assign | Owner | — | NOT TESTED | | |
| 67 | Custom role survives reconciliation | Owner | — | NOT TESTED | | |
| 68 | Project-scope enforcement (PM sees only theirs) | PM | — | NOT TESTED | | |
| 69 | `_all` grants widen scope as documented | Owner | — | NOT TESTED | | |
| 70 | Payments visibility does not cascade | Accountant, PM | — | NOT TESTED | | |
| 71 | Company profile / branding / documents | Owner | — | NOT TESTED | | |
| 72 | Branded PDF reflects company appearance | Owner | — | NOT TESTED | | |
| 73 | Workspace settings (PO approval toggle) | Owner | — | NOT TESTED | | |
| 74 | Audit trails populated and immutable | Owner | — | NOT TESTED | | |
| 75 | Mobile web at 375 px on a real phone | Site Engineer | — | NOT TESTED | | |
| 76 | Dark mode across modules | any | — | NOT TESTED | | |
| 77 | Indian money input in every form | all | — | NOT TESTED | | |
| 78 | Volume behaviour on real data | Owner | — | NOT TESTED | | |

**Baseline: 78 checklist items across 69 rows (rows 51–60 cover the ten reports) — 76 `NOT TESTED`, 2 `BLOCKED`, 0 `PASS`, 0 `FAIL`, 0 `PARTIAL`.**

Test roles to exercise: **Owner · Admin · Project Manager · Accountant ·
Purchase Manager · Site Engineer · Supervisor · one Custom Role.**

---

# PART J — COUNTS

Counted from the entries in this document, not rounded to look tidy.

| What | Count |
|---|---|
| **Major modules** | **15** (Auth, Dashboard, Projects, Labour & Attendance, Contractors & Agreements, Procurement & Vendors, Payments Centre, Reports, Users, Roles/RBAC, Company Settings, Demo mode, Accessibility, Responsive, Audit) |
| Application routes | 16 app + 6 auth + 4 API/callback = **26** |
| **End-to-end workflows** | **18** |
| **Major capabilities** (Part A) | **79** — 50 numbered records + 10 reports + 8 user/invitation capabilities + 7 wired settings sections + 4 module-level (demo, accessibility, responsive, audit) |
| **Minor capabilities / actions** (Part B) | **72** |
| **Financial capabilities** (create or move a tracked money figure) | **21** |
| **Governed destructive / correction capabilities** | **20 entities** in the matrix; **7 reversal or correction operations** (settlement, agreement payment, re-scope, attribution, plus archive/restore on contractor, vendor, project) |
| **Reports** | **10** (4 financial, 6 operational, 3 flagship) |
| **Export formats** | **3** (PDF, Excel, CSV) |
| **RBAC permissions** | **97** across 13 modules; **26 HIGH IMPACT**; **21 unenforced** |
| **Built-in roles** | **7** (Owner 97 implicit, Admin 94, PM 28, Accountant 15, Purchase Manager 8, Site Engineer 5, Supervisor 4) |
| **Currently deferred / limited capabilities** | **14** (L-01 … L-14): 2 pilot blockers, 6 important later, 4 nice to have, 2 tooling/unknown |
| Demo repositories | 10 of 15 modules |
| Automated tests behind this (not validation) | 1,804 unit · 209 browser · 59 a11y scans |

---

## Document maintenance

This file is only useful while it is true. When a capability changes:

1. Update its record in Part A or B.
2. Update the status columns — code, demo, deployed, verified, E2E — **separately**.
3. If it moves money, update Part E and confirm the "does not change" line still holds.
4. If it creates or removes a dependency, update Part F.
5. If it closes a limitation, move the item out of Part G rather than editing it in place.
6. Re-count Part J.

**A capability that is not in this document does not exist as far as validation is concerned.**
