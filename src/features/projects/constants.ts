import type { ProjectStage, ProjectType } from "./types";

/** Canonical lifecycle order — drives the stepper and the Kanban columns. */
export const STAGE_ORDER: ProjectStage[] = [
  "CREATED",
  "PLANNING",
  "ESTIMATION",
  "PROCUREMENT",
  "CONSTRUCTION",
  "QUALITY_INSPECTION",
  "COMPLETION",
  "HANDOVER",
  "CLOSED",
];

export const STAGE_LABEL: Record<ProjectStage, string> = {
  CREATED: "Created",
  PLANNING: "Planning",
  ESTIMATION: "Estimation",
  PROCUREMENT: "Procurement",
  CONSTRUCTION: "Construction",
  QUALITY_INSPECTION: "Quality inspection",
  COMPLETION: "Completion",
  HANDOVER: "Handover",
  CLOSED: "Closed",
};

export const TYPE_LABEL: Record<ProjectType, string> = {
  RESIDENTIAL: "Residential",
  COMMERCIAL: "Commercial",
  INDUSTRIAL: "Industrial",
  INFRASTRUCTURE: "Infrastructure",
  RENOVATION: "Renovation",
  INTERIOR_FITOUT: "Interior fit-out",
};

export const PROJECT_TYPES = Object.keys(TYPE_LABEL) as ProjectType[];

export function nextStage(stage: ProjectStage): ProjectStage | null {
  const i = STAGE_ORDER.indexOf(stage);
  return i >= 0 && i < STAGE_ORDER.length - 1 ? STAGE_ORDER[i + 1] : null;
}
