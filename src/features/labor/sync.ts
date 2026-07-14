import { registerEntity } from "@/lib/sync/registry";
import { attendanceMutationSchema } from "./schema";

/**
 * Registers attendance with the reusable offline sync engine (ADR-0007).
 * Importing this module (done by the attendance screen) makes `attendance`
 * a known syncable entity: mutations can be queued in the Dexie outbox and
 * flushed idempotently to /api/sync with last-write-wins resolution.
 */
registerEntity({
  name: "attendance",
  schema: attendanceMutationSchema,
  conflict: "last-write-wins",
});
