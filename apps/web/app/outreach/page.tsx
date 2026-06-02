import { RunLauncher } from "@/components/run-launcher";
import { listLists, listOutreachTargetOptions } from "@/lib/db/repositories";

export default function OutreachPage() {
  const lists = listLists();
  const outreachTargets = listOutreachTargetOptions(120);
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Outreach Preparation</p>
          <h1>Prepare drafts in the browser, then stop before send.</h1>
        </div>
      </header>
      <div className="grid">
        <section className="panel">
          <h2>Manual-send guardrail</h2>
          <p>The runner can open profiles, find composers, and paste drafts. It must not click the final send button in v1.</p>
          <span className="status">operator controlled</span>
        </section>
        <section className="panel">
          <h2>Saved lists</h2>
          {lists.map((list) => <p key={String(list.id)}>{String(list.name)} · {String(list.target_count)} targets</p>)}
          {lists.length === 0 && <p>Create a research list before starting outreach preparation.</p>}
        </section>
        <section className="panel wide">
          <h2>Queue an outreach run</h2>
          <RunLauncher
            compact
            outreachLists={lists.map((list) => ({ id: String(list.id), name: String(list.name), targetCount: Number(list.target_count ?? 0) }))}
            outreachTargets={outreachTargets.map((target) => ({ id: String(target.id), name: String(target.display_name), platform: String(target.platform), profileUrl: target.profile_url ? String(target.profile_url) : undefined, organization: target.organization ? String(target.organization) : undefined }))}
          />
        </section>
      </div>
    </div>
  );
}
