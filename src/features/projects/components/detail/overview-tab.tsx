import {
  MapPin,
  User as UserIcon,
  Building2,
  Phone,
  Mail,
  CalendarDays,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TagChip } from "../tag-chip";
import { BudgetCard } from "./budget-card";
import { DeadlineEditor } from "./deadline-editor";
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

export function OverviewTab({
  project,
  canEdit = false,
}: {
  project: ProjectDetail;
  canEdit?: boolean;
}) {
  const cd = deadlineCountdown(project.expectedCompletionDate);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <BudgetCard
          projectId={project.id}
          budgetPaise={project.budgetPaise}
          contractValuePaise={project.contractValuePaise}
          procurementBudgetPaise={project.procurementBudgetPaise}
        />

        <Card>
          <CardHeader>
            <CardTitle>Client &amp; site</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border py-0">
            <Line icon={Building2} label="Client" value={project.clientName} />
            <Line icon={UserIcon} label="Contact" value={project.clientContact} />
            <Line icon={Phone} label="Phone" value={project.clientPhone} />
            <Line icon={Mail} label="Email" value={project.clientEmail} />
            <Line icon={MapPin} label="Site address" value={project.siteAddress} />
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
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
            <DeadlineEditor
              projectId={project.id}
              startDate={project.startDate}
              expectedCompletionDate={project.expectedCompletionDate}
              canEdit={canEdit}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Location</CardTitle>
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
    </div>
  );
}
