"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Tags, MoreHorizontal, Pencil, Trash2, Check } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { toRupees } from "@/lib/money";
import { categoryFormSchema, categoryFormToInput, type CategoryFormValues } from "../schema";
import { CATEGORY_COLORS } from "../constants";
import { useCategories, useCategoryMutations } from "../hooks";
import type { LabourCategory } from "../types";

function CategoryDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: LabourCategory | null;
}) {
  const { create, update } = useCategoryMutations();
  // Parent remounts this dialog (via key) when `editing` changes, so lazy
  // initial state is always correct — no sync effect needed.
  const [color, setColor] = React.useState(() => editing?.color ?? CATEGORY_COLORS[0]);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      name: editing?.name ?? "",
      color: editing?.color ?? CATEGORY_COLORS[0],
      dailyRateRupees: editing?.dailyRatePaise != null ? toRupees(editing.dailyRatePaise) : "",
    },
  });

  function close() {
    reset();
    onOpenChange(false);
  }

  const onSubmit = handleSubmit(async (values) => {
    const parsed = categoryFormSchema.parse({ ...values, color });
    const input = categoryFormToInput(parsed);
    if (editing) await update.mutateAsync({ id: editing.id, patch: input });
    else await create.mutateAsync(input);
    close();
  });

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit category" : "Add labour category"}</DialogTitle>
          <DialogDescription>
            Categories group your workforce — e.g. Helper, Mason, Electrician.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input placeholder="Mason" autoFocus {...register("name")} />
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
          <div className="space-y-1.5">
            <Label>Day rate (₹, optional)</Label>
            <Input type="number" min={0} step={50} placeholder="850" {...register("dailyRateRupees")} />
            <p className="text-xs text-foreground-subtle">
              Used to estimate labour cost (rate × headcount). Leave blank to skip cost estimates.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={create.isPending || update.isPending}>
              {editing ? "Save" : "Add category"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CategoriesView() {
  const { data: categories = [], isLoading } = useCategories();
  const { remove } = useCategoryMutations();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LabourCategory | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<LabourCategory | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <Plus />
          Add category
        </Button>
      </div>

      {isLoading ? (
        <RowsSkeleton rows={5} />
      ) : categories.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="No labour categories"
          description="Add categories like Helper, Mason, and Electrician to start recording attendance."
          action={
            <Button variant="primary" size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus />Add category
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0">
              <span className="size-3 shrink-0 rounded-full" style={{ background: c.color }} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
              <span className="font-mono text-sm text-foreground-muted">
                {c.dailyRatePaise != null ? <MoneyText paise={c.dailyRatePaise} whole /> : "—"}
                <span className="text-xs text-foreground-subtle">/day</span>
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8 text-foreground-subtle" aria-label="Actions">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => { setEditing(c); setDialogOpen(true); }}>
                    <Pencil />Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => setConfirmDelete(c)}
                    className="text-danger-foreground [&_svg]:text-danger-foreground focus:bg-danger-subtle"
                  >
                    <Trash2 />Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      <CategoryDialog
        key={`${editing?.id ?? "new"}-${dialogOpen}`}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
      />

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {confirmDelete?.name}?</DialogTitle>
            <DialogDescription>
              This also removes all attendance recorded for this category. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() =>
                confirmDelete && remove.mutate(confirmDelete.id, { onSuccess: () => setConfirmDelete(null) })
              }
            >
              Delete category
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
