import Link from "next/link";
import { RunLauncher } from "@/components/run-launcher";
import { RunTable } from "@/components/tables";
import { getBrowserContexts, getTargetOutreachStats, listLists, listOutreachTargetOptions, listRuns } from "@/lib/db/repositories";

export default function HomePage() {
  const contexts = getBrowserContexts();
  const runs = listRuns(6);
  const lists = listLists();
  const outreachTargets = listOutreachTargetOptions(80);
  const outreachStats = getTargetOutreachStats();

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Browser Agent Workbench</p>
          <h1>Research, evidence, drafts, and manual-send outreach.</h1>
        </div>
      </header>
      <div className="grid">
        <RunLauncher
          outreachLists={lists.map((list) => ({ id: String(list.id), name: String(list.name), targetCount: Number(list.target_count ?? 0) }))}
          outreachTargets={outreachTargets.map((target) => ({ id: String(target.id), name: String(target.display_name), platform: String(target.platform), profileUrl: target.profile_url ? String(target.profile_url) : undefined, organization: target.organization ? String(target.organization) : undefined }))}
        />
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
          <h2>Outreach progress</h2>
          <div className="mini-metrics">
            <span>
              <strong>{outreachStats.outreachedToday}</strong>
              <small>today</small>
            </span>
            <span>
              <strong>{outreachStats.outreachedTotal}</strong>
              <small>historical</small>
            </span>
          </div>
          <p>{outreachStats.notUsefulTotal} targets marked not useful.</p>
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
