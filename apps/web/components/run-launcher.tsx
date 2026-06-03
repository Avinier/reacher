"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Play } from "lucide-react";
import type { GmailDraftMode, Platform } from "@reacher/shared";

const defaultPlatforms: Platform[] = ["web", "linkedin", "x", "reddit", "discord", "github"];
type LauncherMode = "research" | "outreach";
type OutreachChannel = "gmail" | "linkedin";
type OutreachListOption = { id: string; name: string; targetCount: number };
type OutreachTargetOption = { id: string; name: string; platform: string; profileUrl?: string; organization?: string };

export function RunLauncher({ compact = false, listId, outreachLists = [], outreachTargets = [] }: { compact?: boolean; listId?: string; outreachLists?: OutreachListOption[]; outreachTargets?: OutreachTargetOption[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<LauncherMode>(listId ? "outreach" : "research");
  const [channel, setChannel] = useState<OutreachChannel>("gmail");
  const [prompt, setPrompt] = useState(
    listId ? "Prepare outreach for the selected saved list. Use existing drafts where available." : "Find high-signal targets, explain the filters, and save the evidence."
  );
  const [draftMode, setDraftMode] = useState<GmailDraftMode>("template");
  const [recipientsRaw, setRecipientsRaw] = useState("email,name,company,role,notes\n");
  const [subject, setSubject] = useState("Quick note for {{company}}");
  const [body, setBody] = useState("Hi {{name}},\n\nI wanted to reach out about {{company}}.\n\nBest,");
  const [selectedListIds, setSelectedListIds] = useState<string[]>(listId ? [listId] : []);
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const [connectionTemplate, setConnectionTemplate] = useState("Hi {{name}}, {{notes}}. Would be good to connect.");
  const [dmTemplate, setDmTemplate] = useState("Hi {{name}},\n\n{{notes}}. Thought it could be useful to compare notes.\n\nBest,");
  const [isPending, startTransition] = useTransition();

  function selectMode(nextMode: LauncherMode) {
    setMode(nextMode);
    if (nextMode === "research") {
      setPrompt("Find high-signal targets, explain the filters, and save the evidence.");
    } else {
      setPrompt(channel === "linkedin" ? "Prepare supervised LinkedIn outreach for selected saved targets." : "Prepare Gmail outreach drafts for these recipients. Keep the copy concise and specific.");
    }
  }

  function toggleList(id: string) {
    setSelectedListIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleTarget(id: string) {
    setSelectedTargetIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function submit() {
    const payload =
      mode === "outreach"
        ? channel === "linkedin"
          ? {
            prompt,
            kind: "outreach_prepare",
            platforms: ["linkedin"],
            linkedinOutreach: {
              targetIds: selectedTargetIds,
              listIds: selectedListIds,
              connectionTemplate,
              dmTemplate,
              mode: "connect_note_first"
            }
          }
          : {
            prompt,
            kind: "outreach_prepare",
            platforms: ["email"],
            listId,
            gmailOutreach: { draftMode, recipientsRaw, subject, body }
          }
        : { prompt, kind: "research", platforms: defaultPlatforms, researchMode: "code_mode_first", listId };
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
            <div className="segmented" role="tablist" aria-label="Outreach channel">
              <button className={channel === "gmail" ? "active" : ""} type="button" onClick={() => setChannel("gmail")}>Gmail</button>
              <button className={channel === "linkedin" ? "active" : ""} type="button" onClick={() => setChannel("linkedin")}>LinkedIn</button>
            </div>
            {channel === "gmail" ? (
              <>
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
              </>
            ) : (
              <>
                <div className="grid tight">
                  <section className="mini-panel">
                    <strong>Lists</strong>
                    {outreachLists.map((list) => (
                      <label key={list.id} className="check block">
                        <input type="checkbox" checked={selectedListIds.includes(list.id)} onChange={() => toggleList(list.id)} />
                        {list.name} ({list.targetCount})
                      </label>
                    ))}
                    {outreachLists.length === 0 && <p className="muted">No saved lists yet.</p>}
                  </section>
                  <section className="mini-panel">
                    <strong>Targets</strong>
                    {outreachTargets.map((target) => (
                      <label key={target.id} className="check block">
                        <input type="checkbox" checked={selectedTargetIds.includes(target.id)} onChange={() => toggleTarget(target.id)} />
                        {target.name} {target.profileUrl ? "" : "(missing LinkedIn URL)"}
                      </label>
                    ))}
                    {outreachTargets.length === 0 && <p className="muted">No saved targets yet.</p>}
                  </section>
                </div>
                <label className="field-stack">
                  <span>Connection note template</span>
                  <textarea value={connectionTemplate} onChange={(event) => setConnectionTemplate(event.target.value)} aria-label="LinkedIn connection note template" />
                </label>
                <label className="field-stack">
                  <span>DM template</span>
                  <textarea value={dmTemplate} onChange={(event) => setDmTemplate(event.target.value)} aria-label="LinkedIn DM template" />
                </label>
                <p className="muted">LinkedIn variables: {"{{name}}, {{company}}, {{role}}, {{headline}}, {{notes}}, {{linkedin_url}}. Missing LinkedIn URLs are skipped."}</p>
              </>
            )}
          </div>
        )}
        <div className="toolbar">
          <button className="button" onClick={submit} disabled={isPending || prompt.trim().length < 2 || (mode === "outreach" && channel === "gmail" && recipientsRaw.trim().length < 3) || (mode === "outreach" && channel === "linkedin" && selectedListIds.length === 0 && selectedTargetIds.length === 0)}>
            <Play size={16} />
            {mode === "outreach" ? "Prepare outreach" : "Run research"}
          </button>
        </div>
      </div>
    </div>
  );
}
