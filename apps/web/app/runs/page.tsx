import { RunTable } from "@/components/tables";
import Link from "next/link";
import { listRuns, listRunsByMode } from "@/lib/db/repositories";

export default async function RunsPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  const activeMode = mode === "research" || mode === "outreach" ? mode : "all";
  const runs = activeMode === "research" || activeMode === "outreach" ? listRunsByMode(activeMode, 100) : listRuns(100);
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Run Ledger</p>
          <h1>Every browser job stays inspectable.</h1>
        </div>
      </header>
      <section className="panel wide">
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <Link className={activeMode === "all" ? "button" : "button secondary"} href="/runs">All runs</Link>
          <Link className={activeMode === "research" ? "button" : "button secondary"} href="/runs?mode=research">Research runs</Link>
          <Link className={activeMode === "outreach" ? "button" : "button secondary"} href="/runs?mode=outreach">Outreach runs</Link>
        </div>
        <RunTable runs={runs} />
      </section>
    </div>
  );
}
