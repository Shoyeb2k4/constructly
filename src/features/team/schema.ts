import { z } from "zod";

/** Assignable roles. Extend this enum (and the DB Role) to add roles later —
 *  the rest of the team system is role-agnostic. */
export const ASSIGNABLE_ROLES = ["OWNER", "PROJECT_MANAGER"] as const;
export const roleSchema = z.enum(ASSIGNABLE_ROLES);

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(160),
  role: roleSchema,
});

export const acceptSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your name").max(120),
});

export const ROLE_LABEL: Record<(typeof ASSIGNABLE_ROLES)[number], string> = {
  OWNER: "Owner",
  PROJECT_MANAGER: "Project Manager",
};
