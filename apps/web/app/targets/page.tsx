import Link from "next/link";
import { listTargets } from "@/lib/db/repositories";

export default function TargetsPage() {
  const targets = listTargets();
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Targets</p>
          <h1>People, accounts, communities, and pages with evidence.</h1>
        </div>
      </header>
      <section className="panel wide">
        <table className="table">
          <thead><tr><th>Name</th><th>Platform</th><th>Status</th><th>Why</th></tr></thead>
          <tbody>
            {targets.map((target) => (
              <tr key={String(target.id)}>
                <td><Link href={`/targets/${target.id}`}>{String(target.display_name)}</Link></td>
                <td>{String(target.platform)}</td>
                <td>{String(target.status)}</td>
                <td>{String(target.why_relevant ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {targets.length === 0 && <p>No targets saved yet.</p>}
      </section>
    </div>
  );
}
