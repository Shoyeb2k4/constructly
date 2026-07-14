"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { projectsApi, projectKeys } from "./data";
import type {
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

export function useManagers() {
  return useQuery({
    queryKey: projectKeys.managers,
    queryFn: () => projectsApi.listManagers(),
    staleTime: 5 * 60_000,
  });
}

/* ── Mutations ───────────────────────────────────────────────────────── */

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => projectsApi.create(input),
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: projectKeys.all });
      toast.success("Project created", { description: project.name });
    },
    onError: () => toast.error("Couldn't create the project"),
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
  const remove = useMutation({
    mutationFn: (id: string) => projectsApi.remove(id),
    onSuccess: () => {
      invalidate();
      toast.success("Project deleted");
    },
  });
  const assignManager = useMutation({
    mutationFn: ({ id, pmId }: { id: string; pmId: string | null }) =>
      projectsApi.assignManager(id, pmId),
    onSuccess: () => invalidate(),
  });

  return { duplicate, setArchived, remove, assignManager };
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
  const addDeadline = useMutation({
    mutationFn: (v: { title: string; dueDate: string }) =>
      projectsApi.addDeadline(id, v.title, v.dueDate),
    onSuccess: write,
  });
  const toggleDeadline = useMutation({
    mutationFn: (deadlineId: string) => projectsApi.toggleDeadline(id, deadlineId),
    onSuccess: write,
  });
  const removeDeadline = useMutation({
    mutationFn: (deadlineId: string) => projectsApi.removeDeadline(id, deadlineId),
    onSuccess: write,
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
