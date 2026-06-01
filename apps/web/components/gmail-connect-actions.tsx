"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function GmailConnectActions({ configured, connected }: { configured: boolean; connected: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function disconnect() {
    await fetch("/api/integrations/gmail/disconnect", { method: "POST" });
    startTransition(() => router.refresh());
  }

  if (!configured) {
    return <span className="muted">Add Google OAuth credentials to enable Gmail connect.</span>;
  }

  if (connected) {
    return (
      <button className="button secondary" type="button" onClick={disconnect} disabled={isPending}>
        Disconnect Gmail
      </button>
    );
  }

  return (
    <a className="button" href="/api/integrations/gmail/oauth/start">
      Connect Gmail
    </a>
  );
}
