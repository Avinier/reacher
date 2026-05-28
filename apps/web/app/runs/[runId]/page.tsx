import Link from "next/link";
import { notFound } from "next/navigation";
import { getRunDetail } from "@/lib/db/repositories";

export default async function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const detail = getRunDetail(runId);
  if (!detail.run) notFound();

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Run Detail</p>
          <h1>{String(detail.run.kind).replaceAll("_", " ")} run</h1>
          <p>{String(detail.run.prompt)}</p>
        </div>
        <span className={detail.run.status === "failed" ? "status bad" : "status"}>{String(detail.run.status)}</span>
      </header>
      <div className="grid">
        <section className="panel">
          <h2>Timeline</h2>
          <div className="timeline">
            {detail.steps.map((step) => (
              <div className="step" key={String(step.id)}>
                <strong>{String(step.title)}</strong>
                <p>{String(step.detail ?? step.kind)}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>Filters</h2>
          {detail.filters.map((filter) => (
            <p key={String(filter.id)}><strong>{String(filter.platform)}</strong>: {String(filter.value)}</p>
          ))}
          {detail.filters.length === 0 && <p>No filters saved yet.</p>}
        </section>
        <section className="panel wide">
          <h2>Targets</h2>
          <table className="table">
            <thead><tr><th>Name</th><th>Platform</th><th>Why</th><th>Score</th></tr></thead>
            <tbody>
              {detail.targets.map((target) => (
                <tr key={String(target.id)}>
                  <td><Link href={`/targets/${target.id}`}>{String(target.display_name)}</Link></td>
                  <td>{String(target.platform)}</td>
                  <td>{String(target.why_relevant ?? "")}</td>
                  <td>{String(target.relevance_score ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="panel wide">
          <h2>Artifacts</h2>
          {detail.artifacts.map((artifact) => (
            <p key={String(artifact.id)}>{String(artifact.kind)}: {String(artifact.path ?? artifact.provider_url ?? artifact.title ?? "")}</p>
          ))}
          {detail.artifacts.length === 0 && <p>No artifacts saved yet.</p>}
        </section>
      </div>
    </div>
  );
}
