"use client";

import { useState, useTransition } from "react";

type GmailMessage = {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
};

export function GmailReadPreview({ enabled }: { enabled: boolean }) {
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  async function loadMessages() {
    setError("");
    startTransition(async () => {
      const response = await fetch("/api/gmail/messages?limit=5");
      const data = (await response.json()) as { messages?: GmailMessage[]; error?: string };
      if (!response.ok) {
        setError(data.error || "Could not read Gmail messages.");
        return;
      }
      setMessages(data.messages || []);
    });
  }

  if (!enabled) return null;

  return (
    <div className="stack-sm" style={{ marginTop: 12 }}>
      <button className="button secondary" type="button" onClick={loadMessages} disabled={isPending}>
        Test Gmail read
      </button>
      {error && <p className="muted">{error}</p>}
      {messages.length > 0 && (
        <table className="table">
          <thead><tr><th>From</th><th>Subject</th><th>Snippet</th></tr></thead>
          <tbody>
            {messages.map((message) => (
              <tr key={message.id}>
                <td>{message.from}</td>
                <td>{message.subject || "(no subject)"}</td>
                <td>{message.snippet}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
