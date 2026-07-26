import { cn } from "@/lib/utils";

/**
 * Brand mark. With a company `src` logo it shows that logo + the company name;
 * without one it falls back to the Constructly wordmark (§4). `name` defaults
 * to "Constructly".
 */
export function Logo({
  className,
  showText = true,
  src,
  name,
}: {
  className?: string;
  showText?: boolean;
  src?: string | null;
  name?: string | null;
}) {
  const hasLogo = !!src;
  const label = hasLogo ? name?.trim() || "Company" : "Constructly";

  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      {hasLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL
        <img src={src!} alt={label} className="size-7 rounded-[7px] object-contain" />
      ) : (
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
      )}
      {showText && (
        <span className="text-[15px] font-semibold tracking-tight">{label}</span>
      )}
    </span>
  );
}
