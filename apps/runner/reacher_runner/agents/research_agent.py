from __future__ import annotations

from pathlib import Path

from reacher_runner.artifacts.writer import ArtifactWriter
from reacher_runner.db import ReacherDb
from reacher_runner.exports.markdown import render_csv, render_json, render_markdown
from reacher_runner.reddit import RedditResearchClient
from reacher_runner.skills.loader import SkillLoader


class ResearchAgent:
    def __init__(self, db: ReacherDb, data_dir: Path, skills_root: Path):
        self.db = db
        self.writer = ArtifactWriter(data_dir)
        self.skills = SkillLoader(skills_root)

    def run(self, run) -> None:
        settings = self.db.settings(run)
        platforms = settings.get("platforms", ["web"])
        loaded = self.skills.load("research", platforms)
        self.db.add_step(run["id"], "plan", "Loaded browser skills", f"{len(loaded)} skill files selected for this research run.")
        if "reddit" in platforms:
            self.db.add_step(run["id"], "search", "Started Reddit public research", "Using Reddit public JSON endpoints for subreddit, post, comment, and user discovery.")
            client = RedditResearchClient()
            try:
                result = client.research(run["prompt"])
            finally:
                client.close()
            list_id = self.db.save_reddit_research(run, result)
            self.db.add_step(
                run["id"],
                "save",
                "Saved Reddit filters, targets, evidence, drafts, and list",
                f"Created list {list_id} with {len(result.posts)} posts and {len(result.comments)} comments.",
                output_json={"query": result.query, "subreddits": result.subreddits, "posts": len(result.posts), "comments": len(result.comments), "errors": result.errors},
            )
        else:
            self.db.add_step(run["id"], "search", "Prepared discovery filters", "Search/Fetch and authenticated browsing are gated behind Browserbase configuration.")
            list_id = self.db.save_research_fixture(run)
            self.db.add_step(run["id"], "save", "Saved filters, targets, evidence, and list", f"Created list {list_id}.")
        self.write_exports(run["id"])

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
