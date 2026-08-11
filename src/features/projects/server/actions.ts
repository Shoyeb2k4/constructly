"use server";

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { verifyPassword } from "@/lib/auth/verify-password";
import type { SessionUser } from "@/lib/auth/types";
import { STAGE_LABEL } from "../constants";
import { deadlineBounds, todayISO } from "../deadline";
import type {
  ContractorAssignmentInput,
  CreateProjectInput,
  ProjectContractorAssignmentItem,
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
import { updateProjectInputSchema, contractorAssignmentsSchema } from "../schema";

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

/* ── Contractor↔category assignments ─────────────────────────────────── */

const assignmentInclude = {
  contractor: { select: { name: true } },
  category: { select: { name: true, color: true } },
} satisfies Prisma.ProjectContractorAssignmentInclude;

type AssignmentRow = Prisma.ProjectContractorAssignmentGetPayload<{
  include: typeof assignmentInclude;
}>;

function toAssignmentItem(a: AssignmentRow): ProjectContractorAssignmentItem {
  return {
    id: a.id,
    contractorId: a.contractorId,
    contractorName: a.contractor.name,
    labourCategoryId: a.labourCategoryId,
    categoryName: a.category.name,
    categoryColor: a.category.color,
  };
}

/**
 * Validate + normalize an assignment set for a company: strips exact duplicate
 * (contractor, category) pairs and confirms every contractor and category
 * belongs to the caller's company (cross-company rows are rejected — the UI
 * filters, but the server never trusts it). Returns the deduped rows.
 */
async function validateAssignments(
  companyId: string,
  rows: ContractorAssignmentInput[],
): Promise<ContractorAssignmentInput[]> {
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    const k = `${r.contractorId}|${r.labourCategoryId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (deduped.length === 0) return deduped;

  const contractorIds = [...new Set(deduped.map((r) => r.contractorId))];
  const categoryIds = [...new Set(deduped.map((r) => r.labourCategoryId))];
  const [contractorCount, categoryCount] = await Promise.all([
    prisma.contractor.count({ where: { id: { in: contractorIds }, companyId } }),
    prisma.labourCategory.count({ where: { id: { in: categoryIds }, companyId } }),
  ]);
  if (contractorCount !== contractorIds.length || categoryCount !== categoryIds.length) {
    throw new Error("INVALID_ASSIGNMENT");
  }
  return deduped;
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
      contractorAssignments: {
        include: assignmentInclude,
        orderBy: [{ category: { displayOrder: "asc" } }, { contractor: { name: "asc" } }],
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
    contractorAssignments: p.contractorAssignments.map(toAssignmentItem),
  };
}

async function nextCode(companyId: string): Promise<string> {
  const last = await prisma.project.findFirst({
    where: { companyId },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const n = Number(/PRJ-(\d+)/.exec(last?.code ?? "")?.[1] ?? 0) + 1;
  return `PRJ-${String(n).padStart(4, "0")}`;
}

export async function createProject(
  input: CreateProjectInput,
): Promise<ProjectDetail> {
  const user = await requirePermission("projects.create");
  createProjectInputSchema.parse(input);
  // Validate assignments BEFORE any write so a bad row aborts the whole create
  // (no partially-corrupt project). Company ownership enforced here.
  const assignments = await validateAssignments(
    user.company.id,
    contractorAssignmentsSchema.parse(input.contractorAssignments ?? []),
  );
  const created = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        companyId: user.company.id,
        code: input.code ?? (await nextCode(user.company.id)),
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
    if (assignments.length > 0) {
      await tx.projectContractorAssignment.createMany({
        data: assignments.map((a) => ({
          companyId: user.company.id,
          projectId: project.id,
          contractorId: a.contractorId,
          labourCategoryId: a.labourCategoryId,
        })),
      });
    }
    return project;
  });
  await logActivity(user, created.id, "project.created", "created the project");
  return (await getProject(created.id))!;
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
      contractorAssignments: {
        select: { contractorId: true, labourCategoryId: true },
      },
    },
  });
  const created = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        companyId: user.company.id,
        code: await nextCode(user.company.id),
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
    if (src.contractorAssignments.length > 0) {
      await tx.projectContractorAssignment.createMany({
        data: src.contractorAssignments.map((a) => ({
          companyId: user.company.id,
          projectId: project.id,
          contractorId: a.contractorId,
          labourCategoryId: a.labourCategoryId,
        })),
      });
    }
    return project;
  });
  await logActivity(user, created.id, "project.duplicated", `duplicated from ${src.code}`);
  return (await getProject(created.id))!;
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

/* ── Contractor↔category assignments (read + replace) ────────────────── */

const assignmentOrderBy: Prisma.ProjectContractorAssignmentOrderByWithRelationInput[] = [
  { category: { displayOrder: "asc" } },
  { contractor: { name: "asc" } },
];

/** Read a project's contractor assignments. Viewer-level, project-access scoped
 *  (mirrors getProject/attendance access) — safe for the Labour dropdown too. */
export async function listContractorAssignments(
  projectId: string,
): Promise<ProjectContractorAssignmentItem[]> {
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
  const rows = await prisma.projectContractorAssignment.findMany({
    where: { companyId: user.company.id, projectId },
    include: assignmentInclude,
    orderBy: assignmentOrderBy,
  });
  return rows.map(toAssignmentItem);
}

/**
 * Replace a project's contractor assignments (transactional). Gated by
 * projects.edit + ownership scope (same as any project edit). Validates company
 * ownership of every contractor + category and dedupes before writing.
 */
export async function setContractorAssignments(
  projectId: string,
  rows: ContractorAssignmentInput[],
): Promise<ProjectContractorAssignmentItem[]> {
  const user = await requireProjectWrite("projects.edit", projectId);
  const assignments = await validateAssignments(
    user.company.id,
    contractorAssignmentsSchema.parse(rows),
  );
  await prisma.$transaction([
    prisma.projectContractorAssignment.deleteMany({
      where: { companyId: user.company.id, projectId },
    }),
    ...(assignments.length > 0
      ? [
          prisma.projectContractorAssignment.createMany({
            data: assignments.map((a) => ({
              companyId: user.company.id,
              projectId,
              contractorId: a.contractorId,
              labourCategoryId: a.labourCategoryId,
            })),
          }),
        ]
      : []),
  ]);
  await logActivity(
    user,
    projectId,
    "project.contractors_updated",
    assignments.length === 0
      ? "cleared contractor assignments"
      : `set ${assignments.length} contractor assignment${assignments.length === 1 ? "" : "s"}`,
  );
  const fresh = await prisma.projectContractorAssignment.findMany({
    where: { companyId: user.company.id, projectId },
    include: assignmentInclude,
    orderBy: assignmentOrderBy,
  });
  return fresh.map(toAssignmentItem);
}
