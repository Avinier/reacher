from __future__ import annotations

import json
import re
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

from reacher_runner.browserbase.research import BrowserbaseDeepResearchResult
from reacher_runner.browserbase.yc import YCBatchResearchResult
from reacher_runner.github import GitHubResearchResult
from reacher_runner.reddit import RedditResearchResult
from reacher_runner.usage import UsageEvent


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:20]}"


def _is_unusable_browserbase_page(content: str, status_code: int | None) -> bool:
    normalized = " ".join(content.lower().split())
    blocked_markers = [
        "please enable js",
        "disable any ad blocker",
        "enable javascript",
        "just a moment",
        "checking your browser",
        "access denied",
        "forbidden",
    ]
    if status_code in {401, 403, 429, 999}:
        return True
    return any(marker in normalized for marker in blocked_markers)


def _normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _normalize_url(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    text = text.split("#", 1)[0].rstrip("/")
    if text.startswith("http://"):
        text = "https://" + text[len("http://"):]
    if text.startswith("https://www."):
        text = "https://" + text[len("https://www."):]
    return text


def _metadata(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    try:
        parsed = json.loads(str(raw))
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


_PERSON_PROSPECT_TERMS = (
    "founder",
    "founder-cto",
    "founder cto",
    "technical co-founder",
    "technical cofounder",
    "cto",
    "head of engineering",
    "engineering leader",
    "hands-on head",
)

_ROLE_TERMS = (
    "founder",
    "co-founder",
    "cofounder",
    "cto",
    "chief technology officer",
    "head of engineering",
    "vp engineering",
    "engineering leader",
    "technical founder",
)

_SOURCE_ONLY_URL_MARKERS = (
    "/jobs/",
    "/job/",
    "/careers/",
    "/career/",
    "/docs/",
    "/documentation/",
    "/tutorials/",
    "/actions/",
    "/content/",
    "/questions/",
    "/comments/",
)

_SOURCE_ONLY_HOST_MARKERS = (
    "docs.github.com",
    "github.com/github/docs",
    "reddit.com/r/",
)


def _wants_named_people(prompt: Any) -> bool:
    text = _normalize_text(prompt)
    return any(term in text for term in _PERSON_PROSPECT_TERMS) and any(term in text for term in ("name", "linkedin", "outreach", "prospect", "target"))


def _looks_like_relevant_role(value: Any) -> bool:
    text = _normalize_text(value)
    return any(term in text for term in _ROLE_TERMS)


def _looks_like_person_name(value: Any) -> bool:
    text = str(value or "").strip()
    if not text or len(text) > 80:
        return False
    lowered = text.lower()
    if lowered.startswith(("http://", "https://", "www.", "u/", "r/")):
        return False
    if any(marker in lowered for marker in ("/", "\\", "{", "}", "(", ")", ".md", "github actions", "chief technology officer", "channel partnerships", "profitable startup")):
        return False
    words = re.findall(r"[A-Za-z][A-Za-z.'-]+", text)
    if len(words) < 2 or len(words) > 5:
        return False
    role_words = {"founder", "cto", "chief", "technology", "officer", "manager", "engineering", "head", "aws", "cyber", "security"}
    return not all(word.lower() in role_words for word in words)


def _is_source_only_url(value: Any) -> bool:
    url = _normalize_url(value)
    if not url:
        return False
    return any(marker in url for marker in _SOURCE_ONLY_HOST_MARKERS) or any(marker in url for marker in _SOURCE_ONLY_URL_MARKERS)


def _valid_named_prospect(*, prompt: Any, display_name: Any, role: Any = None, organization: Any = None, url: Any = None, target_type: Any = None) -> tuple[bool, str]:
    return True, ""


class ReacherDb:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.execute("PRAGMA busy_timeout = 5000")
        self.ensure_runtime_tables()

    def close(self) -> None:
        self.conn.close()

    def ensure_runtime_tables(self) -> None:
        with self.conn:
            self.conn.execute(
                """
                CREATE TABLE IF NOT EXISTS run_usage_events (
                    id text PRIMARY KEY NOT NULL,
                    run_id text NOT NULL,
                    provider text NOT NULL,
                    service text NOT NULL,
                    operation text NOT NULL,
                    model text,
                    quantity real NOT NULL,
                    unit text NOT NULL,
                    unit_cost_usd real,
                    estimated_cost_usd real,
                    input_tokens integer,
                    output_tokens integer,
                    total_tokens integer,
                    cost_basis text NOT NULL,
                    metadata_json text,
                    created_at integer NOT NULL,
                    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE cascade
                )
                """
            )
            self.conn.execute("CREATE INDEX IF NOT EXISTS run_usage_events_run_id_idx ON run_usage_events (run_id)")
            self.conn.execute(
                """
                CREATE TABLE IF NOT EXISTS research_candidates (
                    id text PRIMARY KEY NOT NULL,
                    run_id text NOT NULL,
                    name text NOT NULL,
                    company text,
                    role text,
                    url text,
                    platform text NOT NULL,
                    source_url text,
                    reason text,
                    confidence real,
                    status text NOT NULL,
                    metadata_json text,
                    created_at integer NOT NULL,
                    updated_at integer,
                    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE cascade
                )
                """
            )
            self.conn.execute("CREATE INDEX IF NOT EXISTS research_candidates_run_id_idx ON research_candidates (run_id)")
            self.conn.execute(
                """
                CREATE TABLE IF NOT EXISTS research_enrichments (
                    id text PRIMARY KEY NOT NULL,
                    run_id text NOT NULL,
                    candidate_id text,
                    query text,
                    platform text NOT NULL,
                    url text,
                    title text,
                    summary text,
                    evidence_type text,
                    confidence real,
                    status text NOT NULL,
                    error text,
                    metadata_json text,
                    created_at integer NOT NULL,
                    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE cascade,
                    FOREIGN KEY (candidate_id) REFERENCES research_candidates(id) ON DELETE cascade
                )
                """
            )
            self.conn.execute("CREATE INDEX IF NOT EXISTS research_enrichments_run_id_idx ON research_enrichments (run_id)")
            self.conn.execute("CREATE INDEX IF NOT EXISTS research_enrichments_candidate_id_idx ON research_enrichments (candidate_id)")
            self.conn.execute(
                """
                CREATE TABLE IF NOT EXISTS research_scorecards (
                    id text PRIMARY KEY NOT NULL,
                    run_id text NOT NULL,
                    candidate_id text,
                    target_id text,
                    icp_fit integer,
                    pain_evidence integer,
                    reachability integer,
                    call_likelihood integer,
                    design_partner integer,
                    total_score real,
                    rationale text,
                    metadata_json text,
                    created_at integer NOT NULL,
                    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE cascade,
                    FOREIGN KEY (candidate_id) REFERENCES research_candidates(id) ON DELETE cascade,
                    FOREIGN KEY (target_id) REFERENCES targets(id) ON DELETE set null
                )
                """
            )
            self.conn.execute("CREATE INDEX IF NOT EXISTS research_scorecards_run_id_idx ON research_scorecards (run_id)")
            self.conn.execute("CREATE INDEX IF NOT EXISTS research_scorecards_candidate_id_idx ON research_scorecards (candidate_id)")
            self.conn.execute(
                """
                CREATE TABLE IF NOT EXISTS research_checkpoints (
                    id text PRIMARY KEY NOT NULL,
                    run_id text NOT NULL,
                    name text NOT NULL,
                    data_json text,
                    created_at integer NOT NULL,
                    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE cascade
                )
                """
            )
            self.conn.execute("CREATE INDEX IF NOT EXISTS research_checkpoints_run_id_idx ON research_checkpoints (run_id)")
            self._ensure_column("runs", "parent_run_id", "text")
            self._ensure_column("runs", "rerun_root_run_id", "text")
            self._ensure_column("runs", "rerun_index", "integer")
            self._ensure_column("targets", "outreached_at", "integer")
            self._ensure_column("targets", "not_useful_at", "integer")

    def _ensure_column(self, table: str, column: str, column_type: str) -> None:
        columns = {row["name"] for row in self.conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in columns:
            self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}")

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

    def save_research_checkpoint(self, run_id: str, *, name: str, data: Any) -> str:
        checkpoint_id = new_id("ckpt")
        now = int(time.time() * 1000)
        with self.conn:
            self.conn.execute(
                "INSERT INTO research_checkpoints (id, run_id, name, data_json, created_at) VALUES (?, ?, ?, ?, ?)",
                (checkpoint_id, run_id, name[:160], json.dumps(data), now),
            )
        return checkpoint_id

    def save_research_candidate(self, run_id: str, candidate: dict[str, Any]) -> str:
        candidate_id = str(candidate.get("id") or new_id("cand"))
        now = int(time.time() * 1000)
        with self.conn:
            self.conn.execute(
                """
                INSERT OR REPLACE INTO research_candidates
                    (id, run_id, name, company, role, url, platform, source_url, reason, confidence, status, metadata_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    candidate_id,
                    run_id,
                    str(candidate.get("name") or candidate.get("display_name") or candidate.get("url") or "Candidate")[:200],
                    str(candidate.get("company") or "") or None,
                    str(candidate.get("role") or "") or None,
                    str(candidate.get("url") or "") or None,
                    str(candidate.get("platform") or "web"),
                    str(candidate.get("source_url") or candidate.get("url") or "") or None,
                    str(candidate.get("reason") or "") or None,
                    float(candidate.get("confidence") or 0.5),
                    str(candidate.get("status") or "discovered"),
                    json.dumps(candidate.get("metadata") or {}),
                    now,
                    now,
                ),
            )
        return candidate_id

    def save_research_enrichment(self, run_id: str, candidate_id: str | None, enrichment: dict[str, Any]) -> str:
        enrichment_id = new_id("enrich")
        now = int(time.time() * 1000)
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO research_enrichments
                    (id, run_id, candidate_id, query, platform, url, title, summary, evidence_type, confidence, status, error, metadata_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    enrichment_id,
                    run_id,
                    candidate_id,
                    str(enrichment.get("query") or "") or None,
                    str(enrichment.get("platform") or "web"),
                    str(enrichment.get("url") or "") or None,
                    str(enrichment.get("title") or "") or None,
                    str(enrichment.get("summary") or "")[:2000] or None,
                    str(enrichment.get("evidence_type") or "observation"),
                    float(enrichment.get("confidence") or 0.5),
                    str(enrichment.get("status") or "completed"),
                    str(enrichment.get("error") or "") or None,
                    json.dumps(enrichment.get("metadata") or {}),
                    now,
                ),
            )
        return enrichment_id

    def save_research_scorecard(self, run_id: str, scorecard: dict[str, Any], target_id: str | None = None) -> str:
        scorecard_id = new_id("score")
        now = int(time.time() * 1000)

        def score(name: str) -> int | None:
            value = scorecard.get(name)
            if value is None:
                return None
            return max(1, min(int(value), 5))

        values = {name: score(name) for name in ("icp_fit", "pain_evidence", "reachability", "call_likelihood", "design_partner")}
        present = [value for value in values.values() if value is not None]
        total = sum(present) / len(present) if present else None
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO research_scorecards
                    (id, run_id, candidate_id, target_id, icp_fit, pain_evidence, reachability, call_likelihood, design_partner, total_score, rationale, metadata_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    scorecard_id,
                    run_id,
                    scorecard.get("candidate_id"),
                    target_id,
                    values["icp_fit"],
                    values["pain_evidence"],
                    values["reachability"],
                    values["call_likelihood"],
                    values["design_partner"],
                    total,
                    str(scorecard.get("rationale") or "") or None,
                    json.dumps(scorecard.get("metadata") or {}),
                    now,
                ),
            )
        return scorecard_id

    def save_code_mode_targets(self, run_id: str, prompt: str, targets: list[dict[str, Any]]) -> list[str]:
        now = int(time.time() * 1000)
        list_id = new_id("list")
        target_ids: list[str] = []
        skipped_duplicates = 0
        skipped_invalid = 0
        with self.conn:
            self.conn.execute(
                "UPDATE runs SET interpreted_goal = ? WHERE id = ?",
                ("Code-mode deep research with generated Python orchestration, checkpoints, candidate enrichment, and scorecards.", run_id),
            )
            self.conn.execute(
                "INSERT INTO lists (id, name, description, source_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (list_id, f"Code-mode research: {prompt[:52]}", "Generated-code research with candidates, enrichment evidence, and scorecards.", run_id, now, now),
            )
            for rank, target in enumerate(targets[:80], start=1):
                url = str(target.get("url") or "")
                if not url:
                    continue
                platform = str(target.get("platform") or "web")
                source_urls = target.get("source_urls") if isinstance(target.get("source_urls"), list) else [url]
                source_url = str(source_urls[0] or url)
                display_name = str(target.get("display_name") or target.get("name") or url)[:200]
                metadata = target.get("metadata") if isinstance(target.get("metadata"), dict) else {}
                organization = target.get("company") or metadata.get("company")
                role_or_context = target.get("role_or_context") or metadata.get("role")
                target_type = str(target.get("target_type") or "page")
                valid, _reason = _valid_named_prospect(
                    prompt=prompt,
                    display_name=display_name,
                    role=role_or_context,
                    organization=organization,
                    url=url,
                    target_type=target_type,
                )
                if not valid:
                    skipped_invalid += 1
                    continue
                if self.target_matches_rerun_exclusion(run_id, display_name=display_name, url=url, organization=organization, source_urls=source_urls):
                    skipped_duplicates += 1
                    continue
                evidence_summary = str(target.get("evidence_summary") or target.get("why_relevant") or "")
                source_id = new_id("source")
                self.conn.execute(
                    "INSERT INTO sources (id, run_id, platform, source_type, url, title, summary, captured_at) VALUES (?, ?, ?, 'document', ?, ?, ?, ?)",
                    (source_id, run_id, platform, source_url, display_name, evidence_summary[:500], now),
                )
                target_id = new_id("target")
                try:
                    relevance_score = float(target.get("relevance_score") or 0.72)
                except (TypeError, ValueError):
                    relevance_score = 0.72
                metadata = {
                    **metadata,
                    "source_method": "code_mode",
                    "candidate_id": target.get("candidate_id"),
                    "source_urls": source_urls,
                    "outreach_angle": target.get("outreach_angle"),
                }
                self.conn.execute(
                    "INSERT INTO targets (id, run_id, list_id, platform, target_type, display_name, handle, profile_url, organization, role_or_context, relevance_score, why_relevant, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'saved', ?, ?, ?)",
                    (
                        target_id,
                        run_id,
                        list_id,
                        platform,
                        target_type,
                        display_name,
                        target.get("handle"),
                        url,
                        organization,
                        role_or_context,
                        max(0.0, min(relevance_score, 1.0)),
                        str(target.get("why_relevant") or "Code-mode research found supporting evidence."),
                        json.dumps(metadata),
                        now,
                        now,
                    ),
                )
                self.conn.execute(
                    "INSERT INTO list_items (id, list_id, target_id, rank, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (new_id("li"), list_id, target_id, rank, str(target.get("outreach_angle") or "Code-mode ranked target."), now),
                )
                self.conn.execute(
                    "INSERT INTO target_evidence (id, target_id, source_id, evidence_type, text, url, confidence, created_at) VALUES (?, ?, ?, 'observation', ?, ?, ?, ?)",
                    (new_id("ev"), target_id, source_id, evidence_summary or str(target.get("why_relevant") or ""), source_url, 0.82, now),
                )
                self.conn.execute(
                    "INSERT INTO drafts (id, target_id, run_id, platform, draft_type, body, evidence_summary, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'dm', ?, ?, 'generated', ?, ?)",
                    (
                        new_id("draft"),
                        target_id,
                        run_id,
                        platform,
                        f"Hi, I found {display_name} while researching {prompt[:70]}. {str(target.get('outreach_angle') or target.get('why_relevant') or '')[:220]}",
                        evidence_summary,
                        now,
                        now,
                    ),
                )
                candidate_id = target.get("candidate_id")
                if candidate_id:
                    self.conn.execute(
                        "UPDATE research_scorecards SET target_id = ? WHERE run_id = ? AND candidate_id = ? AND target_id IS NULL",
                        (target_id, run_id, candidate_id),
                    )
                target_ids.append(target_id)
            if skipped_duplicates:
                self.conn.execute(
                    "INSERT INTO run_steps (id, run_id, \"index\", status, kind, title, detail, output_json, started_at, completed_at) VALUES (?, ?, ?, 'skipped', 'save', 'Skipped duplicate rerun targets', ?, ?, ?, ?)",
                    (
                        new_id("step"),
                        run_id,
                        self.next_step_index(run_id),
                        f"Skipped {skipped_duplicates} code-mode target(s) that matched prior rerun lineage exclusions.",
                        json.dumps({"skippedDuplicates": skipped_duplicates, "savedTargets": len(target_ids)}),
                        now,
                        now,
                    ),
                )
            if skipped_invalid:
                self.conn.execute(
                    "INSERT INTO run_steps (id, run_id, \"index\", status, kind, title, detail, output_json, started_at, completed_at) VALUES (?, ?, ?, 'skipped', 'save', 'Skipped invalid prospect targets', ?, ?, ?, ?)",
                    (
                        new_id("step"),
                        run_id,
                        self.next_step_index(run_id),
                        f"Skipped {skipped_invalid} code-mode target(s) that were pages, jobs, docs, threads, or lacked a named founder/CTO/engineering-leader prospect.",
                        json.dumps({"skippedInvalid": skipped_invalid, "savedTargets": len(target_ids)}),
                        now,
                        now,
                    ),
                )
        return target_ids

    def add_usage_event(self, run_id: str, event: UsageEvent) -> str:
        event_id = new_id("usage")
        now = int(time.time() * 1000)
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO run_usage_events
                    (id, run_id, provider, service, operation, model, quantity, unit, unit_cost_usd, estimated_cost_usd,
                     input_tokens, output_tokens, total_tokens, cost_basis, metadata_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event_id,
                    run_id,
                    event.provider,
                    event.service,
                    event.operation,
                    event.model,
                    event.quantity,
                    event.unit,
                    event.unit_cost_usd,
                    event.estimated_cost_usd,
                    event.input_tokens,
                    event.output_tokens,
                    event.total_tokens,
                    event.cost_basis,
                    json.dumps(event.metadata) if event.metadata is not None else None,
                    now,
                ),
            )
        return event_id

    def usage_summary(self, run_id: str) -> dict[str, Any]:
        totals = self.conn.execute(
            """
            SELECT
                COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(total_tokens), 0) AS total_tokens
            FROM run_usage_events WHERE run_id = ?
            """,
            (run_id,),
        ).fetchone()
        by_provider = self.conn.execute(
            """
            SELECT provider, service,
                   COUNT(*) AS events,
                   COALESCE(SUM(quantity), 0) AS quantity,
                   unit,
                   COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd,
                   COALESCE(SUM(input_tokens), 0) AS input_tokens,
                   COALESCE(SUM(output_tokens), 0) AS output_tokens,
                   COALESCE(SUM(total_tokens), 0) AS total_tokens
            FROM run_usage_events
            WHERE run_id = ?
            GROUP BY provider, service, unit
            ORDER BY provider, service
            """,
            (run_id,),
        ).fetchall()
        return {
            "estimated_cost_usd": float(totals["estimated_cost_usd"] if totals else 0),
            "input_tokens": int(totals["input_tokens"] if totals else 0),
            "output_tokens": int(totals["output_tokens"] if totals else 0),
            "total_tokens": int(totals["total_tokens"] if totals else 0),
            "by_provider": [dict(row) for row in by_provider],
        }

    def settings(self, run: sqlite3.Row) -> dict[str, Any]:
        raw = run["settings_json"]
        if not raw:
            return {}
        if isinstance(raw, str):
            return json.loads(raw)
        return dict(raw)

    def rerun_root_id(self, run: sqlite3.Row) -> str | None:
        return str(run["rerun_root_run_id"] or "") or None

    def lineage_run_ids(self, run_id: str) -> list[str]:
        run = self.conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        if not run:
            return [run_id]
        root_id = str(run["rerun_root_run_id"] or run["id"])
        rows = self.conn.execute(
            "SELECT id FROM runs WHERE id = ? OR rerun_root_run_id = ? ORDER BY created_at",
            (root_id, root_id),
        ).fetchall()
        ids = [str(row["id"]) for row in rows]
        return ids or [run_id]

    def rerun_exclusions(self, run_id: str) -> dict[str, Any]:
        run = self.conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        if not run or not run["rerun_root_run_id"]:
            return {
                "active": False,
                "run_ids": [],
                "urls": [],
                "names": [],
                "not_useful": {"urls": [], "names": []},
                "outreached": {"urls": [], "names": []},
            }
        lineage_ids = [item for item in self.lineage_run_ids(run_id) if item != run_id]
        if not lineage_ids:
            return {
                "active": True,
                "run_ids": [],
                "urls": [],
                "names": [],
                "not_useful": {"urls": [], "names": []},
                "outreached": {"urls": [], "names": []},
            }
        placeholders = ", ".join("?" for _ in lineage_ids)
        rows = self.conn.execute(f"SELECT * FROM targets WHERE run_id IN ({placeholders})", tuple(lineage_ids)).fetchall()
        urls: set[str] = set()
        names: set[str] = set()
        not_useful_urls: set[str] = set()
        not_useful_names: set[str] = set()
        outreached_urls: set[str] = set()
        outreached_names: set[str] = set()
        for row in rows:
            metadata = _metadata(row["metadata_json"])
            row_urls = [
                row["profile_url"],
                metadata.get("url"),
                metadata.get("website"),
            ]
            source_urls = metadata.get("source_urls")
            if isinstance(source_urls, list):
                row_urls.extend(source_urls)
            normalized_urls = {_normalize_url(url) for url in row_urls if _normalize_url(url)}
            urls.update(normalized_urls)
            name_key = self._target_name_key(row["display_name"], row["organization"] or metadata.get("company"))
            if name_key:
                names.add(name_key)
            if row["not_useful_at"]:
                not_useful_urls.update(normalized_urls)
                if name_key:
                    not_useful_names.add(name_key)
            if row["outreached_at"]:
                outreached_urls.update(normalized_urls)
                if name_key:
                    outreached_names.add(name_key)
        return {
            "active": True,
            "run_ids": lineage_ids,
            "urls": sorted(urls),
            "names": sorted(names),
            "not_useful": {"urls": sorted(not_useful_urls), "names": sorted(not_useful_names)},
            "outreached": {"urls": sorted(outreached_urls), "names": sorted(outreached_names)},
        }

    def _target_name_key(self, display_name: Any, organization: Any = None) -> str:
        name = _normalize_text(display_name)
        org = _normalize_text(organization)
        return f"{name}|{org}" if name or org else ""

    def target_matches_rerun_exclusion(self, run_id: str, *, display_name: Any, url: Any = None, organization: Any = None, source_urls: list[Any] | None = None) -> bool:
        exclusions = self.rerun_exclusions(run_id)
        if not exclusions.get("active"):
            return False
        excluded_urls = set(exclusions.get("urls") or [])
        candidate_urls = {_normalize_url(url)}
        for source_url in source_urls or []:
            candidate_urls.add(_normalize_url(source_url))
        if any(candidate_url and candidate_url in excluded_urls for candidate_url in candidate_urls):
            return True
        name_key = self._target_name_key(display_name, organization)
        return bool(name_key and name_key in set(exclusions.get("names") or []))

    def rerun_exclusion_summary(self, run_id: str) -> str:
        exclusions = self.rerun_exclusions(run_id)
        if not exclusions.get("active"):
            return ""
        return (
            "This is a rerun. Same prompt, but find new ground. "
            f"Avoid {len(exclusions.get('urls') or [])} prior URLs and {len(exclusions.get('names') or [])} prior target names from lineage runs. "
            f"Treat {len((exclusions.get('not_useful') or {}).get('names') or [])} not-useful targets as hard excludes. "
            f"Deprioritize {len((exclusions.get('outreached') or {}).get('names') or [])} already-outreached targets unless there is clearly new evidence."
        )

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
                if self.target_matches_rerun_exclusion(run_id, display_name=post.title[:120] or f"Reddit post {post.id}", url=post.permalink, organization=f"r/{post.subreddit}", source_urls=[post.permalink]):
                    continue
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
                    profile_url = f"https://www.reddit.com/user/{post.author}/"
                    if self.target_matches_rerun_exclusion(run_id, display_name=f"u/{post.author}", url=profile_url, organization=f"r/{post.subreddit}", source_urls=[profile_url, post.permalink]):
                        continue
                    account_target_id = new_id("target")
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
                profile_url = f"https://www.reddit.com/user/{comment.author}/"
                if self.target_matches_rerun_exclusion(run_id, display_name=f"u/{comment.author}", url=profile_url, organization=f"r/{comment.subreddit}", source_urls=[profile_url, comment.permalink]):
                    continue
                target_id = new_id("target")
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
                recovered_direct_block = bool(result.posts or result.comments) and (
                    "403" in error
                    or "appears blocked" in error.lower()
                    or "Direct Reddit JSON was blocked" in error
                )
                status = "skipped" if recovered_direct_block else "failed"
                title = "Reddit direct fetch recovered" if recovered_direct_block else "Reddit fetch warning"
                self.conn.execute(
                    "INSERT INTO run_steps (id, run_id, \"index\", status, kind, title, detail, started_at, completed_at) VALUES (?, ?, ?, ?, 'fetch', ?, ?, ?, ?)",
                    (new_id("step"), run_id, self.next_step_index(run_id), status, title, error, now, now),
                )

        return list_id

    def save_github_research(self, run: sqlite3.Row, result: GitHubResearchResult) -> str:
        now = int(time.time() * 1000)
        run_id = run["id"]
        list_id = new_id("list")

        with self.conn:
            self.conn.execute(
                "UPDATE runs SET interpreted_goal = ? WHERE id = ?",
                ("Discover GitHub projects, creators/maintainers, likely users/adopters, and public contact-path signals for outreach.", run_id),
            )
            self.conn.execute(
                "INSERT INTO lists (id, name, description, source_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (list_id, f"GitHub research: {result.prompt[:54]}", "GitHub API-backed project, creator, user, evidence, and contact-path targets.", run_id, now, now),
            )
            for query in result.queries:
                self.conn.execute(
                    "INSERT INTO research_filters (id, run_id, platform, kind, value, reason, confidence, created_at) VALUES (?, ?, 'github', ?, ?, ?, ?, ?)",
                    (new_id("filter"), run_id, f"github_{query.kind}", query.query, query.reason, 0.84, now),
                )

            rank = 1
            source_by_repo: dict[str, str] = {}
            for project in result.projects:
                source_id = new_id("source")
                source_by_repo[project.full_name] = source_id
                summary = "; ".join(
                    part
                    for part in [
                        project.description[:240],
                        f"stars={project.stars}",
                        f"language={project.language}" if project.language else "",
                        f"topics={', '.join(project.topics[:6])}" if project.topics else "",
                    ]
                    if part
                )
                self.conn.execute(
                    "INSERT INTO sources (id, run_id, platform, source_type, url, title, summary, captured_at) VALUES (?, ?, 'github', 'repository', ?, ?, ?, ?)",
                    (source_id, run_id, project.html_url, project.full_name, summary, now),
                )

                contact_paths = [contact.__dict__ for contact in project.package_contact_paths]
                creator_contacts = [contact.__dict__ for creator in project.creators for contact in creator.contact_paths]
                metadata = {
                    "source_method": "github_api",
                    "owner_login": project.owner_login,
                    "owner_type": project.owner_type,
                    "homepage": project.homepage,
                    "language": project.language,
                    "languages": project.languages,
                    "topics": project.topics,
                    "stars": project.stars,
                    "forks": project.forks,
                    "open_issues": project.open_issues,
                    "pushed_at": project.pushed_at,
                    "package_contact_paths": contact_paths,
                    "creator_contact_paths": creator_contacts,
                }
                if self.target_matches_rerun_exclusion(run_id, display_name=project.full_name, url=project.html_url, organization=project.owner_login, source_urls=[project.html_url, project.homepage]):
                    continue
                target_id = new_id("target")
                self.conn.execute(
                    "INSERT INTO targets (id, run_id, list_id, platform, target_type, display_name, handle, profile_url, organization, role_or_context, relevance_score, why_relevant, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, 'github', 'project', ?, ?, ?, ?, ?, ?, ?, 'saved', ?, ?, ?)",
                    (
                        target_id,
                        run_id,
                        list_id,
                        project.full_name,
                        project.full_name,
                        project.html_url,
                        project.owner_login,
                        f"{project.stars} stars; {project.language or 'language unknown'}; owner {project.owner_type or 'unknown'}",
                        project.score,
                        project.why_relevant,
                        json.dumps(metadata),
                        now,
                        now,
                    ),
                )
                self.conn.execute(
                    "INSERT INTO list_items (id, list_id, target_id, rank, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (new_id("li"), list_id, target_id, rank, "GitHub project/company target.", now),
                )
                rank += 1
                evidence_text = "\n".join(
                    part
                    for part in [
                        project.description,
                        project.readme_excerpt,
                        f"Public contact paths: {json.dumps(contact_paths[:5])}" if contact_paths else "",
                    ]
                    if part
                )[:1400]
                self.conn.execute(
                    "INSERT INTO target_evidence (id, target_id, source_id, evidence_type, text, url, confidence, created_at) VALUES (?, ?, ?, 'repository_fact', ?, ?, ?, ?)",
                    (new_id("ev"), target_id, source_id, evidence_text or project.why_relevant, project.html_url, 0.84, now),
                )
                self.conn.execute(
                    "INSERT INTO drafts (id, target_id, run_id, platform, draft_type, body, evidence_summary, status, created_at, updated_at) VALUES (?, ?, ?, 'github', 'email', ?, ?, 'generated', ?, ?)",
                    (
                        new_id("draft"),
                        target_id,
                        run_id,
                        f"Subject: Quick question about {project.full_name}\n\nI found {project.full_name} while researching {result.prompt[:80]}. {project.why_relevant[:220]}",
                        f"Based on GitHub repo metadata, README/package signals, contributors, and public API evidence from {project.html_url}.",
                        now,
                        now,
                    ),
                )

                for creator in project.creators:
                    if self.target_matches_rerun_exclusion(run_id, display_name=creator.name or creator.login, url=creator.html_url, organization=project.full_name, source_urls=[creator.html_url, creator.blog]):
                        continue
                    creator_target_id = new_id("target")
                    creator_metadata = {
                        "source_method": "github_api",
                        "repo_full_name": project.full_name,
                        "role": creator.role,
                        "contributions": creator.contributions,
                        "name": creator.name,
                        "company": creator.company,
                        "blog": creator.blog,
                        "email": creator.email,
                        "contact_paths": [contact.__dict__ for contact in creator.contact_paths],
                    }
                    self.conn.execute(
                        "INSERT INTO targets (id, run_id, list_id, platform, target_type, display_name, handle, profile_url, organization, role_or_context, relevance_score, why_relevant, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, 'github', 'creator', ?, ?, ?, ?, ?, ?, ?, 'saved', ?, ?, ?)",
                        (
                            creator_target_id,
                            run_id,
                            list_id,
                            creator.name or creator.login,
                            creator.login,
                            creator.html_url,
                            project.full_name,
                            f"{creator.role}; {creator.contributions or 0} contributions",
                            min(0.96, project.score + 0.04),
                            f"{creator.login} is a top contributor/maintainer signal for {project.full_name}.",
                            json.dumps(creator_metadata),
                            now,
                            now,
                        ),
                    )
                    self.conn.execute(
                        "INSERT INTO list_items (id, list_id, target_id, rank, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (new_id("li"), list_id, creator_target_id, rank, "GitHub creator/maintainer target.", now),
                    )
                    rank += 1
                    self.conn.execute(
                        "INSERT INTO target_evidence (id, target_id, source_id, evidence_type, text, url, confidence, created_at) VALUES (?, ?, ?, 'maintainer_signal', ?, ?, ?, ?)",
                        (new_id("ev"), creator_target_id, source_id, f"{creator.login} has {creator.contributions or 0} contributions to {project.full_name}.", creator.html_url, 0.82, now),
                    )
                    self.conn.execute(
                        "INSERT INTO drafts (id, target_id, run_id, platform, draft_type, body, evidence_summary, status, created_at, updated_at) VALUES (?, ?, ?, 'github', 'email', ?, ?, 'generated', ?, ?)",
                        (
                            new_id("draft"),
                            creator_target_id,
                            run_id,
                            f"Subject: Quick question on {project.full_name}\n\nSaw your work on {project.full_name} while researching {result.prompt[:80]}. I had a focused question based on the public GitHub signals if you are open to it.",
                            f"Based on public contributor data for {project.full_name}.",
                            now,
                            now,
                        ),
                    )

                for user in project.users:
                    if self.target_matches_rerun_exclusion(run_id, display_name=user.owner_login or user.repo_full_name or "GitHub user signal", url=user.owner_url or user.html_url, organization=user.repo_full_name, source_urls=[user.owner_url, user.html_url]):
                        continue
                    user_source_id = source_by_repo.get(user.repo_full_name)
                    if not user_source_id:
                        user_source_id = new_id("source")
                        source_by_repo[user.repo_full_name] = user_source_id
                        self.conn.execute(
                            "INSERT INTO sources (id, run_id, platform, source_type, url, title, summary, captured_at) VALUES (?, ?, 'github', ?, ?, ?, ?, ?)",
                            (user_source_id, run_id, user.signal_type, user.html_url, user.repo_full_name or user.html_url, user.evidence, now),
                        )
                    user_target_id = new_id("target")
                    self.conn.execute(
                        "INSERT INTO targets (id, run_id, list_id, platform, target_type, display_name, handle, profile_url, organization, role_or_context, relevance_score, why_relevant, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, 'github', 'user', ?, ?, ?, ?, ?, ?, ?, 'saved', ?, ?, ?)",
                        (
                            user_target_id,
                            run_id,
                            list_id,
                            user.owner_login or user.repo_full_name or "GitHub user signal",
                            user.owner_login,
                            user.owner_url or user.html_url,
                            user.repo_full_name,
                            user.signal_type,
                            min(0.9, project.score),
                            f"Likely user/adopter signal connected to GitHub research: {user.evidence}",
                            json.dumps({"source_method": "github_api", "signal_type": user.signal_type, "repo_full_name": user.repo_full_name, "contact_paths": [contact.__dict__ for contact in user.contact_paths]}),
                            now,
                            now,
                        ),
                    )
                    self.conn.execute(
                        "INSERT INTO list_items (id, list_id, target_id, rank, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (new_id("li"), list_id, user_target_id, rank, "GitHub user/adopter target.", now),
                    )
                    rank += 1
                    self.conn.execute(
                        "INSERT INTO target_evidence (id, target_id, source_id, evidence_type, text, url, confidence, created_at) VALUES (?, ?, ?, 'user_signal', ?, ?, ?, ?)",
                        (new_id("ev"), user_target_id, user_source_id, user.evidence, user.html_url, 0.72, now),
                    )

            for user in result.users:
                if user.repo_full_name in source_by_repo:
                    continue
                source_id = new_id("source")
                self.conn.execute(
                    "INSERT INTO sources (id, run_id, platform, source_type, url, title, summary, captured_at) VALUES (?, ?, 'github', ?, ?, ?, ?, ?)",
                    (source_id, run_id, user.signal_type, user.html_url, user.repo_full_name or user.html_url, user.evidence, now),
                )

            for error in result.errors:
                self.conn.execute(
                    "INSERT INTO run_steps (id, run_id, \"index\", status, kind, title, detail, started_at, completed_at) VALUES (?, ?, ?, 'failed', 'fetch', 'GitHub research warning', ?, ?, ?)",
                    (new_id("step"), run_id, self.next_step_index(run_id), error, now, now),
                )

        return list_id

    def save_browserbase_research(self, run: sqlite3.Row, result: BrowserbaseDeepResearchResult) -> str:
        now = int(time.time() * 1000)
        run_id = run["id"]
        list_id = new_id("list")
        source_by_url: dict[str, str] = {}
        skipped_duplicates = 0
        skipped_invalid = 0

        with self.conn:
            self.conn.execute(
                "UPDATE runs SET interpreted_goal = ? WHERE id = ?",
                ("Deep research across Browserbase Search, Fetch, and persisted browser contexts.", run_id),
            )
            self.conn.execute(
                "INSERT INTO lists (id, name, description, source_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (list_id, f"Browserbase research: {result.prompt[:48]}", "Evidence from Browserbase Search, Fetch, and browser-session research.", run_id, now, now),
            )

            for platform in result.platforms:
                self.conn.execute(
                    "INSERT INTO research_filters (id, run_id, platform, kind, value, reason, confidence, created_at) VALUES (?, ?, ?, 'platform', ?, ?, ?, ?)",
                    (new_id("filter"), run_id, platform, platform, "Selected platform for this deep research run.", 0.86, now),
                )
            for query in result.queries:
                self.conn.execute(
                    "INSERT INTO research_filters (id, run_id, platform, kind, value, reason, confidence, created_at) VALUES (?, ?, 'web', 'browserbase_search_query', ?, ?, ?, ?)",
                    (new_id("filter"), run_id, query, "Browserbase Search query used for cheap discovery before Fetch or browser sessions.", 0.82, now),
                )

            rank = 1
            for search_result in result.search_results:
                source_id = new_id("source")
                source_by_url[search_result.url] = source_id
                summary_parts = [f"Browserbase Search query: {search_result.query}"]
                if search_result.author:
                    summary_parts.append(f"Author: {search_result.author}")
                if search_result.published_date:
                    summary_parts.append(f"Published: {search_result.published_date}")
                self.conn.execute(
                    "INSERT INTO sources (id, run_id, platform, source_type, url, title, summary, captured_at) VALUES (?, ?, ?, 'search_result', ?, ?, ?, ?)",
                    (source_id, run_id, search_result.platform, search_result.url, search_result.title, "; ".join(summary_parts), now),
                )

            if result.synthesized_targets:
                for target in result.synthesized_targets:
                    source_url = (target.source_urls[0] if target.source_urls else target.url) or target.url
                    organization = target.metadata.get("company") if isinstance(target.metadata, dict) else None
                    valid, _reason = _valid_named_prospect(
                        prompt=result.prompt,
                        display_name=target.display_name,
                        role=target.role_or_context or (target.metadata.get("role") if isinstance(target.metadata, dict) else None),
                        organization=organization,
                        url=target.url,
                        target_type=target.target_type,
                    )
                    if not valid:
                        skipped_invalid += 1
                        continue
                    if self.target_matches_rerun_exclusion(run_id, display_name=target.display_name, url=target.url, organization=organization, source_urls=target.source_urls):
                        skipped_duplicates += 1
                        continue
                    source_id = source_by_url.get(source_url) or source_by_url.get(target.url) or new_id("source")
                    if source_url not in source_by_url and target.url not in source_by_url:
                        source_by_url[source_url] = source_id
                        self.conn.execute(
                            "INSERT INTO sources (id, run_id, platform, source_type, url, title, summary, captured_at) VALUES (?, ?, ?, 'llm_aggregated_source', ?, ?, ?, ?)",
                            (source_id, run_id, target.platform, source_url, target.display_name, target.evidence_summary[:500], now),
                        )
                    target_id = new_id("target")
                    metadata = {
                        "source_method": "browserbase_llm_aggregated",
                        "source_urls": target.source_urls,
                        "outreach_angle": target.outreach_angle,
                        **target.metadata,
                    }
                    self.conn.execute(
                    "INSERT INTO targets (id, run_id, list_id, platform, target_type, display_name, handle, profile_url, organization, role_or_context, relevance_score, why_relevant, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'saved', ?, ?, ?)",
                    (
                        target_id,
                        run_id,
                        list_id,
                        target.platform,
                        target.target_type,
                        target.display_name,
                        None,
                        target.url,
                        organization,
                        target.role_or_context,
                        target.relevance_score,
                        target.why_relevant or "Matched the prompt through aggregated Browserbase evidence.",
                            json.dumps(metadata),
                            now,
                            now,
                        ),
                    )
                    self.conn.execute(
                        "INSERT INTO list_items (id, list_id, target_id, rank, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (new_id("li"), list_id, target_id, rank, target.outreach_angle or "LLM-aggregated Browserbase target.", now),
                    )
                    rank += 1
                    self.conn.execute(
                        "INSERT INTO target_evidence (id, target_id, source_id, evidence_type, text, url, confidence, created_at) VALUES (?, ?, ?, 'llm_summary', ?, ?, ?, ?)",
                        (new_id("ev"), target_id, source_id, target.evidence_summary or target.why_relevant, source_url, 0.82, now),
                    )
                    self.conn.execute(
                        "INSERT INTO drafts (id, target_id, run_id, platform, draft_type, body, evidence_summary, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'dm', ?, ?, 'generated', ?, ?)",
                        (
                            new_id("draft"),
                            target_id,
                            run_id,
                            target.platform,
                            f"Hi, I found {target.display_name} while researching {result.prompt[:70]}. {target.outreach_angle or target.why_relevant[:180]}",
                            target.evidence_summary,
                            now,
                            now,
                        ),
                    )

            for page in [] if result.synthesized_targets else result.fetched_pages:
                if _is_unusable_browserbase_page(page.content, page.status_code):
                    continue
                if self.target_matches_rerun_exclusion(run_id, display_name=page.title[:120] or page.url, url=page.url, source_urls=[page.url]):
                    skipped_duplicates += 1
                    continue
                source_id = source_by_url.get(page.url) or new_id("source")
                if page.url not in source_by_url:
                    source_by_url[page.url] = source_id
                    self.conn.execute(
                        "INSERT INTO sources (id, run_id, platform, source_type, url, title, summary, captured_at) VALUES (?, ?, ?, 'page', ?, ?, ?, ?)",
                        (source_id, run_id, page.platform, page.url, page.title, f"Browserbase Fetch status {page.status_code}", now),
                    )
                evidence_text = page.content.strip()[:1200] or f"Fetched {page.url} with status {page.status_code}."
                target_id = new_id("target")
                target_type = "account" if page.platform in {"x", "linkedin"} else "page"
                self.conn.execute(
                    "INSERT INTO targets (id, run_id, list_id, platform, target_type, display_name, handle, profile_url, role_or_context, relevance_score, why_relevant, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'saved', ?, ?, ?)",
                    (
                        target_id,
                        run_id,
                        list_id,
                        page.platform,
                        target_type,
                        page.title[:120] or page.url,
                        None,
                        page.url,
                        f"Browserbase Fetch content-type {page.content_type or 'unknown'}",
                        0.72 if page.content else 0.56,
                        "Matched the prompt through Browserbase Search and had retrievable page evidence.",
                        json.dumps({"source_method": "browserbase_search_fetch", "status_code": page.status_code, "content_type": page.content_type}),
                        now,
                        now,
                    ),
                )
                self.conn.execute(
                    "INSERT INTO list_items (id, list_id, target_id, rank, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (new_id("li"), list_id, target_id, rank, "Browserbase Search/Fetch target.", now),
                )
                rank += 1
                self.conn.execute(
                    "INSERT INTO target_evidence (id, target_id, source_id, evidence_type, text, url, confidence, created_at) VALUES (?, ?, ?, 'page_fact', ?, ?, ?, ?)",
                    (new_id("ev"), target_id, source_id, evidence_text, page.url, 0.76 if page.content else 0.52, now),
                )
                self.conn.execute(
                    "INSERT INTO drafts (id, target_id, run_id, platform, draft_type, body, evidence_summary, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'dm', ?, ?, 'generated', ?, ?)",
                    (
                        new_id("draft"),
                        target_id,
                        run_id,
                        page.platform,
                        f"Hi, I found your work while researching {result.prompt[:90]}. The point that stood out was: {evidence_text[:180]}",
                        f"Based on Browserbase-retrieved page evidence from {page.url}.",
                        now,
                        now,
                    ),
                )

            for session in result.browser_sessions:
                self.conn.execute(
                    "INSERT INTO run_steps (id, run_id, \"index\", status, kind, title, detail, output_json, started_at, completed_at) VALUES (?, ?, ?, 'completed', 'browser_session', ?, ?, ?, ?, ?)",
                    (
                        new_id("step"),
                        run_id,
                        self.next_step_index(run_id),
                        f"Opened Browserbase {session.platform} research session",
                        f"Live view and recording: {session.live_url}",
                        json.dumps(
                            {
                                "platform": session.platform,
                                "providerSessionId": session.provider_session_id,
                                "liveUrl": session.live_url,
                                "recordingUrl": session.recording_url,
                            }
                        ),
                        now,
                        now,
                    ),
                )

            for error in result.errors:
                self.conn.execute(
                    "INSERT INTO run_steps (id, run_id, \"index\", status, kind, title, detail, started_at, completed_at) VALUES (?, ?, ?, 'failed', 'fetch', 'Browserbase research warning', ?, ?, ?)",
                    (new_id("step"), run_id, self.next_step_index(run_id), error, now, now),
                )
            if skipped_duplicates:
                self.conn.execute(
                    "INSERT INTO run_steps (id, run_id, \"index\", status, kind, title, detail, output_json, started_at, completed_at) VALUES (?, ?, ?, 'skipped', 'save', 'Skipped duplicate rerun targets', ?, ?, ?, ?)",
                    (
                        new_id("step"),
                        run_id,
                        self.next_step_index(run_id),
                        f"Skipped {skipped_duplicates} Browserbase target(s) that matched prior rerun lineage exclusions.",
                        json.dumps({"skippedDuplicates": skipped_duplicates, "savedTargets": rank - 1}),
                        now,
                        now,
                    ),
                )
            if skipped_invalid:
                self.conn.execute(
                    "INSERT INTO run_steps (id, run_id, \"index\", status, kind, title, detail, output_json, started_at, completed_at) VALUES (?, ?, ?, 'skipped', 'save', 'Skipped invalid prospect targets', ?, ?, ?, ?)",
                    (
                        new_id("step"),
                        run_id,
                        self.next_step_index(run_id),
                        f"Skipped {skipped_invalid} Browserbase target(s) that were pages, jobs, docs, threads, or lacked a named founder/CTO/engineering-leader prospect.",
                        json.dumps({"skippedInvalid": skipped_invalid, "savedTargets": rank - 1}),
                        now,
                        now,
                    ),
                )

        return list_id

    def save_yc_batch_research(self, run: sqlite3.Row, result: YCBatchResearchResult) -> str:
        now = int(time.time() * 1000)
        run_id = run["id"]
        list_id = new_id("list")

        with self.conn:
            self.conn.execute(
                "UPDATE runs SET interpreted_goal = ? WHERE id = ?",
                (f"Collect the top {len(result.companies)} YC {result.batch_name} companies with founder/social clues and notes.", run_id),
            )
            self.conn.execute(
                "INSERT INTO lists (id, name, description, source_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (list_id, f"YC {result.batch_name}: top {len(result.companies)} companies", "Browserbase-rendered YC company list enriched with founder/social clues and notes.", run_id, now, now),
            )
            self.conn.execute(
                "INSERT INTO research_filters (id, run_id, platform, kind, value, reason, confidence, created_at) VALUES (?, ?, 'web', 'yc_batch', ?, ?, ?, ?)",
                (new_id("filter"), run_id, result.batch_name, "Batch parsed from the user prompt.", 0.96, now),
            )
            self.conn.execute(
                "INSERT INTO sources (id, run_id, platform, source_type, url, title, summary, captured_at) VALUES (?, ?, 'web', 'page', ?, ?, ?, ?)",
                (new_id("source"), run_id, result.directory_url, f"YC {result.batch_name} directory", "Rendered through Browserbase and scrolled until at least 30 company cards were available.", now),
            )

            self.conn.execute(
                "INSERT INTO run_steps (id, run_id, \"index\", status, kind, title, detail, output_json, started_at, completed_at) VALUES (?, ?, ?, 'completed', 'browser_session', ?, ?, ?, ?, ?)",
                (
                    new_id("step"),
                    run_id,
                    self.next_step_index(run_id),
                    "Opened Browserbase YC directory research session",
                    f"Live view and recording: {result.browser_session.live_url}",
                    json.dumps({"providerSessionId": result.browser_session.provider_session_id, "liveUrl": result.browser_session.live_url}),
                    now,
                    now,
                ),
            )
            if result.gemini_provider:
                self.conn.execute(
                    "INSERT INTO run_steps (id, run_id, \"index\", status, kind, title, detail, output_json, started_at, completed_at) VALUES (?, ?, ?, 'completed', 'extract', 'Gemini notes enrichment completed', ?, ?, ?, ?)",
                    (
                        new_id("step"),
                        run_id,
                        self.next_step_index(run_id),
                        f"Used {result.gemini_provider} for concise company notes.",
                        json.dumps({"provider": result.gemini_provider}),
                        now,
                        now,
                    ),
                )
            elif result.gemini_error:
                self.conn.execute(
                    "INSERT INTO run_steps (id, run_id, \"index\", status, kind, title, detail, started_at, completed_at) VALUES (?, ?, ?, 'failed', 'extract', 'Gemini notes enrichment failed', ?, ?, ?)",
                    (new_id("step"), run_id, self.next_step_index(run_id), result.gemini_error, now, now),
                )

            for company in result.companies:
                source_id = new_id("source")
                self.conn.execute(
                    "INSERT INTO sources (id, run_id, platform, source_type, url, title, summary, captured_at) VALUES (?, ?, 'web', 'profile', ?, ?, ?, ?)",
                    (source_id, run_id, company.url, company.name, company.one_liner, now),
                )
                metadata = {
                    "source_method": "browserbase_yc_batch_rendered",
                    "rank": company.rank,
                    "batch": company.batch,
                    "website": company.website,
                    "company_socials": company.company_socials,
                    "founder_names": company.founder_names,
                    "founder_social_results": [social.__dict__ for social in company.founder_social_results],
                    "tags": company.tags,
                    "team_size": company.team_size,
                    "status": company.status,
                }
                target_id = new_id("target")
                role = f"{company.batch}; {company.location or 'location unknown'}; team size {company.team_size or 'unknown'}"
                note = company.note or company.one_liner or company.long_description[:220]
                self.conn.execute(
                    "INSERT INTO targets (id, run_id, list_id, platform, target_type, display_name, handle, profile_url, organization, role_or_context, relevance_score, why_relevant, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, 'web', 'company', ?, ?, ?, ?, ?, ?, ?, 'saved', ?, ?, ?)",
                    (
                        target_id,
                        run_id,
                        list_id,
                        company.name,
                        company.slug,
                        company.url,
                        "Y Combinator",
                        role,
                        max(0.5, 1.0 - ((company.rank - 1) * 0.01)),
                        note,
                        json.dumps(metadata),
                        now,
                        now,
                    ),
                )
                self.conn.execute(
                    "INSERT INTO list_items (id, list_id, target_id, rank, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (new_id("li"), list_id, target_id, company.rank, note, now),
                )
                evidence = "\n".join(
                    part
                    for part in [
                        company.one_liner,
                        company.long_description[:700],
                        f"Company socials: {json.dumps(company.company_socials)}" if company.company_socials else "",
                        f"Founder/social clues: {json.dumps([social.__dict__ for social in company.founder_social_results], ensure_ascii=False)}" if company.founder_social_results else "",
                    ]
                    if part
                )
                self.conn.execute(
                    "INSERT INTO target_evidence (id, target_id, source_id, evidence_type, text, url, confidence, created_at) VALUES (?, ?, ?, 'page_fact', ?, ?, ?, ?)",
                    (new_id("ev"), target_id, source_id, evidence[:1400], company.url, 0.88, now),
                )
                self.conn.execute(
                    "INSERT INTO drafts (id, target_id, run_id, platform, draft_type, body, evidence_summary, status, created_at, updated_at) VALUES (?, ?, ?, 'web', 'dm', ?, ?, 'generated', ?, ?)",
                    (
                        new_id("draft"),
                        target_id,
                        run_id,
                        f"Hi {company.name} team, I was looking through YC {result.batch_name} companies and noticed: {note[:180]}",
                        f"Based on YC profile, company socials, and Browserbase Search founder/social clues for {company.name}.",
                        now,
                        now,
                    ),
                )

            for error in result.errors:
                self.conn.execute(
                    "INSERT INTO run_steps (id, run_id, \"index\", status, kind, title, detail, started_at, completed_at) VALUES (?, ?, ?, 'failed', 'fetch', 'YC batch research warning', ?, ?, ?)",
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
