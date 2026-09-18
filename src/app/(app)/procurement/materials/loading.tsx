import { Skeleton } from "@/components/ui/skeleton";
import { RowsSkeleton } from "@/components/patterns/loading-state";

export default function MaterialMasterLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-36" />
      </div>
      <RowsSkeleton rows={5} />
    </div>
  );
}
