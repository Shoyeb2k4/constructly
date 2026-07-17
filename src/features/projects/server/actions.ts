"use server";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/current-user";
import type { SessionUser } from "@/lib/auth/types";
import { STAGE_LABEL } from "../constants";
import type {
  CreateProjectInput,
  ProjectDetail,
  ProjectFilters,
  ProjectListItem,
  ProjectStage,
  UpdateProjectInput,
  Manager,
} from "../types";
import { Prisma } from "@/generated/prisma";
import { spendByProject, projectSpend } from "@/features/budget/server-actions";

/**
 * Server-side projects API. Every function enforces authorization (role +
 * assignment) on top of Postgres RLS — defense in depth. Never trusts a
 * client-supplied companyId; it derives from the session.
 */

function assertOwner(user: SessionUser) {
  if (user.role !== "OWNER") throw new Error("FORBIDDEN");
}

async function assertCanEdit(user: SessionUser, projectId: string) {
  const p = await prisma.project.findFirst({
    where: { id: projectId, companyId: user.company.id, deletedAt: null },
    select: { pmId: true },
  });
  if (!p) throw new Error("NOT_FOUND");
  if (user.role !== "OWNER" && p.pmId !== user.id) throw new Error("FORBIDDEN");
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
  updatedAt: true,
  pm: { select: { id: true, fullName: true } },
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
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listProjects(
  filters: ProjectFilters = {},
): Promise<ProjectListItem[]> {
  const user = await requireUser();
  const where: Prisma.ProjectWhereInput = {
    companyId: user.company.id,
    deletedAt: null,
    ...(user.role !== "OWNER" ? { pmId: user.id } : {}),
    ...(filters.includeArchived ? {} : { archivedAt: null }),
    ...(filters.stage && filters.stage !== "ALL" ? { stage: filters.stage } : {}),
    ...(filters.type && filters.type !== "ALL" ? { type: filters.type } : {}),
    ...(filters.pmId && filters.pmId !== "ALL" ? { pmId: filters.pmId } : {}),
    ...(filters.tag && filters.tag !== "ALL" ? { tags: { has: filters.tag } } : {}),
    ...(filters.favoritesOnly ? { favorites: { some: { userId: user.id } } } : {}),
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
    orderBy: { updatedAt: "desc" },
  });
  const spend = await spendByProject();
  return rows.map((r) => {
    const item = toItem(r, user.id);
    const s = spend[r.id];
    item.usedPaise = s ? s.laborPaise + s.procurementPaise : 0;
    return item;
  });
}

export async function getProject(id: string): Promise<ProjectDetail | null> {
  const user = await requireUser();
  const p = await prisma.project.findFirst({
    where: {
      id,
      companyId: user.company.id,
      deletedAt: null,
      ...(user.role !== "OWNER" ? { pmId: user.id } : {}),
    },
    include: {
      pm: { select: { id: true, fullName: true } },
      favorites: { select: { userId: true } },
      deadlines: { orderBy: { dueDate: "asc" } },
      documents: {
        orderBy: { createdAt: "desc" },
        include: { project: false },
      },
      notes: { orderBy: { createdAt: "desc" } },
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
  const user = await requireUser();
  assertOwner(user);
  const created = await prisma.project.create({
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
  await logActivity(user, created.id, "project.created", "created the project");
  return (await getProject(created.id))!;
}

export async function updateProject(
  id: string,
  patch: UpdateProjectInput,
): Promise<ProjectDetail> {
  const user = await requireUser();
  await assertCanEdit(user, id);
  await prisma.project.update({
    where: { id },
    data: {
      name: patch.name,
      type: patch.type,
      clientName: patch.clientName,
      clientContact: patch.clientContact,
      clientPhone: patch.clientPhone,
      clientEmail: patch.clientEmail,
      siteAddress: patch.siteAddress,
      gpsLat: patch.gpsLat,
      gpsLng: patch.gpsLng,
      ...(patch.budgetPaise != null ? { budgetPaise: BigInt(patch.budgetPaise) } : {}),
      ...(patch.contractValuePaise != null
        ? { contractValuePaise: BigInt(patch.contractValuePaise) }
        : {}),
      ...(patch.procurementBudgetPaise !== undefined
        ? {
            procurementBudgetPaise:
              patch.procurementBudgetPaise != null ? BigInt(patch.procurementBudgetPaise) : null,
          }
        : {}),
      ...(patch.startDate !== undefined
        ? { startDate: patch.startDate ? new Date(patch.startDate) : null }
        : {}),
      ...(patch.expectedCompletionDate !== undefined
        ? {
            expectedCompletionDate: patch.expectedCompletionDate
              ? new Date(patch.expectedCompletionDate)
              : null,
          }
        : {}),
      ...(patch.tags ? { tags: patch.tags } : {}),
    },
  });
  await logActivity(user, id, "project.updated", "updated project details");
  return (await getProject(id))!;
}

export async function changeStage(
  id: string,
  stage: ProjectStage,
): Promise<ProjectListItem> {
  const user = await requireUser();
  await assertCanEdit(user, id);
  await prisma.project.update({ where: { id }, data: { stage } });
  await logActivity(user, id, "stage.changed", `advanced to ${STAGE_LABEL[stage]}`);
  const row = await prisma.project.findUniqueOrThrow({ where: { id }, select: listSelect });
  return toItem(row, user.id);
}

export async function assignManager(
  id: string,
  pmId: string | null,
): Promise<ProjectListItem> {
  const user = await requireUser();
  assertOwner(user);
  await prisma.project.update({ where: { id }, data: { pmId } });
  await logActivity(user, id, "pm.assigned", pmId ? "assigned a manager" : "unassigned manager");
  const row = await prisma.project.findUniqueOrThrow({ where: { id }, select: listSelect });
  return toItem(row, user.id);
}

export async function duplicateProject(id: string): Promise<ProjectDetail> {
  const user = await requireUser();
  assertOwner(user);
  const src = await prisma.project.findFirstOrThrow({
    where: { id, companyId: user.company.id },
  });
  const created = await prisma.project.create({
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
  await logActivity(user, created.id, "project.duplicated", `duplicated from ${src.code}`);
  return (await getProject(created.id))!;
}

export async function setArchived(
  id: string,
  archived: boolean,
): Promise<ProjectListItem> {
  const user = await requireUser();
  await assertCanEdit(user, id);
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

export async function removeProject(id: string): Promise<void> {
  const user = await requireUser();
  assertOwner(user);
  await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity(user, id, "project.deleted", "deleted the project");
}

export async function toggleFavorite(id: string): Promise<boolean> {
  const user = await requireUser();
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
  const user = await requireUser();
  await assertCanEdit(user, projectId);
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
  const user = await requireUser();
  await assertCanEdit(user, projectId);
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
  const user = await requireUser();
  await assertCanEdit(user, projectId);
  await prisma.deadline.delete({ where: { id: deadlineId } });
  return (await getProject(projectId))!;
}

export async function addNote(projectId: string, body: string): Promise<ProjectDetail> {
  const user = await requireUser();
  await assertCanEdit(user, projectId);
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
  const user = await requireUser();
  await assertCanEdit(user, projectId);
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
  const user = await requireUser();
  await assertCanEdit(user, projectId);
  await prisma.projectDocument.delete({ where: { id: docId } });
  return (await getProject(projectId))!;
}

export async function listManagers(): Promise<Manager[]> {
  const user = await requireUser();
  const rows = await prisma.user.findMany({
    where: { companyId: user.company.id, role: "PROJECT_MANAGER", status: "ACTIVE" },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
  return rows;
}
