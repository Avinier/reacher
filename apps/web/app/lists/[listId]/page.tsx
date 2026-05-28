import Link from "next/link";
import { notFound } from "next/navigation";
import { RunLauncher } from "@/components/run-launcher";
import { getListDetail } from "@/lib/db/repositories";

export default async function ListDetailPage({ params }: { params: Promise<{ listId: string }> }) {
  const { listId } = await params;
  const detail = getListDetail(listId);
  if (!detail.list) notFound();

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Saved List</p>
          <h1>{String(detail.list.name)}</h1>
          <p>{String(detail.list.description ?? "")}</p>
        </div>
      </header>
      <div className="grid">
        <section className="panel wide">
          <h2>Targets</h2>
          <table className="table">
            <thead><tr><th>Rank</th><th>Name</th><th>Platform</th><th>Why relevant</th></tr></thead>
            <tbody>
              {detail.targets.map((target) => (
                <tr key={String(target.id)}>
                  <td>{String(target.rank)}</td>
                  <td><Link href={`/targets/${target.id}`}>{String(target.display_name)}</Link></td>
                  <td>{String(target.platform)}</td>
                  <td>{String(target.why_relevant ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="panel wide">
          <h2>Start outreach preparation</h2>
          <RunLauncher compact listId={listId} />
        </section>
      </div>
    </div>
  );
}
