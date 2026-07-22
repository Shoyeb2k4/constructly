import { Skeleton } from "@/components/ui/skeleton";
import { RowsSkeleton } from "@/components/patterns/loading-state";

export default function VendorsLoading() {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-4 w-60" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
      <RowsSkeleton rows={6} />
    </div>
  );
}
