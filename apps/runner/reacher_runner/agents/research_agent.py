from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from reacher_runner.artifacts.writer import ArtifactWriter
from reacher_runner.browserbase.research import BrowserbaseResearchClient, BrowserbaseSynthesizedTarget
from reacher_runner.browserbase.yc import YCBatchResearchClient, is_yc_w22_prompt
from reacher_runner.config import Config
from reacher_runner.db import ReacherDb
from reacher_runner.exports.markdown import render_csv, render_json, render_markdown
from reacher_runner.gemini import GeminiResearchClient
from reacher_runner.github import GitHubResearchClient
from reacher_runner.reddit import RedditResearchClient
from reacher_runner.skills.loader import SkillLoader


class ResearchAgent:
    def __init__(self, db: ReacherDb, data_dir: Path, skills_root: Path, config: Config | None = None):
        self.db = db
        self.writer = ArtifactWriter(data_dir)
        self.skills = SkillLoader(skills_root)
        self.config = config

    def run(self, run) -> None:
        settings = self.db.settings(run)
        platforms = settings.get("platforms", ["web"])
        loaded = self.skills.load("research", platforms)
        self.db.add_step(run["id"], "plan", "Loaded browser skills", f"{len(loaded)} skill files selected for this research run.")
        saved_lists: list[str] = []

        if "reddit" in platforms:
            reddit_plan = self._plan_reddit_queries(run["id"], run["prompt"])
            self.db.add_step(run["id"], "search", "Started Reddit public research", "Using Reddit public JSON endpoints for subreddit, post, comment, and user discovery.")
            client = RedditResearchClient()
            try:
                result = client.research(
                    run["prompt"],
                    planned_queries=reddit_plan.get("queries") or None,
                    planned_subreddits=reddit_plan.get("subreddits") or None,
                )
            finally:
                client.close()
            list_id = self.db.save_reddit_research(run, result)
            saved_lists.append(list_id)
            self.db.add_step(
                run["id"],
                "save",
                "Saved Reddit filters, targets, evidence, drafts, and list",
                f"Created list {list_id} with {len(result.posts)} posts and {len(result.comments)} comments.",
                output_json={"query": result.query, "subreddits": result.subreddits, "posts": len(result.posts), "comments": len(result.comments), "errors": result.errors},
            )

        if "github" in platforms:
            self.db.add_step(
                run["id"],
                "search",
                "Started GitHub API research",
                "Using GitHub REST API search and enrichment for projects, creators/maintainers, likely users/adopters, evidence, and public contact paths.",
            )
            client = GitHubResearchClient(self.config.github_token if self.config else None)
            try:
                result = client.research(run["prompt"])
            finally:
                client.close()
            list_id = self.db.save_github_research(run, result)
            saved_lists.append(list_id)
            self.db.add_step(
                run["id"],
                "save",
                "Saved GitHub projects, creators, users, evidence, drafts, and list",
                f"Created list {list_id} with {len(result.projects)} projects and {len(result.users)} user/adopter signals.",
                output_json={
                    "queries": [query.__dict__ for query in result.queries],
                    "projects": len(result.projects),
                    "users": len(result.users),
                    "errors": result.errors,
                },
            )

        browserbase_platforms = [platform for platform in platforms if platform not in {"reddit", "github"}]
        if browserbase_platforms and self.config and self.config.browserbase_configured:
            context_ids: dict[str, str] = {}
            for platform in browserbase_platforms:
                context = self.db.get_ready_context(platform)
                if context and context["provider_context_id"]:
                    context_ids[platform] = context["provider_context_id"]
            self.db.add_step(
                run["id"],
                "search",
                "Started Browserbase deep research",
                "Using Browserbase Search for discovery, Fetch for page extraction, and persisted contexts for logged-in browser sessions where available.",
                input_json={"platforms": browserbase_platforms, "contextPlatforms": sorted(context_ids)},
            )
            client = BrowserbaseResearchClient(self.config, usage_recorder=lambda event: self.db.add_usage_event(run["id"], event))
            try:
                if is_yc_w22_prompt(run["prompt"]):
                    self.db.add_step(
                        run["id"],
                        "navigate",
                        "Detected YC Winter 2022 batch research",
                        "Using a Browserbase-rendered YC directory scrape so the run can collect the first 30 company profiles instead of generic search snippets.",
                    )
                    yc_result = YCBatchResearchClient(client).research_w22_top_companies(run["prompt"], limit=30)
                    yc_result = self._enrich_yc_notes(run["id"], yc_result)
                    list_id = self.db.save_yc_batch_research(run, yc_result)
                    saved_lists.append(list_id)
                    self.db.add_step(
                        run["id"],
                        "save",
                        "Saved YC W22 companies, socials, evidence, notes, drafts, and list",
                        f"Created list {list_id} with {len(yc_result.companies)} companies from YC Winter 2022.",
                        output_json={
                            "companies": len(yc_result.companies),
                            "withCompanySocials": sum(1 for company in yc_result.companies if company.company_socials),
                            "withFounderSocialClues": sum(1 for company in yc_result.companies if company.founder_social_results),
                            "geminiProvider": yc_result.gemini_provider,
                            "errors": yc_result.errors,
                        },
                    )
                else:
                    plan = self._plan_browserbase_queries(run["id"], run["prompt"], browserbase_platforms)
                    result = client.research(
                        run["prompt"],
                        browserbase_platforms,
                        context_ids=context_ids,
                        planned_queries=plan.get("queries"),
                        max_results_per_query=8,
                        max_fetches=30,
                    )
                    synthesized_targets = self._aggregate_browserbase_research(run["id"], run["prompt"], result.fetched_pages, result.search_results)
                    if synthesized_targets:
                        result = replace(result, synthesized_targets=synthesized_targets)
                    list_id = self.db.save_browserbase_research(run, result)
                    saved_lists.append(list_id)
                    self.db.add_step(
                        run["id"],
                        "save",
                        "Saved Browserbase filters, sources, targets, evidence, drafts, and list",
                        f"Created list {list_id} with {len(result.search_results)} search results, {len(result.fetched_pages)} fetched pages, {len(result.synthesized_targets)} synthesized targets, and {len(result.browser_sessions)} browser sessions.",
                        output_json={
                            "queries": result.queries,
                            "searchResults": len(result.search_results),
                            "fetchedPages": len(result.fetched_pages),
                            "synthesizedTargets": len(result.synthesized_targets),
                            "browserSessions": len(result.browser_sessions),
                            "errors": result.errors,
                        },
                    )
            finally:
                client.close()

        if not saved_lists:
            detail = "Search/Fetch and authenticated browsing are gated behind Browserbase configuration."
            if browserbase_platforms and self.config and not self.config.browserbase_configured:
                detail = "Browserbase credentials are missing, so the runner wrote the local fixture instead of live deep research."
            self.db.add_step(run["id"], "search", "Prepared discovery filters", detail)
            list_id = self.db.save_research_fixture(run)
            saved_lists.append(list_id)
            self.db.add_step(run["id"], "save", "Saved filters, targets, evidence, and list", f"Created list {list_id}.")
        self.write_exports(run["id"])

    def _enrich_yc_notes(self, run_id: str, yc_result):
        if not self.config:
            return yc_result
        gemini = GeminiResearchClient(self.config).enrich_yc_notes([company.__dict__ for company in yc_result.companies])
        if gemini.usage_event:
            self.db.add_usage_event(run_id, gemini.usage_event)
        if not gemini.ok or not gemini.data:
            return replace(yc_result, gemini_provider=gemini.provider, gemini_error=gemini.error)

        notes_by_name = {
            str(item.get("name")): str(item.get("note"))
            for item in gemini.data.get("companies", [])
            if isinstance(item, dict) and item.get("name") and item.get("note")
        }
        companies = [
            replace(company, note=notes_by_name.get(company.name) or company.note)
            for company in yc_result.companies
        ]
        return replace(yc_result, companies=companies, gemini_provider=gemini.provider)

    def _plan_browserbase_queries(self, run_id: str, prompt: str, platforms: list[str]) -> dict:
        if not self.config:
            return {}
        gemini = GeminiResearchClient(self.config).plan_browserbase_queries(prompt, platforms)
        if gemini.usage_event:
            self.db.add_usage_event(run_id, gemini.usage_event)
        if not gemini.ok or not gemini.data:
            self.db.add_step(
                run_id,
                "plan",
                "LLM query planning skipped",
                gemini.error or "No query plan returned; using deterministic query fallback.",
                status="skipped",
            )
            return {}
        queries = gemini.data.get("queries") if isinstance(gemini.data, dict) else []
        interpreted_goal = str(gemini.data.get("interpreted_goal") or "").strip() if isinstance(gemini.data, dict) else ""
        self.db.add_step(
            run_id,
            "plan",
            "Planned Browserbase search queries",
            f"{len(queries) if isinstance(queries, list) else 0} concise queries generated by {gemini.provider}.",
            output_json={"interpreted_goal": interpreted_goal, "queries": queries},
        )
        return {"queries": queries if isinstance(queries, list) else [], "interpreted_goal": interpreted_goal}

    def _plan_reddit_queries(self, run_id: str, prompt: str) -> dict:
        if not self.config:
            return {}
        gemini = GeminiResearchClient(self.config).plan_reddit_queries(prompt)
        if gemini.usage_event:
            self.db.add_usage_event(run_id, gemini.usage_event)
        if not gemini.ok or not gemini.data:
            self.db.add_step(
                run_id,
                "plan",
                "Reddit query planning skipped",
                gemini.error or "No query plan returned; using truncated prompt fallback.",
                status="skipped",
            )
            return {}
        queries = gemini.data.get("queries") if isinstance(gemini.data, dict) else []
        subreddits = gemini.data.get("subreddits") if isinstance(gemini.data, dict) else []
        interpreted_goal = str(gemini.data.get("interpreted_goal") or "").strip() if isinstance(gemini.data, dict) else ""
        self.db.add_step(
            run_id,
            "plan",
            "Planned Reddit search queries",
            f"{len(queries) if isinstance(queries, list) else 0} concise queries and {len(subreddits) if isinstance(subreddits, list) else 0} subreddits generated by {gemini.provider}.",
            output_json={"interpreted_goal": interpreted_goal, "queries": queries, "subreddits": subreddits},
        )
        return {
            "queries": queries if isinstance(queries, list) else [],
            "subreddits": subreddits if isinstance(subreddits, list) else [],
            "interpreted_goal": interpreted_goal,
        }

    def _aggregate_browserbase_research(self, run_id: str, prompt: str, pages, search_results=None) -> list[BrowserbaseSynthesizedTarget]:
        search_results = search_results or []
        if not self.config or (not pages and not search_results):
            return []
        gemini = GeminiResearchClient(self.config).aggregate_browserbase_research(
            prompt,
            [page.__dict__ for page in pages],
            [result.__dict__ for result in search_results],
        )
        if gemini.usage_event:
            self.db.add_usage_event(run_id, gemini.usage_event)
        if not gemini.ok or not gemini.data:
            self.db.add_step(
                run_id,
                "extract",
                "LLM aggregation skipped",
                gemini.error or "No aggregated targets returned; saving fetched pages directly.",
                status="skipped",
            )
            return []
        raw_targets = gemini.data.get("targets", []) if isinstance(gemini.data, dict) else []
        targets: list[BrowserbaseSynthesizedTarget] = []
        if isinstance(raw_targets, list):
            for item in raw_targets:
                if not isinstance(item, dict):
                    continue
                url = str(item.get("url") or "")
                display_name = str(item.get("display_name") or item.get("name") or url).strip()
                if not url or not display_name:
                    continue
                try:
                    score = float(item.get("relevance_score") or 0.72)
                except (TypeError, ValueError):
                    score = 0.72
                source_urls = item.get("source_urls")
                targets.append(
                    BrowserbaseSynthesizedTarget(
                        display_name=display_name[:160],
                        url=url,
                        platform=str(item.get("platform") or "web"),
                        target_type=str(item.get("target_type") or "page"),
                        role_or_context=str(item.get("role_or_context") or "") or None,
                        relevance_score=max(0.0, min(score, 1.0)),
                        why_relevant=str(item.get("why_relevant") or ""),
                        evidence_summary=str(item.get("evidence_summary") or ""),
                        outreach_angle=str(item.get("outreach_angle") or "") or None,
                        source_urls=[str(source) for source in source_urls if source] if isinstance(source_urls, list) else [url],
                        metadata=item.get("metadata") if isinstance(item.get("metadata"), dict) else {},
                    )
                )
        self.db.add_step(
            run_id,
            "extract",
            "Aggregated Browserbase evidence",
            f"{len(targets)} ranked targets synthesized by {gemini.provider}.",
            output_json={"summary": gemini.data.get("summary") if isinstance(gemini.data, dict) else None, "targets": len(targets)},
        )
        return targets

    def write_exports(self, run_id: str) -> None:
        outputs = {
            "markdown": ("research.md", render_markdown(self.db.conn, run_id), "markdown"),
            "csv": ("targets.csv", render_csv(self.db.conn, run_id), "csv"),
            "json": ("targets.json", render_json(self.db.conn, run_id), "json"),
        }
        for fmt, (filename, content, kind) in outputs.items():
            path = self.writer.write_text(f"exports/runs/{run_id}/{filename}", content)
            artifact_id = self.db.add_artifact(run_id, kind, path, f"{fmt} export")
            self.db.add_export(run_id, fmt, artifact_id)
        self.db.add_step(run_id, "export", "Generated run exports", "Markdown, CSV, and JSON exports were written under data/exports.")
