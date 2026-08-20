"use client";

/**
 * The global Payments Centre.
 *
 * One place to FIND a financial transaction, without pretending the four
 * instruments mean the same thing. A vendor payment, an agreement payment, a
 * settlement's net cash and a contractor advance are all cash that left the
 * company — so they share a list — but each keeps its own name, its own source
 * record and its own reversal rules, all of which this screen states rather
 * than smooths over.
 *
 * Two things it is NOT:
 *
 *   Not a ledger. Advance drawdowns, scope transfers and attribution
 *   corrections carry rupee amounts and are excluded, because they move no
 *   cash. They stay in the source module's audit history where they belong.
 *
 *   Not Reports. There is no pivot table and no chart wall here: a few movement
 *   summaries, then the list. Analysis is a different job.
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Banknote,
  HandCoins,
  Inbox,
  Search,
  SlidersHorizontal,
  Truck,
  Undo2,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { RowsSkeleton, StatGridSkeleton } from "@/components/patterns/loading-state";
import { StatCard } from "@/components/patterns/stat-card";
import { Callout } from "@/components/patterns/callout";
import { MoneyText } from "@/components/patterns/money-text";
import { DataTable, type DataColumn } from "@/components/patterns/data-table";
import { Toolbar, ToolbarGroup, ToolbarSpacer } from "@/components/patterns/toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProjects } from "@/features/projects/hooks";
import { formatDate } from "@/features/projects/format";
import { PAYMENT_MODE_LABEL } from "@/features/procurement/constants";
import { countActiveFilters, filterTransactions, resolvePeriod, summarisePayments } from "../assemble";
import {
  PERIOD_PRESETS,
  STATUS_META,
  TRANSACTION_TYPES,
  TRANSACTION_TYPE_ICON,
  TRANSACTION_TYPE_LABEL,
} from "../constants";
import { usePaymentsCentre } from "../hooks";
import type {
  PaymentTransaction,
  PaymentsFilters,
  PaymentsSnapshot,
  PaymentsVisibility,
  PeriodPreset,
} from "../types";
import { PaymentsFilterSheet } from "./payments-filter-sheet";
import { TransactionDetailSheet } from "./transaction-detail-sheet";

/**
 * Above this many rows the table windows itself. Below it, windowing costs a
 * scroll container and a height estimate to solve a problem that does not
 * exist — a month of payments at any realistic company is a few dozen rows.
 * A financial year, or All time at an established company, is where it earns
 * its keep.
 */
const VIRTUALIZE_ABOVE = 150;

function TypeCell({ t }: { t: PaymentTransaction }) {
  const Icon = TRANSACTION_TYPE_ICON[t.type];
  return (
    <span className="flex items-center gap-2">
      {/* Classification, not severity — every type renders identically. */}
      <Icon className="size-4 shrink-0 text-foreground-subtle" aria-hidden="true" />
      <span className="min-w-0 truncate">{TRANSACTION_TYPE_LABEL[t.type]}</span>
    </span>
  );
}

export function PaymentsView({
  userId,
  isOwner,
  visibility,
  initialData,
}: {
  userId: string;
  isOwner: boolean;
  visibility: PaymentsVisibility;
  initialData?: PaymentsSnapshot;
}) {
  // Today is pinned from the server snapshot where there is one, so the period
  // a total is labelled with cannot differ between server and client render.
  const [today] = React.useState(
    () => initialData?.today ?? new Date().toISOString().slice(0, 10),
  );
  const [preset, setPreset] = React.useState<PeriodPreset>("THIS_MONTH");
  const [custom, setCustom] = React.useState<{ from: string; to: string }>({ from: "", to: "" });
  const [filters, setFilters] = React.useState<PaymentsFilters>({});
  const [searchInput, setSearchInput] = React.useState("");
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<PaymentTransaction | null>(null);

  const period = React.useMemo(
    () => resolvePeriod(preset, today, custom),
    [preset, today, custom],
  );

  // Debounced so typing does not re-filter on every keystroke.
  React.useEffect(() => {
    const id = setTimeout(() => {
      const s = searchInput.trim() || undefined;
      setFilters((f) => (f.search === s ? f : { ...f, search: s }));
    }, 250);
    return () => clearTimeout(id);
  }, [searchInput]);

  const { data, isLoading, isFetching } = usePaymentsCentre(
    userId,
    isOwner,
    visibility,
    period,
    // Only the period the server actually rendered may adopt the server
    // snapshot; handing it to a different period would label one month's rows
    // with another month's dates.
    initialData && initialData.from === period.from && initialData.to === period.to
      ? initialData
      : undefined,
  );
  const { data: projects = [] } = useProjects({});

  const transactions = React.useMemo(() => data?.transactions ?? [], [data]);
  const summary = React.useMemo(
    () => summarisePayments(transactions, period),
    [transactions, period],
  );
  const rows = React.useMemo(
    () => filterTransactions(transactions, filters),
    [transactions, filters],
  );
  const activeFilterCount = countActiveFilters(filters);

  const patch = React.useCallback(
    (p: Partial<PaymentsFilters>) => setFilters((f) => ({ ...f, ...p })),
    [],
  );
  const clearAll = React.useCallback(() => {
    setFilters({});
    setSearchInput("");
  }, []);

  const columns: DataColumn<PaymentTransaction>[] = React.useMemo(
    () => [
      {
        key: "party",
        header: "Paid to",
        cell: (t) => (
          <button
            type="button"
            onClick={() => setDetail(t)}
            className="block min-w-0 max-w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="block truncate font-medium">{t.party.name}</span>
            <span className="block truncate text-xs text-foreground-subtle">
              {t.scopeLabel ?? t.source.label}
            </span>
            {/* Says what the control DOES. The visible text names the party but
                not the action, and a button announced as a name alone gives a
                screen-reader user no idea that activating it opens anything. */}
            <span className="sr-only">— open payment details</span>
          </button>
        ),
      },
      { key: "type", header: "Type", cell: (t) => <TypeCell t={t} /> },
      {
        key: "date",
        header: "Date",
        hideBelow: "lg",
        cell: (t) => <span className="whitespace-nowrap">{formatDate(t.date)}</span>,
      },
      {
        key: "project",
        header: "Project",
        hideBelow: "xl",
        cell: (t) =>
          t.project ? (
            <Link
              href={`/projects/${t.project.id}`}
              className="block truncate text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {t.project.name}
            </Link>
          ) : (
            <span className="text-foreground-subtle">No project</span>
          ),
      },
      {
        key: "mode",
        header: "Mode",
        hideBelow: "xl",
        cell: (t) =>
          t.paymentMode ? (
            PAYMENT_MODE_LABEL[t.paymentMode]
          ) : (
            <span className="text-foreground-subtle">—</span>
          ),
      },
      {
        key: "amount",
        header: "Amount",
        numeric: true,
        cell: (t) => (
          <MoneyText
            paise={t.amountPaise}
            className={t.status === "REVERSED" ? "text-foreground-subtle line-through" : undefined}
          />
        ),
      },
      {
        key: "status",
        header: "Status",
        hideBelow: "md",
        cell: (t) =>
          // An ordinary payment is history, not an achievement — so the neutral
          // state carries no badge at all and only a reversal stands out.
          t.status === "REVERSED" ? (
            <Badge variant={STATUS_META.REVERSED.tone}>{STATUS_META.REVERSED.label}</Badge>
          ) : (
            <span className="text-xs text-foreground-subtle">{STATUS_META.ACTIVE.label}</span>
          ),
      },
      {
        key: "source",
        header: "Source",
        headerHidden: true,
        cell: (t) => (
          <Link
            href={t.source.href}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center justify-end gap-1 whitespace-nowrap text-[13px] text-primary hover:underline"
          >
            <span className="hidden lg:inline">Open {t.source.label}</span>
            <span className="lg:hidden">Open</span>
            <ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />
          </Link>
        ),
      },
    ],
    [],
  );

  const renderCard = React.useCallback(
    (t: PaymentTransaction) => (
      <div className="min-w-0 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => setDetail(t)}
            className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="block truncate font-medium">{t.party.name}</span>
            <span className="mt-0.5 block text-xs text-foreground-muted">
              {TRANSACTION_TYPE_LABEL[t.type]}
            </span>
            <span className="sr-only">— open payment details</span>
          </button>
          <span className="shrink-0 text-right">
            <MoneyText
              paise={t.amountPaise}
              className={
                t.status === "REVERSED"
                  ? "font-medium text-foreground-subtle line-through"
                  : "font-medium"
              }
            />
            <span className="mt-0.5 block text-xs text-foreground-subtle">
              {formatDate(t.date)}
            </span>
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-subtle">
          <span className="min-w-0 truncate">{t.project?.name ?? t.scopeLabel ?? "No project"}</span>
          {t.status === "REVERSED" && (
            <Badge variant={STATUS_META.REVERSED.tone}>{STATUS_META.REVERSED.label}</Badge>
          )}
        </div>
        <Link
          href={t.source.href}
          className="mt-3 inline-flex items-center gap-1 text-[13px] text-primary hover:underline"
        >
          Open {t.source.label}
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    ),
    [],
  );

  // Pending is not empty. Until the first snapshot resolves, the page shows its
  // own shape rather than claiming the company has never paid anyone.
  if (isLoading || !data) {
    return (
      <div className="space-y-8">
        <PageHeader title="Payments" description="Every payment recorded across Constructly." />
        <StatGridSkeleton count={4} />
        <RowsSkeleton rows={6} />
      </div>
    );
  }

  // The genuine onboarding case: nothing has ever been recorded, in any period.
  if (!data.hasAnyPayments) {
    return (
      <div className="space-y-8">
        <PageHeader title="Payments" description="Every payment recorded across Constructly." />
        <EmptyState
          icon={Banknote}
          title="No payments recorded yet"
          description="Payments recorded through Contractors and Procurement appear here. This page collects them; it is not where they are created."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {visibility.contractorLedger && (
                <Button asChild variant="secondary">
                  <Link href="/labor/contractors">Go to Contractors</Link>
                </Button>
              )}
              {visibility.vendorPayments && (
                <Button asChild variant="secondary">
                  <Link href="/procurement">Go to Procurement</Link>
                </Button>
              )}
            </div>
          }
        />
      </div>
    );
  }

  const periodControls = (
    <ToolbarGroup>
      <Label htmlFor="payments-period" className="sr-only">
        Period
      </Label>
      <Select value={preset} onValueChange={(v) => setPreset(v as PeriodPreset)}>
        <SelectTrigger id="payments-period" className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PERIOD_PRESETS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {preset === "CUSTOM" && (
        <>
          <Label htmlFor="payments-from" className="sr-only">
            From date
          </Label>
          <Input
            id="payments-from"
            type="date"
            className="w-36"
            value={custom.from}
            onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
          />
          <Label htmlFor="payments-to" className="sr-only">
            To date
          </Label>
          <Input
            id="payments-to"
            type="date"
            className="w-36"
            value={custom.to}
            onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
          />
        </>
      )}
    </ToolbarGroup>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Every payment recorded across Constructly, with the record it came from."
        meta={
          <span>
            Showing <span className="font-medium text-foreground">{period.label}</span>
            {isFetching && <span className="ml-2 text-foreground-subtle">Updating…</span>}
          </span>
        }
      />

      <Tabs defaultValue="transactions">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 pt-5">
          <Toolbar aria-label="Payments period">{periodControls}</Toolbar>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={`Paid · ${period.label}`}
              value={<MoneyText paise={summary.paidPaise} />}
              icon={Banknote}
              hint={`${summary.paidCount} ${summary.paidCount === 1 ? "transaction" : "transactions"}, reversals excluded`}
            />
            <StatCard
              label={`To contractors · ${period.label}`}
              value={<MoneyText paise={summary.contractorPaidPaise} />}
              icon={HandCoins}
              hint="Advances, agreement payments and settlement cash"
            />
            <StatCard
              label={`To vendors · ${period.label}`}
              value={<MoneyText paise={summary.vendorPaidPaise} />}
              icon={Truck}
              hint="Against purchase orders and on account"
            />
            <StatCard
              label={`Reversed · ${period.label}`}
              value={<MoneyText paise={summary.reversedPaise} />}
              icon={Undo2}
              tone={summary.reversedCount > 0 ? "attention" : "default"}
              hint={
                summary.reversedCount > 0
                  ? `${summary.reversedCount} reversed, and not counted above`
                  : "Nothing reversed in this period"
              }
            />
          </div>

          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-sm font-medium">By instrument · {period.label}</h2>
            <p className="mt-0.5 text-xs text-foreground-subtle">
              Active cash only. Each transaction is counted exactly once.
            </p>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
              {summary.byType.map((row) => {
                const Icon = TRANSACTION_TYPE_ICON[row.type];
                return (
                  <div
                    key={row.type}
                    className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2 last:border-0 sm:last:border-b sm:[&:nth-last-child(-n+2)]:border-0"
                  >
                    <dt className="flex min-w-0 items-center gap-2 text-sm text-foreground-muted">
                      <Icon className="size-4 shrink-0 text-foreground-subtle" aria-hidden="true" />
                      <span className="min-w-0 truncate">{TRANSACTION_TYPE_LABEL[row.type]}</span>
                      <span className="shrink-0 text-xs text-foreground-subtle">({row.count})</span>
                    </dt>
                    <dd className="shrink-0 text-sm font-medium">
                      <MoneyText paise={row.amountPaise} />
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>

          <Callout tone="info" title="What counts as a payment here">
            <p>
              Only cash that actually moved. An advance drawn down by a settlement, a
              re-scope of unused advance money and an attribution correction all carry
              rupee amounts, and none of them is counted — no money changed hands. A
              settlement appears once, for the net cash it paid.
            </p>
            <p className="mt-1">
              This page does not add up what is owed. Vendor <em>still owed</em> and
              contractor <em>currently due</em> rest on different commercial bases and
              live in their own modules.
            </p>
          </Callout>
        </TabsContent>

        <TabsContent value="transactions" className="space-y-4 pt-5">
          <Toolbar aria-label="Transaction filters">
            <ToolbarGroup grow>
              <Label htmlFor="payments-search" className="sr-only">
                Search payments
              </Label>
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle"
                  aria-hidden="true"
                />
                <Input
                  id="payments-search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Party, project, order, reference…"
                  className="pl-9"
                />
              </div>
            </ToolbarGroup>

            {periodControls}

            <ToolbarGroup>
              <Label htmlFor="payments-project" className="sr-only">
                Project
              </Label>
              <Select
                value={filters.projectId ?? "ALL"}
                onValueChange={(v) => patch({ projectId: v })}
              >
                <SelectTrigger id="payments-project" className="w-44">
                  <SelectValue placeholder="All projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All projects</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Label htmlFor="payments-type" className="sr-only">
                Type
              </Label>
              <Select
                value={filters.type ?? "ALL"}
                onValueChange={(v) => patch({ type: v as NonNullable<PaymentsFilters["type"]> })}
              >
                <SelectTrigger id="payments-type" className="w-44">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All types</SelectItem>
                  {TRANSACTION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TRANSACTION_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ToolbarGroup>

            <ToolbarSpacer />

            <ToolbarGroup>
              <Button variant="secondary" onClick={() => setFilterOpen(true)}>
                <SlidersHorizontal className="size-4" />
                More filters
                {activeFilterCount > 0 && (
                  <Badge variant="primary" className="ml-1">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
              {activeFilterCount > 0 && (
                <Button variant="ghost" onClick={clearAll}>
                  <X className="size-4" />
                  Clear
                </Button>
              )}
            </ToolbarGroup>
          </Toolbar>

          <p className="text-[13px] text-foreground-muted">
            {rows.length} of {transactions.length}{" "}
            {transactions.length === 1 ? "transaction" : "transactions"} in {period.label}
          </p>

          <DataTable
            columns={columns}
            rows={rows}
            getRowKey={(t) => t.id}
            caption={`Payments — ${period.label}`}
            renderCard={renderCard}
            virtualize={
              rows.length > VIRTUALIZE_ABOVE
                ? { estimateRowHeight: 64, maxHeight: "calc(100vh - 24rem)" }
                : undefined
            }
            empty={
              <EmptyState
                icon={Inbox}
                title={
                  activeFilterCount > 0
                    ? "No payments match these filters"
                    : `No payments in ${period.label}`
                }
                description={
                  activeFilterCount > 0
                    ? "Clear a filter, or widen the period."
                    : "Payments exist in other periods. Widen the period to find them."
                }
                action={
                  activeFilterCount > 0 ? (
                    <Button variant="secondary" onClick={clearAll}>
                      Clear filters
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => setPreset("ALL_TIME")}>
                      Show all time
                    </Button>
                  )
                }
              />
            }
          />
        </TabsContent>
      </Tabs>

      <PaymentsFilterSheet
        open={filterOpen}
        onOpenChange={setFilterOpen}
        filters={filters}
        onChange={patch}
        onClear={clearAll}
      />
      <TransactionDetailSheet
        transaction={detail}
        onOpenChange={(open) => !open && setDetail(null)}
      />
    </div>
  );
}
