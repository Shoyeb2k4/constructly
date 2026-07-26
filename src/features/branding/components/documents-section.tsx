"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";
import { useBrandingAssetUrls } from "../hooks";
import { AssetUploader } from "./asset-uploader";

export function DocumentsSection({ isOwner }: { isOwner: boolean }) {
  const { data: urls } = useBrandingAssetUrls();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Company stamp</CardTitle>
          <CardDescription>Printed automatically on generated PDFs alongside the signature.</CardDescription>
        </CardHeader>
        <CardContent>
          {isOwner ? (
            <div className="max-w-xs">
              <AssetUploader kind="stamp" currentUrl={urls?.stamp} label="Official stamp" previewBg="light" />
            </div>
          ) : (
            <p className="text-sm text-foreground-subtle">Only the owner can manage the company stamp.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>PDF branding</CardTitle>
          <CardDescription>What every generated PDF includes.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 rounded-lg border border-border bg-surface-muted/40 p-4">
            <FileText className="mt-0.5 size-5 shrink-0 text-foreground-subtle" />
            <div className="space-y-1 text-sm text-foreground-muted">
              <p>
                Purchase orders, reports, and ledgers automatically carry your company logo, name, address,
                GST, phone, email and website in the header, and the generated date, &ldquo;prepared by&rdquo;,
                signature and stamp in the footer.
              </p>
              <p className="text-xs text-foreground-subtle">
                Set these under Company and Appearance. Companies without branding use Constructly defaults.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Numbering</CardTitle>
          <CardDescription>Document number formats.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-foreground-muted">
          Purchase orders are numbered automatically (PO-0001, PO-0002, …). Custom prefixes and invoice/
          quotation numbering will appear here as those documents are added.
        </CardContent>
      </Card>
    </div>
  );
}
