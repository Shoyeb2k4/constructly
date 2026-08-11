"use client";

import * as React from "react";
import { useSetProjectContractors } from "../../hooks";
import type { ProjectContractorInput, ProjectContractorItem } from "../../types";
import {
  ContractorAssignmentsField,
  cleanAssignments,
} from "../contractor-assignments-field";
import { SectionEditSheet } from "./section-edit-sheet";

export function ContractorsEditSheet({
  projectId,
  initial,
  open,
  onOpenChange,
}: {
  projectId: string;
  /** Current contractor config from the loaded project detail (no extra fetch). */
  initial: ProjectContractorItem[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const save = useSetProjectContractors(projectId);
  const [rows, setRows] = React.useState<ProjectContractorInput[]>([]);

  // Seed the editor from the persisted config each time it opens
  // (derive-during-render, not an effect — edits stay local until saved).
  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setRows(
        initial.map((pc) => ({
          contractorId: pc.contractorId,
          contractRatePaise: pc.contractRatePaise,
          contractRateUnit: pc.contractRateUnit,
          labourRates: pc.labourRates.map((r) => ({
            labourSubcategoryId: r.labourSubcategoryId,
            ratePaise: r.ratePaise,
            rateUnit: r.rateUnit,
          })),
        })),
      );
    }
  }

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    save.mutate(cleanAssignments(rows), { onSuccess: () => onOpenChange(false) });
  };

  return (
    <SectionEditSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit contractors"
      description="Set the contractors on this project and the labour types they supply, with project rates."
      onSubmit={onSubmit}
      saving={save.isPending}
    >
      <ContractorAssignmentsField value={rows} onChange={setRows} />
    </SectionEditSheet>
  );
}
