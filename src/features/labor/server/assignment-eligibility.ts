import { prisma } from "@/lib/db/prisma";

/**
 * Server-side eligibility + rate resolution for contractor-first labour
 * attendance.
 *
 * Contractor-first model: a contractor supplies specific labour SUBCATEGORIES on
 * a project, each with a project-specific rate — stored as
 * ProjectContractorLabourRate rows hanging off ProjectContractor. A contractor
 * may be attributed to a (project, subcategory) attendance row ONLY when such a
 * rate row exists. This is SUBCATEGORY-EXACT (stronger than the old category
 * check) and lets two contractors supply the same subcategory on one project
 * (Pappu-Centering + Saddam-Centering) at different rates.
 *
 * Above that sits the AGREEMENT: a contractor's commercial work package on the
 * project, whose scope names the labour types it covers and whose rates are
 * effective-dated. When a contractor holds agreements, attendance attaches to
 * one of them and takes its rate as at the attendance date; when they hold none,
 * the tier-2 path below is the whole story and behaves exactly as before.
 *
 * Lives outside the "use server" action module so it can be shared by both the
 * interactive server action and the offline /api/sync handler without being
 * exposed as a server action itself. `contractorId = null` (legacy/unattributed)
 * is handled by callers and never asserts eligibility.
 */

/** The rate to snapshot onto an attendance row, plus its provenance. */
export type ResolvedRate = {
  /** Effective day rate in paise, or null when none resolves. */
  ratePaise: number | null;
  /** The ProjectContractorLabourRate this came from; null when it fell back to
   *  the subcategory's global rate (or no rate at all). */
  projectContractorLabourRateId: string | null;
  /** TIER 1 provenance: the agreement rate revision in force on the row's date. */
  contractScopeRateRevisionId: string | null;
};

/** An agreement a contractor may record attendance against on a project. */
export type EligibleAgreement = {
  contractId: string;
  title: string;
  reference: string | null;
  status: string;
};

/**
 * The project-contractor-subcategory labour rate (company-scoped), or null when
 * the contractor doesn't supply that subcategory on that project. Resolved via
 * the ProjectContractor join so a cross-company / cross-project id can never
 * match.
 */
export async function findProjectContractorRate(
  companyId: string,
  projectId: string,
  contractorId: string,
  labourSubcategoryId: string,
): Promise<{ id: string; ratePaise: number } | null> {
  const row = await prisma.projectContractorLabourRate.findFirst({
    where: {
      companyId,
      labourSubcategoryId,
      projectContractor: { is: { companyId, projectId, contractorId } },
    },
    select: { id: true, ratePaise: true },
  });
  return row ?? null;
}

/**
 * True iff the contractor supplies this subcategory on this project (a
 * ProjectContractorLabourRate exists). The contractor-first replacement for the
 * old category-level assignment check. The category is never trusted from the
 * client; identity is (project, contractor, subcategory).
 */
export async function isAttributionEligible(
  companyId: string,
  projectId: string,
  contractorId: string,
  labourSubcategoryId: string,
): Promise<boolean> {
  return (
    (await findProjectContractorRate(companyId, projectId, contractorId, labourSubcategoryId)) !== null
  );
}

/* ── Agreements ─────────────────────────────────────────────────────────── */

/**
 * Agreement lifecycle states that can still take attendance.
 *
 * CANCELLED is out for the obvious reason. SETTLED is out because it is an
 * administrative close-out that was only permitted while nothing was due —
 * adding labour afterwards would silently reopen a balance on an agreement
 * somebody signed off as finished. Both remain fully readable; they just stop
 * accepting new work.
 */
const OPEN_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "ON_HOLD", "COMPLETED"] as const;

/**
 * The agreements this contractor holds on this project that can take attendance
 * today, oldest first.
 *
 * An agreement with no scope items is excluded: it defines no labour types, so
 * there is nothing to record against it and offering it would be a dead end.
 *
 * The count is what drives selection (0 → attendance-only, 1 → auto-select,
 * ≥2 → the user must choose). It is never collapsed to a "best guess".
 */
export async function eligibleAgreements(
  companyId: string,
  projectId: string,
  contractorId: string,
): Promise<EligibleAgreement[]> {
  const rows = await prisma.contractorContract.findMany({
    where: {
      companyId,
      projectId,
      contractorId,
      deletedAt: null,
      status: { in: [...OPEN_STATUSES] },
      scopeItems: { some: { deletedAt: null } },
    },
    select: { id: true, title: true, reference: true, status: true },
    orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    contractId: r.id,
    title: r.title,
    reference: r.reference,
    status: r.status,
  }));
}

/**
 * True iff this agreement belongs to this contractor on this project AND its
 * scope covers this labour type.
 *
 * Both halves matter. The first stops one contractor's labour being billed to
 * another's agreement; the second stops labour being attributed to an agreement
 * that never priced it — which would leave the row with no rate history to
 * resolve against.
 */
export async function isAgreementAttributionEligible(
  companyId: string,
  projectId: string,
  contractorId: string,
  contractId: string,
  labourSubcategoryId: string,
): Promise<boolean> {
  const item = await prisma.contractScopeItem.findFirst({
    where: {
      companyId,
      contractId,
      labourSubcategoryId,
      deletedAt: null,
      contract: {
        is: {
          companyId,
          projectId,
          contractorId,
          deletedAt: null,
          status: { in: [...OPEN_STATUSES] },
        },
      },
    },
    select: { id: true },
  });
  return item !== null;
}

/**
 * The agreement rate in force on `date` — the ATTENDANCE ROW'S own date, never
 * today's.
 *
 * Rates get renegotiated mid-project, and revisions are append-only precisely so
 * that a rise agreed in April cannot retro-price March's labour. Resolving from
 * `new Date()` would do exactly that, silently, on every back-dated entry.
 *
 * Returns null when the agreement doesn't cover the labour type, or when every
 * revision starts after `date` (labour recorded before any agreed rate) — the
 * caller then falls through to the lower tiers.
 */
export async function resolveAgreementRateOn(
  companyId: string,
  contractId: string,
  labourSubcategoryId: string,
  date: string,
): Promise<{ ratePaise: number; contractScopeRateRevisionId: string } | null> {
  const item = await prisma.contractScopeItem.findFirst({
    where: { companyId, contractId, labourSubcategoryId, deletedAt: null },
    select: { id: true },
  });
  if (!item) return null;

  const revisions = await prisma.contractScopeRateRevision.findMany({
    where: { companyId, scopeItemId: item.id, effectiveFrom: { lte: new Date(date) } },
    select: { id: true, ratePaise: true },
    // Latest effective date wins; a same-day correction is the one created last.
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    take: 1,
  });
  const r = revisions[0];
  return r ? { ratePaise: r.ratePaise, contractScopeRateRevisionId: r.id } : null;
}

/**
 * Resolve the effective day rate to SNAPSHOT for a NEW attendance row, in tier
 * order:
 *
 *   1. the AGREEMENT's scope rate in force on the row's own date;
 *   2. the project+contractor+subcategory rate;
 *   3. the subcategory's global default;
 *   4. null.
 *
 * Returns the paise plus whichever provenance applies, so a historical row can
 * always be traced back to the exact agreed rate it was valued at. Callers
 * snapshot this at first record and never recompute it later (ADR-0022) — on an
 * edit, keep the existing snapshot instead of calling this.
 */
export async function resolveAttendanceRate(
  companyId: string,
  projectId: string,
  contractorId: string | null,
  labourSubcategoryId: string,
  contractId: string | null = null,
  /** The attendance row's date (YYYY-MM-DD). Required for tier 1. */
  date?: string,
): Promise<ResolvedRate> {
  if (contractId != null && date) {
    const agreed = await resolveAgreementRateOn(companyId, contractId, labourSubcategoryId, date);
    if (agreed) {
      return {
        ratePaise: agreed.ratePaise,
        projectContractorLabourRateId: null,
        contractScopeRateRevisionId: agreed.contractScopeRateRevisionId,
      };
    }
  }
  if (contractorId != null) {
    const pcr = await findProjectContractorRate(companyId, projectId, contractorId, labourSubcategoryId);
    if (pcr) {
      return {
        ratePaise: pcr.ratePaise,
        projectContractorLabourRateId: pcr.id,
        contractScopeRateRevisionId: null,
      };
    }
  }
  // Fallback: the subcategory's global default rate (legacy/unattributed rows).
  const sub = await prisma.labourSubcategory.findFirst({
    where: { id: labourSubcategoryId, companyId },
    select: { dailyRatePaise: true },
  });
  return {
    ratePaise: sub?.dailyRatePaise ?? null,
    projectContractorLabourRateId: null,
    contractScopeRateRevisionId: null,
  };
}
