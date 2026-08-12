import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { AttendanceView } from "@/features/labor/components/attendance/attendance-view";

export const metadata: Metadata = { title: "Attendance" };

export default async function AttendancePage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, "attendance.view")) redirect("/dashboard");
  // AttendanceView reads `?project=` via useSearchParams, which requires a
  // Suspense boundary (otherwise the route bails to full client rendering).
  return (
    <Suspense>
      <AttendanceView />
    </Suspense>
  );
}
