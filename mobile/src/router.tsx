import * as React from "react";
import { Navigate, Route, Routes, useParams } from "react-router";
import type { SessionUser } from "@/lib/auth/types";
import { useCan } from "@/features/rbac/permission-context";
import type { Permission } from "@/features/rbac/permissions";
import { canViewReport } from "@/features/reports/report-meta";
import { paymentsVisibilityFor } from "@/features/payments/visibility";

import { DashboardView } from "@/features/dashboard/components/dashboard-view";
import { ProjectsView } from "@/features/projects/components/projects-view";
import { ProjectDetailView } from "@/features/projects/components/detail/project-detail-view";
import { LaborSectionHeader } from "@/features/labor/components/labor-section-header";
import { AttendanceView } from "@/features/labor/components/attendance/attendance-view";
import { CategoriesView } from "@/features/labor/components/categories-view";
import { LaborSummaryView } from "@/features/labor/components/labor-summary-view";
import { ContractorsView } from "@/features/contractors/components/contractors-view";
import { ContractorDetailView } from "@/features/contractors/components/contractor-detail-view";
import { VendorsView } from "@/features/procurement/components/vendors-view";
import { VendorDetailView } from "@/features/procurement/components/vendor-detail-view";
import { ProcurementView } from "@/features/procurement/components/procurement-view";
import { PODetailView } from "@/features/procurement/components/po-detail-view";
import { PaymentsView } from "@/features/payments/components/payments-view";
import { ReportHub } from "@/features/reports/components/report-hub";
import { ReportView } from "@/features/reports/components/report-view";
import { PageHeader } from "@/components/patterns/page-header";
import { SettingsView } from "@/app/(app)/settings/settings-view";

/**
 * Route table for the native app, mirroring `src/app/(app)/`.
 *
 * Every route mounts the SAME view component the web route renders. Nothing is
 * reimplemented for mobile: the views already read their data through
 * `features/*​/data.ts`, which selects the RPC transport in a native build, so
 * mounting them here is the whole port.
 *
 * PERMISSION GATES. The web pages are server components that call
 * `hasPermission(user, …)` and `redirect()` before rendering. There is no server
 * render here, so the equivalent gate runs client-side through `<Guard>`.
 *
 * This is presentation, NOT enforcement. Every action behind these screens still
 * calls `requirePermission()` on the server, under the caller's real resolved
 * session, reached through the RPC allowlist — so removing a guard here would
 * expose a screen, never a capability. The guards exist so a user is not shown a
 * page whose every control will fail.
 */
export function MobileRoutes({ user }: { user: SessionUser }) {
  const visibility = paymentsVisibilityFor(user);
  const isOwner = user.role === "OWNER";
  // Pinned once per render so "this month" cannot resolve differently between
  // two components mounted in the same session.
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      <Route
        path="/dashboard"
        element={
          <DashboardView
            userId={user.id}
            isOwner={isOwner}
            greeting={greeting()}
            firstName={user.fullName.split(" ")[0] ?? "there"}
            companyName={user.company.name}
          />
        }
      />

      {/* ── Projects ─────────────────────────────────────────────────── */}
      <Route path="/projects" element={<ProjectsView />} />
      <Route
        path="/projects/:id"
        element={
          <Guard need="projects.view">
            <ProjectDetail userId={user.id} />
          </Guard>
        }
      />

      {/* ── Labour ───────────────────────────────────────────────────────
          Every /labor route is wrapped in <LaborSection>, which is this
          router's equivalent of src/app/(app)/labor/layout.tsx.

          WITHOUT IT THE SECTION HAS NO NAVIGATION. `LaborSectionHeader`
          renders the Attendance / Contractors / Summary tabs on list screens
          (and a breadcrumb on a record). Nesting the routes but not the layout
          left Contractors and Summary registered, reachable by URL, and
          unreachable by any tap — which is how it shipped to a phone, where the
          contractor module simply could not be opened. */}
      <Route
        path="/labor"
        element={
          <Guard need="attendance.view">
            <LaborSection>
              <AttendanceView />
            </LaborSection>
          </Guard>
        }
      />
      <Route
        path="/labor/categories"
        element={
          <Guard need="labour.view">
            <LaborSection>
              <CategoriesView />
            </LaborSection>
          </Guard>
        }
      />
      <Route
        path="/labor/summary"
        element={
          <Guard need="attendance.view">
            <LaborSection>
              <LaborSummaryView />
            </LaborSection>
          </Guard>
        }
      />
      {/* Deliberately ungated, matching the web route: the view gates each of
          its own actions on the permission that action's server function
          demands. */}
      <Route
        path="/labor/contractors"
        element={
          <LaborSection>
            <ContractorsView />
          </LaborSection>
        }
      />
      <Route
        path="/labor/contractors/:id"
        element={
          <LaborSection>
            <ContractorDetail />
          </LaborSection>
        }
      />

      {/* ── Vendors & procurement ────────────────────────────────────── */}
      <Route
        path="/vendors"
        element={
          <Guard need="vendors.view">
            <VendorsView />
          </Guard>
        }
      />
      <Route
        path="/vendors/:id"
        element={
          <Guard need="vendors.view">
            <VendorDetail />
          </Guard>
        }
      />
      <Route
        path="/procurement"
        element={
          <Guard need="purchase_orders.view">
            <ProcurementView />
          </Guard>
        }
      />
      <Route
        path="/procurement/:id"
        element={
          <Guard need="purchase_orders.view">
            <PODetail />
          </Guard>
        }
      />

      {/* ── Money ────────────────────────────────────────────────────── */}
      {/* `payments.view` gates the ROUTE; what it then SHOWS is gated per
          instrument by the module that owns it — see payments/visibility.ts.
          No `initialData`: the web page server-renders the first period, which
          a native build has no server to do. */}
      <Route
        path="/payments"
        element={
          <Guard need="payments.view">
            <PaymentsView userId={user.id} isOwner={isOwner} visibility={visibility} />
          </Guard>
        }
      />

      {/* ── Reports ──────────────────────────────────────────────────── */}
      <Route
        path="/reports"
        element={
          <Guard need="reports.view">
            <div className="space-y-8">
              <PageHeader
                title="Reports"
                description="Analysis over the same figures the operational modules record — filter it, compare it, export it."
              />
              <ReportHub />
            </div>
          </Guard>
        }
      />
      <Route path="/reports/:id" element={<Report user={user} today={today} />} />

      <Route path="/settings" element={<SettingsView />} />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

/* ── Route params ──────────────────────────────────────────────────────
 * `useParams` returns `string | undefined`. A route can only match when its
 * segment is present, so the id is always there — but the type does not know
 * that, and defaulting to "" would send an empty id to a query rather than
 * failing. Redirecting is the honest response to a URL that cannot be served.
 */

function ProjectDetail({ userId }: { userId: string }) {
  const { id } = useParams();
  if (!id) return <Navigate to="/projects" replace />;
  return <ProjectDetailView id={id} userId={userId} />;
}

function ContractorDetail() {
  const { id } = useParams();
  if (!id) return <Navigate to="/labor/contractors" replace />;
  return <ContractorDetailView contractorId={id} />;
}

function VendorDetail() {
  const { id } = useParams();
  if (!id) return <Navigate to="/vendors" replace />;
  return <VendorDetailView id={id} />;
}

function PODetail() {
  const { id } = useParams();
  if (!id) return <Navigate to="/procurement" replace />;
  return <PODetailView id={id} />;
}

/**
 * Reports carry a second, per-report gate: a financial report needs
 * `reports.view_financial` on top of `reports.view`. `canViewReport` is the same
 * function the web route uses, so the two cannot disagree about which reports a
 * role may open.
 */
function Report({ user, today }: { user: SessionUser; today: string }) {
  const { id } = useParams();
  const permissions = React.useMemo(() => user.permissions ?? [], [user.permissions]);
  const has = React.useCallback(
    (p: Permission) => user.role === "OWNER" || permissions.includes(p),
    [permissions, user.role],
  );

  if (!id || !canViewReport(has, id)) return <Navigate to="/reports" replace />;

  return (
    <ReportView
      id={id}
      userId={user.id}
      isOwner={user.role === "OWNER"}
      permissions={permissions}
      today={today}
      companyName={user.company.name}
    />
  );
}

/**
 * The mobile counterpart of `src/app/(app)/labor/layout.tsx`.
 *
 * Same component, same spacing, so the section's chrome cannot drift between
 * platforms. `LaborSectionHeader` decides for itself whether to show the tabs
 * or a breadcrumb, based on the path.
 */
function LaborSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <LaborSectionHeader />
      {children}
    </div>
  );
}

/**
 * Client-side equivalent of the web pages' server-side permission redirect.
 * Sends the user to the dashboard rather than rendering a screen whose every
 * control would fail — see the note on enforcement above.
 */
function Guard({ need, children }: { need: Permission; children: React.ReactNode }) {
  const can = useCan();
  if (!can(need)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/** Mirrors the greeting computed in src/app/(app)/dashboard/page.tsx. */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
