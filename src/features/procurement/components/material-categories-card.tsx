"use client";

import * as React from "react";
import { X, Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useMaterialCategories, useMaterialCategoryMutations } from "../hooks";

/**
 * Company-wide material category presets (Cement, Steel, …). These power PO
 * line categorization and every procurement filter / dashboard breakdown.
 */
export function MaterialCategoriesCard() {
  const { data: categories = [], isLoading } = useMaterialCategories();
  const { save } = useMaterialCategoryMutations();
  const [draft, setDraft] = React.useState("");

  function add() {
    const v = draft.trim();
    if (!v || categories.some((c) => c.toLowerCase() === v.toLowerCase())) {
      setDraft("");
      return;
    }
    save.mutate([...categories, v]);
    setDraft("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Material categories</CardTitle>
        <CardDescription>Used to categorize purchase order line items, filters, and analytics.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {isLoading ? (
            <span className="text-sm text-foreground-subtle">Loading…</span>
          ) : (
            categories.map((c) => (
              <span
                key={c}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted/60 py-1 pl-3 pr-1.5 text-xs font-medium"
              >
                {c}
                <button
                  onClick={() => save.mutate(categories.filter((x) => x !== c))}
                  className="flex size-4 items-center justify-center rounded-full text-foreground-subtle hover:bg-danger-subtle hover:text-danger-foreground"
                  aria-label={`Remove ${c}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))
          )}
        </div>
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="Add a category (e.g. Tiles)"
            className="h-9"
          />
          <Button type="button" variant="secondary" size="sm" onClick={add} disabled={!draft.trim()}>
            <Plus />
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
