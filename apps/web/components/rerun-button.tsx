"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function RerunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  async function rerun() {
    setError("");
    const response = await fetch(`/api/runs/${runId}/rerun`, { method: "POST" });
    if (!response.ok) {
      setError(await response.text());
      return;
    }
    const data = (await response.json()) as { runId: string };
    startTransition(() => router.push(`/runs/${data.runId}`));
  }

  return (
    <span className="inline-action">
      <button className="button secondary" type="button" onClick={rerun} disabled={isPending}>
        <RotateCcw size={16} />
        {isPending ? "Queueing..." : "Re-run"}
      </button>
      {error && <span className="muted">{error}</span>}
    </span>
  );
}
