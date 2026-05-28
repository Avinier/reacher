import { RunLauncher } from "@/components/run-launcher";
import { listLists } from "@/lib/db/repositories";

export default function OutreachPage() {
  const lists = listLists();
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
          <RunLauncher compact />
        </section>
      </div>
    </div>
  );
}
