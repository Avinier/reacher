import { notFound } from "next/navigation";
import { getTargetDetail } from "@/lib/db/repositories";

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
  const metadata = parseMetadata(detail.target.metadata_json);
  const companySocials = socialEntries(metadata.company_socials);
  const founderSocials = socialResults(metadata.founder_social_results);
  const founderNames = Array.isArray(metadata.founder_names) ? metadata.founder_names.map(String).filter(Boolean) : [];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Target</p>
          <h1>{String(detail.target.display_name)}</h1>
          <p>{String(detail.target.why_relevant ?? "")}</p>
        </div>
        <span className="status">{String(detail.target.status)}</span>
      </header>
      <div className="grid">
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
