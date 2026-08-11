"use client";

import * as React from "react";
import { useSetContractorAssignments } from "../../hooks";
import type { ContractorAssignmentInput, ProjectContractorAssignmentItem } from "../../types";
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
  /** Current assignments from the loaded project detail (no extra fetch). */
  initial: ProjectContractorAssignmentItem[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const save = useSetContractorAssignments(projectId);
  const [rows, setRows] = React.useState<ContractorAssignmentInput[]>([]);

  // Seed the editor from the persisted assignments each time it opens
  // (derive-during-render, not an effect — edits stay local until saved).
  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setRows(initial.map((a) => ({ contractorId: a.contractorId, labourCategoryId: a.labourCategoryId })));
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
      description="Assign contractors to the work categories they handle on this project."
      onSubmit={onSubmit}
      saving={save.isPending}
    >
      <ContractorAssignmentsField value={rows} onChange={setRows} />
    </SectionEditSheet>
  );
}
