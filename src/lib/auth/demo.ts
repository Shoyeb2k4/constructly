import type { SessionUser } from "./types";

/** The fixed demo identity used in demo mode (see lib/env). Mirrors seed.ts. */
export const DEMO_USER: SessionUser = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "owner@demo.constructly.app",
  fullName: "Aarav Mehta",
  role: "OWNER",
  company: {
    id: "00000000-0000-0000-0000-0000000000c0",
    name: "Meridian Build Co.",
  },
};
