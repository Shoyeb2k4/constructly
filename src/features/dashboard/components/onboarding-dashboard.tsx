import Link from "next/link";
import { FolderKanban, HardHat, Truck, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const STEPS = [
  { icon: FolderKanban, title: "Create a project", desc: "Set up your first site with budget and deadlines.", href: "/projects" },
  { icon: HardHat, title: "Set up labour", desc: "Create labour categories and record daily attendance.", href: "/labor" },
  { icon: Truck, title: "Add vendors", desc: "Set up suppliers and raise purchase orders.", href: "/vendors" },
];

export function OnboardingDashboard({ firstName }: { firstName: string }) {
  return (
    <div className="mx-auto max-w-3xl py-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome, {firstName}</h1>
      <p className="mx-auto mt-2 max-w-md text-foreground-muted">
        Let&apos;s set up your workspace. Create your first project and your dashboard will come to life.
      </p>
      <div className="mt-6">
        <Button asChild variant="primary">
          <Link href="/projects">
            Create your first project
            <ArrowRight />
          </Link>
        </Button>
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {STEPS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-xl border border-border bg-surface p-5 text-left transition-all hover:shadow-[0_2px_12px_rgba(16,18,29,0.06)]"
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-surface-muted text-foreground-subtle">
              <s.icon className="size-4" />
            </span>
            <p className="mt-3 text-sm font-semibold">{s.title}</p>
            <p className="mt-1 text-xs text-foreground-muted">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
