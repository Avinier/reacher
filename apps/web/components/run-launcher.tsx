"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Play } from "lucide-react";
import type { GmailDraftMode, Platform } from "@reacher/shared";

const defaultPlatforms: Platform[] = ["web", "linkedin", "x", "reddit", "discord", "github"];
type LauncherMode = "research" | "outreach";

export function RunLauncher({ compact = false, listId }: { compact?: boolean; listId?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<LauncherMode>(listId ? "outreach" : "research");
  const [prompt, setPrompt] = useState(
    listId ? "Prepare outreach for the selected saved list. Use existing drafts where available." : "Find high-signal targets, explain the filters, and save the evidence."
  );
  const [draftMode, setDraftMode] = useState<GmailDraftMode>("template");
  const [recipientsRaw, setRecipientsRaw] = useState("email,name,company,role,notes\n");
  const [subject, setSubject] = useState("Quick note for {{company}}");
  const [body, setBody] = useState("Hi {{name}},\n\nI wanted to reach out about {{company}}.\n\nBest,");
  const [isPending, startTransition] = useTransition();

  function selectMode(nextMode: LauncherMode) {
    setMode(nextMode);
    if (nextMode === "research") {
      setPrompt("Find high-signal targets, explain the filters, and save the evidence.");
    } else {
      setPrompt("Prepare Gmail outreach drafts for these recipients. Keep the copy concise and specific.");
    }
  }

  async function submit() {
    const payload =
      mode === "outreach"
        ? {
            prompt,
            kind: "outreach_prepare",
            platforms: ["email"],
            listId,
            gmailOutreach: { draftMode, recipientsRaw, subject, body }
          }
        : { prompt, kind: "research", platforms: defaultPlatforms, listId };
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = (await response.json()) as { runId: string };
    startTransition(() => router.push(`/runs/${data.runId}`));
  }

  return (
    <div className={compact ? "" : "panel wide"}>
      {!compact && <h2>Start a run</h2>}
      <div style={{ display: "grid", gap: 12 }}>
        <div className="segmented" role="tablist" aria-label="Run mode">
          <button className={mode === "research" ? "active" : ""} type="button" onClick={() => selectMode("research")}>Research</button>
          <button className={mode === "outreach" ? "active" : ""} type="button" onClick={() => selectMode("outreach")}>Outreach</button>
        </div>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} aria-label="Run prompt" />
        {mode === "outreach" && (
          <div style={{ display: "grid", gap: 12 }}>
            <label className="field-stack">
              <span>Recipients</span>
              <textarea
                value={recipientsRaw}
                onChange={(event) => setRecipientsRaw(event.target.value)}
                aria-label="Gmail recipients"
                placeholder="email,name,company,role,notes"
              />
            </label>
            <div className="toolbar">
              <label className="check">
                <input type="radio" checked={draftMode === "template"} onChange={() => setDraftMode("template")} />
                Common template
              </label>
              <label className="check">
                <input type="radio" checked={draftMode === "ai"} onChange={() => setDraftMode("ai")} />
                AI personalized
              </label>
            </div>
            <label className="field-stack">
              <span>Subject</span>
              <input className="field" value={subject} onChange={(event) => setSubject(event.target.value)} />
            </label>
            <label className="field-stack">
              <span>{draftMode === "template" ? "Template body" : "AI instruction/common angle"}</span>
              <textarea value={body} onChange={(event) => setBody(event.target.value)} aria-label="Gmail body" />
            </label>
          </div>
        )}
        <div className="toolbar">
          <button className="button" onClick={submit} disabled={isPending || prompt.trim().length < 2 || (mode === "outreach" && recipientsRaw.trim().length < 3)}>
            <Play size={16} />
            {mode === "outreach" ? "Prepare outreach" : "Run research"}
          </button>
        </div>
      </div>
    </div>
  );
}
