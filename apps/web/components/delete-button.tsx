"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function DeleteButton({ apiPath, confirmLabel, redirectTo }: { apiPath: string; confirmLabel: string; redirectTo?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  async function remove() {
    if (!window.confirm(confirmLabel)) return;
    setError("");
    const response = await fetch(apiPath, { method: "DELETE" });
    if (!response.ok) {
      setError("Delete failed.");
      return;
    }
    startTransition(() => {
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    });
  }

  return (
    <span className="inline-action">
      <button className="button danger" type="button" onClick={remove} disabled={isPending}>
        Delete
      </button>
      {error && <span className="muted">{error}</span>}
    </span>
  );
}
