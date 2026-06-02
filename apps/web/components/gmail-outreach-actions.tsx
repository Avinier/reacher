"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export type GmailActionInput = {
  actionId: string;
  to: string;
  subject: string;
  body: string;
  approved: boolean;
  status: string;
  gmailDraftId?: string;
};

export function GmailOutreachActions({ actions }: { actions: GmailActionInput[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function post(action: GmailActionInput, payload: Record<string, unknown>) {
    await fetch(`/api/gmail/actions/${action.actionId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    startTransition(() => router.refresh());
  }

  async function createDraft(action: GmailActionInput) {
    await post(action, {
      action: "create_draft",
      to: action.to,
      subject: action.subject,
      body: action.body,
      approved: action.approved
    });
  }

  async function send(action: GmailActionInput) {
    if (!action.gmailDraftId) return;
    await post(action, { action: "send", gmailDraftId: action.gmailDraftId, approved: action.approved });
  }

  async function createApprovedDrafts() {
    for (const action of actions) {
      if (action.approved && action.status === "queued") {
        await createDraft(action);
      }
    }
  }

  async function sendApprovedDrafts() {
    for (const action of actions) {
      if (action.approved && action.gmailDraftId && action.status === "prepared") {
        await send(action);
      }
    }
  }

  return (
    <div className="toolbar">
      <button className="button secondary" type="button" onClick={createApprovedDrafts} disabled={isPending}>
        Create Gmail drafts
      </button>
      <button className="button" type="button" onClick={sendApprovedDrafts} disabled={isPending}>
        Send approved
      </button>
      <span className="muted">Gmail actions require a connected Gmail account.</span>
    </div>
  );
}

export function GmailRowActions({ action }: { action: GmailActionInput }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function post(payload: Record<string, unknown>) {
    await fetch(`/api/gmail/actions/${action.actionId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    startTransition(() => router.refresh());
  }

  return (
    <div className="toolbar">
      <label className="check">
        <input type="checkbox" checked={action.approved} onChange={(event) => post({ action: "approve", approved: event.target.checked })} disabled={isPending} />
        Approved
      </label>
      <button
        className="button secondary"
        type="button"
        onClick={() => post({ action: "create_draft", to: action.to, subject: action.subject, body: action.body, approved: action.approved })}
        disabled={isPending || !action.approved || action.status !== "queued"}
      >
        Create draft
      </button>
      <button
        className="button"
        type="button"
        onClick={() => post({ action: "send", gmailDraftId: action.gmailDraftId, approved: action.approved })}
        disabled={isPending || !action.approved || !action.gmailDraftId || action.status !== "prepared"}
      >
        Send
      </button>
    </div>
  );
}
