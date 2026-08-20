import { Skeleton } from "@/components/ui/skeleton";
import { StatGridSkeleton, RowsSkeleton } from "@/components/patterns/loading-state";

export default function PaymentsLoading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <StatGridSkeleton count={4} />
      <RowsSkeleton rows={6} />
    </div>
  );
}
