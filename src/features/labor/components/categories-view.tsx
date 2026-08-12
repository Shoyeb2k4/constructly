"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus,
  Tags,
  MoreHorizontal,
  Pencil,
  Trash2,
  Check,
  GripVertical,
  FolderPlus,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyText } from "@/components/patterns/money-text";
import { EmptyState } from "@/components/patterns/empty-state";
import { RowsSkeleton } from "@/components/patterns/loading-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { toRupees } from "@/lib/money";
import {
  categoryFormSchema,
  subcategoryFormSchema,
  subcategoryFormToInput,
  type CategoryFormValues,
  type SubcategoryFormValues,
} from "../schema";
import { CATEGORY_COLORS, FALLBACK_COLOR } from "../constants";
import { useCategories, useHierarchyMutations, useForceDeletePreview } from "../hooks";
import { laborKeys } from "../data";
import { useCan, useIsOwner } from "@/features/rbac/permission-context";
import type { CategoryWithSubs, LabourCategory, LabourSubcategory } from "../types";

/* ── Dialogs ─────────────────────────────────────────────────────────── */

function CategoryDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: LabourCategory | null;
}) {
  const { createCategory, updateCategory } = useHierarchyMutations();
  const [color, setColor] = React.useState(() => editing?.color ?? CATEGORY_COLORS[0]);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: { name: editing?.name ?? "", color: editing?.color ?? CATEGORY_COLORS[0] },
  });

  function close() {
    reset();
    onOpenChange(false);
  }
  const onSubmit = handleSubmit(async (values) => {
    const parsed = categoryFormSchema.parse({ ...values, color });
    if (editing) await updateCategory.mutateAsync({ id: editing.id, patch: { name: parsed.name, color: parsed.color ?? null } });
    else await createCategory.mutateAsync({ name: parsed.name, color: parsed.color ?? null });
    close();
  });

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit group" : "Add trade group"}</DialogTitle>
          <DialogDescription>A trade group, e.g. Carpenter or Electrician.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input placeholder="Carpenter" autoFocus {...register("name")} />
            {errors.name && <p className="text-xs text-danger-foreground">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full transition-transform",
                    color === c && "scale-110 ring-2 ring-ring ring-offset-2 ring-offset-surface",
                  )}
                  style={{ background: c }}
                >
                  {color === c && <Check className="size-4 text-white" />}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={createCategory.isPending || updateCategory.isPending}>
              {editing ? "Save" : "Add group"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubcategoryDialog({
  open,
  onOpenChange,
  categories,
  editing,
  defaultCategoryId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  categories: CategoryWithSubs[];
  editing: LabourSubcategory | null;
  defaultCategoryId: string | null;
}) {
  const { createSubcategory, updateSubcategory } = useHierarchyMutations();
  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<SubcategoryFormValues>({
    resolver: zodResolver(subcategoryFormSchema),
    defaultValues: {
      categoryId: editing?.categoryId ?? defaultCategoryId ?? categories[0]?.id ?? "",
      name: editing?.name ?? "",
      dailyRateRupees: editing?.dailyRatePaise != null ? toRupees(editing.dailyRatePaise) : "",
    },
  });

  function close() {
    reset();
    onOpenChange(false);
  }
  const onSubmit = handleSubmit(async (values) => {
    const input = subcategoryFormToInput(subcategoryFormSchema.parse(values));
    if (editing) await updateSubcategory.mutateAsync({ id: editing.id, patch: input });
    else await createSubcategory.mutateAsync(input);
    close();
  });

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit labour type" : "Add labour type"}</DialogTitle>
          <DialogDescription>
            e.g. Mason, Mason Helper, or Centering.{editing ? " Changing the group moves it." : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Group</Label>
            <Controller
              control={control}
              name="categoryId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Pick a group" /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.categoryId && <p className="text-xs text-danger-foreground">{errors.categoryId.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input placeholder="Main Carpenter" autoFocus {...register("name")} />
            {errors.name && <p className="text-xs text-danger-foreground">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Day rate (₹, optional)</Label>
            <Input type="number" min={0} step={50} placeholder="900" {...register("dailyRateRupees")} />
            <p className="text-xs text-foreground-subtle">
              Used to estimate labour cost (rate × headcount). Historical records keep their snapshot.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={createSubcategory.isPending || updateSubcategory.isPending}>
              {editing ? "Save" : "Add labour type"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Sortable rows ───────────────────────────────────────────────────── */

function SortableItem({
  id,
  children,
}: {
  id: string;
  children: (handle: React.HTMLAttributes<HTMLButtonElement>) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "relative z-10 opacity-70")}
    >
      {children({ ...attributes, ...listeners } as React.HTMLAttributes<HTMLButtonElement>)}
    </div>
  );
}

/* ── Delete confirmation ─────────────────────────────────────────────── */

type ConfirmTarget =
  | { kind: "category"; item: CategoryWithSubs }
  | { kind: "subcategory"; item: LabourSubcategory };

function ImpactRow({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </li>
  );
}

/**
 * Owner delete flow. Fetches an impact preview: a genuinely unused item gets a
 * plain delete; a referenced item becomes a FORCE DELETE that deactivates it
 * (attendance + financial history preserved) behind a typed-DELETE confirmation.
 */
function OwnerDeleteDialog({
  target,
  onClose,
}: {
  target: ConfirmTarget | null;
  onClose: () => void;
}) {
  const { deleteCategory, deleteSubcategory, forceDeleteCategory, forceDeleteSubcategory } =
    useHierarchyMutations();
  const previewTarget = target ? { kind: target.kind, id: target.item.id } : null;
  const { data: impact, isLoading } = useForceDeletePreview(previewTarget);
  // Fresh per target — the parent keys this component by target id, so the input
  // resets on each open (no setState-in-effect).
  const [ack, setAck] = React.useState("");

  const name = target?.item.name ?? "";
  const referenced =
    !!impact &&
    (impact.attendancePreserved > 0 ||
      impact.projectContractorRates > 0 ||
      impact.projectContractorAssignments > 0);
  const pending =
    deleteCategory.isPending ||
    deleteSubcategory.isPending ||
    forceDeleteCategory.isPending ||
    forceDeleteSubcategory.isPending;
  const canConfirm = !pending && !isLoading && (!referenced || ack.trim() === "DELETE");

  function run() {
    if (!target) return;
    const done = { onSuccess: onClose };
    if (referenced) {
      const v = { id: target.item.id, ack: ack.trim(), name };
      if (target.kind === "category") forceDeleteCategory.mutate(v, done);
      else forceDeleteSubcategory.mutate(v, done);
    } else if (target.kind === "category") {
      deleteCategory.mutate(target.item.id, done);
    } else {
      deleteSubcategory.mutate(target.item.id, done);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {referenced && <AlertTriangle className="size-5 text-danger-foreground" />}
            {referenced ? "Force delete" : "Delete"} {name}?
          </DialogTitle>
          <DialogDescription>
            {isLoading
              ? "Checking what this will affect…"
              : referenced
                ? "This item is in use. As Owner you can force-delete it — current configuration is removed, but attendance and financial history are preserved and stay readable."
                : target?.kind === "category"
                  ? "This removes the group and its labour types. It has no recorded attendance or configured rates."
                  : "This labour type has no recorded attendance or configured rates."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-foreground-subtle">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : referenced && impact ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-border bg-surface-muted/40 p-3">
              <p className="mb-1.5 font-medium text-danger-foreground">Will be permanently removed</p>
              <ul className="space-y-1 text-foreground-muted">
                {impact.labourGroups > 0 && <ImpactRow label="Labour groups" value={impact.labourGroups} />}
                {impact.labourTypes > 0 && <ImpactRow label="Labour types" value={impact.labourTypes} />}
                {impact.projectContractorRates > 0 && (
                  <ImpactRow label="Project-contractor rate configs" value={impact.projectContractorRates} />
                )}
                {impact.projectContractorAssignments > 0 && (
                  <ImpactRow label="Project category assignments" value={impact.projectContractorAssignments} />
                )}
                {impact.projectsAffected > 0 && (
                  <ImpactRow label="Projects affected" value={impact.projectsAffected} />
                )}
              </ul>
            </div>
            <div className="rounded-lg border border-border bg-surface-muted/40 p-3">
              <p className="mb-1.5 font-medium text-foreground-subtle">Preserved — history is kept</p>
              <ul className="space-y-1 text-foreground-muted">
                <ImpactRow label="Attendance records" value={impact.attendancePreserved} />
                {impact.settlementsPreserved > 0 && (
                  <ImpactRow label="Contractor settlements" value={impact.settlementsPreserved} />
                )}
              </ul>
            </div>
            <p className="text-xs text-foreground-subtle">This action cannot be undone.</p>
            <div className="space-y-1.5">
              <Label htmlFor="force-delete-ack">
                Type <span className="font-mono font-semibold">DELETE</span> to confirm
              </Label>
              <Input
                id="force-delete-ack"
                autoFocus
                autoComplete="off"
                value={ack}
                onChange={(e) => setAck(e.target.value)}
                placeholder="DELETE"
              />
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={run} disabled={!canConfirm}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {referenced ? "Force delete" : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── View ────────────────────────────────────────────────────────────── */

export function CategoriesView() {
  const qc = useQueryClient();
  const canCreate = useCan()("labour.create");
  const isOwner = useIsOwner();
  const { data: categories = [], isLoading } = useCategories();
  const { deleteCategory, deleteSubcategory, reorderCategories, reorderSubcategories } =
    useHierarchyMutations();

  const [catDialog, setCatDialog] = React.useState(false);
  const [editingCat, setEditingCat] = React.useState<LabourCategory | null>(null);
  const [subDialog, setSubDialog] = React.useState(false);
  const [editingSub, setEditingSub] = React.useState<LabourSubcategory | null>(null);
  const [subDefaultCat, setSubDefaultCat] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<ConfirmTarget | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onCategoryDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = categories.map((c) => c.id);
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    qc.setQueryData<CategoryWithSubs[]>(laborKeys.categories, (old) =>
      old ? next.map((id) => old.find((c) => c.id === id)!) : old,
    );
    reorderCategories.mutate(next);
  }

  function onSubDragEnd(category: CategoryWithSubs, e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = category.subcategories.map((s) => s.id);
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    qc.setQueryData<CategoryWithSubs[]>(laborKeys.categories, (old) =>
      old?.map((c) =>
        c.id === category.id
          ? { ...c, subcategories: next.map((id) => c.subcategories.find((s) => s.id === id)!) }
          : c,
      ),
    );
    reorderSubcategories.mutate({ categoryId: category.id, orderedIds: next });
  }

  return (
    <div className="space-y-4">
      {/* Orientation: this screen is the reusable master; contractors and
          project rates are configured elsewhere (the owner's contractor-first
          workflow). Keeps "Labour Types" from being mistaken for the per-project
          contractor setup. */}
      <div className="rounded-lg border border-border bg-surface-muted/40 px-3 py-2.5 text-xs text-foreground-muted">
        <p className="font-medium text-foreground-subtle">Reusable labour types &amp; default rates.</p>
        <p className="mt-0.5">
          Labour types (e.g. Mason, Mason Helper, Centering) grouped by trade, with a default day
          rate. Manage contractors under{" "}
          <Link href="/labor/contractors" className="text-primary hover:underline">Labour → Contractors</Link>.
          Assign contractors and set project-specific rates on each{" "}
          <Link href="/projects" className="text-primary hover:underline">Project → Contractors</Link>.
          The <Link href="/labor" className="text-primary hover:underline">Attendance</Link> screen then
          groups labour by contractor.
        </p>
      </div>

      {canCreate && (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { setEditingCat(null); setCatDialog(true); }}>
            <FolderPlus />
            Add group
          </Button>
          <Button variant="primary" onClick={() => { setEditingSub(null); setSubDefaultCat(null); setSubDialog(true); }}>
            <Plus />
            Add labour type
          </Button>
        </div>
      )}

      {isLoading ? (
        <RowsSkeleton rows={5} />
      ) : categories.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="No labour types yet"
          description="Add trade groups like Carpenter and Mason, each with labour types like Main Carpenter and Carpenter Helper. Contractors and project rates are set per project."
          action={
            canCreate ? (
              <Button variant="primary" size="sm" onClick={() => { setEditingCat(null); setCatDialog(true); }}>
                <FolderPlus />Add group
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onCategoryDragEnd}>
          <SortableContext items={categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {categories.map((category) => (
                <SortableItem key={category.id} id={category.id}>
                  {(handle) => (
                    <div className="overflow-hidden rounded-xl border border-border bg-surface">
                      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                        <button
                          {...handle}
                          aria-label={`Reorder ${category.name}`}
                          className="cursor-grab rounded p-1 text-foreground-subtle hover:bg-surface-muted active:cursor-grabbing"
                        >
                          <GripVertical className="size-4" />
                        </button>
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: category.color ?? FALLBACK_COLOR }} />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{category.name}</span>
                        <span className="text-xs text-foreground-subtle">
                          {category.subcategories.length} labour type{category.subcategories.length === 1 ? "" : "s"}
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8 text-foreground-subtle" aria-label={`${category.name} actions`}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => { setEditingSub(null); setSubDefaultCat(category.id); setSubDialog(true); }}>
                              <Plus />Add labour type
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => { setEditingCat(category); setCatDialog(true); }}>
                              <Pencil />Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() => setConfirm({ kind: "category", item: category })}
                              className="text-danger-foreground [&_svg]:text-danger-foreground focus:bg-danger-subtle"
                            >
                              <Trash2 />Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={(e) => onSubDragEnd(category, e)}
                      >
                        <SortableContext items={category.subcategories.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                          {category.subcategories.length === 0 ? (
                            <p className="px-10 py-3 text-xs text-foreground-subtle">No labour types yet.</p>
                          ) : (
                            category.subcategories.map((sub) => (
                              <SortableItem key={sub.id} id={sub.id}>
                                {(subHandle) => (
                                  <div className="flex items-center gap-2 border-b border-border py-2 pl-7 pr-3 last:border-0">
                                    <button
                                      {...subHandle}
                                      aria-label={`Reorder ${sub.name}`}
                                      className="cursor-grab rounded p-1 text-foreground-subtle hover:bg-surface-muted active:cursor-grabbing"
                                    >
                                      <GripVertical className="size-3.5" />
                                    </button>
                                    <span className="min-w-0 flex-1 truncate text-sm">{sub.name}</span>
                                    <span className="font-mono text-sm text-foreground-muted">
                                      {sub.dailyRatePaise != null ? <MoneyText paise={sub.dailyRatePaise} whole /> : "—"}
                                      <span className="text-xs text-foreground-subtle">/day</span>
                                    </span>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="size-7 text-foreground-subtle" aria-label={`${sub.name} actions`}>
                                          <MoreHorizontal className="size-3.5" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onSelect={() => { setEditingSub(sub); setSubDialog(true); }}>
                                          <Pencil />Edit / move
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          onSelect={() => setConfirm({ kind: "subcategory", item: sub })}
                                          className="text-danger-foreground [&_svg]:text-danger-foreground focus:bg-danger-subtle"
                                        >
                                          <Trash2 />Delete
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                )}
                              </SortableItem>
                            ))
                          )}
                        </SortableContext>
                      </DndContext>
                    </div>
                  )}
                </SortableItem>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <CategoryDialog
        key={`cat-${editingCat?.id ?? "new"}-${catDialog}`}
        open={catDialog}
        onOpenChange={setCatDialog}
        editing={editingCat}
      />
      <SubcategoryDialog
        key={`sub-${editingSub?.id ?? "new"}-${subDefaultCat ?? ""}-${subDialog}`}
        open={subDialog}
        onOpenChange={setSubDialog}
        categories={categories}
        editing={editingSub}
        defaultCategoryId={subDefaultCat}
      />

      {/* Owners get the impact-aware Force Delete flow (referenced items
          deactivate, preserving history); everyone else keeps the plain
          confirm that the server blocks when the item is referenced. */}
      {isOwner ? (
        <OwnerDeleteDialog
          key={confirm?.item.id ?? "none"}
          target={confirm}
          onClose={() => setConfirm(null)}
        />
      ) : (
        <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {confirm?.item.name}?</DialogTitle>
              <DialogDescription>
                {confirm?.kind === "category"
                  ? "This removes its labour types. A group whose labour types have recorded attendance or a configured contractor rate can't be deleted — labour history and project config are preserved."
                  : "A labour type with recorded attendance or a configured contractor rate can't be deleted — labour history and project config are preserved."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (!confirm) return;
                  const done = { onSuccess: () => setConfirm(null) };
                  if (confirm.kind === "category") deleteCategory.mutate(confirm.item.id, done);
                  else deleteSubcategory.mutate(confirm.item.id, done);
                }}
              >
                Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
