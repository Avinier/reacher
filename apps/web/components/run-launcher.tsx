"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Play } from "lucide-react";
import { platforms, runKinds, type Platform, type RunKind } from "@reacher/shared";

const defaultPlatforms: Platform[] = ["web", "linkedin", "x", "reddit", "discord", "github"];

export function RunLauncher({ compact = false, listId }: { compact?: boolean; listId?: string }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(
    listId ? "Prepare outreach for the selected saved list. Use existing drafts where available." : "Find high-signal targets, explain the filters, and save the evidence."
  );
  const [kind, setKind] = useState<RunKind>(listId ? "outreach_prepare" : "research");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(listId ? ["linkedin"] : defaultPlatforms);
  const [isPending, startTransition] = useTransition();

  function toggle(platform: Platform) {
    setSelectedPlatforms((current) =>
      current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]
    );
  }

  async function submit() {
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, kind, platforms: selectedPlatforms, listId })
    });
    const data = (await response.json()) as { runId: string };
    startTransition(() => router.push(`/runs/${data.runId}`));
  }

  return (
    <div className={compact ? "" : "panel wide"}>
      {!compact && <h2>Start a run</h2>}
      <div style={{ display: "grid", gap: 12 }}>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} aria-label="Run prompt" />
        <div className="toolbar">
          <select className="field" style={{ maxWidth: 240 }} value={kind} onChange={(event) => setKind(event.target.value as RunKind)}>
            {runKinds.map((runKind) => (
              <option key={runKind} value={runKind}>
                {runKind.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <div className="checks">
            {platforms.map((platform) => (
              <label key={platform} className="check">
                <input type="checkbox" checked={selectedPlatforms.includes(platform)} onChange={() => toggle(platform)} />
                {platform}
              </label>
            ))}
          </div>
          <button className="button" onClick={submit} disabled={isPending || selectedPlatforms.length === 0 || prompt.trim().length < 2}>
            <Play size={16} />
            Run
          </button>
        </div>
      </div>
    </div>
  );
}
