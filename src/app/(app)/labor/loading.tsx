import { Skeleton } from "@/components/ui/skeleton";
import { RowsSkeleton } from "@/components/patterns/loading-state";

export default function LaborLoading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <RowsSkeleton rows={6} />
    </div>
  );
}
