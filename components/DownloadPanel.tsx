import { Button } from "@/components/ui/button";

/**
 * Downloads whichever files scripts/parser.py already generated for this
 * run — never regenerates anything. downloadUrl/errorReportUrl point at a
 * one-shot download route that serves the file already sitting in
 * temp/output/<runId>/.
 */
export function DownloadPanel({
  downloadUrl,
  errorReportUrl,
}: {
  downloadUrl: string;
  errorReportUrl: string | null;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild size="lg" className="h-14 flex-1 text-lg">
        <a href={downloadUrl}>Download Updated Excel</a>
      </Button>
      {errorReportUrl && (
        <Button asChild variant="outline" size="lg" className="h-14">
          <a href={errorReportUrl}>Download Error Report</a>
        </Button>
      )}
    </div>
  );
}
