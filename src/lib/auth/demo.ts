import type { SessionUser } from "./types";
import { ALL_PERMISSIONS } from "@/features/rbac/permissions";

/** The fixed demo identity used in demo mode (see lib/env). Mirrors seed.ts. */
export const DEMO_USER: SessionUser = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "owner@demo.constructly.app",
  fullName: "Aarav Mehta",
  role: "OWNER",
  roleName: "Owner",
  permissions: ALL_PERMISSIONS,
  company: {
    id: "00000000-0000-0000-0000-0000000000c0",
    name: "Meridian Build Co.",
  },
};
