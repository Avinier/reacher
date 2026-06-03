from __future__ import annotations

from pathlib import Path
from sqlite3 import connect

from reacher_runner.browserbase.research import BrowserbaseDeepResearchResult, BrowserbaseSynthesizedTarget
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


def test_rerun_exclusions_include_lineage_feedback(tmp_path: Path) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        db.conn.execute("INSERT INTO runs (id, kind, status, prompt, settings_json, created_at, updated_at) VALUES ('run_root', 'research', 'completed', 'Find', '{\"platforms\":[\"web\"]}', 1, 1)")
        db.conn.execute("INSERT INTO runs (id, kind, status, prompt, settings_json, parent_run_id, rerun_root_run_id, rerun_index, created_at, updated_at) VALUES ('run_rerun', 'research', 'queued', 'Find', '{\"platforms\":[\"web\"]}', 'run_root', 'run_root', 1, 2, 2)")
        db.conn.execute(
            "INSERT INTO targets (id, run_id, platform, target_type, display_name, profile_url, organization, status, metadata_json, outreached_at, not_useful_at, created_at, updated_at) VALUES ('target_prior', 'run_root', 'web', 'person', 'Ada Founder', 'https://www.example.com/ada#frag', 'Acme', 'saved', '{\"source_urls\":[\"https://blog.example.com/ada\"]}', 10, 20, 1, 1)"
        )
        db.conn.commit()

        exclusions = db.rerun_exclusions("run_rerun")

        assert exclusions["active"] is True
        assert exclusions["run_ids"] == ["run_root"]
        assert "https://example.com/ada" in exclusions["urls"]
        assert "https://blog.example.com/ada" in exclusions["urls"]
        assert "ada founder|acme" in exclusions["names"]
        assert "ada founder|acme" in exclusions["not_useful"]["names"]
        assert "ada founder|acme" in exclusions["outreached"]["names"]
    finally:
        db.close()


def test_browserbase_rerun_save_skips_prior_lineage_targets(tmp_path: Path) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        db.conn.execute("INSERT INTO runs (id, kind, status, prompt, settings_json, created_at, updated_at) VALUES ('run_root', 'research', 'completed', 'Find', '{\"platforms\":[\"web\"]}', 1, 1)")
        db.conn.execute("INSERT INTO targets (id, run_id, platform, target_type, display_name, profile_url, organization, status, created_at, updated_at) VALUES ('target_prior', 'run_root', 'web', 'person', 'Ada Founder', 'https://example.com/ada', 'Acme', 'saved', 1, 1)")
        db.conn.execute("INSERT INTO runs (id, kind, status, prompt, settings_json, parent_run_id, rerun_root_run_id, rerun_index, created_at, updated_at) VALUES ('run_rerun', 'research', 'claimed', 'Find', '{\"platforms\":[\"web\"]}', 'run_root', 'run_root', 1, 2, 2)")
        db.conn.commit()
        run = db.conn.execute("SELECT * FROM runs WHERE id = 'run_rerun'").fetchone()
        result = BrowserbaseDeepResearchResult(
            prompt="Find",
            platforms=["web"],
            queries=["founder AWS"],
            search_results=[],
            fetched_pages=[],
            synthesized_targets=[
                BrowserbaseSynthesizedTarget(display_name="Ada Founder", url="https://example.com/ada", platform="web", target_type="person", role_or_context="Founder", relevance_score=0.9, why_relevant="Duplicate", evidence_summary="Duplicate", outreach_angle="", source_urls=["https://example.com/ada"], metadata={"company": "Acme"}),
                BrowserbaseSynthesizedTarget(display_name="New Founder", url="https://example.com/new", platform="web", target_type="person", role_or_context="Founder", relevance_score=0.8, why_relevant="New", evidence_summary="New", outreach_angle="", source_urls=["https://example.com/new"], metadata={"company": "NewCo"}),
            ],
        )

        db.save_browserbase_research(run, result)

        rows = db.conn.execute("SELECT display_name FROM targets WHERE run_id = 'run_rerun' ORDER BY display_name").fetchall()
        assert [row["display_name"] for row in rows] == ["New Founder"]
        skipped = db.conn.execute("SELECT COUNT(*) AS count FROM run_steps WHERE run_id = 'run_rerun' AND title = 'Skipped duplicate rerun targets'").fetchone()["count"]
        assert skipped == 1
    finally:
        db.close()


def test_code_mode_named_prospect_save_keeps_pages_and_jobs_as_hints(tmp_path: Path) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        insert_run(db, "run_people")
        prompt = "Research prospect targets: technical founders, founder-CTOs, CTOs, or hands-on Heads of Engineering. Return Name, Role, Company, LinkedIn URL, outreach angle."

        saved = db.save_code_mode_targets(
            "run_people",
            prompt,
            [
                {
                    "display_name": "content/actions/how",
                    "url": "https://github.com/github/docs/content/actions/how.md",
                    "platform": "web",
                    "target_type": "page",
                    "role_or_context": "docs page",
                    "metadata": {"company": "GitHub Docs"},
                },
                {
                    "display_name": "Channel Partnerships Manager",
                    "url": "https://www.ycombinator.com/companies/pump-co/jobs/BHk6it8-channel-partnerships-manager-aws",
                    "platform": "web",
                    "target_type": "page",
                    "role_or_context": "AWS",
                    "metadata": {"company": "Pump.co"},
                },
                {
                    "display_name": "Rishabh Sagar",
                    "url": "https://rishabhsagar.com/",
                    "platform": "web",
                    "target_type": "person",
                    "role_or_context": "Founder & CTO",
                    "why_relevant": "Founder CTO at Superhawk.ai with AWS/B2B SaaS signals.",
                    "evidence_summary": "Personal site and company evidence identify him as Founder & CTO.",
                    "metadata": {"company": "Superhawk.ai", "role": "Founder & CTO"},
                    "source_urls": ["https://rishabhsagar.com/"],
                },
            ],
        )

        assert len(saved) == 3
        rows = db.conn.execute("SELECT display_name, target_type, organization FROM targets WHERE run_id = 'run_people' ORDER BY created_at").fetchall()
        assert [(row["display_name"], row["target_type"], row["organization"]) for row in rows] == [
            ("content/actions/how", "page", "GitHub Docs"),
            ("Channel Partnerships Manager", "page", "Pump.co"),
            ("Rishabh Sagar", "person", "Superhawk.ai"),
        ]
        skipped = db.conn.execute("SELECT detail FROM run_steps WHERE run_id = 'run_people' AND title = 'Skipped invalid prospect targets'").fetchone()
        assert skipped is None
    finally:
        db.close()


def test_browserbase_named_prospect_save_keeps_generic_synthesized_hints(tmp_path: Path) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        insert_run(db, "run_browserbase_people")
        run = db.conn.execute("SELECT * FROM runs WHERE id = 'run_browserbase_people'").fetchone()
        assert run is not None
        result = BrowserbaseDeepResearchResult(
            prompt="Find CTO prospects with Name, Role, Company, LinkedIn URL for outreach.",
            platforms=["web"],
            queries=["CTO AWS SaaS"],
            search_results=[],
            fetched_pages=[],
            synthesized_targets=[
                BrowserbaseSynthesizedTarget(display_name="Chief Technology Officer", url="https://workatastartup.com/jobs/123", platform="web", target_type="page", role_or_context="CTO", relevance_score=0.7, why_relevant="Job page", evidence_summary="Job listing", outreach_angle="", source_urls=["https://workatastartup.com/jobs/123"], metadata={"company": "Thera"}),
                BrowserbaseSynthesizedTarget(display_name="Ada Lovelace", url="https://example.com/ada", platform="web", target_type="person", role_or_context="Founder CTO", relevance_score=0.9, why_relevant="Named founder CTO", evidence_summary="Evidence identifies Ada as Founder CTO.", outreach_angle="Ask about deploy operations.", source_urls=["https://example.com/ada"], metadata={"company": "Analytical SaaS"}),
            ],
        )

        db.save_browserbase_research(run, result)

        rows = db.conn.execute("SELECT display_name, target_type, organization FROM targets WHERE run_id = 'run_browserbase_people' ORDER BY created_at").fetchall()
        assert [(row["display_name"], row["target_type"], row["organization"]) for row in rows] == [
            ("Chief Technology Officer", "page", "Thera"),
            ("Ada Lovelace", "person", "Analytical SaaS"),
        ]
        skipped = db.conn.execute("SELECT detail FROM run_steps WHERE run_id = 'run_browserbase_people' AND title = 'Skipped invalid prospect targets'").fetchone()
        assert skipped is None
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
