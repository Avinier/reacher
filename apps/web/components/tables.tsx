import Link from "next/link";
import { formatDateTime, formatDuration, humanizeToken } from "@/lib/format";

export function EmptyState({ label }: { label: string }) {
  return <p className="muted">{label}</p>;
}

export function RunTable({ runs }: { runs: Record<string, unknown>[] }) {
  if (runs.length === 0) return <EmptyState label="No runs yet." />;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Run</th>
          <th>Queued</th>
          <th>Kind</th>
          <th>Status</th>
          <th>Duration</th>
          <th>Prompt</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={String(run.id)}>
            <td><Link href={`/runs/${run.id}`}>{String(run.id).slice(0, 14)}</Link></td>
            <td>
              <time dateTime={new Date(Number(run.created_at ?? 0)).toISOString()}>{formatDateTime(run.created_at)}</time>
            </td>
            <td>{humanizeToken(run.kind)}</td>
            <td><span className={run.status === "failed" ? "status bad" : "status"}>{String(run.status)}</span></td>
            <td>{formatDuration(run.started_at, run.completed_at)}</td>
            <td>{String(run.prompt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
