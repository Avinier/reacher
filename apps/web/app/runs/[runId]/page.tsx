import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteButton } from "@/components/delete-button";
import { GmailOutreachActions, GmailRowActions, type GmailActionInput } from "@/components/gmail-outreach-actions";
import { RunAutoRefresh } from "@/components/run-auto-refresh";
import { getRunDetail } from "@/lib/db/repositories";
import { formatDateTime, formatDuration, humanizeToken } from "@/lib/format";

function money(value: unknown) {
  return `$${Number(value ?? 0).toFixed(4)}`;
}

function parseJson(raw: unknown) {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseDraft(raw: unknown) {
  const parsed = parseJson(raw);
  return {
    subject: String(parsed.subject ?? ""),
    body: String(parsed.body ?? raw ?? "")
  };
}

export default async function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const detail = getRunDetail(runId);
  if (!detail.run) notFound();
  const status = String(detail.run.status);
  const isActive = status === "queued" || status === "claimed" || status === "running";
  const isGmailOutreach = detail.run.kind === "outreach_prepare" && detail.actions.some((action) => action.platform === "email");
  const gmailActions: GmailActionInput[] = detail.actions.filter((action) => action.platform === "email").map((action) => {
    const note = parseJson(action.result_note);
    const draft = parseDraft(action.body);
    return {
      actionId: String(action.id),
      to: String(action.handle ?? note.email ?? ""),
      subject: String(note.subject ?? draft.subject),
      body: draft.body,
      approved: Boolean(note.approved),
      status: String(action.status),
      gmailDraftId: note.gmailDraftId ? String(note.gmailDraftId) : undefined
    };
  });

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
            <span className="summary-label">Candidates</span>
            <strong>{detail.candidates.length}</strong>
          </div>
          <div>
            <span className="summary-label">Enrichments</span>
            <strong>{detail.enrichments.length}</strong>
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
        {isGmailOutreach && (
          <section className="panel wide">
            <div className="section-heading">
              <div>
                <h2>Gmail outreach review</h2>
                <p className="muted">Approve rows, create Gmail drafts, then send approved drafts. Final send is explicit.</p>
              </div>
              <GmailOutreachActions actions={gmailActions} />
            </div>
            <table className="table">
              <thead><tr><th>Recipient</th><th>Subject</th><th>Draft</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {detail.actions.filter((action) => action.platform === "email").map((action) => {
                  const note = parseJson(action.result_note);
                  const draft = parseDraft(action.body);
                  const rowAction: GmailActionInput = {
                    actionId: String(action.id),
                    to: String(action.handle ?? note.email ?? ""),
                    subject: String(note.subject ?? draft.subject),
                    body: draft.body,
                    approved: Boolean(note.approved),
                    status: String(action.status),
                    gmailDraftId: note.gmailDraftId ? String(note.gmailDraftId) : undefined
                  };
                  return (
                    <tr key={String(action.id)}>
                      <td>
                        <Link href={`/targets/${action.target_id}`}>{String(action.display_name)}</Link>
                        <br />
                        <span className="muted">{String(action.handle ?? "")}</span>
                      </td>
                      <td>{rowAction.subject}</td>
                      <td><pre className="draft-preview">{rowAction.body}</pre></td>
                      <td><span className={action.status === "done" ? "status" : "status active"}>{String(action.status)}</span></td>
                      <td><GmailRowActions action={rowAction} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
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
          <h2>Code-mode research state</h2>
          <div className="summary-strip compact">
            <div><span className="summary-label">Candidates</span><strong>{detail.candidates.length}</strong></div>
            <div><span className="summary-label">Enrichments</span><strong>{detail.enrichments.length}</strong></div>
            <div><span className="summary-label">Scorecards</span><strong>{detail.scorecards.length}</strong></div>
            <div><span className="summary-label">Checkpoints</span><strong>{detail.checkpoints.length}</strong></div>
          </div>
          {detail.checkpoints.length > 0 && (
            <>
              <h3>Recent checkpoints</h3>
              <table className="table">
                <thead><tr><th>Name</th><th>Data</th></tr></thead>
                <tbody>
                  {detail.checkpoints.slice(0, 5).map((checkpoint) => (
                    <tr key={String(checkpoint.id)}>
                      <td>{String(checkpoint.name)}</td>
                      <td><pre className="draft-preview">{JSON.stringify(parseJson(checkpoint.data_json), null, 2).slice(0, 800)}</pre></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {detail.candidates.length > 0 && (
            <>
              <h3>Candidates</h3>
              <table className="table">
                <thead><tr><th>Name</th><th>Company</th><th>Role</th><th>Reason</th><th>Confidence</th></tr></thead>
                <tbody>
                  {detail.candidates.slice(0, 15).map((candidate) => (
                    <tr key={String(candidate.id)}>
                      <td>{candidate.url ? <a href={String(candidate.url)} target="_blank" rel="noreferrer">{String(candidate.name)}</a> : String(candidate.name)}</td>
                      <td>{String(candidate.company ?? "")}</td>
                      <td>{String(candidate.role ?? "")}</td>
                      <td>{String(candidate.reason ?? "")}</td>
                      <td>{Number(candidate.confidence ?? 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {detail.scorecards.length > 0 && (
            <>
              <h3>Scorecards</h3>
              <table className="table">
                <thead><tr><th>Candidate</th><th>ICP</th><th>Pain</th><th>Reach</th><th>Call</th><th>Design partner</th><th>Rationale</th></tr></thead>
                <tbody>
                  {detail.scorecards.slice(0, 15).map((scorecard) => {
                    const candidate = detail.candidates.find((item) => item.id === scorecard.candidate_id);
                    return (
                      <tr key={String(scorecard.id)}>
                        <td>{String(candidate?.name ?? scorecard.candidate_id ?? "")}</td>
                        <td>{String(scorecard.icp_fit ?? "")}</td>
                        <td>{String(scorecard.pain_evidence ?? "")}</td>
                        <td>{String(scorecard.reachability ?? "")}</td>
                        <td>{String(scorecard.call_likelihood ?? "")}</td>
                        <td>{String(scorecard.design_partner ?? "")}</td>
                        <td>{String(scorecard.rationale ?? "")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
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
