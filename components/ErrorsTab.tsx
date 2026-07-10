import { Badge } from "@/components/ui/badge";
import type { LogEntry } from "@/lib/types";

/** Only rendered as a tab when at least one Failed entry exists (see SinkerApp). */
export function ErrorsTab({ entries }: { entries: LogEntry[] }) {
  return (
    <div className="overflow-x-auto rounded border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Filename</th>
            <th className="px-3 py-2 font-medium">Completed At</th>
            <th className="px-3 py-2 font-medium">Error</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((row, i) => (
            <tr key={`${row.filename}-${i}`} className="border-t">
              <td className="px-3 py-2 font-medium">{row.filename}</td>
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                {row.completedAt ? new Date(row.completedAt).toLocaleString() : "—"}
              </td>
              <td className="px-3 py-2 text-destructive">{row.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length === 0 && (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">No failures recorded.</p>
      )}
    </div>
  );
}

export function ErrorsTabTrigger({ count }: { count: number }) {
  return (
    <span className="flex items-center gap-1.5">
      Errors
      <Badge variant="destructive">{count}</Badge>
    </span>
  );
}
