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
import { MoneyText } from "@/components/patterns/money-text";
import { TagChip } from "../tag-chip";
import { BudgetMeter } from "../budget-meter";
import type { ProjectDetail } from "../../types";
import { TYPE_LABEL } from "../../constants";
import { formatDate, deadlineCountdown, budgetPct } from "../../format";

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

export function OverviewTab({ project }: { project: ProjectDetail }) {
  const remaining = project.budgetPaise - project.usedPaise;
  const pct = budgetPct(project.usedPaise, project.budgetPaise);
  const cd = deadlineCountdown(project.expectedCompletionDate);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Budget</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-foreground-subtle">Used</p>
                <p className="text-2xl font-semibold">
                  <MoneyText paise={project.usedPaise} compact />
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-foreground-subtle">Budget</p>
                <p className="text-lg font-medium">
                  <MoneyText paise={project.budgetPaise} compact />
                </p>
              </div>
            </div>
            <BudgetMeter usedPaise={project.usedPaise} budgetPaise={project.budgetPaise} />
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground-muted">{pct}% deployed</span>
              <span className={remaining < 0 ? "text-danger-foreground" : "text-success-foreground"}>
                {remaining < 0 ? "Over by " : "Remaining "}
                <MoneyText paise={Math.abs(remaining)} compact />
              </span>
            </div>
            <div className="border-t border-border pt-3">
              <Line icon={Building2} label="Contract value" value={<MoneyText paise={project.contractValuePaise} compact />} />
            </div>
          </CardContent>
        </Card>

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
            <Line icon={CalendarDays} label="Completion" value={formatDate(project.expectedCompletionDate)} />
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
