import { cn } from "@/lib/utils";

type LoadingSkeletonProps = {
  className?: string;
};

export function LoadingSkeleton({ className }: LoadingSkeletonProps) {
  return <div className={cn("animate-pulse rounded-xl bg-[rgba(255,255,255,0.08)]", className)} />;
}

export function TableLoadingSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <LoadingSkeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}
