import { Skeleton } from "@/components/ui/skeleton";
import { StatGridSkeleton, RowsSkeleton } from "@/components/patterns/loading-state";

export default function ProcurementLoading() {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
      <StatGridSkeleton count={4} />
      <RowsSkeleton rows={6} />
    </div>
  );
}
