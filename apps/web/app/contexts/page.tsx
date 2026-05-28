import Link from "next/link";
import { ContextActions } from "@/components/context-actions";
import { getBrowserContexts } from "@/lib/db/repositories";

export default function ContextsPage() {
  const contexts = getBrowserContexts();
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Browser Identity</p>
          <h1>One persistent Browserbase context per platform.</h1>
        </div>
      </header>
      <div className="grid">
        {contexts.map((context) => (
          <section className="panel" key={String(context.id)}>
            <h2><Link href={`/contexts/${context.platform}`}>{String(context.display_name)}</Link></h2>
            <p><span className={context.status === "ready" ? "status" : "status bad"}>{String(context.status)}</span></p>
            <p>{String(context.account_label ?? context.last_error ?? "Manual login required before authenticated runs.")}</p>
            <ContextActions platform={String(context.platform)} />
          </section>
        ))}
      </div>
    </div>
  );
}
