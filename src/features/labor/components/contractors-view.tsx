"use client";

import * as React from "react";
import { Plus, Truck, Phone, MoreHorizontal, UserX, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MoneyText } from "@/components/patterns/money-text";
import { EmptyState } from "@/components/patterns/empty-state";
import { RowsSkeleton } from "@/components/patterns/loading-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useContractors, useContractorMutations } from "../hooks";
import { AddContractorSheet } from "./add-contractor-sheet";

export function ContractorsView() {
  const { data: contractors = [], isLoading } = useContractors();
  const { setStatus } = useContractorMutations();
  const [addOpen, setAddOpen] = React.useState(false);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setAddOpen(true)}>
          <Plus />
          Add contractor
        </Button>
      </div>

      {isLoading ? (
        <RowsSkeleton rows={3} />
      ) : contractors.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No contractors yet"
          description="Add labor contractors to group workers and track cost by contractor."
          action={<Button variant="primary" size="sm" onClick={() => setAddOpen(true)}><Plus />Add contractor</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {contractors.map((c) => (
            <Card key={c.id} className="p-5">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.name}</p>
                  {c.phone && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-foreground-subtle">
                      <Phone className="size-3" /> {c.phone}
                    </p>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8 text-foreground-subtle" aria-label="Actions">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => setStatus.mutate({ id: c.id, status: c.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })}
                    >
                      {c.status === "ACTIVE" ? <UserX /> : <UserCheck />}
                      {c.status === "ACTIVE" ? "Deactivate" : "Activate"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <p className="text-xs text-foreground-subtle">Workers</p>
                  <p className="text-lg font-semibold">{c.laborerCount}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-foreground-subtle">Labor cost</p>
                  <p className="font-mono text-sm font-medium">
                    <MoneyText paise={c.laborCostPaise} compact />
                  </p>
                </div>
              </div>
              {c.status === "INACTIVE" && (
                <Badge variant="neutral" className="mt-3">Inactive</Badge>
              )}
            </Card>
          ))}
        </div>
      )}

      <AddContractorSheet open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
