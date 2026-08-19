"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ContractorRemovalBlockedError,
  describeRemovalBlockers,
} from "./contractor-removal";
import { projectsApi, projectKeys } from "./data";
import type {
  ProjectContractorInput,
  CreateProjectInput,
  ProjectDetail,
  ProjectFilters,
  ProjectListItem,
  ProjectStage,
  UpdateProjectInput,
} from "./types";

/* ── Queries ─────────────────────────────────────────────────────────── */

export function useProjects(filters: ProjectFilters = {}) {
  return useQuery({
    queryKey: projectKeys.list(filters),
    queryFn: () => projectsApi.list(filters),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => projectsApi.get(id),
  });
}

export function useManagers(enabled = true) {
  return useQuery({
    queryKey: projectKeys.managers,
    queryFn: () => projectsApi.listManagers(),
    staleTime: 5 * 60_000,
    enabled,
  });
}

/** Company soft-delete retention policy (Owner-only view). */
export function useProjectRetention() {
  return useQuery({
    queryKey: projectKeys.retention,
    queryFn: () => projectsApi.getRetention(),
    staleTime: 5 * 60_000,
  });
}

export function useSetProjectRetention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (days: number | null) => projectsApi.setRetention(days),
    onSuccess: (days) => {
      qc.setQueryData(projectKeys.retention, days);
      qc.invalidateQueries({ queryKey: projectKeys.lists });
      toast.success("Retention policy updated");
    },
    onError: () => toast.error("Couldn't update the retention policy"),
  });
}

/** A project's contractor config (contractors + the labour types/rates they
 *  supply). Also powers the Labour attendance screen (which contractors work
 *  this project, and their labour types/rates). */
export function useProjectContractors(projectId: string | null, enabled = true) {
  return useQuery({
    queryKey: projectKeys.projectContractors(projectId ?? "none"),
    queryFn: () => projectsApi.listProjectContractors(projectId!),
    enabled: enabled && !!projectId,
    staleTime: 60_000,
  });
}

/** Replace a project's contractor config (Contractors edit sheet). Refreshes the
 *  detail and the config list so Labour picks up the change immediately. */
export function useSetProjectContractors(projectId: string, projectName?: string) {
  const qc = useQueryClient();
  return useMutation({
    // A blocked removal is a DECISION, not a transient failure. The app-wide
    // default retries a failed mutation once (see app/providers.tsx), which for a
    // deterministic refusal means running the whole dependency check twice and
    // delaying the explanation for no reason. Opt out.
    retry: false,
    // The server returns blockers as a typed RESULT rather than throwing a code,
    // because Next masks Server Action messages in production. Re-thrown here,
    // browser-side, so `onError` can say exactly what is in the way.
    mutationFn: async (rows: ProjectContractorInput[]) => {
      const res = await projectsApi.setProjectContractors(projectId, rows);
      if ("blockedRemovals" in res) throw new ContractorRemovalBlockedError(res.blockedRemovals);
      return res;
    },
    onSuccess: (items) => {
      qc.setQueryData(projectKeys.projectContractors(projectId), items);
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      qc.invalidateQueries({ queryKey: projectKeys.projectContractors(projectId) });
      // Attendance derives its contractors + labour types/rates from this config.
      qc.invalidateQueries({ queryKey: ["labor"] });
      toast.success("Contractors updated");
    },
    onError: (e: unknown) =>
      toast.error(
        e instanceof ContractorRemovalBlockedError
          ? describeRemovalBlockers(e.blockers, projectName)
          : "Couldn't update contractors",
        // A refusal explains a domain rule and is worth reading properly.
        e instanceof ContractorRemovalBlockedError ? { duration: 10_000 } : undefined,
      ),
  });
}

/* ── Mutations ───────────────────────────────────────────────────────── */

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    // The action RETURNS a duplicate-code marker (it can't throw across the
    // Server Action boundary without becoming a masked 500). Re-throw it here,
    // client-side, so the message is intact for onError + the form's catch.
    mutationFn: async (input: CreateProjectInput) => {
      const res = await projectsApi.create(input);
      if ("duplicateCode" in res) throw new Error("DUPLICATE_CODE");
      return res;
    },
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: projectKeys.all });
      toast.success("Project created", { description: project.name });
    },
    // A duplicate code is surfaced inline on the form's Code field, so skip the
    // generic toast for it.
    onError: (e) => {
      if (!/DUPLICATE_CODE/i.test(e instanceof Error ? e.message : "")) {
        toast.error("Couldn't create the project");
      }
    },
  });
}

/** Optimistic stage change — powers instant Kanban drag-and-drop. */
export function useChangeStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: ProjectStage }) =>
      projectsApi.changeStage(id, stage),
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: projectKeys.lists });
      const prev = qc.getQueriesData<ProjectListItem[]>({
        queryKey: projectKeys.lists,
      });
      qc.setQueriesData<ProjectListItem[]>({ queryKey: projectKeys.lists }, (old) =>
        old?.map((p) => (p.id === id ? { ...p, stage } : p)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      ctx?.prev?.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error("Couldn't move the project");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => projectsApi.toggleFavorite(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: projectKeys.lists });
      const prev = qc.getQueriesData<ProjectListItem[]>({
        queryKey: projectKeys.lists,
      });
      qc.setQueriesData<ProjectListItem[]>({ queryKey: projectKeys.lists }, (old) =>
        old?.map((p) => (p.id === id ? { ...p, isFavorite: !p.isFavorite } : p)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) =>
      ctx?.prev?.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: () => qc.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

/** List-row lifecycle actions (duplicate / archive / delete / assign). */
export function useProjectActions() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: projectKeys.all });

  const duplicate = useMutation({
    mutationFn: (id: string) => projectsApi.duplicate(id),
    onSuccess: (p) => {
      invalidate();
      toast.success("Project duplicated", { description: p.name });
    },
  });
  const setArchived = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      projectsApi.setArchived(id, archived),
    onSuccess: (_p, v) => {
      invalidate();
      toast.success(v.archived ? "Project archived" : "Project restored");
    },
  });
  // Errors (esp. wrong password) are surfaced inline by the delete dialog via
  // its own onError, so the sheet stays open for a retry — no toast here.
  const remove = useMutation({
    mutationFn: (v: { id: string; password: string; reason?: string | null }) =>
      projectsApi.remove(v.id, { password: v.password, reason: v.reason ?? null }),
    onSuccess: () => {
      invalidate();
      toast.success("Project deleted", {
        description: "Moved to Deleted projects — an owner can restore it.",
      });
    },
  });
  const restore = useMutation({
    mutationFn: (id: string) => projectsApi.restore(id),
    onSuccess: (p) => {
      invalidate();
      toast.success("Project restored", { description: p.name });
    },
    onError: () => toast.error("Couldn't restore the project"),
  });
  const assignManager = useMutation({
    mutationFn: ({ id, pmId }: { id: string; pmId: string | null }) =>
      projectsApi.assignManager(id, pmId),
    onSuccess: () => invalidate(),
  });

  return { duplicate, setArchived, remove, restore, assignManager };
}

/** Detail-page actions. Methods return the full detail → we write it straight
 *  into the cache for an instant update (no refetch flicker). */
export function useProjectDetailActions(id: string) {
  const qc = useQueryClient();
  const write = (p: ProjectDetail) => {
    qc.setQueryData(projectKeys.detail(id), p);
    qc.invalidateQueries({ queryKey: projectKeys.lists });
  };

  const update = useMutation({
    mutationFn: (patch: UpdateProjectInput) => projectsApi.update(id, patch),
    onSuccess: (p) => {
      write(p);
      toast.success("Saved");
    },
    onError: () => toast.error("Couldn't save changes"),
  });
  const changeStage = useMutation({
    mutationFn: (stage: ProjectStage) => projectsApi.changeStage(id, stage),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.all }),
  });
  // Deadline mutations surface failures — previously they failed silently, so a
  // rejected write looked to the user like "nothing happened".
  const addDeadline = useMutation({
    mutationFn: (v: { title: string; dueDate: string }) =>
      projectsApi.addDeadline(id, v.title, v.dueDate),
    onSuccess: (p) => {
      write(p);
      toast.success("Deadline added");
    },
    onError: () => toast.error("Couldn't add the deadline"),
  });
  const toggleDeadline = useMutation({
    mutationFn: (deadlineId: string) => projectsApi.toggleDeadline(id, deadlineId),
    onSuccess: write,
    onError: () => toast.error("Couldn't update the deadline"),
  });
  const removeDeadline = useMutation({
    mutationFn: (deadlineId: string) => projectsApi.removeDeadline(id, deadlineId),
    onSuccess: write,
    onError: () => toast.error("Couldn't remove the deadline"),
  });
  const addNote = useMutation({
    mutationFn: (body: string) => projectsApi.addNote(id, body),
    onSuccess: write,
  });
  const addDocument = useMutation({
    mutationFn: (doc: { filename: string; sizeBytes: number; mimeType: string }) =>
      projectsApi.addDocument(id, doc),
    onSuccess: write,
  });
  const removeDocument = useMutation({
    mutationFn: (docId: string) => projectsApi.removeDocument(id, docId),
    onSuccess: write,
  });

  return {
    update,
    changeStage,
    addDeadline,
    toggleDeadline,
    removeDeadline,
    addNote,
    addDocument,
    removeDocument,
  };
}
