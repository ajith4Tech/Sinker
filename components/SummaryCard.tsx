import { CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { ExtractSummary } from "@/lib/types";

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export function SummaryCard({
  summary,
  templateUsed,
}: {
  summary: ExtractSummary;
  templateUsed: "default" | "custom" | "persistent";
}) {
  const templateLabel =
    templateUsed === "custom" ? "Custom" : templateUsed === "persistent" ? "Persistent workbook" : "Default";

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex items-center gap-2 text-success">
          <CheckCircle2 className="h-5 w-5" />
          <p className="font-medium">Extraction completed successfully</p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Processed PDFs" value={summary.successfulPdfs} />
          <Stat label="Skipped PDFs" value={summary.skippedPdfs} />
          <Stat label="Changed PDFs" value={summary.changedPdfs} />
          <Stat label="Failed PDFs" value={summary.failedPdfs} />
          <Stat label="Rows Added" value={summary.rowsAppended} />
          <Stat label="Duplicate Rows Skipped" value={summary.rowsSkipped} />
          <Stat label="Workbook Total Rows" value={summary.workbookTotalRows} />
          <Stat label="Processing Time" value={formatElapsed(summary.processingTimeMs)} />
          <Stat label="Template Used" value={templateLabel} />
        </div>
      </CardContent>
    </Card>
  );
}
