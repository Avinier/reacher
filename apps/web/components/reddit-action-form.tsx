"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { type RedditActionType } from "@reacher/shared";

export function RedditActionForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actionType, setActionType] = useState<RedditActionType>("submit_post");
  const [subredditName, setSubredditName] = useState("reacher_usage_dev");
  const [postId, setPostId] = useState("");
  const [username, setUsername] = useState("");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [runAs, setRunAs] = useState<"USER" | "APP">("USER");
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    const payload =
      actionType === "submit_post" ? { actionType, subredditName, title, text, runAs } :
      actionType === "submit_comment" ? { actionType, postId, text, runAs } :
      { actionType, username, subject, text };

    const response = await fetch("/api/reddit/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      setError(await response.text());
      return;
    }

    const data = (await response.json()) as { runId: string };
    startTransition(() => router.push(`/runs/${data.runId}`));
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="toolbar">
        <select className="field" style={{ maxWidth: 260 }} value={actionType} onChange={(event) => setActionType(event.target.value as RedditActionType)}>
          <option value="submit_post">Submit post</option>
          <option value="submit_comment">Submit comment</option>
          <option value="send_private_message">Send private message</option>
        </select>
        {actionType !== "send_private_message" && (
          <select className="field" style={{ maxWidth: 160 }} value={runAs} onChange={(event) => setRunAs(event.target.value as "USER" | "APP")}>
            <option value="USER">run as user</option>
            <option value="APP">run as app</option>
          </select>
        )}
      </div>

      {actionType === "submit_post" && (
        <>
          <label>Subreddit<input className="field" value={subredditName} onChange={(event) => setSubredditName(event.target.value)} /></label>
          <label>Title<input className="field" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        </>
      )}

      {actionType === "submit_comment" && (
        <label>Post or comment fullname<input className="field" placeholder="t3_abc123 or t1_abc123" value={postId} onChange={(event) => setPostId(event.target.value)} /></label>
      )}

      {actionType === "send_private_message" && (
        <>
          <label>Username<input className="field" placeholder="without u/" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label>Subject<input className="field" value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
        </>
      )}

      <label>Text<textarea value={text} onChange={(event) => setText(event.target.value)} /></label>
      {actionType === "send_private_message" && <p className="muted">Devvit private messages are sent by the app account. User-attributed writes are limited to posts and comments.</p>}
      {error && <p className="status bad">{error}</p>}
      <button className="button" onClick={submit} disabled={isPending || text.trim().length === 0}>
        <Send size={16} />
        Queue explicit Reddit action
      </button>
    </div>
  );
}
