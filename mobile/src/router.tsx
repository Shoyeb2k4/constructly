import * as React from "react";
import { Navigate, Route, Routes } from "react-router";
import type { SessionUser } from "@/lib/auth/types";
import { ProjectsView } from "@/features/projects/components/projects-view";
import { DashboardView } from "@/features/dashboard/components/dashboard-view";
import { NotPortedYet } from "./screens/not-ported-yet";

/**
 * Route table for the native app, mirroring `src/app/(app)/`.
 *
 * PHASE 1 SCOPE — this is architectural scaffolding, not a full port. Dashboard
 * and Projects mount the real views (the proof that shared components render
 * and that the RPC transport serves them). Every other route is registered so
 * navigation, the sidebar and deep links behave correctly, but renders an
 * explicit placeholder rather than a half-working screen.
 *
 * Porting a route later is a one-line change here plus registering that
 * feature's methods in `src/app/api/mobile/registry.ts` — no new architecture.
 */
export function MobileRoutes({ user }: { user: SessionUser }) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      <Route
        path="/dashboard"
        element={
          <DashboardView
            userId={user.id}
            isOwner={user.role === "OWNER"}
            greeting={greeting()}
            firstName={user.fullName.split(" ")[0] ?? "there"}
            companyName={user.company.name}
          />
        }
      />

      <Route path="/projects" element={<ProjectsView />} />

      {/* Registered, not yet ported. */}
      <Route path="/projects/:id" element={<NotPortedYet title="Project detail" />} />
      <Route path="/labor/*" element={<NotPortedYet title="Labour" />} />
      <Route path="/procurement/*" element={<NotPortedYet title="Procurement" />} />
      <Route path="/vendors/*" element={<NotPortedYet title="Vendors" />} />
      <Route path="/reports/*" element={<NotPortedYet title="Reports" />} />
      <Route path="/settings" element={<NotPortedYet title="Settings" />} />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

/** Mirrors the greeting computed in src/app/(app)/dashboard/page.tsx. */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
