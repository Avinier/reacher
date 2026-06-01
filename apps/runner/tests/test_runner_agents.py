from __future__ import annotations

from pathlib import Path
from sqlite3 import connect

from reacher_runner.browserbase.research import (
    BrowserbaseDeepResearchResult,
    BrowserbaseFetchResult,
    BrowserbaseSearchResult,
    BrowserbaseSynthesizedTarget,
    build_research_queries,
)
from reacher_runner.browserbase.yc import is_yc_w22_prompt
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


def test_browserbase_query_builder_includes_x_and_developer_surfaces() -> None:
    queries = build_research_queries("AI code review tools", ["web", "x"])
    values = [spec.query for spec in queries]

    assert "AI code review tools site:news.ycombinator.com" in values
    assert "AI code review tools site:ycombinator.com/companies" in values
    assert "AI code review tools site:x.com" in values
    assert all(len(query) <= 180 for query in values)


def test_browserbase_query_builder_extracts_prompt_queries_without_full_prompt() -> None:
    prompt = """
    Research long target profile text that should never be copied fully.

    Search queries:
    - "Founder CTO" "AWS" "B2B SaaS"
    - site:ycombinator.com/companies "AWS" "B2B"

    Pain signals:
    - uptime
    """
    queries = build_research_queries(prompt, ["web", "linkedin"])
    values = [spec.query for spec in queries]

    assert '"Founder CTO" "AWS" "B2B SaaS"' in values
    assert 'site:ycombinator.com/companies "AWS" "B2B"' in values
    assert not any("Research long target profile text" in query and "Pain signals" in query for query in values)


def test_yc_w22_prompt_detection() -> None:
    assert is_yc_w22_prompt("give me top 30 companies of YC batch 2022 winter batch")
    assert is_yc_w22_prompt("Find YC W22 founders")
    assert not is_yc_w22_prompt("Find recent Hacker News posts")


def test_browserbase_research_persistence_writes_sources_targets_and_sessions(tmp_path: Path) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        db.conn.execute(
            "INSERT INTO runs (id, kind, status, prompt, settings_json, created_at, updated_at) VALUES ('run_bb', 'research', 'claimed', 'Find AI devtool founders', '{\"platforms\":[\"web\",\"x\"]}', 1, 1)"
        )
        db.conn.commit()
        run = db.conn.execute("SELECT * FROM runs WHERE id = 'run_bb'").fetchone()

        result = BrowserbaseDeepResearchResult(
            prompt="Find AI devtool founders",
            platforms=["web", "x"],
            queries=["Find AI devtool founders site:x.com"],
            search_results=[
                BrowserbaseSearchResult(
                    query="Find AI devtool founders site:x.com",
                    title="Founder post",
                    url="https://x.com/example/status/123",
                    platform="x",
                )
            ],
            fetched_pages=[
                BrowserbaseFetchResult(
                    url="https://x.com/example/status/123",
                    title="Founder post",
                    platform="x",
                    status_code=200,
                    content_type="text/markdown",
                    content="Building an AI devtool for code review teams.",
                )
            ],
        )

        list_id = db.save_browserbase_research(run, result)

        assert db.conn.execute("SELECT COUNT(*) AS count FROM sources WHERE run_id = 'run_bb'").fetchone()["count"] == 1
        assert db.conn.execute("SELECT COUNT(*) AS count FROM targets WHERE run_id = 'run_bb'").fetchone()["count"] == 1
        assert db.conn.execute("SELECT COUNT(*) AS count FROM target_evidence").fetchone()["count"] == 1
        assert db.conn.execute("SELECT source_run_id FROM lists WHERE id = ?", (list_id,)).fetchone()["source_run_id"] == "run_bb"
    finally:
        db.close()


def test_browserbase_research_persistence_prefers_synthesized_targets(tmp_path: Path) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        db.conn.execute(
            "INSERT INTO runs (id, kind, status, prompt, settings_json, created_at, updated_at) VALUES ('run_syn', 'research', 'claimed', 'Find founder CTO prospects', '{\"platforms\":[\"web\"]}', 1, 1)"
        )
        db.conn.commit()
        run = db.conn.execute("SELECT * FROM runs WHERE id = 'run_syn'").fetchone()

        result = BrowserbaseDeepResearchResult(
            prompt="Find founder CTO prospects",
            platforms=["web"],
            queries=['"Founder CTO" "AWS"'],
            search_results=[
                BrowserbaseSearchResult(query='"Founder CTO" "AWS"', title="Acme", url="https://acme.example", platform="web")
            ],
            fetched_pages=[
                BrowserbaseFetchResult(url="https://acme.example", title="Acme", platform="web", status_code=200, content_type="text/markdown", content="Acme hiring backend engineers for AWS.")
            ],
            synthesized_targets=[
                BrowserbaseSynthesizedTarget(
                    display_name="Acme Founder CTO",
                    url="https://acme.example",
                    platform="web",
                    target_type="person",
                    relevance_score=0.91,
                    why_relevant="Founder-led SaaS with AWS operations signal.",
                    evidence_summary="Acme is hiring backend engineers with AWS ownership.",
                    outreach_angle="Ask about post-deploy operational closure.",
                    source_urls=["https://acme.example"],
                )
            ],
        )

        db.save_browserbase_research(run, result)

        target = db.conn.execute("SELECT display_name, relevance_score, why_relevant FROM targets WHERE run_id = 'run_syn'").fetchone()
        assert target["display_name"] == "Acme Founder CTO"
        assert target["relevance_score"] == 0.91
        assert "Founder-led" in target["why_relevant"]
        assert db.conn.execute("SELECT COUNT(*) AS count FROM targets WHERE run_id = 'run_syn'").fetchone()["count"] == 1
    finally:
        db.close()
