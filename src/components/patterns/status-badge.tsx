import { Badge, type BadgeProps } from "@/components/ui/badge";

type Tone = NonNullable<BadgeProps["variant"]>;

/** Project lifecycle stage → label + tone. Mirrors the ProjectStage enum. */
export const PROJECT_STAGE_META: Record<string, { label: string; tone: Tone }> = {
  CREATED: { label: "Created", tone: "neutral" },
  PLANNING: { label: "Planning", tone: "neutral" },
  ESTIMATION: { label: "Estimation", tone: "primary" },
  PROCUREMENT: { label: "Procurement", tone: "primary" },
  CONSTRUCTION: { label: "Construction", tone: "primary" },
  QUALITY_INSPECTION: { label: "Quality inspection", tone: "warning" },
  COMPLETION: { label: "Completion", tone: "success" },
  HANDOVER: { label: "Handover", tone: "success" },
  CLOSED: { label: "Closed", tone: "neutral" },
};

export const ATTENDANCE_META: Record<string, { label: string; tone: Tone }> = {
  PRESENT: { label: "Present", tone: "success" },
  ABSENT: { label: "Absent", tone: "danger" },
  HALF_DAY: { label: "Half-day", tone: "warning" },
};

/**
 * PO PAYMENT state — deliberately a separate scale from PO_STATUS_META.
 *
 * "Approved" is an operational fact about the order; "Paid" is an accounting
 * fact about the money. They move independently — an approved order can be
 * unpaid for weeks — so they get separate columns and separate badges rather
 * than one blended "state". Unpaid is NEUTRAL: it is the ordinary condition of
 * a fresh order, not a warning.
 */
export const PO_PAYMENT_META: Record<string, { label: string; tone: Tone }> = {
  UNPAID: { label: "Unpaid", tone: "neutral" },
  PARTIAL: { label: "Partially paid", tone: "warning" },
  PAID: { label: "Paid", tone: "success" },
};

export const PO_STATUS_META: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SUBMITTED: { label: "Submitted", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
};

export function StatusBadge({
  meta,
  value,
}: {
  meta: Record<string, { label: string; tone: Tone }>;
  value: string;
}) {
  const entry = meta[value] ?? { label: value, tone: "neutral" as Tone };
  return <Badge variant={entry.tone}>{entry.label}</Badge>;
}
