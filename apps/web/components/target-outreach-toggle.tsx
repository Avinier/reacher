"use client";

import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function TargetOutreachToggle({ targetId, outreachedAt, notUsefulAt, compact = false }: { targetId: string; outreachedAt?: unknown; notUsefulAt?: unknown; compact?: boolean }) {
  const router = useRouter();
  const [outreached, setOutreached] = useState(Boolean(outreachedAt));
  const [notUseful, setNotUseful] = useState(Boolean(notUsefulAt));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  async function post(payload: { outreached?: boolean; notUseful?: boolean }, rollback: () => void) {
    setError("");
    const response = await fetch(`/api/targets/${targetId}/outreach`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      rollback();
      setError(await response.text());
      return;
    }
    startTransition(() => router.refresh());
  }

  function toggleOutreached(next: boolean) {
    const previous = outreached;
    setOutreached(next);
    void post({ outreached: next }, () => setOutreached(previous));
  }

  function toggleNotUseful(next: boolean) {
    const previous = notUseful;
    setNotUseful(next);
    void post({ notUseful: next }, () => setNotUseful(previous));
  }

  return (
    <div className={compact ? "outreach-toggle compact" : "outreach-toggle"}>
      <label className={outreached ? "check outreach-check checked" : "check outreach-check"}>
        <input type="checkbox" checked={outreached} disabled={isPending} onChange={(event) => toggleOutreached(event.target.checked)} />
        <Check size={15} />
        <span>{outreached ? "Outreached" : "Not outreached"}</span>
      </label>
      <label className={notUseful ? "check outreach-check not-useful checked" : "check outreach-check not-useful"}>
        <input type="checkbox" checked={notUseful} disabled={isPending} onChange={(event) => toggleNotUseful(event.target.checked)} />
        <X size={15} />
        <span>{notUseful ? "Not useful" : "Useful"}</span>
      </label>
      {error && <span className="status bad">{error}</span>}
    </div>
  );
}
