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
import { useCategories, useHierarchyMutations } from "../hooks";
import { laborKeys } from "../data";
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
          <DialogTitle>{editing ? "Edit category" : "Add labour category"}</DialogTitle>
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
              {editing ? "Save" : "Add category"}
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
          <DialogTitle>{editing ? "Edit subcategory" : "Add subcategory"}</DialogTitle>
          <DialogDescription>
            e.g. Main Carpenter or Carpenter Helper.{editing ? " Changing the category moves it." : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Controller
              control={control}
              name="categoryId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Pick a category" /></SelectTrigger>
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
              {editing ? "Save" : "Add subcategory"}
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

/* ── View ────────────────────────────────────────────────────────────── */

export function CategoriesView() {
  const qc = useQueryClient();
  const { data: categories = [], isLoading } = useCategories();
  const { deleteCategory, deleteSubcategory, reorderCategories, reorderSubcategories } = useHierarchyMutations();

  const [catDialog, setCatDialog] = React.useState(false);
  const [editingCat, setEditingCat] = React.useState<LabourCategory | null>(null);
  const [subDialog, setSubDialog] = React.useState(false);
  const [editingSub, setEditingSub] = React.useState<LabourSubcategory | null>(null);
  const [subDefaultCat, setSubDefaultCat] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<
    | { kind: "category"; item: CategoryWithSubs }
    | { kind: "subcategory"; item: LabourSubcategory }
    | null
  >(null);

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
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => { setEditingSub(null); setSubDefaultCat(null); setSubDialog(true); }}>
          <Plus />
          Add subcategory
        </Button>
        <Button variant="primary" onClick={() => { setEditingCat(null); setCatDialog(true); }}>
          <FolderPlus />
          Add category
        </Button>
      </div>

      {isLoading ? (
        <RowsSkeleton rows={5} />
      ) : categories.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="No labour categories"
          description="Add categories like Carpenter and Mason, each with subcategories like Main Carpenter and Carpenter Helper."
          action={
            <Button variant="primary" size="sm" onClick={() => { setEditingCat(null); setCatDialog(true); }}>
              <FolderPlus />Add category
            </Button>
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
                          {category.subcategories.length} subcategor{category.subcategories.length === 1 ? "y" : "ies"}
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8 text-foreground-subtle" aria-label={`${category.name} actions`}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => { setEditingSub(null); setSubDefaultCat(category.id); setSubDialog(true); }}>
                              <Plus />Add subcategory
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
                            <p className="px-10 py-3 text-xs text-foreground-subtle">No subcategories yet.</p>
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

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {confirm?.item.name}?</DialogTitle>
            <DialogDescription>
              {confirm?.kind === "category"
                ? "This also removes its subcategories and all their attendance. This cannot be undone."
                : "This also removes all attendance recorded for this subcategory. This cannot be undone."}
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
    </div>
  );
}
