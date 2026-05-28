import { notFound } from "next/navigation";
import { ContextActions } from "@/components/context-actions";
import { getBrowserContext } from "@/lib/db/repositories";
import { type BrowserPlatform } from "@reacher/shared";

export default async function ContextDetailPage({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const context = getBrowserContext(platform as BrowserPlatform);
  if (!context) notFound();

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Context</p>
          <h1>{String(context.display_name)}</h1>
          <p>Provider context IDs stay server-side. Login happens in Browserbase, not inside Reacher.</p>
        </div>
        <span className={context.status === "ready" ? "status" : "status bad"}>{String(context.status)}</span>
      </header>
      <section className="panel wide">
        <h2>Onboarding</h2>
        <p>Open a Browserbase login session, complete platform login there, then verify the context.</p>
        <ContextActions platform={String(context.platform)} />
      </section>
      <section className="panel wide">
        <h2>State</h2>
        <table className="table">
          <tbody>
            <tr><th>Account label</th><td>{String(context.account_label ?? "")}</td></tr>
            <tr><th>Last verified</th><td>{context.last_verified_at ? new Date(Number(context.last_verified_at)).toLocaleString() : ""}</td></tr>
            <tr><th>Last session</th><td>{String(context.last_session_id ?? "")}</td></tr>
            <tr><th>Last error</th><td>{String(context.last_error ?? "")}</td></tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
