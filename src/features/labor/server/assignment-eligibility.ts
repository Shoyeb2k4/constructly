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

/**
 * Resolve the effective day rate to SNAPSHOT for a NEW attendance row:
 *   project+contractor+subcategory rate → subcategory global rate → null.
 * Returns the paise and provenance id (null when falling back to the global
 * rate). Callers snapshot this at first record and never recompute it later
 * (ADR-0022). For an edit, keep the existing snapshot instead of calling this.
 */
export async function resolveAttendanceRate(
  companyId: string,
  projectId: string,
  contractorId: string | null,
  labourSubcategoryId: string,
): Promise<ResolvedRate> {
  if (contractorId != null) {
    const pcr = await findProjectContractorRate(companyId, projectId, contractorId, labourSubcategoryId);
    if (pcr) return { ratePaise: pcr.ratePaise, projectContractorLabourRateId: pcr.id };
  }
  // Fallback: the subcategory's global default rate (legacy/unattributed rows).
  const sub = await prisma.labourSubcategory.findFirst({
    where: { id: labourSubcategoryId, companyId },
    select: { dailyRatePaise: true },
  });
  return { ratePaise: sub?.dailyRatePaise ?? null, projectContractorLabourRateId: null };
}
