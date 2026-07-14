"use client";

import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Placeholder CTA used on module pages during the foundation phase. */
export function ComingSoonButton({
  label,
  module,
}: {
  label: string;
  module: string;
}) {
  return (
    <Button
      variant="primary"
      onClick={() =>
        toast(`${module} module is coming next`, {
          description: "This screen is wired and styled — data lands in its module.",
        })
      }
    >
      <Plus />
      {label}
    </Button>
  );
}
