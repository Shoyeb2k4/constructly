"use client";

/**
 * The Labour section's own chrome — shown on the section's LIST screens, and
 * deliberately absent on a record page.
 *
 * A contractor detail used to carry three stacked title systems: the layout's
 * "Labor" heading and its sub-nav, then a "← Contractors" link, then the
 * contractor's own name. Together with the action row and the tab strip that
 * pushed the first financial figure to y=828 on an 812px-tall phone — an entire
 * screen of navigation before any information.
 *
 * A record page already knows where it is, so here it gets a single compact
 * breadcrumb instead, and the record's own header does the rest.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { LaborNav } from "./labor-nav";

/** Record routes: anything below a Labour list, e.g. /labor/contractors/c-1. */
function isRecordRoute(pathname: string): boolean {
  return /^\/labor\/contractors\/[^/]+$/.test(pathname);
}

export function LaborSectionHeader() {
  const pathname = usePathname();

  if (isRecordRoute(pathname)) {
    return (
      <nav aria-label="Breadcrumb" className="text-sm">
        <ol className="flex items-center gap-1 text-foreground-muted">
          <li>
            <Link href="/labor" className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Labor
            </Link>
          </li>
          <ChevronRight className="size-3.5 text-foreground-subtle" aria-hidden="true" />
          <li>
            <Link
              href="/labor/contractors"
              className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Contractors
            </Link>
          </li>
        </ol>
      </nav>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Labor</h1>
        <p className="text-sm text-foreground-muted">
          Workers, contractors, and daily attendance.
        </p>
      </div>
      <LaborNav />
    </div>
  );
}
