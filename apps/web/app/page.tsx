import Link from "next/link";
import { RunLauncher } from "@/components/run-launcher";
import { RunTable } from "@/components/tables";
import { getBrowserContexts, listLists, listRuns } from "@/lib/db/repositories";

export default function HomePage() {
  const contexts = getBrowserContexts();
  const runs = listRuns(6);
  const lists = listLists();

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Browser Agent Workbench</p>
          <h1>Research, evidence, drafts, and manual-send outreach.</h1>
        </div>
      </header>
      <div className="grid">
        <RunLauncher />
        <section className="panel third">
          <h2>Contexts</h2>
          {contexts.map((context) => (
            <p key={String(context.id)}>
              <Link href={`/contexts/${context.platform}`}>{String(context.display_name)}</Link>{" "}
              <span className={context.status === "ready" ? "status" : "status bad"}>{String(context.status)}</span>
            </p>
          ))}
        </section>
        <section className="panel third">
          <h2>Saved Lists</h2>
          <div className="metric">{lists.length}</div>
          <p>Filtered research outputs available for export or outreach preparation.</p>
        </section>
        <section className="panel third">
          <h2>Runner</h2>
          <span className="status">sqlite polling</span>
          <p>Start the local Python runner to claim queued jobs.</p>
        </section>
        <section className="panel wide">
          <h2>Recent runs</h2>
          <RunTable runs={runs} />
        </section>
      </div>
    </div>
  );
}
