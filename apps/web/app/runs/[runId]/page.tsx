import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteButton } from "@/components/delete-button";
import { RunAutoRefresh } from "@/components/run-auto-refresh";
import { getRunDetail } from "@/lib/db/repositories";
import { formatDateTime, formatDuration, humanizeToken } from "@/lib/format";

function money(value: unknown) {
  return `$${Number(value ?? 0).toFixed(4)}`;
}

export default async function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const detail = getRunDetail(runId);
  if (!detail.run) notFound();
  const status = String(detail.run.status);
  const isActive = status === "queued" || status === "claimed" || status === "running";

  return (
    <div className="page">
      <RunAutoRefresh active={isActive} />
      <header className="page-header">
        <div>
          <p className="eyebrow">Run Detail</p>
          <h1>{humanizeToken(detail.run.kind)} run</h1>
          <p>{String(detail.run.prompt)}</p>
          <div className="toolbar">
            <DeleteButton apiPath={`/api/runs/${runId}`} confirmLabel={`Delete run ${runId}?`} redirectTo="/runs" />
          </div>
        </div>
        <span className={status === "failed" ? "status bad" : isActive ? "status active" : "status"}>{status}</span>
      </header>
      {status === "queued" && (
        <section className="notice">
          <strong>Waiting for the local runner.</strong>
          <p>This job is saved in SQLite but has not been claimed yet. Start the Python runner from the repo with <code>cd apps/runner && uv run python -m reacher_runner.main</code>.</p>
        </section>
      )}
      {status === "claimed" && (
        <section className="notice">
          <strong>Runner is working.</strong>
          <p>This page refreshes every 3 seconds while the run is active. New timeline steps, targets, usage, and artifacts will appear here.</p>
        </section>
      )}
      <div className="grid">
        <section className="panel wide summary-strip">
          <div>
            <span className="summary-label">Queued</span>
            <strong>{formatDateTime(detail.run.created_at)}</strong>
          </div>
          <div>
            <span className="summary-label">Elapsed</span>
            <strong>{formatDuration(detail.run.started_at, detail.run.completed_at)}</strong>
          </div>
          <div>
            <span className="summary-label">Targets</span>
            <strong>{detail.targets.length}</strong>
          </div>
          <div>
            <span className="summary-label">Artifacts</span>
            <strong>{detail.artifacts.length}</strong>
          </div>
          <div>
            <span className="summary-label">Cost</span>
            <strong>{money(detail.usageSummary.estimated_cost_usd)}</strong>
          </div>
        </section>
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
          <h2>Usage</h2>
          <p><strong>Estimated cost:</strong> {money(detail.usageSummary.estimated_cost_usd)}</p>
          <p><strong>Tokens:</strong> {Number(detail.usageSummary.total_tokens ?? 0).toLocaleString()}</p>
          <table className="table">
            <thead><tr><th>Provider</th><th>Service</th><th>Qty</th><th>Tokens</th><th>Cost</th></tr></thead>
            <tbody>
              {detail.usageByProvider.map((usage) => (
                <tr key={`${String(usage.provider)}-${String(usage.service)}-${String(usage.unit)}`}>
                  <td>{String(usage.provider)}</td>
                  <td>{String(usage.service)}</td>
                  <td>{Number(usage.quantity ?? 0).toLocaleString()} {String(usage.unit)}</td>
                  <td>{Number(usage.total_tokens ?? 0).toLocaleString()}</td>
                  <td>{money(usage.estimated_cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.usage.length === 0 && <p>No usage events recorded yet.</p>}
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
          <p className="muted">Relevance score is Reacher ranking confidence for this run. Higher means the target is earlier in the saved list and has stronger prompt-matching evidence.</p>
          <table className="table">
            <thead><tr><th>Name</th><th>Platform</th><th>Why</th><th>Relevance score</th></tr></thead>
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
