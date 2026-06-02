"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function TargetOutreachToggle({ targetId, outreachedAt, compact = false }: { targetId: string; outreachedAt?: unknown; compact?: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(Boolean(outreachedAt));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  async function toggle(next: boolean) {
    setChecked(next);
    setError("");
    const response = await fetch(`/api/targets/${targetId}/outreach`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outreached: next })
    });
    if (!response.ok) {
      setChecked(!next);
      setError(await response.text());
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className={compact ? "outreach-toggle compact" : "outreach-toggle"}>
      <label className={checked ? "check outreach-check checked" : "check outreach-check"}>
        <input type="checkbox" checked={checked} disabled={isPending} onChange={(event) => toggle(event.target.checked)} />
        <Check size={15} />
        <span>{checked ? "Outreached" : "Not outreached"}</span>
      </label>
      {error && <span className="status bad">{error}</span>}
    </div>
  );
}
