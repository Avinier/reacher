"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export type LinkedInActionInput = {
  actionId: string;
  runId: string;
  profileUrl: string;
  connectionNote: string;
  dm: string;
  approved: boolean;
  status: string;
  liveUrl?: string;
};

export function LinkedInRowActions({ action }: { action: LinkedInActionInput }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function post(payload: Record<string, unknown>) {
    await fetch(`/api/linkedin/actions/${action.actionId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    startTransition(() => router.refresh());
  }

  return (
    <div className="toolbar">
      <label className="check">
        <input type="checkbox" checked={action.approved} onChange={(event) => post({ action: "approve", approved: event.target.checked })} disabled={isPending || action.status === "failed"} />
        Approved
      </label>
      <button
        className="button secondary"
        type="button"
        onClick={() => post({ action: "stage", runId: action.runId, profileUrl: action.profileUrl, approved: action.approved })}
        disabled={isPending || !action.approved || action.status === "failed" || action.status === "done"}
      >
        Stage in Browserbase
      </button>
      {action.liveUrl && <a className="button secondary" href={action.liveUrl} target="_blank" rel="noreferrer">Live session</a>}
      <button
        className="button"
        type="button"
        onClick={() => post({ action: "mark_sent" })}
        disabled={isPending || !["waiting_for_operator", "prepared"].includes(action.status)}
      >
        Mark sent
      </button>
    </div>
  );
}
