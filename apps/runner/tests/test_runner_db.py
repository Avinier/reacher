from __future__ import annotations

from pathlib import Path
from sqlite3 import connect

from reacher_runner.db import ReacherDb


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
