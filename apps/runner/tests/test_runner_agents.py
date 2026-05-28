from __future__ import annotations

from pathlib import Path
from sqlite3 import connect

from reacher_runner.agents.research_agent import ResearchAgent
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


def test_research_agent_writes_exports_and_artifact_records(tmp_path: Path) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        db.conn.execute(
            "INSERT INTO runs (id, kind, status, prompt, settings_json, created_at, updated_at) VALUES ('run_agent', 'research', 'claimed', 'Find targets', '{\"platforms\":[\"web\",\"linkedin\"]}', 1, 1)"
        )
        db.conn.commit()
        run = db.conn.execute("SELECT * FROM runs WHERE id = 'run_agent'").fetchone()

        skills_root = Path(__file__).resolve().parents[1] / "skills"
        ResearchAgent(db, tmp_path, skills_root).run(run)

        assert (tmp_path / "exports" / "runs" / "run_agent" / "research.md").exists()
        assert (tmp_path / "exports" / "runs" / "run_agent" / "targets.csv").exists()
        assert (tmp_path / "exports" / "runs" / "run_agent" / "targets.json").exists()
        assert db.conn.execute("SELECT COUNT(*) AS count FROM exports WHERE run_id = 'run_agent'").fetchone()["count"] == 3
        assert db.conn.execute("SELECT COUNT(*) AS count FROM artifacts WHERE run_id = 'run_agent'").fetchone()["count"] == 3
    finally:
        db.close()
