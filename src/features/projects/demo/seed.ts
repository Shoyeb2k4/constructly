import type { ProjectDetail } from "../types";
import { toPaise } from "@/lib/money";

export const DEMO_MANAGERS = [
  { id: "00000000-0000-0000-0000-000000000002", fullName: "Priya Nair" },
  { id: "00000000-0000-0000-0000-000000000003", fullName: "Rohan Desai" },
];

const now = Date.now();
const day = 86_400_000;
const iso = (offsetDays: number) => new Date(now + offsetDays * day).toISOString();
const dateOnly = (offsetDays: number) =>
  new Date(now + offsetDays * day).toISOString().slice(0, 10);

function base(
  partial: Partial<ProjectDetail> & Pick<ProjectDetail, "id" | "code" | "name" | "type" | "stage">,
): ProjectDetail {
  return {
    budgetPaise: 0,
    contractValuePaise: 0,
    procurementBudgetPaise: null,
    usedPaise: 0,
    startDate: dateOnly(-120),
    expectedCompletionDate: dateOnly(90),
    pm: DEMO_MANAGERS[0],
    tags: [],
    isFavorite: false,
    archivedAt: null,
    deletedAt: null,
    updatedAt: iso(0),
    createdAt: iso(-150),
    clientName: null,
    clientContact: null,
    clientPhone: null,
    clientEmail: null,
    siteAddress: null,
    gpsLat: null,
    gpsLng: null,
    deadlines: [],
    documents: [],
    notes: [],
    activity: [],
    contractors: [],
    ...partial,
  };
}

export function demoSeed(): ProjectDetail[] {
  return [
    base({
      id: "10000000-0000-0000-0000-000000000001",
      code: "PRJ-0142",
      name: "Skyline Residency",
      type: "COMMERCIAL",
      stage: "CONSTRUCTION",
      budgetPaise: toPaise(1_20_00_000),
      contractValuePaise: toPaise(1_35_00_000),
      procurementBudgetPaise: toPaise(70_00_000),
      usedPaise: toPaise(92_40_000),
      expectedCompletionDate: dateOnly(64),
      tags: ["high-rise", "priority"],
      isFavorite: true,
      clientName: "Nirvana Developers",
      clientPhone: "+919845012345",
      siteAddress: "Whitefield, Bengaluru, KA",
      gpsLat: 12.9698,
      gpsLng: 77.7499,
      deadlines: [
        { id: "d1", title: "Slab casting — 8th floor", dueDate: dateOnly(9), completedAt: null },
        { id: "d2", title: "Facade glazing", dueDate: dateOnly(28), completedAt: null },
        { id: "d3", title: "Foundation sign-off", dueDate: dateOnly(-40), completedAt: iso(-38) },
      ],
      notes: [
        { id: "n1", body: "Client requested premium fittings in lobby — quote pending.", authorName: "Priya Nair", createdAt: iso(-2), clientUuid: "seed-n1" },
      ],
      documents: [
        { id: "doc1", category: "DRAWING", filename: "structural-plan-rev4.pdf", sizeBytes: 2_400_000, mimeType: "application/pdf", createdAt: iso(-10), uploadedByName: "Priya Nair" },
        { id: "doc2", category: "CONTRACT", filename: "main-contract.pdf", sizeBytes: 1_100_000, mimeType: "application/pdf", createdAt: iso(-140), uploadedByName: "Aarav Mehta" },
      ],
      activity: [
        { id: "a1", action: "stage.changed", summary: "advanced to Construction", actorName: "Aarav Mehta", createdAt: iso(-30) },
        { id: "a2", action: "document.added", summary: "uploaded structural-plan-rev4.pdf", actorName: "Priya Nair", createdAt: iso(-10) },
      ],
    }),
    base({
      id: "10000000-0000-0000-0000-000000000002",
      code: "PRJ-0138",
      name: "Orion Tech Park",
      type: "INDUSTRIAL",
      stage: "PROCUREMENT",
      budgetPaise: toPaise(2_10_00_000),
      contractValuePaise: toPaise(2_30_00_000),
      procurementBudgetPaise: toPaise(1_30_00_000),
      usedPaise: toPaise(31_00_000),
      expectedCompletionDate: dateOnly(128),
      tags: ["phase-1"],
      pm: DEMO_MANAGERS[1],
      clientName: "Orion Systems Pvt Ltd",
      siteAddress: "Hosur Road, Bengaluru, KA",
      deadlines: [{ id: "d4", title: "Steel procurement close", dueDate: dateOnly(21), completedAt: null }],
    }),
    base({
      id: "10000000-0000-0000-0000-000000000003",
      code: "PRJ-0151",
      name: "Vermillion Villas",
      type: "RESIDENTIAL",
      stage: "QUALITY_INSPECTION",
      budgetPaise: toPaise(19_00_000),
      contractValuePaise: toPaise(20_50_000),
      usedPaise: toPaise(18_80_000),
      expectedCompletionDate: dateOnly(12),
      tags: ["villas"],
      isFavorite: true,
      clientName: "Green Meadows Housing",
      deadlines: [{ id: "d5", title: "Snag list resolution", dueDate: dateOnly(6), completedAt: null }],
    }),
    base({
      id: "10000000-0000-0000-0000-000000000004",
      code: "PRJ-0129",
      name: "Metro Line 3 — Substation",
      type: "INFRASTRUCTURE",
      stage: "ESTIMATION",
      budgetPaise: toPaise(5_60_00_000),
      contractValuePaise: toPaise(6_00_00_000),
      usedPaise: 0,
      expectedCompletionDate: dateOnly(220),
      pm: DEMO_MANAGERS[1],
      tags: ["government", "phase-1"],
    }),
    base({
      id: "10000000-0000-0000-0000-000000000005",
      code: "PRJ-0117",
      name: "Aster Clinic Fit-out",
      type: "INTERIOR_FITOUT",
      stage: "HANDOVER",
      budgetPaise: toPaise(42_00_000),
      contractValuePaise: toPaise(45_00_000),
      usedPaise: toPaise(41_20_000),
      expectedCompletionDate: dateOnly(-4),
      tags: ["healthcare"],
    }),
    base({
      id: "10000000-0000-0000-0000-000000000006",
      code: "PRJ-0098",
      name: "Old Mill Renovation",
      type: "RENOVATION",
      stage: "CLOSED",
      budgetPaise: toPaise(28_00_000),
      contractValuePaise: toPaise(28_00_000),
      usedPaise: toPaise(27_10_000),
      expectedCompletionDate: dateOnly(-60),
      archivedAt: iso(-30),
      tags: ["heritage"],
    }),
  ];
}
