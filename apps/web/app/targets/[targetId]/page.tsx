import Link from "next/link";
import { notFound } from "next/navigation";
import { RunAutoRefresh } from "@/components/run-auto-refresh";
import { TargetResearchButton } from "@/components/target-research-button";
import { getTargetDetail } from "@/lib/db/repositories";
import { formatDateTime, humanizeToken } from "@/lib/format";

type SocialResult = {
  title?: string;
  url?: string;
  query?: string;
  published_date?: string;
};

function parseMetadata(raw: unknown) {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function socialEntries(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).filter(([, url]) => typeof url === "string" && url.length > 0);
}

function socialResults(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is SocialResult => Boolean(item && typeof item === "object" && "url" in item)) : [];
}

function evidenceText(text: unknown) {
  return String(text).split("\nCompany socials:")[0].split("\nFounder/social clues:")[0].trim();
}

export default async function TargetDetailPage({ params }: { params: Promise<{ targetId: string }> }) {
  const { targetId } = await params;
  const detail = getTargetDetail(targetId);
  if (!detail.target) notFound();
  const hasActiveResearch = detail.researchRuns.some((run) => ["queued", "claimed", "running"].includes(String(run.status)));
  const metadata = parseMetadata(detail.target.metadata_json);
  const gmail = parseMetadata(metadata.gmail);
  const companySocials = socialEntries(metadata.company_socials);
  const founderSocials = socialResults(metadata.founder_social_results);
  const founderNames = Array.isArray(metadata.founder_names) ? metadata.founder_names.map(String).filter(Boolean) : [];

  return (
    <div className="page">
      <RunAutoRefresh active={hasActiveResearch} />
      <header className="page-header">
        <div>
          <p className="eyebrow">Target</p>
          <h1>{String(detail.target.display_name)}</h1>
          <p>{String(detail.target.why_relevant ?? "")}</p>
          <p className="meta-line">
            Found by <Link className="external-link" href={`/runs/${detail.target.run_id}`}>{humanizeToken(detail.target.run_kind)} run</Link>
            {" "}on {formatDateTime(detail.target.run_created_at)}
          </p>
        </div>
        <span className="status">{String(detail.target.status)}</span>
      </header>
      <div className="grid">
        <section className="panel wide emphasis-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Research further</p>
              <h2>Build a deeper person dossier from public sources.</h2>
              <p>Queues a focused research run for role, company context, public activity, outreach angles, and source-backed facts.</p>
            </div>
            <TargetResearchButton targetId={targetId} />
          </div>
          {detail.researchRuns.length > 0 ? (
            <div className="run-history">
              {detail.researchRuns.map((run) => (
                <Link className="run-history-item" href={`/runs/${run.id}`} key={String(run.id)}>
                  <span>
                    <strong>{formatDateTime(run.created_at)}</strong>
                    <small>{String(run.result_summary ?? run.prompt)}</small>
                  </span>
                  <span className={run.status === "failed" ? "status bad" : "status"}>{String(run.status)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted">No deeper research runs have been queued for this target yet.</p>
          )}
        </section>
        <section className="panel">
          <h2>Company links</h2>
          {companySocials.length > 0 ? (
            <ul className="link-list">
              {companySocials.map(([label, url]) => (
                <li className="link-item" key={label}>
                  <span className="link-label">{label}</span>
                  <a className="external-link" href={String(url)} target="_blank" rel="noreferrer">{String(url)}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p>No company links saved.</p>
          )}
        </section>
        <section className="panel">
          <h2>Founder/social clues</h2>
          {founderNames.length > 0 && <p><strong>Names:</strong> {founderNames.join(", ")}</p>}
          {founderSocials.length > 0 ? (
            <ul className="link-list">
              {founderSocials.map((result, index) => (
                <li className="link-item" key={`${result.url}-${index}`}>
                  <span className="link-label">{result.title ?? "Source"}</span>
                  <a className="external-link" href={String(result.url)} target="_blank" rel="noreferrer">{String(result.url)}</a>
                  {result.query && <span className="muted">Query: {result.query}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p>No founder/social clues saved.</p>
          )}
        </section>
        <section className="panel">
          <h2>Gmail status</h2>
          {detail.target.platform === "email" ? (
            <>
              <p><strong>Email:</strong> {String(detail.target.handle ?? metadata.email ?? "")}</p>
              <p><strong>Status:</strong> {String(detail.target.status)}</p>
              {gmail.draft_id && <p><strong>Gmail draft:</strong> {String(gmail.draft_id)}</p>}
              {gmail.message_id && <p><strong>Message:</strong> {String(gmail.message_id)}</p>}
              {gmail.sent_at && <p><strong>Sent:</strong> {formatDateTime(gmail.sent_at)}</p>}
            </>
          ) : (
            <p>No Gmail outreach recorded for this target.</p>
          )}
        </section>
        <section className="panel">
          <h2>Evidence</h2>
          {detail.evidence.map((item) => <p key={String(item.id)}>{evidenceText(item.text)}</p>)}
          {detail.evidence.length === 0 && <p>No evidence saved.</p>}
        </section>
        <section className="panel">
          <h2>Drafts</h2>
          {detail.drafts.map((draft) => <p key={String(draft.id)}>{String(draft.body)}</p>)}
          {detail.drafts.length === 0 && <p>No drafts generated.</p>}
        </section>
        <section className="panel wide">
          <h2>Outreach actions</h2>
          {detail.actions.map((action) => <p key={String(action.id)}>{String(action.action_type)}: {String(action.status)}</p>)}
          {detail.actions.length === 0 && <p>No outreach actions recorded.</p>}
        </section>
      </div>
    </div>
  );
}
