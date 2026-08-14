"use server";

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { verifyPassword } from "@/lib/auth/verify-password";
import type { SessionUser } from "@/lib/auth/types";
import { STAGE_LABEL } from "../constants";
import { deadlineBounds, todayISO } from "../deadline";
import type {
  ProjectContractorInput,
  CreateProjectInput,
  ProjectContractorItem,
  ProjectDetail,
  ProjectFilters,
  ProjectListItem,
  ProjectStage,
  UpdateProjectInput,
  Manager,
} from "../types";
import { Prisma } from "@/generated/prisma";
import { spendByProject, projectSpend } from "@/features/budget/server-actions";
import { purgeEligibleAt, isValidRetention } from "../retention";
import { updateProjectInputSchema, projectContractorsSchema } from "../schema";
import type { DuplicateCodeResult } from "../repository";

/**
 * Server-side projects API. Authorization is RBAC-first: every action requires a
 * permission (requirePermission) BEFORE any work, and mutations additionally
 * enforce ownership/assignment scope so `projects.edit` alone never lets a user
 * touch a project they aren't assigned to (permission ≠ ownership). Company
 * isolation is always enforced via companyId; never trusts a client companyId.
 */

/** Server-side input validation for project creation (never trust the client). */
const createProjectInputSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(120),
  budgetPaise: z.number().int().min(0),
  contractValuePaise: z.number().int().min(0),
  procurementBudgetPaise: z.number().int().min(0).nullable().optional(),
});

/**
 * Require an action permission AND the ownership/assignment scope for a LIVE
 * project. The broad `projects.edit_all` grant unlocks any project in the
 * company; otherwise the caller must be the assigned PM. Preserves the legacy
 * "owner-or-assigned" rule while separating permission (what) from ownership
 * (which). Company-scoped throughout.
 */
async function requireProjectWrite(
  permission: "projects.edit" | "projects.archive" | "projects.assign",
  projectId: string,
): Promise<SessionUser> {
  const user = await requirePermission(permission);
  const p = await prisma.project.findFirst({
    where: { id: projectId, companyId: user.company.id, deletedAt: null },
    select: { pmId: true },
  });
  if (!p) throw new Error("NOT_FOUND");
  if (!hasPermission(user, "projects.edit_all") && p.pmId !== user.id) {
    throw new Error("FORBIDDEN");
  }
  return user;
}

async function logActivity(
  user: SessionUser,
  entityId: string,
  action: string,
  summary: string,
) {
  await prisma.activityLog.create({
    data: {
      companyId: user.company.id,
      actorId: user.id,
      action,
      entityType: "project",
      entityId,
      summary,
    },
  });
}

/* ── Contractor-first labour config (project → contractors → labour rates) ─ */

const projectContractorInclude = {
  contractor: { select: { name: true } },
  labourRates: {
    include: {
      subcategory: {
        select: { name: true, categoryId: true, displayOrder: true, category: { select: { name: true } } },
      },
    },
    orderBy: { subcategory: { displayOrder: "asc" } },
  },
} satisfies Prisma.ProjectContractorInclude;

type ProjectContractorRow = Prisma.ProjectContractorGetPayload<{
  include: typeof projectContractorInclude;
}>;

function toProjectContractorItem(pc: ProjectContractorRow): ProjectContractorItem {
  return {
    id: pc.id,
    contractorId: pc.contractorId,
    contractorName: pc.contractor.name,
    contractRatePaise: pc.contractRatePaise,
    contractRateUnit: pc.contractRateUnit,
    labourRates: pc.labourRates.map((r) => ({
      id: r.id,
      labourSubcategoryId: r.labourSubcategoryId,
      subcategoryName: r.subcategory.name,
      categoryId: r.subcategory.categoryId,
      categoryName: r.subcategory.category.name,
      ratePaise: r.ratePaise,
      rateUnit: r.rateUnit,
    })),
  };
}

const projectContractorOrderBy = { contractor: { name: "asc" } } satisfies Prisma.ProjectContractorOrderByWithRelationInput;

/**
 * Validate + normalize a contractor-config set for a company: dedupes
 * contractors (first wins) and, within each, dedupes labour types by
 * subcategory; then confirms every contractor and labour subcategory belongs to
 * the caller's company (cross-company ids are rejected — the UI filters, but the
 * server never trusts it). Returns the deduped rows.
 */
async function validateProjectContractors(
  companyId: string,
  rows: ProjectContractorInput[],
): Promise<ProjectContractorInput[]> {
  const seenContractor = new Set<string>();
  const deduped = rows
    .filter((r) => {
      if (seenContractor.has(r.contractorId)) return false;
      seenContractor.add(r.contractorId);
      return true;
    })
    .map((r) => {
      const seenSub = new Set<string>();
      return {
        ...r,
        labourRates: r.labourRates.filter((lr) => {
          if (seenSub.has(lr.labourSubcategoryId)) return false;
          seenSub.add(lr.labourSubcategoryId);
          return true;
        }),
      };
    });
  if (deduped.length === 0) return deduped;

  const contractorIds = [...new Set(deduped.map((r) => r.contractorId))];
  const subIds = [...new Set(deduped.flatMap((r) => r.labourRates.map((lr) => lr.labourSubcategoryId)))];
  const [contractorCount, subCount] = await Promise.all([
    prisma.contractor.count({ where: { id: { in: contractorIds }, companyId } }),
    subIds.length > 0
      ? prisma.labourSubcategory.count({ where: { id: { in: subIds }, companyId } })
      : Promise.resolve(0),
  ]);
  if (contractorCount !== contractorIds.length || subCount !== subIds.length) {
    throw new Error("INVALID_ASSIGNMENT");
  }
  return deduped;
}

/**
 * Reconcile a project's contractor config to a normalized target set, IN PLACE.
 *
 * This is a diff, never a delete-and-recreate. Attendance rows carry a
 * `projectContractorLabourRateId` provenance FK with `ON DELETE SET NULL`, so
 * recreating rate rows on every save silently nulled the provenance of all
 * historical attendance — the money snapshot survived, the audit trail did not.
 * Unchanged mappings therefore MUST keep their row ids.
 *
 * A contractor dropped from the config is removed only when it has no attendance
 * on this project; otherwise those rows would lose the assignment that explains
 * their attribution. Individual labour-type mappings may still be removed — the
 * attendance sheet already surfaces de-configured pairs as read-only orphan rows.
 */
async function syncProjectContractors(
  tx: Prisma.TransactionClient,
  companyId: string,
  projectId: string,
  rows: ProjectContractorInput[],
): Promise<void> {
  const existing = await tx.projectContractor.findMany({
    where: { companyId, projectId },
    select: {
      id: true,
      contractorId: true,
      contractRatePaise: true,
      contractRateUnit: true,
      labourRates: {
        select: { id: true, labourSubcategoryId: true, ratePaise: true, rateUnit: true },
      },
    },
  });
  const previous = new Map(existing.map((pc) => [pc.contractorId, pc]));
  const desired = new Set(rows.map((r) => r.contractorId));

  const dropped = existing.filter((pc) => !desired.has(pc.contractorId));
  if (dropped.length > 0) {
    const attributed = await tx.labourAttendance.findFirst({
      where: { companyId, projectId, contractorId: { in: dropped.map((pc) => pc.contractorId) } },
      select: { id: true },
    });
    if (attributed) throw new Error("CONTRACTOR_HAS_ATTENDANCE");
    await tx.projectContractor.deleteMany({ where: { id: { in: dropped.map((pc) => pc.id) } } });
  }

  for (const r of rows) {
    const prev = previous.get(r.contractorId);
    const contractRatePaise = r.contractRatePaise ?? null;
    const contractRateUnit = r.contractRateUnit ?? null;

    let projectContractorId: string;
    if (prev) {
      projectContractorId = prev.id;
      if (prev.contractRatePaise !== contractRatePaise || prev.contractRateUnit !== contractRateUnit) {
        await tx.projectContractor.update({
          where: { id: prev.id },
          data: { contractRatePaise, contractRateUnit },
        });
      }
    } else {
      const created = await tx.projectContractor.create({
        data: { companyId, projectId, contractorId: r.contractorId, contractRatePaise, contractRateUnit },
        select: { id: true },
      });
      projectContractorId = created.id;
    }

    const prevRates = new Map((prev?.labourRates ?? []).map((lr) => [lr.labourSubcategoryId, lr]));
    const desiredSubs = new Set(r.labourRates.map((lr) => lr.labourSubcategoryId));

    const staleIds = [...prevRates.values()]
      .filter((lr) => !desiredSubs.has(lr.labourSubcategoryId))
      .map((lr) => lr.id);
    if (staleIds.length > 0) {
      await tx.projectContractorLabourRate.deleteMany({ where: { id: { in: staleIds } } });
    }

    const added: Prisma.ProjectContractorLabourRateCreateManyInput[] = [];
    for (const lr of r.labourRates) {
      const rateUnit = lr.rateUnit ?? "day";
      const prevRate = prevRates.get(lr.labourSubcategoryId);
      if (!prevRate) {
        added.push({
          companyId,
          projectContractorId,
          labourSubcategoryId: lr.labourSubcategoryId,
          ratePaise: lr.ratePaise,
          rateUnit,
        });
      } else if (prevRate.ratePaise !== lr.ratePaise || prevRate.rateUnit !== rateUnit) {
        // Rate revised in place — the row id (and every attendance FK pointing
        // at it) survives.
        await tx.projectContractorLabourRate.update({
          where: { id: prevRate.id },
          data: { ratePaise: lr.ratePaise, rateUnit },
        });
      }
    }
    if (added.length > 0) {
      await tx.projectContractorLabourRate.createMany({ data: added });
    }
  }
}


const listSelect = {
  id: true,
  code: true,
  name: true,
  type: true,
  stage: true,
  budgetPaise: true,
  contractValuePaise: true,
  procurementBudgetPaise: true,
  startDate: true,
  expectedCompletionDate: true,
  tags: true,
  archivedAt: true,
  deletedAt: true,
  deletedReason: true,
  updatedAt: true,
  pm: { select: { id: true, fullName: true } },
  deletedBy: { select: { fullName: true } },
  favorites: { select: { userId: true } },
} satisfies Prisma.ProjectSelect;

type ListRow = Prisma.ProjectGetPayload<{ select: typeof listSelect }>;

function toItem(row: ListRow, userId: string): ProjectListItem {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    stage: row.stage,
    budgetPaise: Number(row.budgetPaise),
    contractValuePaise: Number(row.contractValuePaise),
    procurementBudgetPaise: row.procurementBudgetPaise == null ? null : Number(row.procurementBudgetPaise),
    usedPaise: 0, // derived in Modules 2–3
    startDate: row.startDate ? row.startDate.toISOString().slice(0, 10) : null,
    expectedCompletionDate: row.expectedCompletionDate
      ? row.expectedCompletionDate.toISOString().slice(0, 10)
      : null,
    pm: row.pm ? { id: row.pm.id, fullName: row.pm.fullName } : null,
    tags: row.tags,
    isFavorite: row.favorites.some((f) => f.userId === userId),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    deletedReason: row.deletedReason ?? null,
    deletedByName: row.deletedBy?.fullName ?? null,
    purgeEligibleAt: null, // populated by the deleted-view list (retention policy)
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listProjects(
  filters: ProjectFilters = {},
): Promise<ProjectListItem[]> {
  const user = await requirePermission("projects.view");
  const today = todayISO();
  const dl = deadlineBounds(filters.deadline ?? "ALL", today);
  // Scope: only holders of projects.view_all see the whole company; everyone
  // else is limited to their assigned projects (ownership, not just permission).
  const canViewAll = hasPermission(user, "projects.view_all");
  // The recycle bin is delete-authority only; it never leaks to viewers who
  // can't delete (preserves the previous Owner-only behaviour).
  const showDeleted = hasPermission(user, "projects.delete") && !!filters.includeDeleted;
  const where: Prisma.ProjectWhereInput = {
    companyId: user.company.id,
    ...(showDeleted
      ? { deletedAt: { not: null } }
      : { deletedAt: null, ...(filters.includeArchived ? {} : { archivedAt: null }) }),
    ...(canViewAll ? {} : { pmId: user.id }),
    // Overdue excludes closed projects (unless an explicit stage filter is set).
    ...(filters.stage && filters.stage !== "ALL"
      ? { stage: filters.stage }
      : dl?.excludeClosed
        ? { stage: { not: "CLOSED" } }
        : {}),
    ...(filters.type && filters.type !== "ALL" ? { type: filters.type } : {}),
    ...(filters.pmId && filters.pmId !== "ALL" ? { pmId: filters.pmId } : {}),
    ...(filters.tag && filters.tag !== "ALL" ? { tags: { has: filters.tag } } : {}),
    ...(filters.favoritesOnly ? { favorites: { some: { userId: user.id } } } : {}),
    ...(dl
      ? {
          expectedCompletionDate: {
            ...(dl.lt ? { lt: new Date(dl.lt) } : {}),
            ...(dl.gte ? { gte: new Date(dl.gte) } : {}),
            ...(dl.lte ? { lte: new Date(dl.lte) } : {}),
          },
        }
      : {}),
    ...(filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: "insensitive" } },
            { code: { contains: filters.search, mode: "insensitive" } },
            { tags: { has: filters.search } },
          ],
        }
      : {}),
  };
  const rows = await prisma.project.findMany({
    where,
    select: listSelect,
    orderBy:
      filters.sort === "DEADLINE"
        ? [{ expectedCompletionDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }]
        : { updatedAt: "desc" },
  });
  const spend = await spendByProject();
  // In the recycle-bin view, annotate each row with its retention eligibility.
  const retentionDays = showDeleted ? await getRetentionDays(user.company.id) : null;
  return rows.map((r) => {
    const item = toItem(r, user.id);
    const s = spend[r.id];
    item.usedPaise = s ? s.laborPaise + s.procurementPaise : 0;
    if (showDeleted) {
      item.purgeEligibleAt = purgeEligibleAt(r.deletedAt, retentionDays)?.toISOString() ?? null;
    }
    return item;
  });
}

async function getRetentionDays(companyId: string): Promise<number | null> {
  const c = await prisma.company.findUnique({
    where: { id: companyId },
    select: { projectRetentionDays: true },
  });
  return c?.projectRetentionDays ?? null;
}

/** Retention policy read — gated by delete authority (who can see the recycle
 *  bin). Days, or null = keep indefinitely. */
export async function getProjectRetention(): Promise<number | null> {
  const user = await requirePermission("projects.delete");
  return getRetentionDays(user.company.id);
}

/** Set the retention policy (delete authority). Accepts null (indefinite) or one
 *  of the fixed day choices. This only governs when a deleted project becomes
 *  ELIGIBLE for an admin-reviewed permanent cleanup — it never hard-deletes. */
export async function setProjectRetention(days: number | null): Promise<number | null> {
  const user = await requirePermission("projects.delete");
  if (!isValidRetention(days)) throw new Error("INVALID_RETENTION");
  await prisma.company.update({
    where: { id: user.company.id },
    data: { projectRetentionDays: days },
  });
  await prisma.activityLog.create({
    data: {
      companyId: user.company.id,
      actorId: user.id,
      action: "company.retention_changed",
      entityType: "company",
      entityId: user.company.id,
      summary:
        days == null
          ? "set project retention to keep indefinitely"
          : `set project retention to ${days} days`,
      meta: { projectRetentionDays: days },
    },
  });
  return days;
}

export async function getProject(id: string): Promise<ProjectDetail | null> {
  const user = await requirePermission("projects.view");
  const p = await prisma.project.findFirst({
    where: {
      id,
      companyId: user.company.id,
      deletedAt: null,
      ...(hasPermission(user, "projects.view_all") ? {} : { pmId: user.id }),
    },
    include: {
      pm: { select: { id: true, fullName: true } },
      deletedBy: { select: { fullName: true } },
      favorites: { select: { userId: true } },
      deadlines: { orderBy: { dueDate: "asc" } },
      documents: {
        orderBy: { createdAt: "desc" },
        include: { project: false },
      },
      notes: { orderBy: { createdAt: "desc" } },
      projectContractors: {
        include: projectContractorInclude,
        orderBy: projectContractorOrderBy,
      },
    },
  });
  if (!p) return null;

  const activity = await prisma.activityLog.findMany({
    where: { companyId: user.company.id, entityType: "project", entityId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { actor: { select: { fullName: true } } },
  });

  const spend = await projectSpend(id);
  return {
    ...toItem({ ...p, favorites: p.favorites }, user.id),
    usedPaise: spend.laborPaise + spend.procurementPaise,
    clientName: p.clientName,
    clientContact: p.clientContact,
    clientPhone: p.clientPhone,
    clientEmail: p.clientEmail,
    siteAddress: p.siteAddress,
    gpsLat: p.gpsLat,
    gpsLng: p.gpsLng,
    createdAt: p.createdAt.toISOString(),
    deadlines: p.deadlines.map((d) => ({
      id: d.id,
      title: d.title,
      dueDate: d.dueDate.toISOString().slice(0, 10),
      completedAt: d.completedAt ? d.completedAt.toISOString() : null,
    })),
    documents: p.documents.map((d) => ({
      id: d.id,
      category: d.category,
      filename: d.filename,
      sizeBytes: d.sizeBytes,
      mimeType: d.mimeType,
      createdAt: d.createdAt.toISOString(),
    })),
    notes: p.notes.map((n) => ({
      id: n.id,
      body: n.body,
      authorName: "",
      createdAt: n.createdAt.toISOString(),
      clientUuid: n.clientUuid,
    })),
    activity: activity.map((a) => ({
      id: a.id,
      action: a.action,
      summary: a.summary,
      actorName: a.actor?.fullName,
      createdAt: a.createdAt.toISOString(),
    })),
    contractors: p.projectContractors.map(toProjectContractorItem),
  };
}

/**
 * Next auto project code (`PRJ-####`) for a company. Takes the numeric MAX over
 * ONLY `PRJ-####`-pattern codes, so custom/legacy codes ("6565", "QA-LAB-1") are
 * ignored and can never reset the counter to 1 into a collision.
 *
 * MUST run OUTSIDE an interactive `$transaction`: it issues its own query on the
 * global client, and awaiting that from inside a transaction holds the pooled
 * connection hostage and deadlocks until the tx times out (P2028 → 500).
 */
async function nextCode(companyId: string): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ max: number | null }>>(
    Prisma.sql`
      SELECT MAX(CAST(substring(code from '^PRJ-([0-9]+)$') AS INTEGER)) AS max
      FROM projects
      WHERE company_id = ${companyId}::uuid AND code ~ '^PRJ-[0-9]+$'
    `,
  );
  const n = Number(rows[0]?.max ?? 0) + 1;
  return `PRJ-${String(n).padStart(4, "0")}`;
}

/** True for the unique-constraint violation on a project's (company, code). */
function isDuplicateCodeError(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") {
    return false;
  }
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
  return fields.some((f) => f.includes("code"));
}

export async function createProject(
  input: CreateProjectInput,
): Promise<ProjectDetail | DuplicateCodeResult> {
  const user = await requirePermission("projects.create");
  createProjectInputSchema.parse(input);
  // Validate contractor config BEFORE any write so a bad row aborts the whole
  // create (no partially-corrupt project). Company ownership enforced here.
  const contractors = await validateProjectContractors(
    user.company.id,
    projectContractorsSchema.parse(input.contractors ?? []),
  );

  // Blank code (client sends undefined; guard "" too) → auto-generate. An
  // explicit duplicate RETURNS a typed result (not a throw): Server Action error
  // messages are masked in production, so a throw would reach the client as a
  // raw 500 the form can't identify. Returning survives the boundary cleanly.
  const explicitCode = input.code?.trim() || null;
  if (explicitCode) {
    const clash = await prisma.project.findFirst({
      where: { companyId: user.company.id, code: explicitCode },
      select: { id: true },
    });
    if (clash) return { duplicateCode: true };
  }

  const outcome = await insertProjectWithCode(user, input, explicitCode, contractors);
  if ("duplicateCode" in outcome) return outcome;
  await logActivity(user, outcome.id, "project.created", "created the project");
  return (await getProject(outcome.id))!;
}

/**
 * Insert a project (+ contractor config) with a resolved code, retrying auto
 * codes on a unique-code collision (covers the small race between generating a
 * code and inserting it). The transaction body performs NO code lookup — doing
 * that inside the tx deadlocks the pooled connection until it times out (P2028).
 */
async function insertProjectWithCode(
  user: SessionUser,
  input: CreateProjectInput,
  explicitCode: string | null,
  contractors: ProjectContractorInput[],
): Promise<{ id: string } | DuplicateCodeResult> {
  const MAX_ATTEMPTS = 5;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = explicitCode ?? (await nextCode(user.company.id));
    try {
      return await prisma.$transaction(async (tx) => {
        const project = await tx.project.create({
          data: {
            companyId: user.company.id,
            code,
            name: input.name,
            type: input.type,
            clientName: input.clientName ?? null,
            clientContact: input.clientContact ?? null,
            clientPhone: input.clientPhone ?? null,
            clientEmail: input.clientEmail ?? null,
            siteAddress: input.siteAddress ?? null,
            gpsLat: input.gpsLat ?? null,
            gpsLng: input.gpsLng ?? null,
            budgetPaise: BigInt(input.budgetPaise),
            contractValuePaise: BigInt(input.contractValuePaise),
            procurementBudgetPaise:
              input.procurementBudgetPaise != null ? BigInt(input.procurementBudgetPaise) : null,
            startDate: input.startDate ? new Date(input.startDate) : null,
            expectedCompletionDate: input.expectedCompletionDate
              ? new Date(input.expectedCompletionDate)
              : null,
            tags: input.tags ?? [],
            pmId: input.pmId ?? null,
            createdById: user.id,
          },
          select: { id: true },
        });
        await syncProjectContractors(tx, user.company.id, project.id, contractors);
        return project;
      });
    } catch (e) {
      // An explicit code that lost a race returns the typed duplicate result; an
      // auto code simply regenerates from the new MAX and retries.
      if (isDuplicateCodeError(e)) {
        if (explicitCode) return { duplicateCode: true };
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw lastErr ?? new Error("CODE_GENERATION_FAILED");
}

export async function updateProject(
  id: string,
  patch: UpdateProjectInput,
): Promise<ProjectDetail> {
  const user = await requireProjectWrite("projects.edit", id);
  // Validate + normalize the patch (parity with the create form; strips unknown
  // keys like pmId/code — pmId has its own action). Never trust the client.
  const input = updateProjectInputSchema.parse(patch);
  await prisma.project.update({
    where: { id },
    data: {
      name: input.name,
      type: input.type,
      clientName: input.clientName,
      clientContact: input.clientContact,
      clientPhone: input.clientPhone,
      clientEmail: input.clientEmail,
      siteAddress: input.siteAddress,
      gpsLat: input.gpsLat,
      gpsLng: input.gpsLng,
      ...(input.budgetPaise != null ? { budgetPaise: BigInt(input.budgetPaise) } : {}),
      ...(input.contractValuePaise != null
        ? { contractValuePaise: BigInt(input.contractValuePaise) }
        : {}),
      ...(input.procurementBudgetPaise !== undefined
        ? {
            procurementBudgetPaise:
              input.procurementBudgetPaise != null ? BigInt(input.procurementBudgetPaise) : null,
          }
        : {}),
      ...(input.startDate !== undefined
        ? { startDate: input.startDate ? new Date(input.startDate) : null }
        : {}),
      ...(input.expectedCompletionDate !== undefined
        ? {
            expectedCompletionDate: input.expectedCompletionDate
              ? new Date(input.expectedCompletionDate)
              : null,
          }
        : {}),
      ...(input.tags ? { tags: input.tags } : {}),
    },
  });
  await logActivity(user, id, "project.updated", "updated project details");
  return (await getProject(id))!;
}

export async function changeStage(
  id: string,
  stage: ProjectStage,
): Promise<ProjectListItem> {
  const user = await requireProjectWrite("projects.edit", id);
  await prisma.project.update({ where: { id }, data: { stage } });
  await logActivity(user, id, "stage.changed", `advanced to ${STAGE_LABEL[stage]}`);
  const row = await prisma.project.findUniqueOrThrow({ where: { id }, select: listSelect });
  return toItem(row, user.id);
}

export async function assignManager(
  id: string,
  pmId: string | null,
): Promise<ProjectListItem> {
  const user = await requireProjectWrite("projects.assign", id);
  await prisma.project.update({ where: { id }, data: { pmId } });
  await logActivity(user, id, "pm.assigned", pmId ? "assigned a manager" : "unassigned manager");
  const row = await prisma.project.findUniqueOrThrow({ where: { id }, select: listSelect });
  return toItem(row, user.id);
}

export async function duplicateProject(id: string): Promise<ProjectDetail> {
  // Duplicating creates a new project → gated by create. Source must be in the
  // caller's company (isolation preserved).
  const user = await requirePermission("projects.create");
  const src = await prisma.project.findFirstOrThrow({
    where: { id, companyId: user.company.id },
    include: {
      projectContractors: {
        select: {
          contractorId: true,
          contractRatePaise: true,
          contractRateUnit: true,
          labourRates: { select: { labourSubcategoryId: true, ratePaise: true, rateUnit: true } },
        },
      },
    },
  });
  const contractors: ProjectContractorInput[] = src.projectContractors.map((pc) => ({
    contractorId: pc.contractorId,
    contractRatePaise: pc.contractRatePaise,
    contractRateUnit: pc.contractRateUnit,
    labourRates: pc.labourRates.map((lr) => ({
      labourSubcategoryId: lr.labourSubcategoryId,
      ratePaise: lr.ratePaise,
      rateUnit: lr.rateUnit,
    })),
  }));

  // Same P2028-safe pattern as create: the auto code is resolved OUTSIDE the
  // transaction, with a retry on a unique-code collision.
  const MAX_ATTEMPTS = 5;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = await nextCode(user.company.id);
    try {
      const created = await prisma.$transaction(async (tx) => {
        const project = await tx.project.create({
          data: {
            companyId: user.company.id,
            code,
            name: `${src.name} (copy)`,
            type: src.type,
            clientName: src.clientName,
            clientContact: src.clientContact,
            clientPhone: src.clientPhone,
            clientEmail: src.clientEmail,
            siteAddress: src.siteAddress,
            gpsLat: src.gpsLat,
            gpsLng: src.gpsLng,
            budgetPaise: src.budgetPaise,
            contractValuePaise: src.contractValuePaise,
            procurementBudgetPaise: src.procurementBudgetPaise,
            tags: src.tags,
            pmId: src.pmId,
            createdById: user.id,
          },
          select: { id: true },
        });
        await syncProjectContractors(tx, user.company.id, project.id, contractors);
        return project;
      });
      await logActivity(user, created.id, "project.duplicated", `duplicated from ${src.code}`);
      return (await getProject(created.id))!;
    } catch (e) {
      if (isDuplicateCodeError(e)) {
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw lastErr ?? new Error("CODE_GENERATION_FAILED");
}

export async function setArchived(
  id: string,
  archived: boolean,
): Promise<ProjectListItem> {
  const user = await requireProjectWrite("projects.archive", id);
  await prisma.project.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null },
  });
  await logActivity(
    user,
    id,
    archived ? "project.archived" : "project.restored",
    archived ? "archived the project" : "restored the project",
  );
  const row = await prisma.project.findUniqueOrThrow({ where: { id }, select: listSelect });
  return toItem(row, user.id);
}

/**
 * Permanently-styled delete: a soft delete under the hood (deletedAt/deletedBy/
 * deletedReason) so procurement, labour, and financial history is preserved and
 * the Owner can restore. Gated by re-authentication — the caller must re-enter
 * their account password, verified server-side (never trusting the client). The
 * name-typing + checkbox are UX guards; this password check is the real gate.
 */
export async function removeProject(
  id: string,
  confirm: { password: string; reason?: string | null },
): Promise<void> {
  const user = await requirePermission("projects.delete");

  const project = await prisma.project.findFirst({
    where: { id, companyId: user.company.id, deletedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      pmId: true,
      _count: {
        select: {
          purchaseOrders: true,
          vendorPayments: true,
          goodsReceipts: true,
          labourAttendance: true,
          contractorSettlements: true,
          documents: true,
          notes: true,
        },
      },
    },
  });
  if (!project) throw new Error("NOT_FOUND");
  // Ownership scope: broad edit_all deletes any; otherwise only assigned.
  if (!hasPermission(user, "projects.edit_all") && project.pmId !== user.id) {
    throw new Error("FORBIDDEN");
  }

  const ok = await verifyPassword(user.email, confirm.password ?? "");
  if (!ok) throw new Error("INVALID_PASSWORD");

  const reason = (confirm.reason ?? "").trim() || null;
  await prisma.$transaction([
    prisma.project.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: user.id, deletedReason: reason },
    }),
    prisma.activityLog.create({
      data: {
        companyId: user.company.id,
        actorId: user.id,
        action: "project.deleted",
        entityType: "project",
        entityId: id,
        summary: `deleted project ${project.code} — ${project.name}`,
        meta: { code: project.code, name: project.name, reason, related: project._count },
      },
    }),
  ]);
}

/** Owner-only recovery of a soft-deleted project. Clears the deletion metadata
 *  and records the restore in the audit trail. */
export async function restoreProject(id: string): Promise<ProjectListItem> {
  const user = await requirePermission("projects.delete");
  const project = await prisma.project.findFirst({
    where: { id, companyId: user.company.id, deletedAt: { not: null } },
    select: { id: true, code: true, name: true, pmId: true },
  });
  if (!project) throw new Error("NOT_FOUND");
  if (!hasPermission(user, "projects.edit_all") && project.pmId !== user.id) {
    throw new Error("FORBIDDEN");
  }
  await prisma.project.update({
    where: { id },
    data: { deletedAt: null, deletedById: null, deletedReason: null },
  });
  await logActivity(
    user,
    id,
    "project.recovered",
    `restored project ${project.code} — ${project.name}`,
  );
  const row = await prisma.project.findUniqueOrThrow({ where: { id }, select: listSelect });
  return toItem(row, user.id);
}

export async function toggleFavorite(id: string): Promise<boolean> {
  // Personal pin — available to anyone who can view projects.
  const user = await requirePermission("projects.view");
  const existing = await prisma.projectFavorite.findUnique({
    where: { userId_projectId: { userId: user.id, projectId: id } },
  });
  if (existing) {
    await prisma.projectFavorite.delete({
      where: { userId_projectId: { userId: user.id, projectId: id } },
    });
    return false;
  }
  await prisma.projectFavorite.create({ data: { userId: user.id, projectId: id } });
  return true;
}

export async function addDeadline(
  projectId: string,
  title: string,
  dueDate: string,
): Promise<ProjectDetail> {
  const user = await requireProjectWrite("projects.edit", projectId);
  await prisma.deadline.create({
    data: { companyId: user.company.id, projectId, title, dueDate: new Date(dueDate) },
  });
  await logActivity(user, projectId, "deadline.added", `added deadline "${title}"`);
  return (await getProject(projectId))!;
}

export async function toggleDeadline(
  projectId: string,
  deadlineId: string,
): Promise<ProjectDetail> {
  await requireProjectWrite("projects.edit", projectId);
  const d = await prisma.deadline.findUniqueOrThrow({ where: { id: deadlineId } });
  await prisma.deadline.update({
    where: { id: deadlineId },
    data: { completedAt: d.completedAt ? null : new Date() },
  });
  return (await getProject(projectId))!;
}

export async function removeDeadline(
  projectId: string,
  deadlineId: string,
): Promise<ProjectDetail> {
  await requireProjectWrite("projects.edit", projectId);
  await prisma.deadline.delete({ where: { id: deadlineId } });
  return (await getProject(projectId))!;
}

export async function addNote(projectId: string, body: string): Promise<ProjectDetail> {
  const user = await requireProjectWrite("projects.edit", projectId);
  await prisma.note.create({
    data: {
      companyId: user.company.id,
      projectId,
      body,
      authorId: user.id,
      clientUuid: crypto.randomUUID(),
    },
  });
  await logActivity(user, projectId, "note.added", "added a note");
  return (await getProject(projectId))!;
}

export async function addDocument(
  projectId: string,
  doc: { filename: string; sizeBytes: number; mimeType: string },
): Promise<ProjectDetail> {
  const user = await requireProjectWrite("projects.edit", projectId);
  const category = doc.mimeType.startsWith("image/")
    ? "PHOTO"
    : doc.mimeType === "application/pdf"
      ? "PDF"
      : "OTHER";
  await prisma.projectDocument.create({
    data: {
      companyId: user.company.id,
      projectId,
      category,
      storagePath: `${user.company.id}/${projectId}/${doc.filename}`,
      filename: doc.filename,
      sizeBytes: doc.sizeBytes,
      mimeType: doc.mimeType,
      uploadedById: user.id,
    },
  });
  await logActivity(user, projectId, "document.added", `uploaded ${doc.filename}`);
  return (await getProject(projectId))!;
}

export async function removeDocument(
  projectId: string,
  docId: string,
): Promise<ProjectDetail> {
  await requireProjectWrite("projects.edit", projectId);
  await prisma.projectDocument.delete({ where: { id: docId } });
  return (await getProject(projectId))!;
}

export async function listManagers(): Promise<Manager[]> {
  // Used by the project filter + assignment dropdowns → viewer-level.
  const user = await requirePermission("projects.view");
  const rows = await prisma.user.findMany({
    where: { companyId: user.company.id, role: "PROJECT_MANAGER", status: "ACTIVE" },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
  return rows;
}

/* ── Contractor-first labour config (read + replace) ─────────────────── */

/** Read a project's contractor config (contractors + labour types + rates).
 *  Viewer-level, project-access scoped (mirrors getProject/attendance access) —
 *  safe for the Labour attendance screen too. */
export async function listProjectContractors(
  projectId: string,
): Promise<ProjectContractorItem[]> {
  const user = await requirePermission("projects.view");
  const p = await prisma.project.findFirst({
    where: {
      id: projectId,
      companyId: user.company.id,
      deletedAt: null,
      ...(hasPermission(user, "projects.view_all") ? {} : { pmId: user.id }),
    },
    select: { id: true },
  });
  if (!p) throw new Error("FORBIDDEN");
  const rows = await prisma.projectContractor.findMany({
    where: { companyId: user.company.id, projectId },
    include: projectContractorInclude,
    orderBy: projectContractorOrderBy,
  });
  return rows.map(toProjectContractorItem);
}

/**
 * Reconcile a project's contractor config to `rows` (transactional). Gated by
 * projects.edit + ownership scope (same as any project edit). Validates company
 * ownership of every contractor + labour subcategory and dedupes before writing.
 *
 * Reconciled as a DIFF, not a replace: unchanged mappings keep their row ids so
 * historical attendance keeps its rate-provenance FK. Dropping a contractor that
 * already has attendance on this project throws CONTRACTOR_HAS_ATTENDANCE.
 */
export async function setProjectContractors(
  projectId: string,
  rows: ProjectContractorInput[],
): Promise<ProjectContractorItem[]> {
  const user = await requireProjectWrite("projects.edit", projectId);
  const contractors = await validateProjectContractors(
    user.company.id,
    projectContractorsSchema.parse(rows),
  );
  await prisma.$transaction(async (tx) => {
    await syncProjectContractors(tx, user.company.id, projectId, contractors);
  });
  const labourTypeCount = contractors.reduce((s, c) => s + c.labourRates.length, 0);
  await logActivity(
    user,
    projectId,
    "project.contractors_updated",
    contractors.length === 0
      ? "cleared project contractors"
      : `set ${contractors.length} contractor${contractors.length === 1 ? "" : "s"} (${labourTypeCount} labour type${labourTypeCount === 1 ? "" : "s"})`,
  );
  const fresh = await prisma.projectContractor.findMany({
    where: { companyId: user.company.id, projectId },
    include: projectContractorInclude,
    orderBy: projectContractorOrderBy,
  });
  return fresh.map(toProjectContractorItem);
}
