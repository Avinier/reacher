import { RunTable } from "@/components/tables";
import { listRuns } from "@/lib/db/repositories";

export default function RunsPage() {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Run Ledger</p>
          <h1>Every browser job stays inspectable.</h1>
        </div>
      </header>
      <section className="panel wide">
        <RunTable runs={listRuns(100)} />
      </section>
    </div>
  );
}
