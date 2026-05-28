from __future__ import annotations

import json
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

from reacher_runner.reddit import RedditResearchResult


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:20]}"


class ReacherDb:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.execute("PRAGMA busy_timeout = 5000")

    def close(self) -> None:
        self.conn.close()

    def claim_next_run(self) -> sqlite3.Row | None:
        now = int(time.time() * 1000)
        with self.conn:
            row = self.conn.execute(
                "SELECT * FROM runs WHERE status = 'queued' ORDER BY created_at LIMIT 1"
            ).fetchone()
            if row is None:
                return None
            self.conn.execute(
                "UPDATE runs SET status = 'claimed', updated_at = ?, started_at = COALESCE(started_at, ?) WHERE id = ? AND status = 'queued'",
                (now, now, row["id"]),
            )
            claimed = self.conn.execute("SELECT * FROM runs WHERE id = ?", (row["id"],)).fetchone()
        return claimed

    def mark_run(self, run_id: str, status: str, **fields: Any) -> None:
        now = int(time.time() * 1000)
        assignments = ["status = ?", "updated_at = ?"]
        values: list[Any] = [status, now]
        for column, value in fields.items():
            assignments.append(f"{column} = ?")
            values.append(value)
        if status in {"completed", "failed", "cancelled", "interrupted"}:
            assignments.append("completed_at = ?")
            values.append(now)
        values.append(run_id)
        with self.conn:
            self.conn.execute(f"UPDATE runs SET {', '.join(assignments)} WHERE id = ?", values)

    def next_step_index(self, run_id: str) -> int:
        row = self.conn.execute('SELECT COALESCE(MAX("index"), -1) + 1 AS idx FROM run_steps WHERE run_id = ?', (run_id,)).fetchone()
        return int(row["idx"])

    def add_step(self, run_id: str, kind: str, title: str, detail: str = "", status: str = "completed", input_json: Any = None, output_json: Any = None) -> str:
        now = int(time.time() * 1000)
        step_id = new_id("step")
        with self.conn:
            self.conn.execute(
                'INSERT INTO run_steps (id, run_id, "index", status, kind, title, detail, input_json, output_json, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (
                    step_id,
                    run_id,
                    self.next_step_index(run_id),
                    status,
                    kind,
                    title,
                    detail,
                    json.dumps(input_json) if input_json is not None else None,
                    json.dumps(output_json) if output_json is not None else None,
                    now,
                    now if status in {"completed", "failed", "skipped"} else None,
                ),
            )
        return step_id

    def settings(self, run: sqlite3.Row) -> dict[str, Any]:
        raw = run["settings_json"]
        if not raw:
            return {}
        if isinstance(raw, str):
            return json.loads(raw)
        return dict(raw)

    def get_ready_context(self, platform: str) -> sqlite3.Row | None:
        return self.conn.execute(
            "SELECT * FROM browser_contexts WHERE platform = ? AND status = 'ready'",
            (platform,),
        ).fetchone()

    def save_research_fixture(self, run: sqlite3.Row) -> str:
        now = int(time.time() * 1000)
        run_id = run["id"]
        settings = self.settings(run)
        platform = next((item for item in settings.get("platforms", []) if item != "web"), "web")
        list_id = new_id("list")
        source_id = new_id("source")
        target_id = new_id("target")
        draft_id = new_id("draft")

        with self.conn:
            self.conn.execute(
                "UPDATE runs SET interpreted_goal = ? WHERE id = ?",
                ("Discover high-signal targets, explain filters, and save evidence.", run_id),
            )
            self.conn.execute(
                "INSERT INTO research_filters (id, run_id, platform, kind, value, reason, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (new_id("filter"), run_id, platform, "seed_filter", f"{platform} high-intent conversation filter", "Initial runnable workflow fixture until live Browserbase research is configured.", 0.72, now),
            )
            self.conn.execute(
                "INSERT INTO sources (id, run_id, platform, source_type, url, title, summary, captured_at) VALUES (?, ?, ?, 'search_result', ?, ?, ?, ?)",
                (source_id, run_id, platform, "https://example.com/reacher-fixture", "Seed research source", "A placeholder source proving persistence and export wiring.", now),
            )
            self.conn.execute(
                "INSERT INTO lists (id, name, description, source_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (list_id, "Seed research list", "Created by the local runner smoke workflow.", run_id, now, now),
            )
            self.conn.execute(
                "INSERT INTO targets (id, run_id, list_id, platform, target_type, display_name, handle, profile_url, role_or_context, relevance_score, why_relevant, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'person', ?, ?, ?, ?, ?, ?, 'saved', ?, ?)",
                (target_id, run_id, list_id, platform, "Example Target", "@example", "https://example.com/profile", "Fixture target", 0.72, "Saved to prove the run can persist targets with relevance reasoning.", now, now),
            )
            self.conn.execute(
                "INSERT INTO list_items (id, list_id, target_id, rank, notes, created_at) VALUES (?, ?, ?, 1, ?, ?)",
                (new_id("li"), list_id, target_id, "Seed item from runner.", now),
            )
            self.conn.execute(
                "INSERT INTO target_evidence (id, target_id, source_id, evidence_type, text, url, confidence, created_at) VALUES (?, ?, ?, 'observation', ?, ?, ?, ?)",
                (new_id("ev"), target_id, source_id, "The fixture source matched the run's initial discovery filter.", "https://example.com/reacher-fixture", 0.72, now),
            )
            self.conn.execute(
                "INSERT INTO drafts (id, target_id, run_id, platform, draft_type, body, evidence_summary, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'dm', ?, ?, 'generated', ?, ?)",
                (draft_id, target_id, run_id, platform, "Hi Example, I noticed the signal captured in the research run and wanted to compare notes.", "Uses the saved fixture evidence.", now, now),
            )
        return list_id

    def save_reddit_research(self, run: sqlite3.Row, result: RedditResearchResult) -> str:
        now = int(time.time() * 1000)
        run_id = run["id"]
        list_id = new_id("list")

        with self.conn:
            self.conn.execute(
                "UPDATE runs SET interpreted_goal = ? WHERE id = ?",
                ("Discover Reddit communities, posts, commenters, and outreach angles from public Reddit evidence.", run_id),
            )
            self.conn.execute(
                "INSERT INTO lists (id, name, description, source_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (list_id, f"Reddit research: {result.query[:54]}", "Reddit posts, users, and threads found from public evidence.", run_id, now, now),
            )
            self.conn.execute(
                "INSERT INTO research_filters (id, run_id, platform, kind, value, reason, confidence, created_at) VALUES (?, ?, 'reddit', 'query', ?, ?, ?, ?)",
                (new_id("filter"), run_id, result.query, "Primary Reddit search query derived from the user prompt.", 0.82, now),
            )
            for subreddit in result.subreddits:
                self.conn.execute(
                    "INSERT INTO research_filters (id, run_id, platform, kind, value, reason, confidence, created_at) VALUES (?, ?, 'reddit', 'subreddit', ?, ?, ?, ?)",
                    (new_id("filter"), run_id, f"r/{subreddit}", "User-specified subreddit filter.", 0.9, now),
                )

            rank = 1
            post_sources: dict[str, str] = {}
            for post in result.posts:
                source_id = new_id("source")
                post_sources[post.id] = source_id
                summary = f"Score {post.score}; {post.num_comments} comments. {post.selftext[:240]}"
                self.conn.execute(
                    "INSERT INTO sources (id, run_id, platform, source_type, url, title, summary, captured_at) VALUES (?, ?, 'reddit', 'post', ?, ?, ?, ?)",
                    (source_id, run_id, post.permalink, post.title, summary, now),
                )
                target_id = new_id("target")
                self.conn.execute(
                    "INSERT INTO targets (id, run_id, list_id, platform, target_type, display_name, handle, profile_url, organization, role_or_context, relevance_score, why_relevant, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, 'reddit', 'thread', ?, ?, ?, ?, ?, ?, ?, 'saved', ?, ?, ?)",
                    (
                        target_id,
                        run_id,
                        list_id,
                        post.title[:120] or f"Reddit post {post.id}",
                        post.author,
                        post.permalink,
                        f"r/{post.subreddit}",
                        f"{post.num_comments} comments",
                        min(0.99, 0.55 + min(post.score, 500) / 1000 + min(post.num_comments, 100) / 500),
                        f"Matched Reddit query '{result.query}' in r/{post.subreddit}.",
                        json.dumps({"reddit_id": f"t3_{post.id}", "source_method": "reddit_json", "num_comments": post.num_comments, "score": post.score}),
                        now,
                        now,
                    ),
                )
                self.conn.execute(
                    "INSERT INTO list_items (id, list_id, target_id, rank, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (new_id("li"), list_id, target_id, rank, "Reddit thread target.", now),
                )
                rank += 1
                self.conn.execute(
                    "INSERT INTO target_evidence (id, target_id, source_id, evidence_type, text, url, confidence, created_at) VALUES (?, ?, ?, 'page_fact', ?, ?, ?, ?)",
                    (new_id("ev"), target_id, source_id, f"{post.title}\n\n{post.selftext[:500]}", post.permalink, 0.82, now),
                )
                draft_id = new_id("draft")
                self.conn.execute(
                    "INSERT INTO drafts (id, target_id, run_id, platform, draft_type, body, evidence_summary, status, created_at, updated_at) VALUES (?, ?, ?, 'reddit', 'comment', ?, ?, 'generated', ?, ?)",
                    (
                        draft_id,
                        target_id,
                        run_id,
                        f"Thoughtful thread reply draft for '{post.title[:80]}':\n\nThis is relevant. I noticed the point about {result.query[:80]}. Curious how you are handling this today?",
                        f"Based on post title and public thread metadata from r/{post.subreddit}.",
                        now,
                        now,
                    ),
                )

                if post.author:
                    account_target_id = new_id("target")
                    profile_url = f"https://www.reddit.com/user/{post.author}/"
                    self.conn.execute(
                        "INSERT INTO targets (id, run_id, list_id, platform, target_type, display_name, handle, profile_url, organization, role_or_context, relevance_score, why_relevant, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, 'reddit', 'account', ?, ?, ?, ?, ?, ?, ?, 'saved', ?, ?, ?)",
                        (
                            account_target_id,
                            run_id,
                            list_id,
                            f"u/{post.author}",
                            post.author,
                            profile_url,
                            f"r/{post.subreddit}",
                            "Post author",
                            0.7,
                            f"Authored a Reddit post matching '{result.query}'.",
                            json.dumps({"source_post_id": f"t3_{post.id}", "source_method": "reddit_json"}),
                            now,
                            now,
                        ),
                    )
                    self.conn.execute(
                        "INSERT INTO list_items (id, list_id, target_id, rank, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (new_id("li"), list_id, account_target_id, rank, "Reddit account target.", now),
                    )
                    rank += 1
                    self.conn.execute(
                        "INSERT INTO target_evidence (id, target_id, source_id, evidence_type, text, url, confidence, created_at) VALUES (?, ?, ?, 'activity_signal', ?, ?, ?, ?)",
                        (new_id("ev"), account_target_id, source_id, f"u/{post.author} authored: {post.title}", post.permalink, 0.78, now),
                    )
                    self.conn.execute(
                        "INSERT INTO drafts (id, target_id, run_id, platform, draft_type, body, evidence_summary, status, created_at, updated_at) VALUES (?, ?, ?, 'reddit', 'dm', ?, ?, 'generated', ?, ?)",
                        (
                            new_id("draft"),
                            account_target_id,
                            run_id,
                            f"Subject: Quick question on {result.query[:60]}\n\nSaw your Reddit post in r/{post.subreddit} about {post.title[:90]}. I am researching this area and wanted to compare notes if useful.",
                            f"Based on public post authored by u/{post.author}.",
                            now,
                            now,
                        ),
                    )

            for comment in result.comments:
                if not comment.author:
                    continue
                source_id = post_sources.get(comment.post_id)
                target_id = new_id("target")
                profile_url = f"https://www.reddit.com/user/{comment.author}/"
                self.conn.execute(
                    "INSERT INTO targets (id, run_id, list_id, platform, target_type, display_name, handle, profile_url, organization, role_or_context, relevance_score, why_relevant, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, 'reddit', 'account', ?, ?, ?, ?, ?, ?, ?, 'saved', ?, ?, ?)",
                    (
                        target_id,
                        run_id,
                        list_id,
                        f"u/{comment.author}",
                        comment.author,
                        profile_url,
                        f"r/{comment.subreddit}",
                        "Comment author",
                        min(0.94, 0.62 + min(comment.score, 200) / 700),
                        f"Commented in a thread matching '{result.query}'.",
                        json.dumps({"reddit_id": f"t1_{comment.id}", "source_post_id": f"t3_{comment.post_id}", "source_method": "reddit_json", "score": comment.score}),
                        now,
                        now,
                    ),
                )
                self.conn.execute(
                    "INSERT INTO list_items (id, list_id, target_id, rank, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (new_id("li"), list_id, target_id, rank, "Reddit commenter target.", now),
                )
                rank += 1
                self.conn.execute(
                    "INSERT INTO target_evidence (id, target_id, source_id, evidence_type, text, url, confidence, created_at) VALUES (?, ?, ?, 'quote', ?, ?, ?, ?)",
                    (new_id("ev"), target_id, source_id, comment.body[:800], comment.permalink, 0.78, now),
                )
                self.conn.execute(
                    "INSERT INTO drafts (id, target_id, run_id, platform, draft_type, body, evidence_summary, status, created_at, updated_at) VALUES (?, ?, ?, 'reddit', 'dm', ?, ?, 'generated', ?, ?)",
                    (
                        new_id("draft"),
                        target_id,
                        run_id,
                        f"Subject: Your Reddit comment on {result.query[:60]}\n\nI saw your comment in r/{comment.subreddit}: \"{comment.body[:140]}\". I am researching this and wanted to ask a quick follow-up if you are open to it.",
                        f"Based on public comment by u/{comment.author}.",
                        now,
                        now,
                    ),
                )

            for error in result.errors:
                self.conn.execute(
                    "INSERT INTO run_steps (id, run_id, \"index\", status, kind, title, detail, started_at, completed_at) VALUES (?, ?, ?, 'failed', 'fetch', 'Reddit fetch warning', ?, ?, ?)",
                    (new_id("step"), run_id, self.next_step_index(run_id), error, now, now),
                )

        return list_id

    def save_outreach_fixture(self, run: sqlite3.Row) -> None:
        now = int(time.time() * 1000)
        settings = self.settings(run)
        list_id = settings.get("listId")
        targets = self.conn.execute(
            "SELECT targets.* FROM targets JOIN list_items ON targets.id = list_items.target_id WHERE list_items.list_id = ? ORDER BY list_items.rank",
            (list_id,),
        ).fetchall() if list_id else self.conn.execute("SELECT * FROM targets ORDER BY created_at DESC LIMIT 5").fetchall()

        with self.conn:
            for target in targets:
                draft = self.conn.execute("SELECT * FROM drafts WHERE target_id = ? ORDER BY created_at DESC LIMIT 1", (target["id"],)).fetchone()
                self.conn.execute(
                    "INSERT INTO outreach_actions (id, run_id, target_id, draft_id, platform, action_type, status, result_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'paste_draft', 'waiting_for_operator', ?, ?, ?)",
                    (new_id("act"), run["id"], target["id"], draft["id"] if draft else None, target["platform"], "Prepared workflow stops before final send.", now, now),
                )

    def add_artifact(self, run_id: str, kind: str, path: str, title: str) -> str:
        artifact_id = new_id("artifact")
        now = int(time.time() * 1000)
        with self.conn:
            self.conn.execute(
                "INSERT INTO artifacts (id, run_id, kind, path, title, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (artifact_id, run_id, kind, path, title, now),
            )
        return artifact_id

    def add_export(self, run_id: str, fmt: str, artifact_id: str) -> None:
        with self.conn:
            self.conn.execute(
                "INSERT INTO exports (id, run_id, format, artifact_id, created_at) VALUES (?, ?, ?, ?, ?)",
                (new_id("export"), run_id, fmt, artifact_id, int(time.time() * 1000)),
            )
