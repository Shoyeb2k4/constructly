import { prisma } from "@/lib/db/prisma";

/**
 * Server-side eligibility for contractor↔project↔category attribution.
 *
 * The client submits `labourSubcategoryId` (and, on the sync path, a
 * `contractorId`) — it does NOT get to assert the labour category. We resolve
 * the category server-side from the subcategory and require an exact
 * ProjectContractorAssignment for (company, project, contractor, category). This
 * closes the gap where a manipulated request could attribute a contractor to a
 * category they aren't assigned to (e.g. Civil-only "Pappu" against "Tiles").
 *
 * Lives outside the "use server" action module so it can be shared by both the
 * interactive server action and the offline /api/sync handler without being
 * exposed as a server action itself. `contractorId = null` is always allowed by
 * callers and never reaches these functions.
 */

/** Resolve the labour category a subcategory belongs to (company-scoped).
 *  Returns null when the subcategory is unknown in this company. */
export async function categoryOfSubcategory(
  companyId: string,
  labourSubcategoryId: string,
): Promise<string | null> {
  const sub = await prisma.labourSubcategory.findFirst({
    where: { id: labourSubcategoryId, companyId },
    select: { categoryId: true },
  });
  return sub?.categoryId ?? null;
}

/** True iff the contractor is assigned to this project for this exact category. */
export async function isContractorAssignedToCategory(
  companyId: string,
  projectId: string,
  contractorId: string,
  labourCategoryId: string,
): Promise<boolean> {
  const found = await prisma.projectContractorAssignment.findFirst({
    where: { companyId, projectId, contractorId, labourCategoryId },
    select: { id: true },
  });
  return found !== null;
}

/**
 * Full attribution check for an attendance write. The category is resolved
 * from `labourSubcategoryId` server-side (never trusted from the client); the
 * contractor must be assigned to the project FOR THAT CATEGORY. Returns false
 * if the subcategory is unknown or the exact pairing isn't assigned.
 */
export async function isAttributionEligible(
  companyId: string,
  projectId: string,
  contractorId: string,
  labourSubcategoryId: string,
): Promise<boolean> {
  const labourCategoryId = await categoryOfSubcategory(companyId, labourSubcategoryId);
  if (labourCategoryId === null) return false;
  return isContractorAssignedToCategory(companyId, projectId, contractorId, labourCategoryId);
}
