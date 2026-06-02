"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "failed">("idle");

  async function copy() {
    setState("copying");
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    } finally {
      window.setTimeout(() => setState("idle"), 1400);
    }
  }

  return (
    <button className="button secondary compact-button" type="button" onClick={copy} disabled={state === "copying"}>
      {state === "copied" ? "Copied" : state === "failed" ? "Failed" : label}
    </button>
  );
}
