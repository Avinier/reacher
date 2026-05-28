import Link from "next/link";
import { RedditActionForm } from "@/components/reddit-action-form";
import { RunLauncher } from "@/components/run-launcher";
import { listRedditActions } from "@/lib/db/repositories";

export default function RedditPage() {
  const actions = listRedditActions();

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Reddit</p>
          <h1>Research Reddit, queue writes, execute through Devvit.</h1>
          <p>Posts and comments can run as user actions. Private messages are app-account messages in Devvit.</p>
        </div>
      </header>
      <div className="grid">
        <section className="panel wide">
          <h2>Research Reddit</h2>
          <RunLauncher compact />
        </section>
        <section className="panel wide">
          <h2>Explicit Reddit write action</h2>
          <RedditActionForm />
        </section>
        <section className="panel wide">
          <h2>Queued Reddit actions</h2>
          <table className="table">
            <thead>
              <tr><th>Action</th><th>Status</th><th>Target</th><th>Draft</th><th>Run</th></tr>
            </thead>
            <tbody>
              {actions.map((action) => (
                <tr key={String(action.id)}>
                  <td>{String(action.action_type)}</td>
                  <td><span className={action.status === "failed" ? "status bad" : "status"}>{String(action.status)}</span></td>
                  <td>{String(action.display_name)}</td>
                  <td>{String(action.body ?? "").slice(0, 140)}</td>
                  <td><Link href={`/runs/${action.run_id}`}>{String(action.run_id).slice(0, 14)}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          {actions.length === 0 && <p>No Reddit write actions queued yet.</p>}
          <p className="muted">Devvit playtest: <a href="https://www.reddit.com/r/reacher_usage_dev/?playtest=reacher-usage">r/reacher_usage_dev</a></p>
        </section>
      </div>
    </div>
  );
}
