import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { AttendanceView } from "@/features/labor/components/attendance/attendance-view";

export const metadata: Metadata = { title: "Attendance" };

export default async function AttendancePage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, "attendance.view")) redirect("/dashboard");
  return <AttendanceView />;
}
