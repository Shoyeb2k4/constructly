import { LaborSectionHeader } from "@/features/labor/components/labor-section-header";

export default function LaborLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      {/* Renders the section title + tabs on list screens and a compact
          breadcrumb on a record, so a record page carries ONE page title —
          its own — instead of three stacked ones. */}
      <LaborSectionHeader />
      {children}
    </div>
  );
}
