import Link from "next/link";
import { TargetOutreachToggle } from "@/components/target-outreach-toggle";
import { listTargetsByRun } from "@/lib/db/repositories";
import { formatDateTime, humanizeToken } from "@/lib/format";

export default function TargetsPage() {
  const targets = listTargetsByRun();
  const targetsByRun = targets.reduce((groups, target) => {
    const runId = String(target.run_id);
    const group = groups.get(runId) ?? { run: target, targets: [] as Record<string, unknown>[] };
    group.targets.push(target);
    groups.set(runId, group);
    return groups;
  }, new Map<string, { run: Record<string, unknown>; targets: Record<string, unknown>[] }>());

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Targets</p>
          <h1>Targets grouped by the run that found them.</h1>
        </div>
      </header>
      <div className="run-groups">
        {[...targetsByRun.values()].map(({ run, targets: runTargets }) => (
          <section className="panel wide run-group" key={String(run.run_id)}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">{formatDateTime(run.run_created_at)}</p>
                <h2><Link href={`/runs/${run.run_id}`}>{humanizeToken(run.run_kind)} run</Link></h2>
                <p>{String(run.run_prompt ?? "")}</p>
              </div>
              <div className="section-meta">
                <span className={run.run_status === "failed" ? "status bad" : "status"}>{String(run.run_status)}</span>
                <span>{runTargets.length} targets</span>
              </div>
            </div>
            <table className="table">
              <thead><tr><th>Name</th><th>Platform</th><th>Outreach</th><th>Status</th><th>Why</th></tr></thead>
              <tbody>
                {runTargets.map((target) => (
                  <tr key={String(target.id)}>
                    <td><Link href={`/targets/${target.id}`}>{String(target.display_name)}</Link></td>
                    <td>{String(target.platform)}</td>
                    <td><TargetOutreachToggle targetId={String(target.id)} outreachedAt={target.outreached_at} notUsefulAt={target.not_useful_at} compact /></td>
                    <td>{String(target.status)}</td>
                    <td>{String(target.why_relevant ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {targets.length === 0 && <section className="panel wide"><p>No targets saved yet.</p></section>}
      </div>
    </div>
  );
}
