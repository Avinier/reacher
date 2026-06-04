import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteButton } from "@/components/delete-button";
import { GmailOutreachActions, GmailRowActions, type GmailActionInput } from "@/components/gmail-outreach-actions";
import { LinkedInRowActions, type LinkedInActionInput } from "@/components/linkedin-outreach-actions";
import { RerunButton } from "@/components/rerun-button";
import { RunAutoRefresh } from "@/components/run-auto-refresh";
import { TargetOutreachToggle } from "@/components/target-outreach-toggle";
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

function targetKind(target: Record<string, unknown>) {
  const type = String(target.target_type ?? "").toLowerCase();
  const platform = String(target.platform ?? "").toLowerCase();
  const url = String(target.profile_url ?? "");
  if (type === "person" || type === "account" || platform === "linkedin" || platform === "x") return "Person";
  if (type === "company") return "Company";
  if (type === "project") return "Repo";
  if (type === "thread" || platform === "reddit") return "Thread";
  if (url.includes("/jobs/") || url.includes("/job/") || url.includes("workatastartup.com")) return "Job signal";
  if (url.includes("/docs/") || url.includes("/documentation/") || url.includes("github.com/github/docs") || url.includes("/content/")) return "Docs/source";
  if (type === "page") return "Web page";
  return type ? humanizeToken(type) : "Hint";
}

function kindClass(kind: string) {
  const normalized = kind.toLowerCase();
  if (normalized === "person") return "type-chip person";
  if (normalized === "company") return "type-chip company";
  if (normalized === "thread") return "type-chip thread";
  if (normalized === "job signal") return "type-chip job";
  if (normalized === "docs/source" || normalized === "web page") return "type-chip source";
  return "type-chip";
}

function isOutreachTarget(target: Record<string, unknown>) {
  const type = String(target.target_type ?? "").toLowerCase();
  return ["person", "company", "account", "creator", "user"].includes(type);
}

export default async function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const detail = getRunDetail(runId);
  if (!detail.run) notFound();
  const status = String(detail.run.status);
  const isActive = status === "queued" || status === "claimed" || status === "running";
  const canRerun = detail.run.kind === "research" && ["completed", "failed"].includes(status);
  const parentRunId = detail.run.parent_run_id ? String(detail.run.parent_run_id) : "";
  const rerunRootRunId = detail.run.rerun_root_run_id ? String(detail.run.rerun_root_run_id) : "";
  const rerunIndex = Number(detail.run.rerun_index ?? 0);
  const isRerun = Boolean(rerunRootRunId && rerunIndex > 0);
  const outreachTargets = detail.targets.filter((target) => isOutreachTarget(target));
  const evidenceHints = detail.targets.filter((target) => !isOutreachTarget(target));
  const isGmailOutreach = detail.run.kind === "outreach_prepare" && detail.actions.some((action) => action.platform === "email");
  const isLinkedInOutreach = detail.run.kind === "outreach_prepare" && detail.actions.some((action) => action.platform === "linkedin");
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
      <header className={isRerun ? "page-header rerun-header" : "page-header"}>
        <div>
          <p className="eyebrow">{isRerun ? `Rerun #${rerunIndex}` : "Run Detail"}</p>
          <h1>{humanizeToken(detail.run.kind)} run</h1>
          {isRerun && (
            <div className="rerun-line">
              <span className="rerun-badge">Re-run pass {rerunIndex}</span>
              <span>
                Original{" "}
                <Link href={`/runs/${rerunRootRunId}`}>{rerunRootRunId}</Link>
                {parentRunId && parentRunId !== rerunRootRunId ? (
                  <>
                    {" "}
                    · queued from <Link href={`/runs/${parentRunId}`}>{parentRunId}</Link>
                  </>
                ) : null}
              </span>
            </div>
          )}
          <p>{String(detail.run.prompt)}</p>
          <div className="toolbar">
            {canRerun && <RerunButton runId={runId} />}
            <DeleteButton apiPath={`/api/runs/${runId}`} confirmLabel={`Delete run ${runId}?`} redirectTo="/runs" />
          </div>
        </div>
        <span className={status === "failed" ? "status bad" : isActive ? "status active" : "status"}>{status}</span>
      </header>
      {isRerun && (
        <section className="notice rerun-notice">
          <strong>Re-run mode: same prompt, new ground.</strong>
          <p>This pass uses the original research request but avoids targets already found in this run lineage. Targets marked not useful are hard-excluded, and already-outreached targets are deprioritized.</p>
        </section>
      )}
      {status === "queued" && (
        <section className="notice">
          <strong>Waiting for the local runner</strong>
          <p>Start the runner to claim this job: <code>cd apps/runner && uv run python -m reacher_runner.main</code></p>
        </section>
      )}
      {status === "claimed" && (
        <section className="notice">
          <strong>Research in progress</strong>
          <p>The runner is executing this job. This page refreshes automatically as new steps, targets, and artifacts come in.</p>
        </section>
      )}
      {status === "running" && (
        <section className="notice">
          <strong>Research in progress</strong>
          <p>Browsing the web, extracting candidates, and scoring results. New data will appear below as the pipeline advances.</p>
        </section>
      )}
      <div className="grid">
        <section className={isActive ? "panel wide summary-strip active" : "panel wide summary-strip"}>
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
            <strong>{outreachTargets.length}</strong>
          </div>
          <div>
            <span className="summary-label">Hints</span>
            <strong>{evidenceHints.length}</strong>
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
        {isLinkedInOutreach && (
          <section className="panel wide">
            <div className="section-heading">
              <div>
                <h2>LinkedIn outreach review</h2>
                <p className="muted">Approve rows, stage a logged-in Browserbase session, then manually send or connect in LinkedIn. Reacher never clicks final send.</p>
              </div>
            </div>
            <table className="table">
              <thead><tr><th>Target</th><th>Connection note</th><th>DM</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {detail.actions.filter((action) => action.platform === "linkedin").map((action) => {
                  const note = parseJson(action.result_note);
                  const draft = parseJson(action.body);
                  const rowAction: LinkedInActionInput = {
                    actionId: String(action.id),
                    runId,
                    profileUrl: String(note.profileUrl ?? ""),
                    connectionNote: String(note.connectionNote ?? draft.connectionNote ?? ""),
                    dm: String(note.dm ?? draft.dm ?? ""),
                    approved: Boolean(note.approved),
                    status: String(action.status),
                    liveUrl: note.liveUrl ? String(note.liveUrl) : undefined
                  };
                  return (
                    <tr key={String(action.id)}>
                      <td>
                        <Link href={`/targets/${action.target_id}`}>{String(action.display_name)}</Link>
                        <br />
                        {rowAction.profileUrl ? <a className="external-link" href={rowAction.profileUrl} target="_blank" rel="noreferrer">{rowAction.profileUrl}</a> : <span className="muted">{String(note.reason ?? "missing_linkedin_url")}</span>}
                      </td>
                      <td><pre className="draft-preview">{rowAction.connectionNote}</pre></td>
                      <td><pre className="draft-preview">{rowAction.dm}</pre></td>
                      <td><span className={action.status === "failed" ? "status bad" : action.status === "done" ? "status" : "status active"}>{String(action.status)}</span></td>
                      <td><LinkedInRowActions action={rowAction} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
        <section className="panel">
          <h2>Timeline</h2>
          <div className={isActive ? "timeline active" : "timeline"}>
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
          <p className="muted">Concrete outreach points only: people or companies. Threads, jobs, docs, and generic pages are shown separately as evidence hints.</p>
          <table className="table research-table targets-table">
            <thead><tr><th>Name / context</th><th>Kind</th><th>Platform</th><th>Outreach</th><th>Why</th><th>Score</th></tr></thead>
            <tbody>
              {outreachTargets.map((target) => {
                const metadata = parseJson(target.metadata_json);
                const kind = targetKind(target);
                const sourceUrls = Array.isArray(metadata.source_urls) ? metadata.source_urls.filter(Boolean).map(String) : [];
                const primaryUrl = String(target.profile_url ?? sourceUrls[0] ?? "");
                return (
                  <tr key={String(target.id)}>
                    <td className="target-name-cell">
                      <Link href={`/targets/${target.id}`} className="target-title-link">{String(target.display_name)}</Link>
                      <span className="target-context">
                        {[target.organization, target.role_or_context].filter(Boolean).map(String).join(" · ") || "Evidence hint"}
                      </span>
                      {primaryUrl ? <a className="external-link compact-link" href={primaryUrl} target="_blank" rel="noreferrer">Open source</a> : null}
                    </td>
                    <td><span className={kindClass(kind)}>{kind}</span></td>
                    <td>{String(target.platform)}</td>
                    <td><TargetOutreachToggle targetId={String(target.id)} outreachedAt={target.outreached_at} notUsefulAt={target.not_useful_at} compact /></td>
                    <td className="target-reason">{String(target.why_relevant ?? "")}</td>
                    <td>{Number(target.relevance_score ?? 0).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {outreachTargets.length === 0 && <p className="muted">No outreach-ready person or company targets saved for this run.</p>}
        </section>
        {evidenceHints.length > 0 && (
          <section className="panel wide">
            <h2>Evidence hints</h2>
            <p className="muted">Useful clues for mining pain, source pages, job signals, discussions, and follow-up research. These are not treated as outreach targets.</p>
            <table className="table research-table hints-table">
              <thead><tr><th>Hint / context</th><th>Kind</th><th>Platform</th><th>Why</th><th>Score</th></tr></thead>
              <tbody>
                {evidenceHints.map((target) => {
                  const metadata = parseJson(target.metadata_json);
                  const kind = targetKind(target);
                  const sourceUrls = Array.isArray(metadata.source_urls) ? metadata.source_urls.filter(Boolean).map(String) : [];
                  const primaryUrl = String(target.profile_url ?? sourceUrls[0] ?? "");
                  return (
                    <tr key={String(target.id)}>
                      <td className="target-name-cell">
                        <Link href={`/targets/${target.id}`} className="target-title-link">{String(target.display_name)}</Link>
                        <span className="target-context">
                          {[target.organization, target.role_or_context].filter(Boolean).map(String).join(" · ") || "Supporting evidence"}
                        </span>
                        {primaryUrl ? <a className="external-link compact-link" href={primaryUrl} target="_blank" rel="noreferrer">Open source</a> : null}
                      </td>
                      <td><span className={kindClass(kind)}>{kind}</span></td>
                      <td>{String(target.platform)}</td>
                      <td className="target-reason">{String(target.why_relevant ?? "")}</td>
                      <td>{Number(target.relevance_score ?? 0).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
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
