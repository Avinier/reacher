"use client";

import { useState, useTransition } from "react";
import { ExternalLink, RotateCw, ShieldCheck } from "lucide-react";

export function ContextActions({ platform }: { platform: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function call(action: "open" | "verify") {
    startTransition(async () => {
      const response = await fetch(`/api/contexts/${platform}?action=${action}`, { method: "POST" });
      const data = await response.json();
      if (action === "open" && data.liveUrl) {
        window.open(data.liveUrl, "_blank", "noopener,noreferrer");
      }
      setMessage(action === "open" ? `Login session: ${data.configOk ? "opened" : "local fallback opened"}` : `Verification status: ${data.status}`);
      window.location.reload();
    });
  }

  return (
    <div className="toolbar">
      <button className="button" onClick={() => call("open")} disabled={isPending}>
        <ExternalLink size={16} />
        Open login
      </button>
      <button className="button secondary" onClick={() => call("verify")} disabled={isPending}>
        <ShieldCheck size={16} />
        Verify
      </button>
      {message && <span className="muted">{message}</span>}
      {isPending && <RotateCw size={16} aria-label="Working" />}
    </div>
  );
}
