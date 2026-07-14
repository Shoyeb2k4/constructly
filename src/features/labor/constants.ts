/** Common construction trades — suggestions, not an enum (free text allowed). */
export const TRADES = [
  "Mason",
  "Helper",
  "Carpenter",
  "Electrician",
  "Plumber",
  "Painter",
  "Steel Fixer",
  "Welder",
  "Bar Bender",
  "Operator",
  "Supervisor",
  "Fitter",
] as const;

export const ATTENDANCE_STATUSES = ["PRESENT", "HALF_DAY", "ABSENT"] as const;

export const ATTENDANCE_SHORT: Record<string, string> = {
  PRESENT: "P",
  HALF_DAY: "½",
  ABSENT: "A",
};

export const ATTENDANCE_LABEL: Record<string, string> = {
  PRESENT: "Present",
  HALF_DAY: "Half-day",
  ABSENT: "Absent",
};
