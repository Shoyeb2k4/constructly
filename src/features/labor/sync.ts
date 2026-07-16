import { registerEntity } from "@/lib/sync/registry";
import { labourAttendanceMutationSchema } from "./schema";

/**
 * Registers category-based labour attendance with the reusable offline sync
 * engine (ADR-0007). Mutations queue in the Dexie outbox and flush
 * idempotently to /api/sync with last-write-wins on
 * (project, date, category).
 */
registerEntity({
  name: "labour_attendance",
  schema: labourAttendanceMutationSchema,
  conflict: "last-write-wins",
});
