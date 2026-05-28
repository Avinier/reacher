import Link from "next/link";

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
          <th>Kind</th>
          <th>Status</th>
          <th>Prompt</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={String(run.id)}>
            <td><Link href={`/runs/${run.id}`}>{String(run.id).slice(0, 14)}</Link></td>
            <td>{String(run.kind)}</td>
            <td><span className={run.status === "failed" ? "status bad" : "status"}>{String(run.status)}</span></td>
            <td>{String(run.prompt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
