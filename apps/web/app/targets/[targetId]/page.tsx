import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
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

function compactText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function draftText(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw.startsWith("{")) return raw;
  try {
    const parsed = JSON.parse(raw) as { subject?: unknown; body?: unknown };
    const subject = compactText(parsed.subject);
    const body = String(parsed.body ?? "").trim();
    return [subject ? `Subject: ${subject}` : "", body].filter(Boolean).join("\n\n");
  } catch {
    return raw;
  }
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function buildSearchSuggestions(target: Record<string, unknown>, metadata: Record<string, unknown>) {
  const name = compactText(target.display_name);
  const handle = compactText(target.handle).replace(/^@/, "");
  const organization = compactText(target.organization);
  const role = compactText(target.role_or_context);
  const profileUrl = compactText(target.profile_url);
  const email = compactText(metadata.email);
  const base = name || handle || email || profileUrl;
  const suggestions = [
    base && `${base} linkedin`,
    base && `${base} twitter`,
    base && `${base} x.com`,
    base && `${base} github`,
    base && `${base} email`,
    base && `${base} contact`,
    name && organization && `${name} ${organization}`,
    name && role && `${name} ${role}`,
    handle && `${handle} twitter`,
    handle && `${handle} linkedin`,
    organization && `${organization} founders linkedin`,
    profileUrl && `${profileUrl}`
  ].filter((item): item is string => Boolean(item));

  return [...new Set(suggestions.map(compactText))].slice(0, 12);
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
  const sourceUrls = stringList(metadata.source_urls);
  const stackSignals = stringList(metadata.stack_signals);
  const painSignals = stringList(metadata.pain_signals);
  const scores = parseMetadata(metadata.scores);
  const outreachAngle = typeof metadata.outreach_angle === "string" ? metadata.outreach_angle : "";
  const searchSuggestions = buildSearchSuggestions(detail.target, metadata);

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
          <h2>Prospect signals</h2>
          {outreachAngle && <p><strong>Angle:</strong> {outreachAngle}</p>}
          {Object.keys(scores).length > 0 && (
            <div className="score-grid">
              {Object.entries(scores).map(([label, value]) => (
                <span key={label}><strong>{humanizeToken(label)}</strong>{String(value)}</span>
              ))}
            </div>
          )}
          {stackSignals.length > 0 && <p><strong>Stack:</strong> {stackSignals.join(", ")}</p>}
          {painSignals.length > 0 && <p><strong>Pain:</strong> {painSignals.join(", ")}</p>}
          {sourceUrls.length > 0 && (
            <ul className="link-list">
              {sourceUrls.map((url) => (
                <li className="link-item" key={url}>
                  <span className="link-label">source</span>
                  <a className="external-link" href={url} target="_blank" rel="noreferrer">{url}</a>
                </li>
              ))}
            </ul>
          )}
          {!outreachAngle && Object.keys(scores).length === 0 && stackSignals.length === 0 && painSignals.length === 0 && sourceUrls.length === 0 && (
            <p>No structured prospect signals saved.</p>
          )}
        </section>
        <section className="panel">
          <h2>Search suggestions</h2>
          {searchSuggestions.length > 0 ? (
            <div className="copy-list">
              {searchSuggestions.map((suggestion) => (
                <div className="copy-row" key={suggestion}>
                  <input className="copy-field" readOnly value={suggestion} aria-label={`Search suggestion: ${suggestion}`} />
                  <div className="copy-actions">
                    <CopyButton text={suggestion} />
                    <a className="button secondary compact-button" href={`https://www.google.com/search?q=${encodeURIComponent(suggestion)}`} target="_blank" rel="noreferrer">
                      Search
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p>No search suggestions available.</p>
          )}
        </section>
        <section className="panel">
          <h2>Evidence</h2>
          {detail.evidence.map((item) => <p key={String(item.id)}>{evidenceText(item.text)}</p>)}
          {detail.evidence.length === 0 && <p>No evidence saved.</p>}
        </section>
        <section className="panel">
          <h2>Drafts</h2>
          {detail.drafts.map((draft) => {
            const body = draftText(draft.body);
            return (
              <div className="copy-card" key={String(draft.id)}>
                <div className="copy-card-header">
                  <span className="status">{String(draft.status)}</span>
                  <CopyButton text={body} />
                </div>
                <pre className="draft-preview full">{body}</pre>
              </div>
            );
          })}
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
