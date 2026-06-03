from __future__ import annotations

from threading import get_ident
from pathlib import Path
from sqlite3 import connect

import httpx

from reacher_runner.browserbase.research import (
    BrowserbaseDeepResearchResult,
    BrowserbaseFetchResult,
    BrowserbaseResearchClient,
    BrowserbaseSearchResult,
    BrowserbaseSynthesizedTarget,
    build_research_queries,
)
from reacher_runner.browserbase.yc import is_yc_w22_prompt
from reacher_runner.code_mode import ResearchCodeModeExecutor, ResearchCodeModeSdk, fallback_code_for_prompt
from reacher_runner.agents.research_agent import ResearchAgent
from reacher_runner.config import Config
from reacher_runner.db import ReacherDb
from reacher_runner.gemini import GeminiResearchClient, GeminiResult, _json_from_text
from reacher_runner.github import (
    GitHubContactPath,
    GitHubCreatorSignal,
    GitHubProjectSignal,
    GitHubResearchClient,
    GitHubResearchResult,
    GitHubUserSignal,
    build_github_queries,
)
from reacher_runner.reddit.research import RedditResearchClient
from reacher_runner.runs.executor import RunExecutor
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


def test_browserbase_query_builder_keeps_twenty_planned_queries() -> None:
    planned = [
        {"platform": "web", "query": f'"Founder CTO" AWS SaaS {index}', "reason": "coverage"}
        for index in range(25)
    ]

    queries = build_research_queries("Find founder CTO prospects", ["web"], planned_queries=planned)

    assert len(queries) == 20
    assert queries[-1].query == '"Founder CTO" AWS SaaS 19'


def test_reddit_research_sanitizes_planned_queries_and_subreddits() -> None:
    class StubRedditClient(RedditResearchClient):
        def __init__(self):
            self.calls: list[tuple[str, str | None]] = []

        def _search_posts(self, query: str, subreddit: str | None, limit: int):
            self.calls.append((query, subreddit))
            return []

        def _top_comments(self, post_id: str, limit: int):
            return []

    client = StubRedditClient()
    result = client.research(
        "Find ops pain in r/startups",
        planned_queries=["  deploy failures   AWS  ", "", "x" * 200, "deploy failures AWS"],
        planned_subreddits=["r/SaaS", "/r/devops", "not valid"],
    )

    assert result.subreddits == ["startups", "saas", "devops"]
    assert all(query and len(query) <= 120 for query, _ in client.calls)
    assert ("deploy failures AWS", "saas") in client.calls


def test_reddit_research_caps_planned_query_subreddit_matrix() -> None:
    class StubRedditClient(RedditResearchClient):
        def __init__(self):
            self.calls: list[tuple[str, str | None]] = []

        def _search_posts(self, query: str, subreddit: str | None, limit: int):
            self.calls.append((query, subreddit))
            return []

        def _top_comments(self, post_id: str, limit: int):
            return []

    client = StubRedditClient()
    result = client.research(
        "Find ops pain",
        planned_queries=["q1", "q2", "q3"],
        planned_subreddits=["saas", "devops", "aws"],
        max_searches=5,
    )

    assert len(client.calls) == 5
    assert "search budget reached" in result.errors[-1].lower()


def test_reddit_research_stops_after_repeated_403s() -> None:
    class BlockedRedditClient(RedditResearchClient):
        def __init__(self):
            self.calls = 0

        def _search_posts(self, query: str, subreddit: str | None, limit: int):
            self.calls += 1
            request = httpx.Request("GET", "https://www.reddit.com/search.json")
            response = httpx.Response(403, request=request)
            raise httpx.HTTPStatusError("403 Blocked", request=request, response=response)

        def _top_comments(self, post_id: str, limit: int):
            return []

    client = BlockedRedditClient()
    result = client.research(
        "Find ops pain",
        planned_queries=["q1", "q2", "q3"],
        planned_subreddits=["saas", "devops", "aws", "gcp"],
        max_searches=30,
    )

    assert client.calls == 3
    assert "appears blocked" in result.errors[-1]


def test_reddit_research_uses_browserbase_fallback_after_repeated_403s() -> None:
    class FallbackSearch:
        def __init__(self):
            self.calls: list[str] = []

        def search_web(self, query: str, *, platform: str, num_results: int = 5):
            self.calls.append(query)
            return [
                BrowserbaseSearchResult(
                    query=query,
                    title="How do small SaaS teams handle deploy failures?",
                    url="https://www.reddit.com/r/SaaS/comments/abc123/how_do_small_saas_teams_handle_deploy_failures/",
                    platform=platform,
                )
            ]

    class BlockedRedditClient(RedditResearchClient):
        def __init__(self, fallback):
            super().__init__(browserbase=fallback)
            self.calls = 0

        def _search_posts(self, query: str, subreddit: str | None, limit: int):
            self.calls += 1
            request = httpx.Request("GET", "https://www.reddit.com/search.json")
            response = httpx.Response(403, request=request)
            raise httpx.HTTPStatusError("403 Blocked", request=request, response=response)

        def _top_comments(self, post_id: str, limit: int):
            return []

    fallback = FallbackSearch()
    client = BlockedRedditClient(fallback)
    result = client.research(
        "Find ops pain",
        planned_queries=["deploy failures"],
        planned_subreddits=["saas", "devops", "aws", "gcp"],
        max_searches=30,
    )

    client.close()

    assert client.calls == 3
    assert fallback.calls
    assert result.posts
    assert result.posts[0].id == "abc123"
    assert result.posts[0].subreddit == "saas"
    assert "Browserbase Search fallback" in result.errors[-1]


def test_browserbase_usage_recorder_runs_on_calling_thread() -> None:
    config = Config(
        root=Path("."),
        database_path=Path("reacher.sqlite"),
        data_dir=Path("."),
        browserbase_api_key="bb_test",
        browserbase_project_id="project_test",
        github_token=None,
        gemini_api_key=None,
        google_agent_platform_api_key=None,
        poll_interval_ms=1000,
    )
    main_thread = get_ident()
    recorder_threads: list[int] = []
    client = BrowserbaseResearchClient(config, usage_recorder=lambda event: recorder_threads.append(get_ident()))

    def fake_search(query: str, *, platform: str, num_results: int = 5):
        client.record_usage(browserbase_search_event(query, 1))
        return [BrowserbaseSearchResult(query=query, title=query, url=f"https://example.com/{len(query)}", platform=platform)]

    try:
        client.search_web = fake_search  # type: ignore[method-assign]
        client.research("Find targets", ["web"], planned_queries=[{"platform": "web", "query": "founder CTO AWS"}], max_fetches=0)
    finally:
        client.close()

    assert recorder_threads
    assert set(recorder_threads) == {main_thread}


def test_gemini_api_rejects_oauth_shaped_token(tmp_path: Path) -> None:
    config = Config(
        root=tmp_path,
        database_path=tmp_path / "reacher.sqlite",
        data_dir=tmp_path,
        browserbase_api_key=None,
        browserbase_project_id=None,
        github_token=None,
        gemini_api_key="AQ.Ab8RNfakeoauth",
        google_agent_platform_api_key=None,
        poll_interval_ms=1000,
    )

    result = GeminiResearchClient(config)._try_genai_api("Return JSON only. {}")

    assert not result.ok
    assert "does not look like" in str(result.error)


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


def test_executor_marks_research_failed_when_all_discovery_failed(tmp_path: Path, monkeypatch) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    config = Config(
        root=tmp_path,
        database_path=db_path,
        data_dir=tmp_path,
        browserbase_api_key=None,
        browserbase_project_id=None,
        github_token=None,
        gemini_api_key=None,
        google_agent_platform_api_key=None,
        poll_interval_ms=1000,
    )

    def fake_run(agent, run) -> None:
        agent.db.add_step(run["id"], "fetch", "Provider failed", "All discovery providers failed.", status="failed")

    monkeypatch.setattr(ResearchAgent, "run", fake_run)
    try:
        db.conn.execute(
            "INSERT INTO runs (id, kind, status, prompt, settings_json, created_at, updated_at) VALUES ('run_failed_empty', 'research', 'claimed', 'Find targets', '{\"platforms\":[\"web\"]}', 1, 1)"
        )
        db.conn.commit()
        run = db.conn.execute("SELECT * FROM runs WHERE id = 'run_failed_empty'").fetchone()

        RunExecutor(config, db).execute(run)

        saved = db.conn.execute("SELECT status, result_summary, error_message FROM runs WHERE id = 'run_failed_empty'").fetchone()
        assert saved["status"] == "failed"
        assert "no targets" in saved["result_summary"].lower()
        assert "No targets" in saved["error_message"]
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


def test_browserbase_research_persistence_skips_blocked_fallback_pages(tmp_path: Path) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        db.conn.execute(
            "INSERT INTO runs (id, kind, status, prompt, settings_json, created_at, updated_at) VALUES ('run_blocked_page', 'research', 'claimed', 'Research Adam Nelson', '{\"platforms\":[\"web\"]}', 1, 1)"
        )
        db.conn.commit()
        run = db.conn.execute("SELECT * FROM runs WHERE id = 'run_blocked_page'").fetchone()

        result = BrowserbaseDeepResearchResult(
            prompt="Research Adam Nelson",
            platforms=["web"],
            queries=["Adam Nelson Wellfound"],
            search_results=[
                BrowserbaseSearchResult(query="Adam Nelson Wellfound", title="Adam Nelson", url="https://wellfound.com/p/varud", platform="web")
            ],
            fetched_pages=[
                BrowserbaseFetchResult(
                    url="https://wellfound.com/p/varud",
                    title="Adam Nelson",
                    platform="web",
                    status_code=403,
                    content_type="text/markdown",
                    content="Please enable JS and disable any ad blocker",
                )
            ],
        )

        db.save_browserbase_research(run, result)

        assert db.conn.execute("SELECT COUNT(*) AS count FROM sources WHERE run_id = 'run_blocked_page'").fetchone()["count"] == 1
        assert db.conn.execute("SELECT COUNT(*) AS count FROM targets WHERE run_id = 'run_blocked_page'").fetchone()["count"] == 0
    finally:
        db.close()


def test_code_mode_executor_allows_safe_imports_and_blocks_unsafe_imports(tmp_path: Path) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        db.conn.execute(
            "INSERT INTO runs (id, kind, status, prompt, settings_json, created_at, updated_at) VALUES ('run_code_block', 'research', 'claimed', 'Find targets', '{\"platforms\":[\"web\"]}', 1, 1)"
        )
        db.conn.commit()

        class StubBrowserbase:
            pass

        sdk = ResearchCodeModeSdk(run_id="run_code_block", prompt="Find targets", db=db, browserbase=StubBrowserbase(), platforms=["web"])  # type: ignore[arg-type]
        safe_result = ResearchCodeModeExecutor(db, tmp_path).execute(
            run_id="run_code_block",
            code='import json\nimport re\nfrom statistics import mean\ndef run(sdk):\n    return {"ok": bool(re.search("a", "acme")), "avg": mean([1, 2, 3]), "json": json.dumps({"a": 1})}',
            sdk=sdk,
        )
        assert safe_result.ok
        assert safe_result.output == {"ok": True, "avg": 2, "json": '{"a": 1}'}

        result = ResearchCodeModeExecutor(db, tmp_path).execute(
            run_id="run_code_block",
            code="import os\ndef run(sdk):\n    return {}",
            sdk=sdk,
        )

        assert not result.ok
        assert "may not import os" in str(result.error)

        dunder_result = ResearchCodeModeExecutor(db, tmp_path).execute(
            run_id="run_code_block",
            code="def run(sdk):\n    return sdk.__class__",
            sdk=sdk,
        )
        assert not dunder_result.ok
        assert "dunder" in str(dunder_result.error)
    finally:
        db.close()


def test_code_mode_executor_persists_candidates_scorecards_and_targets(tmp_path: Path) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        db.conn.execute(
            "INSERT INTO runs (id, kind, status, prompt, settings_json, created_at, updated_at) VALUES ('run_code', 'research', 'claimed', 'Find founder CTO prospects', '{\"platforms\":[\"web\"]}', 1, 1)"
        )
        db.conn.commit()

        class StubBrowserbase:
            def flush_usage(self):
                return None

        code = """
def run(sdk):
    sdk.checkpoint("plan", {"queries": 1})
    ids = sdk.save_candidates([{"name": "Jane CTO", "company": "Acme", "role": "Founder CTO", "url": "https://acme.example", "platform": "web", "reason": "AWS SaaS signal", "confidence": 0.9}])
    sdk.save_enrichments(ids[0], [{"query": "Acme AWS", "platform": "web", "url": "https://acme.example", "title": "Acme", "summary": "Hiring backend engineers for AWS operations", "confidence": 0.8}])
    sdk.save_scorecards([{"candidate_id": ids[0], "icp_fit": 5, "pain_evidence": 4, "reachability": 4, "call_likelihood": 3, "design_partner": 5, "rationale": "Strong fit"}])
    sdk.save_targets([{"candidate_id": ids[0], "display_name": "Jane CTO", "url": "https://acme.example", "platform": "web", "target_type": "person", "role_or_context": "Founder CTO", "relevance_score": 0.93, "why_relevant": "Founder-led B2B SaaS with AWS ops signal", "evidence_summary": "Hiring backend engineers for AWS operations", "outreach_angle": "Ask about post-deploy closure", "source_urls": ["https://acme.example"], "metadata": {"scores": {"icp_fit": 5}, "stack_signals": ["AWS"], "pain_signals": ["backend infra ownership"]}}])
    return {"ok": True}
"""
        sdk = ResearchCodeModeSdk(run_id="run_code", prompt="Find founder CTO prospects", db=db, browserbase=StubBrowserbase(), platforms=["web"])  # type: ignore[arg-type]
        result = ResearchCodeModeExecutor(db, tmp_path).execute(run_id="run_code", code=code, sdk=sdk)

        assert result.ok
        assert db.conn.execute("SELECT COUNT(*) AS count FROM research_checkpoints WHERE run_id = 'run_code'").fetchone()["count"] == 1
        assert db.conn.execute("SELECT COUNT(*) AS count FROM research_candidates WHERE run_id = 'run_code'").fetchone()["count"] == 1
        assert db.conn.execute("SELECT COUNT(*) AS count FROM research_enrichments WHERE run_id = 'run_code'").fetchone()["count"] == 1
        assert db.conn.execute("SELECT COUNT(*) AS count FROM research_scorecards WHERE run_id = 'run_code' AND target_id IS NOT NULL").fetchone()["count"] == 1
        target = db.conn.execute("SELECT display_name, relevance_score, metadata_json FROM targets WHERE run_id = 'run_code'").fetchone()
        assert target["display_name"] == "Jane CTO"
        assert target["relevance_score"] == 0.93
        assert "stack_signals" in target["metadata_json"]
    finally:
        db.close()


def test_code_mode_sdk_exposes_exclusions_and_save_guard_skips_duplicates(tmp_path: Path) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        db.conn.execute("INSERT INTO runs (id, kind, status, prompt, settings_json, created_at, updated_at) VALUES ('run_root', 'research', 'completed', 'Find', '{\"platforms\":[\"web\"]}', 1, 1)")
        db.conn.execute("INSERT INTO targets (id, run_id, platform, target_type, display_name, profile_url, organization, status, created_at, updated_at) VALUES ('target_prior', 'run_root', 'web', 'person', 'Ada Founder', 'https://example.com/ada', 'Acme', 'saved', 1, 1)")
        db.conn.execute("INSERT INTO runs (id, kind, status, prompt, settings_json, parent_run_id, rerun_root_run_id, rerun_index, created_at, updated_at) VALUES ('run_code_rerun', 'research', 'claimed', 'Find', '{\"platforms\":[\"web\"]}', 'run_root', 'run_root', 1, 2, 2)")
        db.conn.commit()

        class StubBrowserbase:
            def flush_usage(self):
                return None

        code = """
def run(sdk):
    exclusions = sdk.exclusions()
    sdk.checkpoint("exclusions", {"urls": len(exclusions.get("urls", []))})
    sdk.save_targets([
        {"display_name": "Ada Founder", "url": "https://example.com/ada", "platform": "web", "target_type": "person", "role_or_context": "Founder", "relevance_score": 0.9, "why_relevant": "Duplicate", "evidence_summary": "Duplicate", "source_urls": ["https://example.com/ada"], "metadata": {"company": "Acme"}},
        {"display_name": "New Founder", "url": "https://example.com/new", "platform": "web", "target_type": "person", "role_or_context": "Founder", "relevance_score": 0.8, "why_relevant": "New", "evidence_summary": "New", "source_urls": ["https://example.com/new"], "metadata": {"company": "NewCo"}},
    ])
    return {"excluded": len(exclusions.get("urls", []))}
"""
        exclusions = db.rerun_exclusions("run_code_rerun")
        sdk = ResearchCodeModeSdk(run_id="run_code_rerun", prompt="Find", db=db, browserbase=StubBrowserbase(), platforms=["web"], exclusions=exclusions)  # type: ignore[arg-type]
        result = ResearchCodeModeExecutor(db, tmp_path).execute(run_id="run_code_rerun", code=code, sdk=sdk)

        assert result.ok
        assert result.output["excluded"] == 1
        rows = db.conn.execute("SELECT display_name FROM targets WHERE run_id = 'run_code_rerun' ORDER BY display_name").fetchall()
        assert [row["display_name"] for row in rows] == ["New Founder"]
    finally:
        db.close()


def test_deterministic_code_mode_fallback_covers_many_targets_without_fetch(tmp_path: Path) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        db.conn.execute(
            "INSERT INTO runs (id, kind, status, prompt, settings_json, created_at, updated_at) VALUES ('run_code_many', 'research', 'claimed', 'Find founder CTO prospects with company and LinkedIn URL', '{\"platforms\":[\"web\",\"linkedin\"]}', 1, 1)"
        )
        db.conn.commit()

        class StubBrowserbase:
            def __init__(self):
                self.search_calls = 0
                self.fetch_calls = 0

            def search_web(self, query: str, platform: str = "web", num_results: int = 10):
                self.search_calls += 1
                return [
                    BrowserbaseSearchResult(
                        query=query,
                        title=f"Alex Founder {self.search_calls}-{index} - Founder CTO at Acme {self.search_calls}-{index}",
                        url=f"https://www.linkedin.com/in/alex-founder-{self.search_calls}-{index}",
                        platform=platform,
                    )
                    for index in range(num_results)
                ]

            def fetch_url(self, *args, **kwargs):
                self.fetch_calls += 1
                raise AssertionError("deterministic fallback should not fetch by default")

            def flush_usage(self):
                return None

        browserbase = StubBrowserbase()
        sdk = ResearchCodeModeSdk(run_id="run_code_many", prompt="Find founder CTO prospects with company and LinkedIn URL", db=db, browserbase=browserbase, platforms=["web", "linkedin"])  # type: ignore[arg-type]
        result = ResearchCodeModeExecutor(db, tmp_path).execute(run_id="run_code_many", code=fallback_code_for_prompt("Find founder CTO prospects with company and LinkedIn URL"), sdk=sdk)

        assert result.ok
        assert result.output["targets"] == 100
        assert browserbase.fetch_calls == 0
        assert db.conn.execute("SELECT COUNT(*) AS count FROM research_candidates WHERE run_id = 'run_code_many'").fetchone()["count"] >= 100
        target_count = db.conn.execute("SELECT COUNT(*) AS count FROM targets WHERE run_id = 'run_code_many' AND target_type = 'person'").fetchone()["count"]
        assert target_count == 100
        first = db.conn.execute("SELECT display_name, organization, role_or_context FROM targets WHERE run_id = 'run_code_many' ORDER BY relevance_score DESC LIMIT 1").fetchone()
        assert first["display_name"] == "Alex Founder"
        assert str(first["organization"]).startswith("Acme ")
        assert first["role_or_context"] == "Founder CTO"
    finally:
        db.close()


def test_code_mode_fallback_parses_linkedin_title_name_and_company(tmp_path: Path) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        db.conn.execute(
            "INSERT INTO runs (id, kind, status, prompt, settings_json, created_at, updated_at) VALUES ('run_code_parse', 'research', 'claimed', 'Find founder CTO prospects with company and LinkedIn URL', '{\"platforms\":[\"web\",\"linkedin\"]}', 1, 1)"
        )
        db.conn.commit()

        class StubBrowserbase:
            def search_web(self, query: str, platform: str = "web", num_results: int = 10):
                return [
                    BrowserbaseSearchResult(query=query, title="Rishabh Sagar — Co-Founder & CTO at Superhawk.ai", url="https://rishabhsagar.com/", platform=platform),
                    BrowserbaseSearchResult(query=query, title="Piyush Agarwal", url="https://linkedin.com/in/piyushlinkedin", platform=platform),
                    BrowserbaseSearchResult(query=query, title="Inside T-Mat Global Technologies: The Startup Founded by Cloud & DevOps Leader Sainath Mitalakar | Indianflux", url="https://indianflux.com/inside-t-mat-global-technologies-the-startup-founded-by-cloud-devops-leader-sainath-mitalakar/", platform=platform),
                ]

            def flush_usage(self):
                return None

        sdk = ResearchCodeModeSdk(run_id="run_code_parse", prompt="Find founder CTO prospects with company and LinkedIn URL", db=db, browserbase=StubBrowserbase(), platforms=["web", "linkedin"])  # type: ignore[arg-type]
        result = ResearchCodeModeExecutor(db, tmp_path).execute(run_id="run_code_parse", code=fallback_code_for_prompt("Find founder CTO prospects with company and LinkedIn URL"), sdk=sdk)

        assert result.ok
        rows = db.conn.execute("SELECT display_name, organization, role_or_context FROM targets WHERE run_id = 'run_code_parse' ORDER BY relevance_score DESC LIMIT 3").fetchall()
        values = [(row["display_name"], row["organization"], row["role_or_context"]) for row in rows]
        assert ("Rishabh Sagar", "Superhawk.ai", "Co-Founder & CTO") in values
        assert any(name == "Piyush Agarwal" for name, _company, _role in values)
        assert any(row["display_name"] == "Sainath Mitalakar" for row in rows)
    finally:
        db.close()


def test_gemini_json_parser_repairs_invalid_python_regex_escapes() -> None:
    parsed = _json_from_text('{"code":"def run(sdk):\\n    pattern = \\"\\\\s+\\"\\n    return {}"}')
    assert "def run" in parsed["code"]
    assert "\\s+" in parsed["code"]


def test_research_agent_code_mode_runs_deterministic_fallback_after_generated_code_crash(tmp_path: Path, monkeypatch) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        db.conn.execute(
            "INSERT INTO runs (id, kind, status, prompt, settings_json, created_at, updated_at) VALUES ('run_code_recover', 'research', 'claimed', 'Find founder CTO prospects with company and LinkedIn URL', '{\"platforms\":[\"web\",\"linkedin\"]}', 1, 1)"
        )
        db.conn.commit()

        config = Config(
            root=tmp_path,
            database_path=db_path,
            data_dir=tmp_path,
            browserbase_api_key="bb_test",
            browserbase_project_id="proj_test",
            github_token=None,
            gemini_api_key=None,
            google_agent_platform_api_key=None,
            poll_interval_ms=1000,
        )

        def broken_generate(self, prompt: str, platforms: list[str], rerun_guidance: str = ""):
            return GeminiResult(ok=True, provider="test", data={"code": "def run(sdk):\n    return missing_variable"})

        monkeypatch.setattr(GeminiResearchClient, "generate_code_mode_research", broken_generate)

        class StubBrowserbase:
            def __init__(self):
                self.search_calls = 0

            def search_web(self, query: str, platform: str = "web", num_results: int = 10):
                self.search_calls += 1
                return [
                    BrowserbaseSearchResult(
                        query=query,
                        title=f"Jordan CTO {self.search_calls}-{index} - Founder CTO at RecoverCo {self.search_calls}-{index}",
                        url=f"https://www.linkedin.com/in/jordan-cto-{self.search_calls}-{index}",
                        platform=platform,
                    )
                    for index in range(num_results)
                ]

            def flush_usage(self):
                return None

        agent = ResearchAgent(db, tmp_path, tmp_path, config=config)
        ok = agent._run_code_mode("run_code_recover", "Find founder CTO prospects with company and LinkedIn URL", ["web", "linkedin"], StubBrowserbase())  # type: ignore[arg-type]

        assert ok
        executed = db.conn.execute("SELECT status, detail FROM run_steps WHERE run_id = 'run_code_recover' AND title = 'Executed code-mode research'").fetchone()
        assert executed["status"] == "failed"
        fallback = db.conn.execute("SELECT status, detail FROM run_steps WHERE run_id = 'run_code_recover' AND title = 'Executed deterministic code-mode fallback'").fetchone()
        assert fallback["status"] == "completed"
        assert "saved" in fallback["detail"]
        assert db.conn.execute("SELECT COUNT(*) AS count FROM targets WHERE run_id = 'run_code_recover' AND target_type = 'person'").fetchone()["count"] == 100
    finally:
        db.close()


def test_research_agent_code_mode_first_short_circuits_other_research_paths(tmp_path: Path, monkeypatch) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        db.conn.execute(
            "INSERT INTO runs (id, kind, status, prompt, settings_json, created_at, updated_at) VALUES ('run_code_first', 'research', 'claimed', 'Find founder CTO prospects', '{\"platforms\":[\"web\",\"linkedin\",\"reddit\",\"github\"],\"researchMode\":\"code_mode_first\"}', 1, 1)"
        )
        db.conn.commit()
        run = db.conn.execute("SELECT * FROM runs WHERE id = 'run_code_first'").fetchone()
        config = Config(
            root=tmp_path,
            database_path=db_path,
            data_dir=tmp_path,
            browserbase_api_key="bb_test",
            browserbase_project_id="proj_test",
            github_token=None,
            gemini_api_key=None,
            google_agent_platform_api_key=None,
            poll_interval_ms=1000,
        )

        def fake_code_mode(self, run_id, prompt, platforms, client, exclusions=None, rerun_guidance=""):
            self.db.save_code_mode_targets(run_id, prompt, [{
                "display_name": "Code Mode Founder",
                "url": "https://example.com/founder",
                "platform": "web",
                "target_type": "person",
                "role_or_context": "Founder CTO",
                "relevance_score": 0.9,
                "why_relevant": "Code-mode target.",
                "evidence_summary": "Code-mode saved this target.",
                "metadata": {"company": "CodeCo"},
            }])
            return True

        monkeypatch.setattr(ResearchAgent, "_run_code_mode", fake_code_mode)
        agent = ResearchAgent(db, tmp_path, tmp_path, config=config)
        agent.run(run)

        step_titles = [row["title"] for row in db.conn.execute("SELECT title FROM run_steps WHERE run_id = 'run_code_first' ORDER BY \"index\"").fetchall()]
        assert "Code-mode first enabled" in step_titles
        assert "Started Reddit public research" not in step_titles
        assert "Started GitHub API research" not in step_titles
        assert "Started Browserbase deep research" not in step_titles
        assert db.conn.execute("SELECT COUNT(*) AS count FROM targets WHERE run_id = 'run_code_first'").fetchone()["count"] == 1
    finally:
        db.close()


def test_normal_browserbase_simulation_fetches_pages_while_code_mode_fallback_is_search_first(tmp_path: Path) -> None:
    config = Config(
        root=tmp_path,
        database_path=tmp_path / "reacher.sqlite",
        data_dir=tmp_path,
        browserbase_api_key="bb_test",
        browserbase_project_id="proj_test",
        github_token=None,
        gemini_api_key=None,
        google_agent_platform_api_key=None,
        poll_interval_ms=1000,
    )
    client = BrowserbaseResearchClient(config)
    search_calls = 0
    fetch_calls = 0

    def fake_search(query: str, platform: str = "web", num_results: int = 5):
        nonlocal search_calls
        search_calls += 1
        return [
            BrowserbaseSearchResult(
                query=query,
                title=f"Normal Result {search_calls}-{index}",
                url=f"https://example.com/normal-{search_calls}-{index}",
                platform=platform,
            )
            for index in range(num_results)
        ]

    def fake_fetch(url: str, title: str = "", platform: str = "web"):
        nonlocal fetch_calls
        fetch_calls += 1
        return BrowserbaseFetchResult(url=url, title=title, platform=platform, status_code=200, content_type="text/plain", content="Fetched page")

    client.search_web = fake_search  # type: ignore[method-assign]
    client.fetch_url = fake_fetch  # type: ignore[method-assign]
    try:
        result = client.research(
            "Find founder CTO prospects with company and LinkedIn URL",
            ["web", "linkedin"],
            planned_queries=[{"platform": "web", "query": "Founder CTO AWS SaaS"}, {"platform": "linkedin", "query": "Founder CTO AWS site:linkedin.com/in"}],
            max_results_per_query=10,
            max_fetches=30,
        )
    finally:
        client.close()

    assert search_calls >= 2
    assert fetch_calls == 30
    assert len(result.fetched_pages) == 30


def test_browserbase_aggregation_accepts_search_result_evidence(tmp_path: Path) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    config = Config(
        root=tmp_path,
        database_path=db_path,
        data_dir=tmp_path,
        browserbase_api_key=None,
        browserbase_project_id=None,
        github_token=None,
        gemini_api_key=None,
        google_agent_platform_api_key=None,
        poll_interval_ms=1000,
    )
    db.conn.execute(
        "INSERT INTO runs (id, kind, status, prompt, settings_json, created_at, updated_at) VALUES ('run_test', 'research', 'claimed', 'Find SaaS CTOs', '{\"platforms\":[\"web\"]}', 1, 1)"
    )
    db.conn.commit()

    class FakeGeminiClient:
        def __init__(self, config):
            self.config = config

        def aggregate_browserbase_research(self, prompt, pages, search_results):
            assert pages == []
            assert search_results[0]["title"] == "Jane CTO at Acme"

            class Result:
                ok = True
                provider = "fake"
                usage_event = None
                data = {
                    "summary": "Search evidence produced a target.",
                    "targets": [
                        {
                            "display_name": "Jane CTO",
                            "url": "https://example.com/jane",
                            "platform": "web",
                            "target_type": "person",
                            "role_or_context": "CTO at Acme",
                            "relevance_score": 0.64,
                            "why_relevant": "Search result identifies a SaaS CTO.",
                            "evidence_summary": "Search title names Jane as CTO at Acme.",
                            "outreach_angle": "Ask about post-deploy operations.",
                            "source_urls": ["https://example.com/jane"],
                        }
                    ],
                }

            return Result()

    try:
        import reacher_runner.agents.research_agent as research_agent_module

        original = research_agent_module.GeminiResearchClient
        research_agent_module.GeminiResearchClient = FakeGeminiClient
        agent = ResearchAgent(db, tmp_path, Path(__file__).resolve().parents[1] / "skills", config)
        targets = agent._aggregate_browserbase_research(
            "run_test",
            "Find SaaS CTOs",
            [],
            [BrowserbaseSearchResult(query="CTO SaaS", title="Jane CTO at Acme", url="https://example.com/jane", platform="web")],
        )

        assert len(targets) == 1
        assert targets[0].display_name == "Jane CTO"
    finally:
        research_agent_module.GeminiResearchClient = original
        db.close()


def test_github_query_builder_covers_projects_pain_and_users() -> None:
    queries = build_github_queries("Find browser automation agent projects and users")
    by_kind = {query.kind: [] for query in queries}
    for query in queries:
        by_kind.setdefault(query.kind, []).append(query.query)

    assert any("in:name,description,readme" in query for query in by_kind["repositories"])
    assert any("type:issue" in query for query in by_kind["issues"])
    assert any("filename:package.json" in query for query in by_kind["code"])
    assert all(len(query.query) <= 180 for query in queries)


def test_github_client_parses_project_creator_user_and_contact_signals() -> None:
    class StubGitHubClient(GitHubResearchClient):
        def __init__(self):
            pass

        def _get_json(self, path: str):
            if path.startswith("/search/repositories"):
                return {
                    "items": [
                        {
                            "full_name": "acme/browser-agent",
                            "html_url": "https://github.com/acme/browser-agent",
                            "description": "Browser automation agents for support teams.",
                            "stargazers_count": 120,
                            "open_issues_count": 4,
                            "owner": {"login": "acme", "type": "Organization", "html_url": "https://github.com/acme"},
                        }
                    ]
                }
            if path.startswith("/search/issues"):
                return {
                    "items": [
                        {
                            "title": "Browser sessions are flaky in production",
                            "html_url": "https://github.com/user/app/issues/7",
                            "repository_url": "https://api.github.com/repos/user/app",
                            "user": {"login": "jane", "html_url": "https://github.com/jane"},
                        }
                    ]
                }
            if path.startswith("/search/code"):
                return {
                    "items": [
                        {
                            "name": "package.json",
                            "html_url": "https://github.com/user/app/blob/main/package.json",
                            "repository": {
                                "full_name": "user/app",
                                "owner": {"login": "jane", "html_url": "https://github.com/jane"},
                            },
                        }
                    ]
                }
            if path == "/repos/acme/browser-agent":
                return {
                    "full_name": "acme/browser-agent",
                    "html_url": "https://github.com/acme/browser-agent",
                    "description": "Browser automation agents for support teams.",
                    "homepage": "https://acme.example",
                    "language": "TypeScript",
                    "stargazers_count": 120,
                    "forks_count": 12,
                    "open_issues_count": 4,
                    "pushed_at": "2026-05-01T00:00:00Z",
                    "topics": ["browser-automation", "agents"],
                    "owner": {"login": "acme", "type": "Organization", "html_url": "https://github.com/acme"},
                }
            if path == "/repos/acme/browser-agent/languages":
                return {"TypeScript": 1000}
            if path == "/repos/acme/browser-agent/contributors?per_page=3":
                return [{"login": "maintainer", "html_url": "https://github.com/maintainer", "contributions": 55}]
            if path == "/users/maintainer":
                return {
                    "login": "maintainer",
                    "html_url": "https://github.com/maintainer",
                    "name": "Main Tainer",
                    "company": "Acme",
                    "blog": "maintainer.example",
                    "email": "main@example.com",
                    "twitter_username": "maintainer",
                }
            if path == "/repos/acme/browser-agent/readme":
                return {"content": "QnJvd3NlciBhZ2VudCBmb3Igc3VwcG9ydCB0ZWFtcy4="}
            if path == "/repos/acme/browser-agent/contents/package.json":
                return {
                    "html_url": "https://github.com/acme/browser-agent/blob/main/package.json",
                    "content": "eyJhdXRob3IiOiJBY21lIDxvcHNAYWNtZS5leGFtcGxlPiJ9",
                }
            return None

        def _safe_get_json(self, path: str):
            return self._get_json(path)

        def close(self):
            pass

    result = StubGitHubClient().research("Find browser automation agent projects", max_repositories=1)

    assert len(result.projects) == 1
    project = result.projects[0]
    assert project.full_name == "acme/browser-agent"
    assert project.creators[0].login == "maintainer"
    assert project.creators[0].contact_paths[0].value == "main@example.com"
    assert project.package_contact_paths[0].value == "ops@acme.example"
    assert result.users[0].owner_login == "jane"
    assert project.score > 0.6


def test_github_research_persistence_writes_projects_creators_users_and_exports(tmp_path: Path) -> None:
    db_path = tmp_path / "reacher.sqlite"
    apply_migration(db_path)
    db = ReacherDb(db_path)
    try:
        db.conn.execute(
            "INSERT INTO runs (id, kind, status, prompt, settings_json, created_at, updated_at) VALUES ('run_gh', 'research', 'claimed', 'Find browser agent companies', '{\"platforms\":[\"github\"]}', 1, 1)"
        )
        db.conn.commit()
        run = db.conn.execute("SELECT * FROM runs WHERE id = 'run_gh'").fetchone()
        result = GitHubResearchResult(
            prompt="Find browser agent companies",
            queries=build_github_queries("Find browser agent companies")[:2],
            projects=[
                GitHubProjectSignal(
                    full_name="acme/browser-agent",
                    html_url="https://github.com/acme/browser-agent",
                    owner_login="acme",
                    owner_type="Organization",
                    owner_url="https://github.com/acme",
                    description="Browser automation agents.",
                    homepage="https://acme.example",
                    language="TypeScript",
                    stars=120,
                    forks=12,
                    open_issues=4,
                    pushed_at="2026-05-01T00:00:00Z",
                    topics=["agents"],
                    readme_excerpt="Contact ops@acme.example",
                    package_contact_paths=[GitHubContactPath("email", "ops@acme.example", "https://github.com/acme/browser-agent", 0.7)],
                    creators=[
                        GitHubCreatorSignal(
                            login="maintainer",
                            html_url="https://github.com/maintainer",
                            role="top_contributor",
                            contributions=55,
                            contact_paths=[GitHubContactPath("email", "main@example.com", "https://github.com/maintainer", 0.88)],
                        )
                    ],
                    users=[
                        GitHubUserSignal(
                            repo_full_name="user/app",
                            html_url="https://github.com/user/app/issues/7",
                            signal_type="issue_or_pr",
                            evidence="Browser sessions are flaky in production",
                            owner_login="jane",
                            owner_url="https://github.com/jane",
                        )
                    ],
                    score=0.84,
                    why_relevant="Matched browser agent company research.",
                )
            ],
        )

        list_id = db.save_github_research(run, result)

        assert db.conn.execute("SELECT source_run_id FROM lists WHERE id = ?", (list_id,)).fetchone()["source_run_id"] == "run_gh"
        assert db.conn.execute("SELECT COUNT(*) AS count FROM targets WHERE run_id = 'run_gh'").fetchone()["count"] == 3
        assert db.conn.execute("SELECT COUNT(*) AS count FROM targets WHERE platform = 'github' AND target_type = 'creator'").fetchone()["count"] == 1
        assert db.conn.execute("SELECT COUNT(*) AS count FROM targets WHERE platform = 'github' AND target_type = 'user'").fetchone()["count"] == 1
        assert db.conn.execute("SELECT COUNT(*) AS count FROM target_evidence").fetchone()["count"] >= 3
        metadata = db.conn.execute("SELECT metadata_json FROM targets WHERE target_type = 'project'").fetchone()["metadata_json"]
        assert "ops@acme.example" in metadata
    finally:
        db.close()
