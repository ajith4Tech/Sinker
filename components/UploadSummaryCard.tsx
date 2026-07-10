import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { UploadSummaryEvent } from "@/lib/types";

/**
 * Shown immediately after upload, before any PDF is parsed — a direct
 * render of the "upload_summary" event scripts/parser.py emits right after
 * hashing every file against data/state.json.
 */
export function UploadSummaryCard({ summary }: { summary: UploadSummaryEvent }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Upload Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-center sm:grid-cols-4">
          <Stat label="Uploaded PDFs" value={summary.uploadedPdfs} />
          <Stat label="New PDFs" value={summary.newPdfs} />
          <Stat label="Already Processed" value={summary.alreadyProcessedPdfs} />
          <Stat label="Changed PDFs" value={summary.changedPdfs} />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
