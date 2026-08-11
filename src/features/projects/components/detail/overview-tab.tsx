"use client";

import * as React from "react";
import {
  MapPin,
  User as UserIcon,
  Building2,
  Phone,
  Mail,
  CalendarDays,
  ExternalLink,
  HardHat,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TagChip } from "../tag-chip";
import { BudgetCard } from "./budget-card";
import { SectionEditButton } from "./section-edit-sheet";
import { ClientSiteEditSheet } from "./client-site-edit-sheet";
import { DetailsEditSheet } from "./details-edit-sheet";
import { LocationEditSheet } from "./location-edit-sheet";
import { ContractorsEditSheet } from "./contractors-edit-sheet";
import type { ProjectDetail } from "../../types";
import { TYPE_LABEL } from "../../constants";
import { formatDate, deadlineCountdown } from "../../format";

function Line({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="flex items-center gap-2 text-sm text-foreground-muted">
        <Icon className="size-4 text-foreground-subtle" />
        {label}
      </span>
      <span className="truncate text-sm font-medium">{value || "—"}</span>
    </div>
  );
}

type Section = "client" | "details" | "location" | "contractors";

export function OverviewTab({
  project,
  canEdit = false,
}: {
  project: ProjectDetail;
  canEdit?: boolean;
}) {
  const cd = deadlineCountdown(project.expectedCompletionDate);
  const [editing, setEditing] = React.useState<Section | null>(null);
  const toggle = (s: Section) => (o: boolean) => setEditing(o ? s : null);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <BudgetCard
          projectId={project.id}
          budgetPaise={project.budgetPaise}
          contractValuePaise={project.contractValuePaise}
          procurementBudgetPaise={project.procurementBudgetPaise}
          canEdit={canEdit}
        />

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Client &amp; site</CardTitle>
            {canEdit && (
              <SectionEditButton label="Edit client & site" onClick={() => setEditing("client")} />
            )}
          </CardHeader>
          <CardContent className="divide-y divide-border py-0">
            <Line icon={Building2} label="Client" value={project.clientName} />
            <Line icon={UserIcon} label="Contact" value={project.clientContact} />
            <Line icon={Phone} label="Phone" value={project.clientPhone} />
            <Line icon={Mail} label="Email" value={project.clientEmail} />
            <Line icon={MapPin} label="Site address" value={project.siteAddress} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Contractors</CardTitle>
            {canEdit && (
              <SectionEditButton label="Edit contractors" onClick={() => setEditing("contractors")} />
            )}
          </CardHeader>
          <CardContent className="py-0">
            {project.contractorAssignments.length === 0 ? (
              <p className="py-4 text-sm text-foreground-subtle">
                No contractors assigned yet.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {project.contractorAssignments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                      <HardHat className="size-4 shrink-0 text-foreground-subtle" />
                      <span className="truncate">{a.contractorName}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-sm text-foreground-muted">
                      <span
                        className="size-2 rounded-full"
                        style={{ background: a.categoryColor ?? "var(--color-foreground-subtle)" }}
                      />
                      {a.categoryName}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Details</CardTitle>
            {canEdit && (
              <SectionEditButton label="Edit details" onClick={() => setEditing("details")} />
            )}
          </CardHeader>
          <CardContent className="divide-y divide-border py-0">
            <Line icon={Building2} label="Type" value={TYPE_LABEL[project.type]} />
            <Line icon={UserIcon} label="Manager" value={project.pm?.fullName} />
            <Line
              icon={CalendarDays}
              label="Deadline"
              value={
                <span className={cd.tone === "danger" ? "text-danger-foreground" : undefined}>
                  {cd.label}
                </span>
              }
            />
            <Line icon={CalendarDays} label="Start" value={formatDate(project.startDate)} />
            <Line
              icon={CalendarDays}
              label="Completion"
              value={formatDate(project.expectedCompletionDate)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Location</CardTitle>
            {canEdit && (
              <SectionEditButton label="Edit location" onClick={() => setEditing("location")} />
            )}
          </CardHeader>
          <CardContent>
            {project.gpsLat != null && project.gpsLng != null ? (
              <div className="space-y-2">
                <p className="font-mono text-sm">
                  {project.gpsLat.toFixed(4)}, {project.gpsLng.toFixed(4)}
                </p>
                <a
                  href={`https://www.google.com/maps?q=${project.gpsLat},${project.gpsLng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  View on map <ExternalLink className="size-3.5" />
                </a>
              </div>
            ) : (
              <p className="text-sm text-foreground-subtle">No GPS location set.</p>
            )}
          </CardContent>
        </Card>

        {project.tags.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Tags</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {project.tags.map((t) => (
                <TagChip key={t} label={t} />
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {canEdit && (
        <>
          <ClientSiteEditSheet
            project={project}
            open={editing === "client"}
            onOpenChange={toggle("client")}
          />
          <DetailsEditSheet
            project={project}
            open={editing === "details"}
            onOpenChange={toggle("details")}
          />
          <LocationEditSheet
            projectId={project.id}
            gpsLat={project.gpsLat}
            gpsLng={project.gpsLng}
            open={editing === "location"}
            onOpenChange={toggle("location")}
          />
          <ContractorsEditSheet
            projectId={project.id}
            initial={project.contractorAssignments}
            open={editing === "contractors"}
            onOpenChange={toggle("contractors")}
          />
        </>
      )}
    </div>
  );
}
