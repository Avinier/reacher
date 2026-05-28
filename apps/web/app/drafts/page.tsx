import { listDrafts } from "@/lib/db/repositories";

export default function DraftsPage() {
  const drafts = listDrafts();
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Drafts</p>
          <h1>Messages stay reviewable before browser preparation.</h1>
        </div>
      </header>
      <section className="panel wide">
        <table className="table">
          <thead><tr><th>Target</th><th>Platform</th><th>Status</th><th>Body</th></tr></thead>
          <tbody>
            {drafts.map((draft) => (
              <tr key={String(draft.id)}>
                <td>{String(draft.display_name)}</td>
                <td>{String(draft.platform)}</td>
                <td>{String(draft.status)}</td>
                <td>{String(draft.body)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {drafts.length === 0 && <p>No drafts generated yet.</p>}
      </section>
    </div>
  );
}
