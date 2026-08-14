"use client";

/**
 * Add a labour type to whatever the attendance sheet is currently showing.
 *
 * Two things happen, and they are deliberately separate:
 *
 *  1. the type is created in (or picked from) the COMPANY-WIDE taxonomy;
 *  2. it is attached to the row the user is standing in front of — the selected
 *     agreement's scope, or, for a contractor with no agreements, that
 *     contractor's labour rates on this project.
 *
 * Step 2 is what makes step 1 useful: a type created and then invisible would
 * be a dead end. And an attendance-only contractor never has to invent an
 * agreement just to get a labour type onto their sheet.
 */

import * as React from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toPaise, toRupees } from "@/lib/money";
import { useCan } from "@/features/rbac/permission-context";
import { useProjectContractors, useSetProjectContractors } from "@/features/projects/hooks";
import { useAddScopeItem } from "@/features/contracts/hooks";
import { NewLabourTypeForm } from "@/features/contracts/components/new-labour-type-form";
import { useCategories } from "../../hooks";
import type { LabourSubcategory } from "../../types";

export function AddLabourTypeDialog({
  open,
  onOpenChange,
  projectId,
  contractorId,
  contractorName,
  /** The agreement currently selected for this contractor, if any. */
  contractId,
  agreementTitle,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  contractorId: string;
  contractorName: string;
  contractId: string | null;
  agreementTitle: string | null;
}) {
  if (!open) return null;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <AddLabourTypeForm
        onOpenChange={onOpenChange}
        projectId={projectId}
        contractorId={contractorId}
        contractorName={contractorName}
        contractId={contractId}
        agreementTitle={agreementTitle}
      />
    </Dialog>
  );
}

function AddLabourTypeForm({
  onOpenChange,
  projectId,
  contractorId,
  contractorName,
  contractId,
  agreementTitle,
}: {
  onOpenChange: (o: boolean) => void;
  projectId: string;
  contractorId: string;
  contractorName: string;
  contractId: string | null;
  agreementTitle: string | null;
}) {
  const can = useCan();
  const canCreateType = can("labour.create");
  const { data: categories = [] } = useCategories();
  const { data: projectContractors = [] } = useProjectContractors(projectId);
  const setContractors = useSetProjectContractors(projectId);
  const addScopeItem = useAddScopeItem();

  const [subId, setSubId] = React.useState("");
  const [rate, setRate] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const allSubs = React.useMemo(
    () => categories.flatMap((c) => c.subcategories.map((s) => ({ ...s, categoryName: c.name }))),
    [categories],
  );

  function choose(sub: LabourSubcategory) {
    setSubId(sub.id);
    // Start from the company default; the user sets what THIS contractor gets.
    setRate(String(toRupees(sub.dailyRatePaise ?? 0) || ""));
  }

  const ratePaise = rate.trim() ? toPaise(Number(rate) || 0) : 0;
  const canSave = !!subId && ratePaise > 0 && !busy;

  async function submit() {
    if (!canSave) return;
    setBusy(true);
    try {
      if (contractId) {
        // Agreement-linked: the type joins that agreement's scope at its rate.
        await addScopeItem.mutateAsync({
          contractId,
          labourSubcategoryId: subId,
          ratePaise,
          effectiveFrom: new Date().toLocaleDateString("en-CA"),
        });
      } else {
        // Attendance-only: the type joins this contractor's labour rates on the
        // project. Replace-all is the audited path, so every other contractor
        // and rate is carried through untouched.
        await setContractors.mutateAsync(
          projectContractors.map((pc) => ({
            contractorId: pc.contractorId,
            contractRatePaise: pc.contractRatePaise,
            contractRateUnit: pc.contractRateUnit,
            labourRates: [
              ...pc.labourRates.map((lr) => ({
                labourSubcategoryId: lr.labourSubcategoryId,
                ratePaise: lr.ratePaise,
                rateUnit: lr.rateUnit,
              })),
              ...(pc.contractorId === contractorId &&
              !pc.labourRates.some((lr) => lr.labourSubcategoryId === subId)
                ? [{ labourSubcategoryId: subId, ratePaise, rateUnit: "day" }]
                : []),
            ],
          })),
        );
      }
      onOpenChange(false);
    } catch {
      // The mutation's own toast explained it.
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add a labour type</DialogTitle>
        <DialogDescription>
          For {contractorName}
          {agreementTitle ? ` under ${agreementTitle}` : " on this project"}. Labour types are
          shared company-wide; the rate below is what this{" "}
          {agreementTitle ? "agreement" : "contractor"} pays.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Labour type</Label>
          <Select
            value={subId}
            onValueChange={(v) => {
              const sub = allSubs.find((s) => s.id === v);
              if (sub) choose(sub);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select an existing labour type" />
            </SelectTrigger>
            <SelectContent>
              {allSubs.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.categoryName} · {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {subId && (
          <div className="space-y-1.5">
            <Label htmlFor="attendance-rate">
              {agreementTitle ? "Agreement" : "Contractor"} rate (₹/day)
            </Label>
            <Input
              id="attendance-rate"
              type="number"
              min={0}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="e.g. 900"
            />
          </div>
        )}

        {canCreateType && !creating && (
          <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
            + Create labour type
          </Button>
        )}
        {canCreateType && creating && (
          <NewLabourTypeForm
            categories={categories}
            onCancel={() => setCreating(false)}
            onCreated={(sub) => {
              setCreating(false);
              choose(sub);
            }}
          />
        )}
        {!canCreateType && (
          <p className="text-xs text-foreground-subtle">
            Creating new labour types needs the labour create permission — you can still use any
            that already exist.
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} disabled={!canSave}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Add to sheet
        </Button>
      </div>
    </DialogContent>
  );
}
