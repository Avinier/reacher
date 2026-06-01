"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Search } from "lucide-react";

export function TargetResearchButton({ targetId }: { targetId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    const response = await fetch(`/api/targets/${targetId}/research`, { method: "POST" });
    if (!response.ok) {
      setError(await response.text());
      return;
    }
    const data = (await response.json()) as { runId: string };
    startTransition(() => router.push(`/runs/${data.runId}`));
  }

  return (
    <div className="stack-sm">
      <button className="button" onClick={submit} disabled={isPending}>
        <Search size={16} />
        {isPending ? "Queueing..." : "Research further"}
      </button>
      {error && <span className="status bad">{error}</span>}
    </div>
  );
}
