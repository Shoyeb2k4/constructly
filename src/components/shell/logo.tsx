import { cn } from "@/lib/utils";

/** Constructly wordmark with a blueprint-grid mark. */
export function Logo({
  className,
  showText = true,
}: {
  className?: string;
  showText?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span className="flex size-7 items-center justify-center rounded-[7px] bg-primary text-primary-foreground shadow-sm">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
          <path
            d="M4 20V7l8-4 8 4v13"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M9 20v-6h6v6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {showText && (
        <span className="text-[15px] font-semibold tracking-tight">
          Constructly
        </span>
      )}
    </span>
  );
}
