import Link from "next/link";
import { listLists } from "@/lib/db/repositories";

export default function ListsPage() {
  const lists = listLists();
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Lists</p>
          <h1>Filtered targets with reasons attached.</h1>
        </div>
      </header>
      <section className="panel wide">
        <table className="table">
          <thead><tr><th>Name</th><th>Targets</th><th>Description</th></tr></thead>
          <tbody>
            {lists.map((list) => (
              <tr key={String(list.id)}>
                <td><Link href={`/lists/${list.id}`}>{String(list.name)}</Link></td>
                <td>{String(list.target_count)}</td>
                <td>{String(list.description ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {lists.length === 0 && <p>No saved lists yet.</p>}
      </section>
    </div>
  );
}
