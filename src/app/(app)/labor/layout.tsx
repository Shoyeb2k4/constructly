import { LaborNav } from "@/features/labor/components/labor-nav";

export default function LaborLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Labor</h1>
        <p className="text-sm text-foreground-muted">
          Workers, contractors, and daily attendance.
        </p>
      </div>
      <LaborNav />
      {children}
    </div>
  );
}
