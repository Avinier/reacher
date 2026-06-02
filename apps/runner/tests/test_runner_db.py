from __future__ import annotations

from pathlib import Path
from sqlite3 import connect

from reacher_runner.db import ReacherDb
from reacher_runner.reddit.research import RedditPost, RedditResearchResult
from reacher_runner.usage import browserbase_search_event


def apply_migration(db_path: Path) -> None:
    migration = Path(__file__).resolve().parents[2] / "web" / "db" / "migrations" / "0000_square_moon_knight.sql"
    conn = connect(db_path)
    try:
        for statement in migration.read_text().split("--> statement-breakpoint"):
            sql = statement.strip()
            if sql:
                conn.execute(sql)
        conn.commit()
    finally:
        conn.close()


def insert_run(db: ReacherDb, run_id: str, created_at: int = 1) -> None:
    db.conn.execute(
        "INSERT INTO runs (id, kind, status, prompt, settings_json, created_at, updated_at) VALUES (?, 'research', 'queued', 'Find targets', '{\"platforms\":[\"web\",\"reddit\"]}', ?, ?)",
        (run_id, created_at, created_at),
    )
    db.conn.commit()


def test_claim_next_run_claims_oldest_queued_run(tmp_path: Path) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        insert_run(db, "run_newer", 2)
        insert_run(db, "run_older", 1)

        claimed = db.claim_next_run()

        assert claimed is not None
        assert claimed["id"] == "run_older"
        assert claimed["status"] == "claimed"
        assert db.conn.execute("SELECT status FROM runs WHERE id = 'run_newer'").fetchone()["status"] == "queued"
    finally:
        db.close()


def test_research_fixture_writes_core_entities(tmp_path: Path) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        insert_run(db, "run_research")
        run = db.claim_next_run()
        assert run is not None

        list_id = db.save_research_fixture(run)

        assert db.conn.execute("SELECT COUNT(*) AS count FROM research_filters WHERE run_id = 'run_research'").fetchone()["count"] == 1
        assert db.conn.execute("SELECT COUNT(*) AS count FROM targets WHERE run_id = 'run_research'").fetchone()["count"] == 1
        assert db.conn.execute("SELECT COUNT(*) AS count FROM target_evidence").fetchone()["count"] == 1
        assert db.conn.execute("SELECT source_run_id FROM lists WHERE id = ?", (list_id,)).fetchone()["source_run_id"] == "run_research"
    finally:
        db.close()


def test_usage_events_are_summarized(tmp_path: Path) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        insert_run(db, "run_usage")

        db.add_usage_event("run_usage", browserbase_search_event("yc w22", 5))
        summary = db.usage_summary("run_usage")

        assert summary["estimated_cost_usd"] > 0
        assert summary["by_provider"][0]["provider"] == "browserbase"
        assert db.conn.execute("SELECT COUNT(*) AS count FROM run_usage_events WHERE run_id = 'run_usage'").fetchone()["count"] == 1
    finally:
        db.close()


def test_recovered_reddit_block_warnings_are_not_failed_steps(tmp_path: Path) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        insert_run(db, "run_reddit")
        run = db.claim_next_run()
        assert run is not None

        result = RedditResearchResult(
            query="deploy failures",
            subreddits=["saas"],
            posts=[
                RedditPost(
                    id="abc123",
                    title="How do small SaaS teams handle deploy failures?",
                    subreddit="saas",
                    author=None,
                    permalink="https://www.reddit.com/r/SaaS/comments/abc123/example/",
                    url="https://www.reddit.com/r/SaaS/comments/abc123/example/",
                    score=0,
                    num_comments=0,
                    selftext="Fallback result",
                    created_utc=None,
                )
            ],
            errors=[
                "r/saas [deploy failures]: Client error '403 Blocked'",
                "Reddit public JSON appears blocked for this network/session; skipping remaining Reddit searches.",
                "Direct Reddit JSON was blocked; using Browserbase Search fallback for public Reddit results.",
            ],
        )

        db.save_reddit_research(run, result)

        failed = db.conn.execute("SELECT COUNT(*) AS count FROM run_steps WHERE run_id = 'run_reddit' AND status = 'failed'").fetchone()["count"]
        skipped = db.conn.execute("SELECT COUNT(*) AS count FROM run_steps WHERE run_id = 'run_reddit' AND status = 'skipped'").fetchone()["count"]
        assert failed == 0
        assert skipped == 3
    finally:
        db.close()
