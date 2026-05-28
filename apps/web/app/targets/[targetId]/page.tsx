import { notFound } from "next/navigation";
import { getTargetDetail } from "@/lib/db/repositories";

export default async function TargetDetailPage({ params }: { params: Promise<{ targetId: string }> }) {
  const { targetId } = await params;
  const detail = getTargetDetail(targetId);
  if (!detail.target) notFound();

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
          <h2>Evidence</h2>
          {detail.evidence.map((item) => <p key={String(item.id)}>{String(item.text)}</p>)}
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
