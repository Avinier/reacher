import { listExports, listRuns } from "@/lib/db/repositories";

export default function ExportsPage() {
  const exports = listExports();
  const runs = listRuns(20);
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Exports</p>
          <h1>Regenerable Markdown, CSV, and JSON artifacts.</h1>
        </div>
      </header>
      <div className="grid">
        <section className="panel">
          <h2>Available exports</h2>
          {exports.map((item) => <p key={String(item.id)}>{String(item.format)} · {String(item.path ?? item.title ?? "")}</p>)}
          {exports.length === 0 && <p>No exports written yet.</p>}
        </section>
        <section className="panel">
          <h2>Run downloads</h2>
          {runs.map((run) => (
            <p key={String(run.id)}>
              {String(run.id).slice(0, 14)} ·{" "}
              <a href={`/api/exports/run/${run.id}?format=markdown`}>md</a>{" "}
              <a href={`/api/exports/run/${run.id}?format=csv`}>csv</a>{" "}
              <a href={`/api/exports/run/${run.id}?format=json`}>json</a>
            </p>
          ))}
          {runs.length === 0 && <p>Create a run to enable generated downloads.</p>}
        </section>
      </div>
    </div>
  );
}
